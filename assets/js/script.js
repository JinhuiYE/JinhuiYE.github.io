const menuButton = document.querySelector(".menu-toggle");
const navigation = document.querySelector(".site-nav");
const navigationLinks = document.querySelectorAll(".site-nav a");
const filterButtons = document.querySelectorAll(".filter");
const publicationItems = document.querySelectorAll(".publication-item");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const compactNavigation = window.matchMedia("(max-width: 860px)");

if (menuButton && navigation) {
  const menuLabel = menuButton.textContent.trim() || "Menu";
  const closeLabel = document.documentElement.lang.startsWith("zh") ? "关闭" : "Close";

  function setMenu(open, restoreFocus = false) {
    const collapsed = compactNavigation.matches;
    const isOpen = collapsed && open;
    if ((restoreFocus || (collapsed && !isOpen && navigation.contains(document.activeElement))) && collapsed) {
      menuButton.focus({ preventScroll: true });
    }
    navigation.classList.toggle("is-open", isOpen);
    navigation.hidden = collapsed && !isOpen;
    navigation.inert = collapsed && !isOpen;
    menuButton.setAttribute("aria-expanded", String(isOpen));
    menuButton.textContent = isOpen ? closeLabel : menuLabel;
  }

  menuButton.addEventListener("click", () => setMenu(!navigation.classList.contains("is-open")));
  navigationLinks.forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("pointerdown", (event) => {
    if (navigation.classList.contains("is-open") && !navigation.contains(event.target) && !menuButton.contains(event.target)) {
      setMenu(false);
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && navigation.classList.contains("is-open")) {
      event.preventDefault();
      setMenu(false, true);
    }
  });
  navigation.addEventListener("focusout", (event) => {
    if (event.relatedTarget && !navigation.contains(event.relatedTarget) && event.relatedTarget !== menuButton) {
      setMenu(false);
    }
  });
  compactNavigation.addEventListener("change", () => {
    setMenu(false);
    if (!compactNavigation.matches && document.activeElement === menuButton) {
      navigationLinks[0]?.focus({ preventScroll: true });
    }
  });
  navigation.dataset.collapsible = "";
  document.documentElement.classList.add("js");
  setMenu(false);
}

function filterPublications(category) {
  let count = 0;
  filterButtons.forEach((button) => {
    const active = button.dataset.filter === category;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  publicationItems.forEach((item) => {
    item.hidden = category !== "all" && item.dataset.category !== category;
    if (!item.hidden) count += 1;
  });
  const status = document.querySelector(".publication-count");
  if (status) status.textContent = `${count} ${count === 1 ? "publication" : "publications"}`;
}

if (filterButtons.length) {
  document.querySelector(".publication-tools").hidden = false;
  filterButtons.forEach((button) => button.addEventListener("click", () => filterPublications(button.dataset.filter)));
  filterPublications("all");
}

const demoTabs = [...document.querySelectorAll("[data-demo]")];
const demoPanels = [...document.querySelectorAll(".current-work[role='tabpanel']")];
let activeDemo = demoPanels[0];
let userPausedDemo = false;
const showcase = document.querySelector(".research-showcase");
let rotationEnabled = !reduceMotion.matches;
let rotationTimer;
let showcaseVisible = false;
let showcaseFocused = false;
const rotationDelay = 10000;

function scheduleRotation() {
  clearTimeout(rotationTimer);
  showcase?.classList.remove("is-rotating");
  if (!rotationEnabled || document.hidden || !showcaseVisible || showcaseFocused) return;
  showcase?.classList.add("is-rotating");
  rotationTimer = setTimeout(() => {
    selectDemo((demoPanels.indexOf(activeDemo) + 1) % demoPanels.length);
  }, rotationDelay);
}
function setRotation(enabled) {
  rotationEnabled = enabled;
  scheduleRotation();
}

function syncDemoControl(panel) {
  const video = panel.querySelector("video");
  const button = panel.querySelector(".video-control");
  const name = panel.querySelector("h3").textContent;
  button.classList.toggle("is-paused", video.paused);
  button.title = video.paused ? "Click to play" : "Click to pause";
  button.setAttribute("aria-label", `${video.paused ? "Play" : "Pause"} ${name} demo`);
}

async function playDemo(panel) {
  const video = panel.querySelector("video");
  try { await video.play(); } catch { /* Keep the poster and manual play button available. */ }
  syncDemoControl(panel);
}

function selectDemo(index, moveFocus = false) {
  const chosen = demoPanels[index];
  if (!chosen) return;
  demoTabs.forEach((tab, i) => {
    tab.setAttribute("aria-selected", String(i === index));
    tab.tabIndex = i === index ? 0 : -1;
  });
  demoPanels.forEach((panel) => {
    const selected = panel === chosen;
    panel.hidden = !selected;
    if (!selected) panel.querySelector("video").pause();
  });
  activeDemo = chosen;
  if (moveFocus) demoTabs[index].focus();
  if (!reduceMotion.matches && !userPausedDemo && showcaseVisible && !document.hidden) playDemo(chosen);
  scheduleRotation();
}

demoPanels.forEach((panel) => {
  const video = panel.querySelector("video");
  const button = panel.querySelector(".video-control");
  video.controls = false;
  button.hidden = false;
  ["play", "pause", "error"].forEach((type) => video.addEventListener(type, () => syncDemoControl(panel)));
  button.addEventListener("click", () => {
    setRotation(false);
    userPausedDemo = !video.paused;
    if (video.paused) {
      if (video.error) video.load();
      playDemo(panel);
    } else video.pause();
  });
  syncDemoControl(panel);
});
demoTabs.forEach((tab, index) => {
  tab.addEventListener("click", () => { setRotation(false); selectDemo(index); });
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % demoTabs.length;
    if (event.key === "ArrowLeft") next = (index - 1 + demoTabs.length) % demoTabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = demoTabs.length - 1;
    if (next !== undefined) { event.preventDefault(); setRotation(false); selectDemo(next, true); }
  });
});
if (demoTabs.length) selectDemo(0);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) demoPanels.forEach((panel) => panel.querySelector("video").pause());
  else if (activeDemo && showcaseVisible && !reduceMotion.matches && !userPausedDemo) playDemo(activeDemo);
  scheduleRotation();
});

if (showcase && demoTabs.length > 1) {
  showcase.addEventListener("focusin", () => { showcaseFocused = true; scheduleRotation(); });
  showcase.addEventListener("focusout", (event) => {
    showcaseFocused = showcase.contains(event.relatedTarget);
    scheduleRotation();
  });
  if ("IntersectionObserver" in window) {
    const demoObserver = new IntersectionObserver(([entry]) => {
      showcaseVisible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
      if (!showcaseVisible) activeDemo.querySelector("video").pause();
      else if (!reduceMotion.matches && !userPausedDemo && !document.hidden) playDemo(activeDemo);
      scheduleRotation();
    }, { threshold: 0.25 });
    demoObserver.observe(showcase);
  } else showcaseVisible = true;
  setRotation(rotationEnabled);
}

const newsExpand = document.querySelector("#news-expand");
const newsList = document.querySelector("#news-list");
if (newsExpand && newsList) {
  newsExpand.hidden = false;
  newsExpand.addEventListener("click", () => {
    const expanded = newsList.classList.toggle("is-expanded");
    newsExpand.setAttribute("aria-expanded", String(expanded));
    newsExpand.textContent = expanded ? "Show less ↑" : "Show all ↓";
    newsExpand.previousElementSibling.textContent = expanded ? "All updates" : "Scroll for earlier updates";
    if (!expanded) newsList.scrollTop = 0;
  });
}

if ("IntersectionObserver" in window && !reduceMotion.matches) {
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.remove("is-pending");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08 },
  );
  document.querySelectorAll(".reveal").forEach((element) => {
    element.classList.add("is-pending");
    revealObserver.observe(element);
  });
}

reduceMotion.addEventListener("change", (event) => {
  if (event.matches) {
    setRotation(false);
    demoPanels.forEach((panel) => panel.querySelector("video").pause());
    document.querySelectorAll(".is-pending").forEach((element) => element.classList.remove("is-pending"));
  }
});

const year = document.querySelector("#year");
if (year) year.textContent = String(new Date().getFullYear());

const figureDialog = document.querySelector("#figure-dialog");
if (figureDialog && typeof figureDialog.showModal === "function") {
  let figureOpener;
  let scrollState;
  const scrollStyles = ["position", "top", "left", "width", "overflow", "padding-right"];

  function updateFigureViewport() {
    if (!figureDialog.open) return;
    figureDialog.style.setProperty("--figure-viewport-height", `${window.visualViewport?.height || window.innerHeight}px`);
  }

  function lockFigureScroll() {
    const body = document.body;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    scrollState = {
      x: window.scrollX,
      y: window.scrollY,
      hadDialogClass: body.classList.contains("has-dialog"),
      styles: scrollStyles.map((property) => [property, body.style.getPropertyValue(property), body.style.getPropertyPriority(property)]),
    };
    if (scrollbarWidth > 0) {
      body.style.setProperty("padding-right", `${parseFloat(getComputedStyle(body).paddingRight) + scrollbarWidth}px`);
    }
    body.style.position = "fixed";
    body.style.top = `${-scrollState.y}px`;
    body.style.left = `${-scrollState.x}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.classList.add("has-dialog");
  }

  function restoreFigureScroll() {
    if (!scrollState) return;
    const rootStyle = document.documentElement.style;
    const previousBehavior = rootStyle.getPropertyValue("scroll-behavior");
    const previousPriority = rootStyle.getPropertyPriority("scroll-behavior");
    rootStyle.setProperty("scroll-behavior", "auto", "important");
    scrollState.styles.forEach(([property, value, priority]) => {
      if (value) document.body.style.setProperty(property, value, priority);
      else document.body.style.removeProperty(property);
    });
    if (!scrollState.hadDialogClass) document.body.classList.remove("has-dialog");
    window.scrollTo(scrollState.x, scrollState.y);
    if (previousBehavior) rootStyle.setProperty("scroll-behavior", previousBehavior, previousPriority);
    else rootStyle.removeProperty("scroll-behavior");
    scrollState = undefined;
  }

  document.querySelectorAll("[data-lightbox]").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      if (figureDialog.open) return;
      figureOpener = link;
      const source = link.querySelector("img");
      const enlarged = new Image();
      enlarged.src = link.href;
      enlarged.alt = source.alt;
      figureDialog.querySelector(".figure-image").replaceChildren(enlarged);
      figureDialog.querySelector("figcaption").textContent = source.alt;
      lockFigureScroll();
      figureDialog.showModal();
      updateFigureViewport();
      figureDialog.querySelector(".dialog-close").focus({ preventScroll: true });
    });
  });
  figureDialog.querySelector(".dialog-close").addEventListener("click", () => figureDialog.close());
  figureDialog.addEventListener("click", (event) => {
    if (event.target !== figureDialog) return;
    const bounds = figureDialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) {
      figureDialog.close();
    }
  });
  figureDialog.addEventListener("close", () => {
    restoreFigureScroll();
    if (figureOpener?.isConnected) figureOpener.focus({ preventScroll: true });
  });
  window.addEventListener("resize", updateFigureViewport, { passive: true });
  window.visualViewport?.addEventListener("resize", updateFigureViewport, { passive: true });
}

const sectionLinks = [...navigationLinks].filter((link) => link.getAttribute("href").startsWith("#"));
const sections = sectionLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
if (sections.length) {
  let pending = false;
  const markSection = () => {
    const current = sections.filter((section) => section.getBoundingClientRect().top <= 180).at(-1) || sections[0];
    sectionLinks.forEach((link) => {
      if (link.hash === `#${current.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    pending = false;
  };
  window.addEventListener("scroll", () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(markSection);
    }
  }, { passive: true });
  markSection();
}
