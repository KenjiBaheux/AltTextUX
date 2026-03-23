import { DOM } from './dom.js';
import { state } from './state.js';
import { notifyBTS, setBTSState } from './bts.js';
import { consumeSavings } from './metrics.js';
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

  if (stateStr === 'error' || stateStr === 'unavailable') {
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
  if (!DOM.generateBtn) return;

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  const shortcut = isMac ? '(Cmd+Enter)' : '(Ctrl+Enter)';

  if (state.isGenerating) {
    DOM.generateBtn.classList.add('loading');
    if (DOM.aiBtnTooltip) DOM.aiBtnTooltip.textContent = "Abort task (Esc)";
    return;
  }
  DOM.generateBtn.classList.remove('loading');

  const currentEntry = history.stack[history.currentIndex];
  const isUserEdit = currentEntry && !currentEntry.isAI && history.currentIndex > 0;
  const textToCheck = targetText !== null ? targetText : DOM.altTextInput.value;

  if (isUserEdit && textToCheck.trim() !== "") {
    if (DOM.iconSparkle) DOM.iconSparkle.classList.add('icon-hidden-transition');
    if (DOM.iconEnhance) {
      DOM.iconEnhance.classList.remove('icon-hidden-transition');
      DOM.iconEnhance.classList.remove('hidden');
    }
    if (DOM.aiBtnTooltip) DOM.aiBtnTooltip.textContent = `Refine with AI ${shortcut}`;
  } else {
    if (DOM.iconEnhance) DOM.iconEnhance.classList.add('icon-hidden-transition');
    if (DOM.iconSparkle) {
      DOM.iconSparkle.classList.remove('icon-hidden-transition');
      DOM.iconSparkle.classList.remove('hidden');
    }
    if (DOM.aiBtnTooltip) DOM.aiBtnTooltip.textContent = `Draft a story with AI ${shortcut}`;
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
    consumeSavings();

    state.cachedAltText = "";
    state.cachedHint = null;
  }
  else if (state.activeInferencePromise) {
    console.log("BTS: Smart Fallback - Waiting for in-flight inference.");

    // Track time saved
    consumeSavings();

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
    history.updateUI();
    state.lastGeneratedAltText = fallbackText;

    notifyBTS('fallback', 'pulse');

    if (DOM.iconSparkle) DOM.iconSparkle.classList.add('glitter-animation');

    await typeWriterEffect(fallbackText);

    if (DOM.iconSparkle) DOM.iconSparkle.classList.remove('glitter-animation');

    history.push(fallbackText, true);

    state.isGenerating = false;
    updateShareButtonState();
    history.updateUI();
  }
}

export function showProgressUI(percent = null) {
  if (DOM.progressContainer) {
    DOM.progressContainer.classList.add('show');
    if (percent !== null) {
      DOM.progressContainer.style.transitionDelay = '0s';
      if (DOM.progressFill) DOM.progressFill.style.width = `${percent}%`;
      if (DOM.progressPercent) DOM.progressPercent.textContent = `${percent}%`;
    } else {
      if (DOM.progressPercent) DOM.progressPercent.textContent = '...';
    }
  }
}

export function hideProgressUI(delay = 0) {
  setTimeout(() => {
    if (DOM.progressContainer) DOM.progressContainer.classList.remove('show');
  }, delay);
}

export function triggerDoubleTakeAnimation(wittyMessage) {
  const isSparkleHidden = DOM.iconSparkle && (DOM.iconSparkle.classList.contains('hidden') || DOM.iconSparkle.classList.contains('icon-hidden-transition'));
  const wasRefine = !isSparkleHidden && DOM.iconEnhance && !DOM.iconEnhance.classList.contains('hidden') && !DOM.iconEnhance.classList.contains('icon-hidden-transition');
  // If sparkle wasn't hidden, it was active. If it was hidden, enhance was likely active.
  const activeIcon = isSparkleHidden ? DOM.iconEnhance : DOM.iconSparkle;
  const inactiveIcon = isSparkleHidden ? DOM.iconSparkle : DOM.iconEnhance;

  if (activeIcon) {
    activeIcon.classList.remove('hidden');
    if (inactiveIcon) inactiveIcon.classList.add('hidden');
    activeIcon.classList.remove('icon-double-take');
    void activeIcon.offsetWidth; // trigger reflow
    activeIcon.classList.add('icon-double-take');
  }

  DOM.altTextInput.classList.remove('text-wave');
  DOM.altTextInput.classList.remove('text-shimmer');
  DOM.altTextInput.classList.remove('text-dimming');
  void DOM.altTextInput.offsetWidth; // trigger reflow
  DOM.altTextInput.classList.add('text-wave');

  if (DOM.historyIndex) {
    DOM.historyIndex.classList.remove('history-index-pulse');
    void DOM.historyIndex.offsetWidth; // trigger reflow
    DOM.historyIndex.classList.add('history-index-pulse');
  }

  if (DOM.wittyBubble && wittyMessage) {
    DOM.wittyBubble.textContent = wittyMessage;
    DOM.wittyBubble.classList.remove('hidden');
    DOM.wittyBubble.classList.remove('bubble-pop');
    void DOM.wittyBubble.offsetWidth; // trigger reflow
    DOM.wittyBubble.classList.add('bubble-pop');
  }

  setTimeout(() => {
    DOM.altTextInput.classList.remove('text-wave');
    if (activeIcon) activeIcon.classList.remove('icon-double-take');
    if (DOM.historyIndex) DOM.historyIndex.classList.remove('history-index-pulse');
    if (DOM.wittyBubble) {
      DOM.wittyBubble.classList.remove('bubble-pop');
      DOM.wittyBubble.classList.add('hidden');
    }
    updateGenerateButtonUI();
  }, 2500);
}

export function showErrorState(originalAltText) {
  updateStatus('error', 'AI Failed');
  DOM.altTextInput.parentElement.classList.add('error-caution');

  if (!originalAltText) {
    DOM.altTextInput.placeholder = "Even AI can't see these pixels. Tell the story for everyone—and everything—who can't see pixels.";
  } else {
    DOM.altTextInput.value = originalAltText;
  }
}

export function showUnavailableState() {
  DOM.altTextInput.parentElement.classList.add('error-caution');
  if (DOM.altTextInput.value.trim() === "") {
    DOM.altTextInput.placeholder = "Local AI is a no-show for this setup. Tell the story for everyone—and everything—who can't see pixels.";
  }
}

export function clearErrorState() {
  DOM.altTextInput.parentElement.classList.remove('error-caution');
}
