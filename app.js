import { DOM } from './js/dom.js';
import { state } from './js/state.js';
import { history } from './js/history.js';
import { setupBTSEventListeners, setBTSState, notifyBTS } from './js/bts.js';
import { checkAIAvailability, triggerModelDownload, cleanupAISession, prewarmWithSampleImage, startProactiveGeneration, generateAltText, prepareAISession, abortGeneration } from './js/ai.js';
import { handleFileSelected, showPreview, hidePreview, updateShareButtonState, handleShareClick, closeSuccessOverlay, updateGenerateButtonUI, handleSmartFallback } from './js/ui.js';
import { handleAppShare, generateICSReminder } from './js/actions.js';

function setupEventListeners() {
  window.addEventListener('beforeunload', cleanupAISession);

  if (DOM.publishBtn) {
    DOM.publishBtn.addEventListener('click', () => {
      cleanupAISession();
      const originalText = DOM.publishBtn.textContent;
      DOM.publishBtn.textContent = "Shared!";
      setTimeout(() => DOM.publishBtn.textContent = originalText, 2000);
    });
  }

  DOM.statusBadge.addEventListener('click', () => {
    triggerModelDownload();
  });

  document.querySelectorAll('.info-icon').forEach(icon => {
    icon.addEventListener('click', (e) => {
      e.stopPropagation();

      const tooltip = icon.querySelector('.tooltip');
      const isActive = tooltip.classList.contains('is-active');

      document.querySelectorAll('.tooltip.is-active').forEach(t => t.classList.remove('is-active'));

      if (!isActive) {
        tooltip.classList.add('is-active');
      }
    });
  });

  document.addEventListener('click', () => {
    document.querySelectorAll('.tooltip.is-active').forEach(t => t.classList.remove('is-active'));
  });

  const footerShareBtn = document.getElementById('footer-share-btn');
  if (footerShareBtn) {
    footerShareBtn.addEventListener('click', handleAppShare);
  }

  const footerRemindBtn = document.getElementById('footer-remind-btn');
  if (footerRemindBtn) {
    footerRemindBtn.addEventListener('click', generateICSReminder);
  }

  DOM.selectBtn.addEventListener('click', () => {
    DOM.imageUpload.click();
    triggerModelDownload();
  });

  DOM.imageUpload.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  DOM.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.add('dragover');
  });

  DOM.dropZone.addEventListener('dragleave', () => {
    DOM.dropZone.classList.remove('dragover');
  });

  DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.remove('dragover');

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        handleFileSelected(file);
        triggerModelDownload();
      }
    }
  });

  DOM.sampleBtn.addEventListener('click', () => {
    DOM.stagingOverlay?.classList.remove('hidden');
    state.currentImageSource = DOM.sampleImageSource;

    if (state.currentPreviewUrl) {
      URL.revokeObjectURL(state.currentPreviewUrl);
      state.currentPreviewUrl = null;
    }
    DOM.imagePreview.src = DOM.sampleImageSource.src;

    prepareAISession(true).catch(e => console.error("Failed to reset session for sample image", e));

    history.clear();
    history.push("", false);
    state.lastGeneratedAltText = "";
    showPreview();
    triggerModelDownload();
    state.wasAltTextManuallyCleared = false;
  });

  DOM.removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();

    if (state.prewarmAbortController) {
      state.prewarmAbortController.abort();
      state.prewarmAbortController = null;
    }

    state.cachedAltText = null;
    state.cachedHint = null;
    if (state.inferenceAbortController) {
      state.inferenceAbortController.abort();
      state.inferenceAbortController = null;
    }
    state.activeInferencePromise = null;
    state.activeInferenceHint = null;
    state.currentProactiveImageSrc = null;
    state.lastGeneratedAltText = "";
    history.clear();
    history.push("", false);

    state.currentImageFile = null;
    state.currentImageSource = null;
    if (state.currentPreviewUrl) {
      URL.revokeObjectURL(state.currentPreviewUrl);
      state.currentPreviewUrl = null;
    }
    DOM.imageUpload.value = '';
    hidePreview();
    DOM.altTextInput.value = '';
    state.isGenerating = false;
    updateShareButtonState();

    prewarmWithSampleImage();
  });

  DOM.generateBtn.addEventListener('mouseenter', () => {
    if (state.aiAvailable && state.currentImageSource && !DOM.generateBtn.disabled && !DOM.generateLoader.classList.contains('show')) {
      startProactiveGeneration(DOM.altTextInput.value.trim());
      notifyBTS('proactive-1');
    }
  });

  DOM.altTextInput.addEventListener('input', () => {
    const rawInput = DOM.altTextInput.value;
    updateGenerateButtonUI();
    if (rawInput.trim() === "") {
      state.wasAltTextManuallyCleared = true;
    } else {
      state.wasAltTextManuallyCleared = false;
    }

    if (history.currentIndex >= 0 && history.stack[history.currentIndex]) {
      const currentEntry = history.stack[history.currentIndex];
      const isErasing = rawInput.trim() === "";

      if (isErasing) {
        // Rule 4 (amended): If the user erases an entry, don't make a copy. Overwrite current so it can be purged.
        history.updateCurrent(rawInput, false);
      } else if (currentEntry.isAI || history.currentIndex === 0) {
        history.push(rawInput, false);
      } else {
        history.updateCurrent(rawInput, false);
      }
    }
  });

  DOM.altTextInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (DOM.generateBtn.classList.contains('error-state')) {
        // Flash the status badge and shake the icon to indicate failure
        DOM.statusBadge.classList.remove('badge-error-flash');
        const icon = DOM.generateBtn.querySelector('svg:not(.hidden)');
        if (icon) icon.classList.remove('icon-shake');
        void DOM.statusBadge.offsetWidth; // Reflow
        DOM.statusBadge.classList.add('badge-error-flash');
        if (icon) icon.classList.add('icon-shake');
        return;
      }

      if (!DOM.generateBtn.disabled) {
        generateAltText();
      }
    }

    if (e.key === 'ArrowUp' && DOM.altTextInput.selectionStart === 0) {
      if (!state.isGenerating && history.prev()) {
        e.preventDefault();
        notifyBTS('versioning', 'pulse');
      }
    } else if (e.key === 'ArrowDown' && DOM.altTextInput.selectionEnd === DOM.altTextInput.value.length) {
      if (!state.isGenerating && history.next()) {
        e.preventDefault();
        notifyBTS('versioning', 'pulse');
      }
    }

    if (e.key === 'Escape') {
      if (state.isGenerating || state.isAnimating) {
        abortGeneration();
      }
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (state.isGenerating || state.isAnimating)) {
      abortGeneration();
    }
  });

  DOM.generateBtn.addEventListener('click', (e) => {
    if (DOM.generateBtn.classList.contains('error-state')) {
      e.preventDefault();

      // Flash the status badge when clicked in an error state
      DOM.statusBadge.classList.remove('badge-error-flash');

      // Also shake the icon
      const icon = DOM.generateBtn.querySelector('svg:not(.hidden)');
      if (icon) icon.classList.remove('icon-shake');

      // Trigger a reflow to restart the animation
      void DOM.statusBadge.offsetWidth;

      DOM.statusBadge.classList.add('badge-error-flash');
      if (icon) icon.classList.add('icon-shake');

      return;
    }
    generateAltText();
  });

  if (DOM.copyBtn) {
    DOM.copyBtn.addEventListener('click', async () => {
      const text = DOM.altTextInput.value;
      if (!text) return;

      try {
        await navigator.clipboard.writeText(text);
        const originalHTML = DOM.copyBtn.innerHTML;
        DOM.copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="var(--success)"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>`;
        setTimeout(() => {
          DOM.copyBtn.innerHTML = originalHTML;
        }, 2000);
      } catch (err) {
        console.error('Failed to copy', err);
      }
    });
  }

  DOM.altTextInput.addEventListener('focus', () => {
    if (state.currentImageSource) setBTSState('staged');
  });

  DOM.postContent.addEventListener('input', updateShareButtonState);
  DOM.postContent.addEventListener('focus', () => {
    handleSmartFallback();
    setBTSState('composition');
  });

  DOM.shareBtn.addEventListener('click', handleShareClick);

  DOM.successClose.addEventListener('click', closeSuccessOverlay);

  updateShareButtonState();
}

function setupHistoryEventListeners() {
  if (DOM.historyPrev) {
    DOM.historyPrev.addEventListener('click', () => {
      if (history.prev()) notifyBTS('versioning', 'pulse');
    });
  }

  if (DOM.historyNext) {
    DOM.historyNext.addEventListener('click', () => {
      if (history.next()) notifyBTS('versioning', 'pulse');
    });
  }
}

async function init() {
  await checkAIAvailability();
  setupEventListeners();
  setupBTSEventListeners();
  setupHistoryEventListeners();
  setBTSState('welcome');

  if (state.aiAvailable && !DOM.imagePreview.src.includes('data:')) {
    try {
      if (prewarmWithSampleImage()) {
        notifyBTS('prewarm');
      } else if (!state.sampleImageAltText) {
        notifyBTS('proactive-1');
      }
    } catch (e) {
      console.error("Failed to start prewarming:", e);
    }
  }
}

// Safety net for any AI promises that might escape local catch blocks
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && (event.reason.name === 'UnknownError' || event.reason.name === 'InvalidStateError')) {
    console.warn("Caught unhandled AI rejection:", event.reason);
    event.preventDefault(); // Prevent console noise if we're handling it
  }
});

init();
