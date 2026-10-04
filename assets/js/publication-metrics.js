const REQUEST_TIMEOUT = 8000;
const CACHE_PREFIX = 'jinhui:publication-metrics:';
const providers = {
  github: { name: 'GitHub', label: 'Stars', idKey: 'repo', attribute: 'githubRepo', selector: '[data-github-repo]', ttl: 6 * 60 * 60 * 1000 },
  'semantic-scholar': { name: 'Semantic Scholar', label: 'Citations', idKey: 'paperId', attribute: 'semanticScholarId', selector: '[data-semantic-scholar-id], [data-semantic-scholar-ids]', ttl: 24 * 60 * 60 * 1000 },
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

export function semanticScholarIds(dataset) {
  if (dataset.semanticScholarIds !== undefined) {
    if (typeof dataset.semanticScholarIds !== 'string') return [];
    const ids = dataset.semanticScholarIds.split(',').map((id) => id.trim());
    if (ids.length < 2 || ids.some((id) => !semanticScholarId(id)) || new Set(ids).size !== ids.length) return [];
    return ids;
  }
  const id = semanticScholarId(dataset.semanticScholarId);
  return id ? [id] : [];
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

const metricTime = (updatedAt) => new Date(updatedAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

function displayMetric(nodes, metric, source, state, descriptionOverride) {
  const provider = providers[source];
  const count = metric.count.toLocaleString('en-US');
  const timestamp = new Date(metric.updatedAt).toISOString();
  const time = metricTime(metric.updatedAt);
  const origin = state === 'snapshot' ? 'Snapshot' : state === 'live' ? 'Updated' : 'Cached';
  const identity = source === 'github' ? ` · ${metric.id}` : '';
  const description = descriptionOverride || `${provider.name} · ${count} ${provider.label}${identity} · ${origin} ${time}`;
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

function citationComponents(raw, ids, now) {
  const components = new Map();
  try {
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return components;
    entries.forEach((entry) => {
      if (!entry || !ids.includes(entry.id) || !validCount(entry.value)) return;
      const snapshot = parseMetricSnapshot({ metricSnapshotValue: String(entry.value), metricSnapshotAt: entry.fetched_at }, now);
      if (snapshot && (!components.has(entry.id) || components.get(entry.id).updatedAt < snapshot.updatedAt)) {
        components.set(entry.id, { id: entry.id, ...snapshot });
      }
    });
  } catch { /* An unavailable component cannot be treated as zero. */ }
  return components;
}

function displayCitationBadge(badge, papers) {
  const { ids, link, value, snapshot } = badge;
  const components = ids.map((id) => papers.get(id).metric);
  if (ids.length === 1) {
    if (components[0]) displayMetric([{ link, value }], components[0], 'semantic-scholar', components[0].state);
    return;
  }

  const label = link.dataset.metricCombinedLabel?.trim() || `${ids.length} papers`;
  if (components.every(Boolean)) {
    const count = components.reduce((sum, component) => sum + component.count, 0);
    const updatedAt = Math.min(...components.map((component) => component.updatedAt));
    if (validCount(count) && (!snapshot || updatedAt >= snapshot.updatedAt)) {
      const states = new Set(components.map((component) => component.state));
      const state = states.size === 1 ? components[0].state : 'mixed';
      const labels = label.split(/\s*\+\s*/);
      const details = components.map((component, index) => {
        const name = labels.length === ids.length ? labels[index] : component.id;
        const origin = { live: 'Updated', snapshot: 'Snapshot', cached: 'Cached', stale: 'Stale cache' }[component.state];
        return `${name}: ${component.count.toLocaleString('en-US')} (${origin} ${metricTime(component.updatedAt)})`;
      }).join(' + ');
      const description = `Semantic Scholar · ${count.toLocaleString('en-US')} Citations · Sum of ${label} · ${details} · Oldest component ${metricTime(updatedAt)}`;
      displayMetric([{ link, value }], { count, updatedAt }, 'semantic-scholar', state, description);
      return;
    }
  }
  // A complete verified total is safer than showing only the returned component.
  if (snapshot) {
    const description = `Semantic Scholar · ${snapshot.count.toLocaleString('en-US')} Citations · Sum of ${label} · Snapshot ${metricTime(snapshot.updatedAt)}`;
    displayMetric([{ link, value }], snapshot, 'semantic-scholar', 'snapshot', description);
  }
}

function prepareCitationMetrics(page, storage, now) {
  const badges = [];
  const snapshots = new Map();
  page.querySelectorAll(providers['semantic-scholar'].selector).forEach((link) => {
    const ids = semanticScholarIds(link.dataset);
    const value = link.querySelector('[data-metric-value]');
    if (!ids.length || !value) return;
    const snapshot = parseMetricSnapshot(link.dataset, now);
    badges.push({ ids, link, value, snapshot });
    const components = ids.length > 1 ? citationComponents(link.dataset.metricComponents, ids, now)
      : new Map(snapshot ? [[ids[0], { id: ids[0], ...snapshot }]] : []);
    components.forEach((component, id) => {
      if (!snapshots.has(id) || snapshots.get(id).updatedAt < component.updatedAt) snapshots.set(id, component);
    });
  });

  const papers = new Map();
  badges.forEach(({ ids }) => ids.forEach((id) => {
    if (papers.has(id)) return;
    const snapshot = snapshots.get(id);
    const cached = cachedMetric(storage, id, 'semantic-scholar', now);
    const useCache = cached && (!snapshot || cached.updatedAt >= snapshot.updatedAt);
    const metric = useCache ? { ...cached, state: cached.stale ? 'stale' : 'cached' }
      : snapshot ? { ...snapshot, state: 'snapshot' } : null;
    papers.set(id, { metric, needsRefresh: !useCache || cached.stale });
  }));

  const pending = new Set();
  badges.forEach(({ ids }) => {
    // Refresh all parts of an aggregate together, even if one part has a fresh cache.
    if (ids.some((id) => papers.get(id).needsRefresh)) ids.forEach((id) => pending.add(id));
  });
  const render = () => badges.forEach((badge) => displayCitationBadge(badge, papers));
  render();
  return { pending: [...pending], papers, render };
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

async function refreshSemanticScholar({ pending, papers, render }, { fetchImpl, timeoutMs, now, storage }) {
  if (!pending.length) return;
  const payload = await withTimeout(async (signal) => {
    const response = await fetchImpl('https://api.semanticscholar.org/graph/v1/paper/batch?fields=paperId,title,citationCount,url', {
      method: 'POST',
      // This safelisted content type keeps the anonymous POST a simple CORS request.
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ ids: pending }),
      mode: 'cors', credentials: 'omit', signal,
    });
    return response.ok ? response.json() : null;
  }, timeoutMs);
  if (!Array.isArray(payload)) return;
  const entries = new Map(payload.filter((entry) => semanticScholarId(entry?.paperId)).map((entry) => [entry.paperId, entry]));
  pending.forEach((id) => {
    const count = semanticScholarCitationCount(entries.get(id), id);
    if (count === null) return;
    const metric = { id, count, updatedAt: now() };
    papers.get(id).metric = { ...metric, state: 'live' };
    saveMetric(storage, metric, 'semantic-scholar');
  });
  render();
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
  const citations = prepareCitationMetrics(page, storage, now());
  if (typeof fetchImpl !== 'function') return;
  const options = { fetchImpl, timeoutMs, now, storage };
  // Reserve one slot for the single citation batch; total concurrency stays at three.
  await Promise.all([
    refreshGithub(github, options, citations.pending.length ? 2 : 3),
    refreshSemanticScholar(citations, options),
  ]);
}

if (typeof document !== 'undefined') {
  const initialize = () => { initPublicationMetrics().catch(() => {}); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
