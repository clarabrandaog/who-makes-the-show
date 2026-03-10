// --- Configuration ---------------------------------------------------------

const DATA_URL = "data/workers.json";
const HIGHLIGHT_INTERVAL_MS = 18_000;
const HIGHLIGHT_VISIBLE_MS = 8_000;
const BUBBLE_SIZES = ["large", "medium", "small"];

// --- State -----------------------------------------------------------------

let workers = [];
let bubbleElementsById = new Map();
let highlightQueue = [];
let highlightIntervalId = null;
let hideTimeoutId = null;
let lastHighlightedId = null;

// --- Utility: seeded pseudo-random from worker id -------------------------

function hashStringToSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0xffffffff;
  };
}

// --- Data loading ----------------------------------------------------------

async function loadWorkers() {
  const response = await fetch(DATA_URL, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Failed to load workers JSON: ${response.status}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

// --- Bubble creation & layout ---------------------------------------------

function computeBubbleLayout(worker) {
  const seed = hashStringToSeed(String(worker.id));
  const rand = createRng(seed);

  const sizeIndex = Math.floor(rand() * BUBBLE_SIZES.length);
  const size = BUBBLE_SIZES[sizeIndex];

  // Sample a point on a sphere for a 3D starfield-like distribution
  const theta = rand() * 2 * Math.PI; // around vertical axis
  const u = rand() * 2 - 1; // cos(phi) in [-1, 1]
  const phi = Math.acos(u);

  const x = Math.sin(phi) * Math.cos(theta); // left/right
  const y = Math.sin(phi) * Math.sin(theta); // up/down
  const z = Math.cos(phi); // depth: -1 (far) to 1 (near)

  const perspective = 0.7;
  const scale = 1 / (1 + z * perspective); // nearer points project larger / further from center

  const centerTop = 50;
  const centerLeft = 50;
  const radius = 42; // how far "stars" spread from center in %

  const top = centerTop + y * radius * scale;
  const left = centerLeft + x * radius * scale;

  const depth = (z + 1) / 2; // 0 = far, 1 = near
  const floatDelay = rand() * 16;
  const floatDuration = 18 - depth * 6; // nearer bubbles float a bit slower
  const zIndex = 1 + Math.round(depth * 3); // bring nearer bubbles forward

  return { size, top, left, floatDelay, floatDuration, zIndex };
}

function createBubbleElement(worker) {
  const layout = computeBubbleLayout(worker);

  const bubble = document.createElement("button");
  bubble.className = `bubble size-${layout.size}`;
  bubble.type = "button";
  bubble.style.top = `${layout.top}%`;
  bubble.style.left = `${layout.left}%`;
  bubble.style.animationDelay = `${layout.floatDelay.toFixed(2)}s`;
  bubble.style.setProperty("--float-duration", `${layout.floatDuration.toFixed(2)}s`);
  bubble.style.zIndex = String(layout.zIndex);
  bubble.dataset.workerId = worker.id;
  bubble.setAttribute("aria-label", `${worker.name}, ${worker.department}`);

  const inner = document.createElement("div");
  inner.className = "bubble-inner";

  const floatWrapper = document.createElement("div");
  floatWrapper.className = "bubble-float";

  const img = document.createElement("img");
  img.className = "bubble-photo";
  img.src = worker.photo;
  img.alt = worker.name;
  img.loading = "lazy";

  const iconRing = document.createElement("div");
  iconRing.className = "bubble-icon-ring";

  const icon = document.createElement("img");
  icon.className = "bubble-icon";
  icon.src = worker.icon;
  icon.alt = `${worker.department} icon`;
  icon.loading = "lazy";
  iconRing.appendChild(icon);
  floatWrapper.appendChild(img);
  floatWrapper.appendChild(iconRing);
  inner.appendChild(floatWrapper);
  bubble.appendChild(inner);

  bubble.addEventListener("click", () => {
    showHighlightForWorker(worker.id, { fromUserClick: true });
  });

  return bubble;
}

function renderBubbles(workersList) {
  const layer = document.getElementById("bubble-layer");
  layer.innerHTML = "";
  bubbleElementsById.clear();

  const fragment = document.createDocumentFragment();

  workersList.forEach((worker) => {
    const bubble = createBubbleElement(worker);
    fragment.appendChild(bubble);
    bubbleElementsById.set(String(worker.id), bubble);
  });

  layer.appendChild(fragment);
}

// --- Highlight card --------------------------------------------------------

const highlightOverlayEl = document.getElementById("highlight-overlay");
const highlightCardEl = document.getElementById("highlight-card");
const highlightBackdropEl = document.getElementById("highlight-backdrop");
const highlightCloseEl = document.getElementById("highlight-close");

const highlightPhotoEl = document.getElementById("highlight-photo");
const highlightIconEl = document.getElementById("highlight-icon");
const highlightNameEl = document.getElementById("highlight-name");
const highlightDepartmentEl = document.getElementById("highlight-department");
const highlightBioEl = document.getElementById("highlight-bio");
const highlightInstagramEl = document.getElementById("highlight-instagram");
const highlightShowsEl = document.getElementById("highlight-shows");

function openHighlightOverlay() {
  highlightOverlayEl.classList.add("visible");
  highlightOverlayEl.setAttribute("aria-hidden", "false");
}

function closeHighlightOverlay() {
  highlightOverlayEl.classList.remove("visible");
  highlightOverlayEl.setAttribute("aria-hidden", "true");

  if (lastHighlightedId != null) {
    const prevBubble = bubbleElementsById.get(String(lastHighlightedId));
    if (prevBubble) {
      prevBubble.classList.remove("highlighted");
    }
  }

  lastHighlightedId = null;
}

function wireHighlightDismiss() {
  highlightBackdropEl.addEventListener("click", closeHighlightOverlay);
  highlightCloseEl.addEventListener("click", closeHighlightOverlay);

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeHighlightOverlay();
    }
  });
}

function updateHighlightCard(worker) {
  highlightPhotoEl.src = worker.photo;
  highlightPhotoEl.alt = worker.name;
  highlightIconEl.src = worker.icon;
  highlightIconEl.alt = `${worker.department} icon`;

  highlightNameEl.textContent = worker.name.toUpperCase();
  highlightDepartmentEl.textContent = worker.department;
  highlightBioEl.textContent = worker.bio;

  const handle = worker.instagram || "";
  const normalized =
    handle.startsWith("@") || handle === "" ? handle : `@${handle}`;
  highlightInstagramEl.textContent = normalized;

  const shows = Array.isArray(worker.shows) ? worker.shows : [];
  highlightShowsEl.textContent = shows.map((s) => String(s).toUpperCase()).join(
    ", "
  );
}

function scheduleAutoHide() {
  if (hideTimeoutId !== null) {
    clearTimeout(hideTimeoutId);
  }
  hideTimeoutId = window.setTimeout(() => {
    closeHighlightOverlay();
  }, HIGHLIGHT_VISIBLE_MS);
}

function showHighlightForWorker(workerId, { fromUserClick = false } = {}) {
  const worker = workers.find((w) => String(w.id) === String(workerId));
  if (!worker) return;

  if (lastHighlightedId != null && lastHighlightedId !== worker.id) {
    const prev = bubbleElementsById.get(String(lastHighlightedId));
    if (prev) prev.classList.remove("highlighted");
  }

  const bubble = bubbleElementsById.get(String(worker.id));
  if (bubble) {
    bubble.classList.add("highlighted");
  }

  lastHighlightedId = worker.id;

  updateHighlightCard(worker);
  openHighlightOverlay();
  scheduleAutoHide();

  if (fromUserClick) {
    restartHighlightCycleFrom(worker.id);
  }
}

// --- Highlight cycle management -------------------------------------------

function buildHighlightQueue() {
  const ids = workers.map((w) => w.id);
  const seed = hashStringToSeed("highlight-queue");
  const rand = createRng(seed);

  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }

  highlightQueue = ids;
}

function getNextHighlightId() {
  if (highlightQueue.length === 0) {
    buildHighlightQueue();
  }
  return highlightQueue.shift();
}

function startHighlightCycle() {
  if (!workers.length) return;
  stopHighlightCycle();

  highlightIntervalId = window.setInterval(() => {
    const id = getNextHighlightId();
    showHighlightForWorker(id);
  }, HIGHLIGHT_INTERVAL_MS);

  const firstId = getNextHighlightId();
  window.setTimeout(() => {
    showHighlightForWorker(firstId);
  }, 1500);
}

function stopHighlightCycle() {
  if (highlightIntervalId !== null) {
    clearInterval(highlightIntervalId);
    highlightIntervalId = null;
  }
}

function restartHighlightCycleFrom(currentId) {
  stopHighlightCycle();

  highlightQueue = highlightQueue.filter(
    (id) => String(id) !== String(currentId)
  );

  if (!highlightQueue.length) {
    buildHighlightQueue();
  }

  startHighlightCycle();
}

// --- Init ------------------------------------------------------------------

async function init() {
  try {
    workers = await loadWorkers();
    if (!workers.length) return;

    renderBubbles(workers);
    buildHighlightQueue();
    wireHighlightDismiss();
    startHighlightCycle();
  } catch (error) {
    console.error(error);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}

