const READER = window.READER_CONFIG || {
  pageCount: 123,
  startPage: 2,
  storageKey: "basic-image-reader"
};
const PAGE_RATIO = 595.32 / 841.92;
const state = {
  pageCount: READER.pageCount,
  pageNumber: READER.startPage,
  zoom: 1,
  voices: [],
  voice: null,
  rate: 0.88,
  suppressTap: false,
  touchStart: null,
  controlsTimer: 0
};

const dom = {
  viewer: document.getElementById("viewer"),
  pageScroll: document.getElementById("pageScroll"),
  pageFrame: document.getElementById("pageFrame"),
  pageImage: document.getElementById("pageImage"),
  wordLayer: document.getElementById("wordLayer"),
  loading: document.getElementById("loading"),
  loadingTitle: document.getElementById("loadingTitle"),
  loadingSubtitle: document.getElementById("loadingSubtitle"),
  loadingBar: document.getElementById("loadingBar"),
  errorBox: document.getElementById("errorBox"),
  errorText: document.getElementById("errorText"),
  hint: document.getElementById("hint"),
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
  bottomBar: document.getElementById("bottomBar"),
  showControlsButton: document.getElementById("showControlsButton"),
  toast: document.getElementById("toast")
};

function showToast(text) {
  dom.toast.textContent = text;
  dom.toast.classList.add("is-visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => dom.toast.classList.remove("is-visible"), 2200);
}

function pageFile(pageNumber) {
  return `pages/page-${String(pageNumber).padStart(3, "0")}.jpg`;
}

function fitPage() {
  const horizontalPadding = window.innerWidth < 700 ? 16 : 28;
  const verticalPadding = 96;
  const availableWidth = Math.max(260, dom.viewer.clientWidth - horizontalPadding);
  const availableHeight = Math.max(320, dom.viewer.clientHeight - verticalPadding);
  const fitWidth = Math.min(availableWidth, availableHeight * PAGE_RATIO);
  const width = fitWidth * state.zoom;
  dom.pageFrame.style.width = `${width}px`;
}

function updateStatus() {
  dom.pageInput.value = String(state.pageNumber);
  dom.pageInput.max = String(state.pageCount);
  dom.pageStatusText.textContent = `第 ${state.pageNumber} 页 / 共 ${state.pageCount} 页`;
  dom.progressBar.style.width = `${(state.pageNumber / state.pageCount) * 100}%`;
  dom.previousButton.disabled = state.pageNumber <= 1;
  dom.nextButton.disabled = state.pageNumber >= state.pageCount;
  document.title = `第 ${state.pageNumber} 页 · 基础词汇图片点读`;
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

function englishVoices() {
  if (!("speechSynthesis" in window)) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((voice) => /^en([-_]|$)/i.test(voice.lang) || /English/i.test(voice.name))
    .sort((left, right) => voiceScore(right) - voiceScore(left));
}

function populateVoices() {
  state.voices = englishVoices();
  dom.voiceSelect.replaceChildren();
  if (!state.voices.length) {
    const option = document.createElement("option");
    option.textContent = "使用系统默认英文声音";
    option.value = "";
    dom.voiceSelect.appendChild(option);
    return;
  }

  let saved = "";
  try {
    saved = localStorage.getItem(`${READER.storageKey}-voice`) || "";
  } catch (_) {}

  state.voices.forEach((voice) => {
    const option = document.createElement("option");
    option.value = voice.name;
    const mark = /siri|premium|neural|enhanced/i.test(voice.name) ? "★ " : "";
    option.textContent = `${mark}${voice.name} · ${voice.lang}`;
    dom.voiceSelect.appendChild(option);
  });

  state.voice =
    state.voices.find((voice) => voice.name === saved) || state.voices[0];
  dom.voiceSelect.value = state.voice.name;
}

function speak(word) {
  if (!("speechSynthesis" in window)) {
    showToast("当前浏览器不支持朗读。");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(word);
  if (state.voice) utterance.voice = state.voice;
  utterance.lang = state.voice?.lang || "en-US";
  utterance.rate = state.rate;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function renderWords(pageData) {
  dom.wordLayer.replaceChildren();
  const fragment = document.createDocumentFragment();

  pageData.words.forEach((word) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "word-hit";
    button.dataset.word = word.t;
    button.setAttribute("aria-label", `朗读 ${word.t}`);
    button.style.left = `${word.x * 100}%`;
    button.style.top = `${word.y * 100}%`;
    button.style.width = `${word.w * 100}%`;
    button.style.height = `${word.h * 100}%`;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.suppressTap) return;
      document.querySelectorAll(".word-hit.is-active").forEach((item) => {
        item.classList.remove("is-active");
      });
      button.classList.add("is-active");
      speak(word.t);
    });
    fragment.appendChild(button);
  });

  dom.wordLayer.appendChild(fragment);
}

async function showPage(pageNumber) {
  const next = Math.max(1, Math.min(state.pageCount, Math.round(pageNumber)));
  state.pageNumber = next;
  updateStatus();
  dom.loading.classList.remove("is-hidden");
  dom.errorBox.hidden = true;
  dom.loadingTitle.textContent = `正在载入第 ${next} 页`;
  dom.loadingSubtitle.textContent = "只加载当前页面图片";
  dom.loadingBar.style.width = "18%";

  try {
    const mapResponse = await fetch(
      `./maps/${String(next).padStart(3, "0")}.json`,
      { cache: "force-cache" }
    );
    if (!mapResponse.ok) throw new Error(`词汇索引 HTTP ${mapResponse.status}`);
    const pageData = await mapResponse.json();
    const imageUrl = pageData.file;
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        dom.pageImage.src = imageUrl;
        dom.pageImage.alt = `基础词汇背诵表第 ${next} 页`;
        resolve();
      };
      image.onerror = () => reject(new Error(`图片载入失败：${imageUrl}`));
      image.src = imageUrl;
    });

    dom.loadingBar.style.width = "72%";
    renderWords(pageData);
    fitPage();
    dom.loadingBar.style.width = "100%";
    dom.loading.classList.add("is-hidden");
    dom.pageScroll.scrollTo({ top: 0, left: 0, behavior: "instant" });
    dom.hint.classList.remove("is-hidden");
    setTimeout(() => dom.hint.classList.add("is-hidden"), 4200);
    updateStatus();

    try {
      localStorage.setItem(`${READER.storageKey}-page`, String(next));
    } catch (_) {}
  } catch (error) {
    console.error(error);
    dom.loading.classList.add("is-hidden");
    dom.errorBox.hidden = false;
    dom.errorText.textContent = error.message || "请检查网络后重新打开。";
  }
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

dom.previousButton.addEventListener("click", () => showPage(state.pageNumber - 1));
dom.nextButton.addEventListener("click", () => showPage(state.pageNumber + 1));
dom.showControlsButton.addEventListener("click", showControls);
dom.zoomOutButton.addEventListener("click", () => {
  state.zoom = Math.max(0.72, state.zoom - 0.15);
  fitPage();
});
dom.zoomInButton.addEventListener("click", () => {
  state.zoom = Math.min(2.4, state.zoom + 0.15);
  fitPage();
});
dom.pageInput.addEventListener("change", () => showPage(Number(dom.pageInput.value)));
dom.pageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    dom.pageInput.blur();
    showPage(Number(dom.pageInput.value));
  }
});

dom.settingsButton.addEventListener("click", () => {
  dom.settingsSheet.classList.add("is-open");
  dom.settingsSheet.setAttribute("aria-hidden", "false");
  populateVoices();
});
document.querySelectorAll("[data-close-settings]").forEach((element) => {
  element.addEventListener("click", () => {
    dom.settingsSheet.classList.remove("is-open");
    dom.settingsSheet.setAttribute("aria-hidden", "true");
  });
});
dom.voiceSelect.addEventListener("change", () => {
  state.voice = state.voices.find((voice) => voice.name === dom.voiceSelect.value) || null;
  try {
    localStorage.setItem(`${READER.storageKey}-voice`, dom.voiceSelect.value);
  } catch (_) {}
});
dom.rateRange.addEventListener("input", () => {
  state.rate = Number(dom.rateRange.value);
  dom.rateValue.textContent = `${state.rate.toFixed(2)}×`;
  try {
    localStorage.setItem(`${READER.storageKey}-rate`, String(state.rate));
  } catch (_) {}
});

dom.viewer.addEventListener("touchstart", (event) => {
  const touch = event.changedTouches[0];
  state.touchStart = { x: touch.clientX, y: touch.clientY, time: Date.now() };
  state.suppressTap = false;
}, { passive: true });

dom.viewer.addEventListener("touchmove", (event) => {
  if (!state.touchStart) return;
  const touch = event.changedTouches[0];
  if (Math.hypot(touch.clientX - state.touchStart.x, touch.clientY - state.touchStart.y) > 22) {
    state.suppressTap = true;
  }
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
    showPage(state.pageNumber + (dx < 0 ? 1 : -1));
    setTimeout(() => {
      state.suppressTap = false;
    }, 200);
  }
}, { passive: false });

dom.pageScroll.addEventListener("click", showControls);
document.addEventListener("keydown", (event) => {
  if (event.target.matches("input, select")) return;
  if (event.key === "ArrowLeft") showPage(state.pageNumber - 1);
  if (event.key === "ArrowRight") showPage(state.pageNumber + 1);
});
window.addEventListener("resize", fitPage);
window.visualViewport?.addEventListener?.("resize", fitPage);
window.speechSynthesis?.addEventListener?.("voiceschanged", populateVoices);

try {
  const savedPage = Number(
    localStorage.getItem(`${READER.storageKey}-page`) || String(READER.startPage)
  );
  if (savedPage >= 1 && savedPage <= READER.pageCount) state.pageNumber = savedPage;
  const savedRate = Number(localStorage.getItem(`${READER.storageKey}-rate`) || "0.88");
  state.rate = Math.max(0.6, Math.min(1.1, savedRate));
  dom.rateRange.value = String(state.rate);
  dom.rateValue.textContent = `${state.rate.toFixed(2)}×`;
} catch (_) {}

populateVoices();
showControls();
showPage(state.pageNumber);
