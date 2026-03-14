import { DOM } from './dom.js';
import { state } from './state.js';
import { notifyBTS, setBTSState, updateMetricsUI } from './bts.js';
import { history } from './history.js';
import { prepareAISession, startProactiveGeneration } from './ai.js';
import { typeWriterEffect } from './utils.js';

export function updateStatus(stateStr, text) {
  if (DOM.statusTextSpan) {
    DOM.statusTextSpan.textContent = text;
  } else {
    DOM.statusBadge.textContent = text;
  }

  DOM.statusBadge.className = `badge status-${stateStr}`;

  const container = DOM.statusBadge.closest('.status-badge-container');
  if (container) {
    if (!state.isBadgeResolved && ['available', 'downloadable', 'unavailable', 'error'].includes(stateStr)) {
      state.isBadgeResolved = true;
      container.classList.add('resolved');
    }
  }

  DOM.statusBadge.classList.add('badge-flash');

  if (stateStr === 'error' || stateStr === 'unavailable') {
    notifyBTS('status');
  }

  if (DOM.errorIcon) {
    if (stateStr === 'error') {
      DOM.errorIcon.classList.remove('hidden');
    } else {
      DOM.errorIcon.classList.add('hidden');
    }
  }

  if (DOM.unavailableIcon) {
    if (stateStr === 'unavailable') {
      DOM.unavailableIcon.classList.remove('hidden');
    } else {
      DOM.unavailableIcon.classList.add('hidden');
    }
  }

  if (stateStr === 'error') {
    DOM.generateBtn.classList.add('error-state');
  } else {
    DOM.generateBtn.classList.remove('error-state');
  }
}


export function updateShareButtonState() {
  if (!DOM.shareBtn) return;
  const isPostEmpty = DOM.postContent.value.trim() === "";
  DOM.shareBtn.disabled = isPostEmpty || state.isGenerating;
}

export function handleShareClick() {
  if (state.isGenerating) {
    DOM.altTextInput.classList.add('caution-pulse');
    setTimeout(() => DOM.altTextInput.classList.remove('caution-pulse'), 1500);
    return;
  }

  if (DOM.postContent.value.trim() === "") {
    DOM.postContent.classList.add('caution-pulse');
    setTimeout(() => DOM.postContent.classList.remove('caution-pulse'), 1500);
    return;
  }

  showSuccessOverlay();
}

export function showSuccessOverlay() {
  if (DOM.successOverlay) DOM.successOverlay.classList.remove('hidden');
}

export function closeSuccessOverlay() {
  if (DOM.successOverlay) DOM.successOverlay.classList.add('hidden');

  DOM.altTextInput.value = '';
  DOM.postContent.value = '';
  hidePreview();
  updateShareButtonState();
}

export function hidePreview() {
  DOM.uploadContent.classList.remove('hidden');
  DOM.previewContainer.classList.add('hidden');
  updateGenerateButtonState();
  setBTSState('welcome');
}

export function updateGenerateButtonState() {
  DOM.generateBtn.disabled = !state.currentImageSource || !state.aiAvailable;
  updateGenerateButtonUI();
}

export function updateGenerateButtonUI(targetText = null) {
  if (!DOM.generateBtn || DOM.generateBtn.disabled) return;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcut = isMac ? '(Cmd+Enter)' : '(Ctrl+Enter)';

  const currentEntry = history.stack[history.currentIndex];
  const isUserEdit = currentEntry && !currentEntry.isAI && history.currentIndex > 0;
  const textToCheck = targetText !== null ? targetText : DOM.altTextInput.value;

  if (isUserEdit && textToCheck.trim() !== "") {
    if (DOM.iconSparkle) DOM.iconSparkle.classList.add('hidden');
    if (DOM.iconEnhance) DOM.iconEnhance.classList.remove('hidden');
    DOM.generateBtn.title = `Refine with AI ${shortcut}`;
  } else {
    if (DOM.iconEnhance) DOM.iconEnhance.classList.add('hidden');
    if (DOM.iconSparkle) DOM.iconSparkle.classList.remove('hidden');
    DOM.generateBtn.title = `Generate with AI ${shortcut}`;
  }
}

export function handleFileSelected(file) {
  state.wasAltTextManuallyCleared = false;
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

  state.currentImageFile = file;
  state.currentImageSource = file;

  if (state.currentPreviewUrl) {
    URL.revokeObjectURL(state.currentPreviewUrl);
  }

  state.currentPreviewUrl = URL.createObjectURL(file);
  DOM.imagePreview.src = state.currentPreviewUrl;

  prepareAISession(true).catch(e => console.error("Failed to reset session for new image", e));

  DOM.stagingOverlay?.classList.remove('hidden');

  requestAnimationFrame(() => {
    showPreview();
  });
}

export function showPreview() {
  DOM.stagingOverlay?.classList.add('hidden');
  DOM.uploadContent.classList.add('hidden');
  DOM.previewContainer.classList.remove('hidden');
  updateGenerateButtonState();
  setBTSState('staged');

  setTimeout(() => DOM.altTextInput.focus(), 100);

  notifyBTS('proactive-1');
  startProactiveGeneration();
}

export async function handleSmartFallback() {
  if (state.wasAltTextManuallyCleared) {
    console.log("BTS: Smart Fallback - Respecting intentional silence.");
    return;
  }

  if (DOM.altTextInput.value.trim() !== "") return;

  let fallbackText = "";

  if (state.cachedAltText) {
    console.log("BTS: Smart Fallback - Rescuing from local cache.");
    fallbackText = state.cachedAltText;
    
    // Track time saved
    if (state.unconsumedSavings) {
      const actualSaved = state.unconsumedSavings.duration || (performance.now() - state.unconsumedSavings.startTime);
      if (state.unconsumedSavings.type === 'prewarm') {
        state.metrics.timeSavedPrewarm += actualSaved;
      } else if (state.unconsumedSavings.type === 'proactive2') {
        state.metrics.timeSavedProactive2 += actualSaved;
      } else {
        state.metrics.timeSavedProactive += actualSaved;
      }
      state.unconsumedSavings = null;
    }
    updateMetricsUI();

    state.cachedAltText = "";
    state.cachedHint = null;
  }
  else if (state.activeInferencePromise) {
    console.log("BTS: Smart Fallback - Waiting for in-flight inference.");
    
    // Track time saved
    if (state.unconsumedSavings) {
      const actualSaved = state.unconsumedSavings.duration || (performance.now() - state.unconsumedSavings.startTime);
      if (state.unconsumedSavings.type === 'prewarm') {
        state.metrics.timeSavedPrewarm += actualSaved;
      } else if (state.unconsumedSavings.type === 'proactive2') {
        state.metrics.timeSavedProactive2 += actualSaved;
      } else {
        state.metrics.timeSavedProactive += actualSaved;
      }
      state.unconsumedSavings = null;
    }
    updateMetricsUI();

    fallbackText = await state.activeInferencePromise;
    state.cachedAltText = "";
    state.cachedHint = null;
  }

  if (fallbackText && DOM.altTextInput.value.trim() === "") {
    const currentText = DOM.altTextInput.value.trim();
    // In handleSmartFallback, currentText will be empty if we're generating a fallback.
    // The history initialization logic in the original file was:
    // if (currentText && (history.currentIndex === -1 || history.stack[history.currentIndex] !== currentText)) { history.push(currentText); }
    // which prevents the initial empty state from being pushed. But we often want
    // the very first result to be recorded!
    
    // Instead of pushing the (empty) currentText, we just proceed. The fallback text 
    // gets pushed at the end of this block anyway!

    state.isGenerating = true;
    updateShareButtonState();
    state.lastGeneratedAltText = fallbackText;

    notifyBTS('fallback', 'pulse');

    if (DOM.iconSparkle) DOM.iconSparkle.classList.add('glitter-animation');

    await typeWriterEffect(fallbackText);

    if (DOM.iconSparkle) DOM.iconSparkle.classList.remove('glitter-animation');

    history.push(fallbackText, true);

    state.isGenerating = false;
    updateShareButtonState();
  }
}
