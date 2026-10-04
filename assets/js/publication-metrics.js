const REQUEST_TIMEOUT = 8000;
const CACHE_PREFIX = 'jinhui:publication-metrics:';
const providers = {
  github: { name: 'GitHub', label: 'Stars', idKey: 'repo', attribute: 'githubRepo', selector: '[data-github-repo]', ttl: 6 * 60 * 60 * 1000 },
  'semantic-scholar': { name: 'Semantic Scholar', label: 'Citations', idKey: 'paperId', attribute: 'semanticScholarId', selector: '[data-semantic-scholar-id]', ttl: 24 * 60 * 60 * 1000 },
};

export function normalizeGithubRepo(value) {
  if (typeof value !== 'string') return null;
  const repo = value.trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?\/[a-z0-9_.-]{1,100}$/i.test(repo)) return null;
  if (['.', '..'].includes(repo.split('/')[1])) return null;
  return repo.toLowerCase();
}

export function semanticScholarId(value) {
  return typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) ? value : null;
}

const validCount = (count) => Number.isSafeInteger(count) && count >= 0;
const normalizeId = (value, source) => source === 'github' ? normalizeGithubRepo(value) : semanticScholarId(value);
const cacheKey = (source, id) => `${CACHE_PREFIX}${source}:v1:${id}`;

export function githubStarCount(payload, repo) {
  const normalized = normalizeGithubRepo(repo);
  if (!normalized || !payload || normalizeGithubRepo(payload.full_name) !== normalized) return null;
  return validCount(payload.stargazers_count) ? payload.stargazers_count : null;
}

export function semanticScholarCitationCount(payload, id) {
  if (!semanticScholarId(id) || !payload || payload.paperId !== id) return null;
  return validCount(payload.citationCount) ? payload.citationCount : null;
}

function parseCache(raw, id, source, now) {
  try {
    const value = JSON.parse(raw);
    const provider = providers[source];
    if (!normalizeId(id, source) || !value || value.version !== 1 || normalizeId(value[provider.idKey], source) !== id
      || !validCount(value.count) || !Number.isSafeInteger(value.updatedAt)
      || value.updatedAt <= 0 || value.updatedAt > now) return null;
    return { id, count: value.count, updatedAt: value.updatedAt, stale: now - value.updatedAt >= provider.ttl };
  } catch { return null; }
}

export function parseGithubCache(raw, repo, now = Date.now()) {
  return parseCache(raw, normalizeGithubRepo(repo), 'github', now);
}

export function parseSemanticScholarCache(raw, id, now = Date.now()) {
  return parseCache(raw, id, 'semantic-scholar', now);
}

export function parseMetricSnapshot(dataset, now = Date.now()) {
  const countText = dataset.metricSnapshotValue;
  const timestamp = dataset.metricSnapshotAt;
  if (typeof countText !== 'string' || !/^(?:0|[1-9]\d*)$/.test(countText)
    || typeof timestamp !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(timestamp)) return null;
  const count = Number(countText);
  const updatedAt = Date.parse(timestamp);
  if (!validCount(count) || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > now
    || new Date(updatedAt).toISOString().slice(0, 19) !== timestamp.slice(0, 19)) return null;
  return { count, updatedAt };
}

function localStorageOrNull() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function cachedMetric(storage, id, source, now) {
  try { return parseCache(storage?.getItem(cacheKey(source, id)), id, source, now); }
  catch { return null; }
}

function saveMetric(storage, metric, source) {
  const { count, updatedAt, id } = metric;
  try { storage?.setItem(cacheKey(source, id), JSON.stringify({ version: 1, [providers[source].idKey]: id, count, updatedAt })); }
  catch { /* Metrics still work when browser storage is unavailable or full. */ }
}

function displayMetric(nodes, metric, source, state) {
  const provider = providers[source];
  const count = metric.count.toLocaleString('en-US');
  const timestamp = new Date(metric.updatedAt).toISOString();
  const time = timestamp.slice(0, 16).replace('T', ' ') + ' UTC';
  const origin = state === 'snapshot' ? 'Snapshot' : state === 'live' ? 'Updated' : 'Cached';
  const identity = source === 'github' ? ` · ${metric.id}` : '';
  const description = `${provider.name} · ${count} ${provider.label}${identity} · ${origin} ${time}`;
  nodes.forEach(({ link, value }) => {
    value.textContent = `${count} ${provider.label}`;
    link.setAttribute('title', description);
    link.setAttribute('aria-label', description);
    link.dataset.metricSource = source;
    link.dataset.metricState = state;
    link.dataset.metricUpdatedAt = timestamp;
    if (state === 'cached' || state === 'stale') link.dataset.metricCachedAt = timestamp;
    else delete link.dataset.metricCachedAt;
  });
}

function prepareMetrics(page, storage, source, now) {
  const provider = providers[source];
  const groups = new Map();
  page.querySelectorAll(provider.selector).forEach((link) => {
    const id = normalizeId(link.dataset[provider.attribute], source);
    const value = link.querySelector('[data-metric-value]');
    if (!id || !value) return;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ link, value });
  });
  const pending = [];
  groups.forEach((nodes, id) => {
    const snapshots = nodes.map(({ link }) => parseMetricSnapshot(link.dataset, now)).filter(Boolean);
    const snapshot = snapshots.sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const cached = cachedMetric(storage, id, source, now);
    const useCache = cached && (!snapshot || cached.updatedAt >= snapshot.updatedAt);
    if (useCache) displayMetric(nodes, cached, source, cached.stale ? 'stale' : 'cached');
    else if (snapshot) displayMetric(nodes, { id, ...snapshot }, source, 'snapshot');
    // A bundled snapshot is a fallback, never a reason to skip a live refresh.
    if (!useCache || cached.stale) pending.push({ id, nodes });
  });
  return pending;
}

async function withTimeout(request, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Publication metric request timed out.'));
    }, timeoutMs);
  });
  try { return await Promise.race([request(controller.signal), timeout]); }
  catch { return null; }
  finally { clearTimeout(timer); }
}

async function refreshGithub(pending, { fetchImpl, timeoutMs, now, storage }, concurrency) {
  let cursor = 0;
  let stopped = false;
  async function worker() {
    while (cursor < pending.length && !stopped) {
      const { id, nodes } = pending[cursor++];
      const metric = await withTimeout(async (signal) => {
        const response = await fetchImpl(`https://api.github.com/repos/${id}`, {
          headers: { Accept: 'application/vnd.github+json' }, mode: 'cors', credentials: 'omit', signal,
        });
        if (response.status === 403 || response.status === 429) stopped = true;
        if (!response.ok) return null;
        const count = githubStarCount(await response.json(), id);
        return count === null ? null : { id, count, updatedAt: now() };
      }, timeoutMs);
      if (!metric) continue;
      displayMetric(nodes, metric, 'github', 'live');
      saveMetric(storage, metric, 'github');
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, pending.length) }, worker));
}

async function refreshSemanticScholar(pending, { fetchImpl, timeoutMs, now, storage }) {
  if (!pending.length) return;
  const payload = await withTimeout(async (signal) => {
    const response = await fetchImpl('https://api.semanticscholar.org/graph/v1/paper/batch?fields=paperId,title,citationCount,url', {
      method: 'POST',
      // This safelisted content type keeps the anonymous POST a simple CORS request.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ids: pending.map(({ id }) => id) }),
      mode: 'cors', credentials: 'omit', signal,
    });
    return response.ok ? response.json() : null;
  }, timeoutMs);
  if (!Array.isArray(payload)) return;
  const entries = new Map(payload.filter((entry) => semanticScholarId(entry?.paperId)).map((entry) => [entry.paperId, entry]));
  pending.forEach(({ id, nodes }) => {
    const count = semanticScholarCitationCount(entries.get(id), id);
    if (count === null) return;
    const metric = { id, count, updatedAt: now() };
    displayMetric(nodes, metric, 'semantic-scholar', 'live');
    saveMetric(storage, metric, 'semantic-scholar');
  });
}

export async function initPublicationMetrics({
  document: page = globalThis.document,
  storage = localStorageOrNull(),
  fetch: fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT,
} = {}) {
  if (!page?.querySelectorAll) return;
  const github = prepareMetrics(page, storage, 'github', now());
  const citations = prepareMetrics(page, storage, 'semantic-scholar', now());
  if (typeof fetchImpl !== 'function') return;
  const options = { fetchImpl, timeoutMs, now, storage };
  // Reserve one slot for the single citation batch; total concurrency stays at three.
  await Promise.all([
    refreshGithub(github, options, citations.length ? 2 : 3),
    refreshSemanticScholar(citations, options),
  ]);
}

if (typeof document !== 'undefined') {
  const initialize = () => { initPublicationMetrics().catch(() => {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
