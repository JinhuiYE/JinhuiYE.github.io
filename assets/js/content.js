document.querySelectorAll('[data-local-only]').forEach((element) => {
  element.hidden = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
});

const printCV = document.querySelector('#print-cv');
if (printCV) {
  printCV.hidden = false;
  printCV.addEventListener('click', () => window.print());
}

const searchField = document.querySelector('#post-search');
const topicButtons = [...document.querySelectorAll('[data-tag]')];
const postPreviews = [...document.querySelectorAll('[data-post]')];
if (searchField) {
  document.querySelector('.archive-tools').hidden = false;
  let activeTopic = '';
  function filterPosts() {
    const query = searchField.value.trim().toLocaleLowerCase();
    let count = 0;
    postPreviews.forEach((post) => {
      const matchesTopic = !activeTopic || JSON.parse(post.dataset.tags).includes(activeTopic);
      const matchesSearch = post.dataset.search.toLocaleLowerCase().includes(query);
      post.hidden = !(matchesTopic && matchesSearch);
      if (!post.hidden) count += 1;
    });
    document.querySelector('#post-count').textContent = `${count} ${count === 1 ? 'post' : 'posts'}`;
    document.querySelector('.search-empty').hidden = count !== 0;
  }
  searchField.addEventListener('input', filterPosts);
  topicButtons.forEach((button) => button.addEventListener('click', () => {
    activeTopic = button.dataset.tag;
    topicButtons.forEach((topic) => topic.setAttribute('aria-pressed', String(topic === button)));
    filterPosts();
  }));
}

document.querySelectorAll('#article-body pre').forEach((block) => {
  if (!navigator.clipboard) return;
  const code = block.querySelector('code');
  if (!code) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'copy-code';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', 'Copy code');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code.textContent);
      button.textContent = 'Copied';
    } catch { button.textContent = 'Unable to copy'; }
    setTimeout(() => { button.textContent = 'Copy'; }, 2000);
  });
  block.prepend(button);
});

const articleBody = document.querySelector('#article-body');
if (articleBody) {
  const progress = document.querySelector('.reading-progress');
  const tocLinks = [...document.querySelectorAll('.article-toc a')];
  const headings = tocLinks.map((link) => document.getElementById(decodeURIComponent(link.hash.slice(1))));
  let scheduled = false;
  function updateReading() {
    const rect = articleBody.getBoundingClientRect();
    const distance = Math.max(1, rect.height - innerHeight + 120);
    progress.style.transform = `scaleX(${Math.max(0, Math.min(1, (120 - rect.top) / distance))})`;
    const current = headings.filter((heading) => heading && heading.getBoundingClientRect().top <= 150).at(-1);
    tocLinks.forEach((link, i) => {
      if (headings[i] === current) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    });
    scheduled = false;
  }
  const scheduleReading = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(updateReading);
  };
  addEventListener('scroll', scheduleReading, { passive: true });
  addEventListener('resize', scheduleReading);
  updateReading();
}
