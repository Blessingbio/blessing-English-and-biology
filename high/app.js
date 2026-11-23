const PDF_URL = "./高频词汇背诵表.pdf";
const PDFJS_WORKER_URL = "./vendor/pdf.worker.min.js";

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

if (window.__PDFJS_WORKER_BASE64__) {
  const workerBlob = new Blob([base64ToBytes(window.__PDFJS_WORKER_BASE64__)], {
    type: "text/javascript"
  });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
}

const dom = {
  app: document.getElementById("app"),
  viewer: document.getElementById("viewer"),
  pageScroll: document.getElementById("pageScroll"),
  pageShell: document.getElementById("pageShell"),
  canvas: document.getElementById("pdfCanvas"),
  textLayer: document.getElementById("textLayer"),
  tapHighlight: document.getElementById("tapHighlight"),
  loading: document.getElementById("loading"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingSubtitle: document.getElementById("loadingSubtitle"),
  loadingBar: document.getElementById("loadingBar"),
  hint: document.getElementById("hint"),
  bottomBar: document.getElementById("bottomBar"),
  showControlsButton: document.getElementById("showControlsButton"),
  pageInput: document.getElementById("pageInput"),
  pageTotal: document.getElementById("pageTotal"),
  pageStatusText: document.getElementById("pageStatusText"),
  progressBar: document.getElementById("progressBar"),
  previousButton: document.getElementById("previousButton"),
  nextButton: document.getElementById("nextButton"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  settingsButton: document.getElementById("settingsButton"),
  settingsSheet: document.getElementById("settingsSheet"),
  voiceSelect: document.getElementById("voiceSelect"),
  rateRange: document.getElementById("rateRange"),
  rateValue: document.getElementById("rateValue"),
  toast: document.getElementById("toast"),
  wordAnnouncement: document.getElementById("wordAnnouncement")
};

const state = {
  pdf: null,
  pageNumber: 1,
  pageCount: 123,
  page: null,
  viewport: null,
  renderTask: null,
  zoom: 1,
  baseScale: 1,
  voice: null,
  voices: [],
  rate: 0.88,
  loading: true,
  controlsTimer: 0,
  hideHintTimer: 0,
  touchStart: null,
  suppressTap: false
};

function showToast(text) {
  dom.toast.textContent = text;
  dom.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.remove("is-visible"), 2200);
}

function updateLoading(percent, title, subtitle) {
  dom.loadingBar.style.width = `${Math.max(4, Math.min(100, percent))}%`;
  if (title) dom.loadingTitle.textContent = title;
  if (subtitle) dom.loadingSubtitle.textContent = subtitle;
}

function hideLoading() {
  state.loading = false;
  dom.loading.classList.add("is-hidden");
  dom.hint.classList.add("is-visible");
  clearTimeout(state.hideHintTimer);
  state.hideHintTimer = setTimeout(() => dom.hint.classList.remove("is-visible"), 4500);
}

function loadSavedPreferences() {
  try {
    const savedPage = Number(localStorage.getItem("pdf-reader-page") || "1");
    const savedRate = Number(localStorage.getItem("pdf-reader-rate") || "0.88");
    state.pageNumber = Math.max(1, savedPage);
    state.rate = Math.max(0.6, Math.min(1.1, savedRate));
    dom.rateRange.value = String(state.rate);
    dom.rateValue.textContent = `${state.rate.toFixed(2)}×`;
  } catch (_) {
    state.pageNumber = 1;
  }
}

function englishVoices() {
  if (!("speechSynthesis" in window)) return [];
  const voices = window.speechSynthesis.getVoices().filter((voice) => {
    return /^en([-_]|$)/i.test(voice.lang) || /English/i.test(voice.name);
  });
  return voices.sort((left, right) => voiceScore(right) - voiceScore(left));
}

function voiceScore(voice) {
  const name = voice.name || "";
  const lang = voice.lang || "";
  let score = 0;
  if (/siri/i.test(name)) score += 1000;
  if (/premium|neural/i.test(name)) score += 650;
  if (/enhanced/i.test(name)) score += 500;
  if (/samantha|daniel|serena|ava|allison|susan|karen|moira|tessa/i.test(name)) score += 350;
  if (/kathy|eddy|flo|reed|rocko|sandy|shelley/i.test(name)) score += 150;
  if (/^en[-_]US$/i.test(lang)) score += 100;
  if (/^en[-_]GB$/i.test(lang)) score += 90;
  if (voice.localService) score += 20;
  if (/^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Fred|Good News|Grandma|Grandpa|Jester|Junior|Organ|Superstar|Ralph|Trinoids|Whisper|Wobble|Zarvox)$/i.test(name)) {
    score -= 1000;
  }
  return score;
}

function populateVoices() {
  const voices = englishVoices();
  state.voices = voices;
  if (!voices.length) {
    dom.voiceSelect.innerHTML = '<option value="">使用 iPad 默认英文声音</option>';
    dom.voiceSelect.value = "";
    state.voice = null;
    return;
  }
  const saved = localStorage.getItem("pdf-reader-voice") || "";
  dom.voiceSelect.replaceChildren();
  voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    const qualityMark = /siri|premium|neural|enhanced/i.test(voice.name) ? "★ " : "";
    option.textContent = `${qualityMark}${voice.name} · ${voice.lang}`;
    dom.voiceSelect.appendChild(option);
  });
  const preferred =
    voices.find((voice) => voice.name === saved && voiceScore(voice) >= 0) ||
    voices[0];
  state.voice = preferred;
  dom.voiceSelect.value = preferred.name;
}

function chooseVoice(name) {
  state.voice = state.voices.find((voice) => voice.name === name) || null;
  try {
    localStorage.setItem("pdf-reader-voice", name);
  } catch (_) {}
}

function speakWord(word) {
  const clean = String(word || "").trim();
  if (!clean) return;
  if (!("speechSynthesis" in window)) {
    showToast("当前浏览器不支持语音朗读。");
    return;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(clean);
  if (state.voice) utterance.voice = state.voice;
  utterance.lang = state.voice?.lang || "en-US";
  utterance.rate = state.rate;
  utterance.pitch = 1;
  utterance.volume = 1;
  dom.wordAnnouncement.textContent = clean;
  window.speechSynthesis.speak(utterance);
}

function fitScale(baseViewport) {
  const horizontalPadding = window.innerWidth < 700 ? 20 : 44;
  const verticalPadding = 112;
  const viewerWidth = dom.viewer.clientWidth || window.innerWidth;
  const viewerHeight =
    dom.viewer.clientHeight ||
    Math.max(320, (window.visualViewport?.height || window.innerHeight) - 58);
  const availableWidth = Math.max(260, viewerWidth - horizontalPadding);
  const availableHeight = Math.max(240, viewerHeight - verticalPadding);
  const fit = Math.min(
    availableWidth / baseViewport.width,
    availableHeight / baseViewport.height
  );
  return Math.max(0.42, fit);
}

async function waitForViewerLayout() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (dom.viewer.clientWidth > 0 && dom.viewer.clientHeight > 0) return;
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
}

async function renderPage() {
  if (!state.pdf) return;
  if (state.renderTask) {
    try {
      state.renderTask.cancel();
    } catch (_) {}
  }

  await waitForViewerLayout();
  const page = await state.pdf.getPage(state.pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  state.baseScale = fitScale(baseViewport);
  const scale = state.baseScale * state.zoom;
  const viewport = page.getViewport({ scale });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);

  state.page = page;
  state.viewport = viewport;

  dom.pageShell.style.width = `${viewport.width}px`;
  dom.pageShell.style.height = `${viewport.height}px`;
  dom.canvas.width = Math.floor(viewport.width * outputScale);
  dom.canvas.height = Math.floor(viewport.height * outputScale);
  dom.canvas.style.width = `${viewport.width}px`;
  dom.canvas.style.height = `${viewport.height}px`;

  const context = dom.canvas.getContext("2d", { alpha: false });
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, dom.canvas.width, dom.canvas.height);

  state.renderTask = page.render({
    canvasContext: context,
    viewport,
    transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null,
    intent: "display"
  });

  await state.renderTask.promise;
  await renderTextLayer(page, viewport);

  dom.pageInput.value = String(state.pageNumber);
  dom.pageInput.max = String(state.pageCount);
  dom.pageStatusText.textContent = `第 ${state.pageNumber} 页 / 共 ${state.pageCount} 页`;
  dom.progressBar.style.width = `${(state.pageNumber / state.pageCount) * 100}%`;
  dom.previousButton.disabled = state.pageNumber <= 1;
  dom.nextButton.disabled = state.pageNumber >= state.pageCount;
  document.title = `第 ${state.pageNumber} 页 · 高频词汇点读机`;

  try {
    localStorage.setItem("pdf-reader-page", String(state.pageNumber));
  } catch (_) {}

  dom.pageScroll.scrollTo({ top: 0, left: 0, behavior: "instant" });
}

async function renderTextLayer(page, viewport) {
  const textContent = await page.getTextContent();
  dom.textLayer.replaceChildren();

  textContent.items.forEach((item) => {
    if (!item.str || !item.str.trim()) return;
    const transform = pdfjsLib.Util.transform(viewport.transform, item.transform);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const angle = Math.atan2(transform[1], transform[0]);
    const span = document.createElement("span");
    span.textContent = item.str;
    span.style.left = `${transform[4]}px`;
    span.style.top = `${transform[5] - fontHeight}px`;
    span.style.fontSize = `${Math.max(fontHeight, 1)}px`;
    span.style.fontFamily = textContent.styles[item.fontName]?.fontFamily || "sans-serif";
    span.style.width = `${Math.max(item.width * viewport.scale, 2)}px`;
    span.style.height = `${Math.max(fontHeight, 2)}px`;
    if (Math.abs(angle) > 0.001) {
      span.style.transform = `rotate(${angle}rad)`;
    }
    if (/[A-Za-z]/.test(item.str)) {
      span.classList.add("is-word");
      span.dataset.pdfText = item.str;
    }
    dom.textLayer.appendChild(span);
  });
}

function wordAtPoint(span, clientX) {
  const text = span.dataset.pdfText || span.textContent || "";
  const matches = [...text.matchAll(/[A-Za-z]+(?:[’'][A-Za-z]+)*/g)];
  if (!matches.length) return "";

  const rect = span.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(rect.width, 1)));
  const approximateIndex = ratio * text.length;
  let nearest = matches[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  matches.forEach((match) => {
    const center = match.index + match[0].length / 2;
    const distance = Math.abs(center - approximateIndex);
    if (distance < bestDistance) {
      nearest = match;
      bestDistance = distance;
    }
  });

  return nearest[0];
}

function positionTapHighlight(span, word) {
  const text = span.dataset.pdfText || span.textContent || "";
  const start = text.indexOf(word);
  if (start < 0) return;

  const totalWeight = [...text].reduce((sum, character) => {
    return sum + (character === " " ? 0.45 : 1);
  }, 0);
  const beforeWeight = [...text.slice(0, start)].reduce((sum, character) => {
    return sum + (character === " " ? 0.45 : 1);
  }, 0);
  const wordWeight = [...word].reduce((sum, character) => {
    return sum + (character === " " ? 0.45 : 1);
  }, 0);
  const rect = span.getBoundingClientRect();
  const shellRect = dom.pageShell.getBoundingClientRect();

  dom.tapHighlight.style.left = `${rect.left - shellRect.left + (beforeWeight / totalWeight) * rect.width}px`;
  dom.tapHighlight.style.top = `${rect.top - shellRect.top}px`;
  dom.tapHighlight.style.width = `${Math.max(8, (wordWeight / totalWeight) * rect.width)}px`;
  dom.tapHighlight.style.height = `${Math.max(10, rect.height)}px`;
  dom.tapHighlight.classList.remove("is-visible");
  requestAnimationFrame(() => {
    dom.tapHighlight.classList.add("is-visible");
  });
}

function handleWordTap(event) {
  if (state.suppressTap) return;
  const span = event.target.closest(".text-layer span.is-word");
  if (!span) return;
  event.preventDefault();
  event.stopPropagation();
  const word = wordAtPoint(span, event.clientX);
  if (!word) return;
  positionTapHighlight(span, word);
  speakWord(word);
}

function showControls() {
  dom.bottomBar.classList.remove("is-hidden");
  dom.showControlsButton.classList.remove("is-visible");
  clearTimeout(state.controlsTimer);
  state.controlsTimer = setTimeout(() => {
    dom.bottomBar.classList.add("is-hidden");
    dom.showControlsButton.classList.add("is-visible");
  }, 5000);
}

async function goToPage(pageNumber) {
  if (!state.pdf) return;
  const next = Math.max(1, Math.min(state.pageCount, Math.round(pageNumber)));
  if (next === state.pageNumber && state.page) return;
  state.pageNumber = next;
  dom.loading.classList.remove("is-hidden");
  dom.loadingTitle.textContent = `正在载入第 ${next} 页`;
  dom.loadingSubtitle.textContent = "页面不会修改";
  updateLoading(22);
  try {
    await renderPage();
    updateLoading(100);
    hideLoading();
  } catch (error) {
    console.error(error);
    dom.loadingTitle.textContent = "页面载入失败";
    dom.loadingSubtitle.textContent = "请返回上一页或重新打开点读机";
  }
}

function openSettings() {
  dom.settingsSheet.classList.add("is-open");
  dom.settingsSheet.setAttribute("aria-hidden", "false");
  populateVoices();
}

function closeSettings() {
  dom.settingsSheet.classList.remove("is-open");
  dom.settingsSheet.setAttribute("aria-hidden", "true");
}

async function loadPdf() {
  const source = window.__PDF_DATA_BASE64__
    ? { data: base64ToBytes(window.__PDF_DATA_BASE64__) }
    : { url: PDF_URL };
  const loadingTask = pdfjsLib.getDocument({
    ...source,
    disableRange: true,
    disableStream: true,
    cMapUrl: "./vendor/cmaps/",
    cMapPacked: true,
    standardFontDataUrl: "./vendor/standard_fonts/"
  });

  loadingTask.onProgress = (progress) => {
    if (progress.total > 0) {
      updateLoading(8 + Math.min(84, (progress.loaded / progress.total) * 84));
    }
  };

  state.pdf = await loadingTask.promise;
  state.pageCount = state.pdf.numPages;
  state.pageNumber = Math.max(1, Math.min(state.pageNumber, state.pageCount));
  dom.pageTotal.textContent = `/ ${state.pageCount} 页`;
  updateLoading(96, "正在排版页面", "马上就可以点读");
  await renderPage();
  updateLoading(100);
  hideLoading();
}

dom.textLayer.addEventListener("click", handleWordTap);
dom.pageScroll.addEventListener("click", () => {
  if (!state.loading) showControls();
});
dom.previousButton.addEventListener("click", () => goToPage(state.pageNumber - 1));
dom.nextButton.addEventListener("click", () => goToPage(state.pageNumber + 1));
dom.showControlsButton.addEventListener("click", showControls);
dom.zoomOutButton.addEventListener("click", async () => {
  state.zoom = Math.max(0.72, state.zoom - 0.15);
  await renderPage();
  showControls();
});
dom.zoomInButton.addEventListener("click", async () => {
  state.zoom = Math.min(2.4, state.zoom + 0.15);
  await renderPage();
  showControls();
});
dom.pageInput.addEventListener("change", () => goToPage(Number(dom.pageInput.value)));
dom.pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    dom.pageInput.blur();
    goToPage(Number(dom.pageInput.value));
  }
});
dom.settingsButton.addEventListener("click", openSettings);
document.querySelectorAll("[data-close-settings]").forEach((element) => {
  element.addEventListener("click", closeSettings);
});
dom.voiceSelect.addEventListener("change", () => chooseVoice(dom.voiceSelect.value));
dom.rateRange.addEventListener("input", () => {
  state.rate = Number(dom.rateRange.value);
  dom.rateValue.textContent = `${state.rate.toFixed(2)}×`;
  try {
    localStorage.setItem("pdf-reader-rate", String(state.rate));
  } catch (_) {}
});

document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select, textarea")) return;
  if (event.key === "ArrowRight" || event.key === "PageDown") {
    event.preventDefault();
    goToPage(state.pageNumber + 1);
  } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
    event.preventDefault();
    goToPage(state.pageNumber - 1);
  } else if (event.key === "+" || event.key === "=") {
    dom.zoomInButton.click();
  } else if (event.key === "-") {
    dom.zoomOutButton.click();
  }
});

dom.viewer.addEventListener("touchstart", (event) => {
  const touch = event.changedTouches[0];
  state.touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  state.suppressTap = false;
}, { passive: true });

dom.viewer.addEventListener("touchmove", (event) => {
  if (!state.touchStart) return;
  const touch = event.changedTouches[0];
  const distance = Math.hypot(touch.clientX - state.touchStart.x, touch.clientY - state.touchStart.y);
  if (distance > 24) state.suppressTap = true;
}, { passive: true });

dom.viewer.addEventListener("touchend", (event) => {
  if (!state.touchStart) return;
  const touch = event.changedTouches[0];
  const dx = touch.clientX - state.touchStart.x;
  const dy = touch.clientY - state.touchStart.y;
  const elapsed = Date.now() - state.touchStart.time;
  state.touchStart = null;
  if (Math.abs(dx) > 72 && Math.abs(dx) > Math.abs(dy) * 1.4 && elapsed < 700) {
    event.preventDefault();
    state.suppressTap = true;
    goToPage(state.pageNumber + (dx < 0 ? 1 : -1));
    setTimeout(() => { state.suppressTap = false; }, 160);
  }
}, { passive: false });

window.speechSynthesis?.addEventListener?.("voiceschanged", populateVoices);
window.addEventListener("resize", () => {
  clearTimeout(window.__pdfResizeTimer);
  window.__pdfResizeTimer = setTimeout(() => renderPage(), 180);
});
window.visualViewport?.addEventListener?.("resize", () => {
  clearTimeout(window.__pdfResizeTimer);
  window.__pdfResizeTimer = setTimeout(() => renderPage(), 180);
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./sw.js").catch((error) => console.warn("Service worker", error));
}

loadSavedPreferences();
populateVoices();
showControls();
loadPdf().catch((error) => {
  console.error(error);
  dom.loadingTitle.textContent = "PDF 载入失败";
  dom.loadingSubtitle.textContent = "请通过“启动iPad点读.command”打开本网页";
});
