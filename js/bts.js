import { DOM } from './dom.js';
import { state } from './state.js';
import { history } from './history.js';
import { prewarmWithSampleImage, startProactiveGeneration, checkAIAvailability } from './ai.js';
import { updateStatus } from './ui.js';
import { updateMetricsUI } from './metrics.js';

export function setupBTSEventListeners() {
  if (!DOM.btsToggle) return;

  DOM.btsToggle.addEventListener('click', () => {
    DOM.btsPanel.classList.toggle('show');
    DOM.btsNotification?.classList.remove('active');
  });

  DOM.btsClose.addEventListener('click', () => {
    DOM.btsPanel.classList.remove('show');
  });

  // Close panel on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && DOM.btsPanel.classList.contains('show')) {
      if (!DOM.btsPanel.classList.contains('pinned')) {
        DOM.btsPanel.classList.remove('show');
      }
    }
  });

  // Close panel on clicking outside
  document.addEventListener('click', (e) => {
    if (DOM.btsPanel.classList.contains('show') && 
        !DOM.btsPanel.contains(e.target) && 
        !DOM.btsToggle.contains(e.target)) {
      if (!DOM.btsPanel.classList.contains('pinned')) {
        DOM.btsPanel.classList.remove('show');
      }
    }
  });

  if (DOM.btsPin) {
    DOM.btsPin.addEventListener('click', () => {
      DOM.btsPanel.classList.toggle('pinned');
      DOM.btsPin.classList.toggle('active');
    });
  }

  // Bi-directional link mapping
  state.btsMapping = {
    'status': [DOM.statusBadge],
    'prewarm': [],
    'proactive-1': [DOM.generateBtn],
    'empathetic-ui': [DOM.altTextInput],
    'empathetic-ai': [DOM.altTextInput],
    'proactive-2': [DOM.generateBtn],
    'temporal': [DOM.generateBtn],
    'guidance': [DOM.generateBtn],
    'morph': [DOM.altTextInput],
    'deduplication': [document.getElementById('history-stepper')],
    'fallback': [DOM.postContent],
    'chameleon': [DOM.altTextInput],
    'shortcuts': [DOM.generateBtn],
    'versioning': [document.getElementById('history-stepper')],
    'focus': [document.querySelector('.post-composition-area')]
  };

  // 1. Mouse/Focus triggers (UI -> BTS)
  Object.keys(state.btsMapping).forEach(key => {
    const elements = state.btsMapping[key];
    elements.forEach(el => {
      if (!el) return;
      el.addEventListener('mouseenter', () => activateBTSCard(key));
      el.addEventListener('focus', () => activateBTSCard(key), true);
    });
  });

  // 2. Click triggers (BTS -> UI)
  DOM.btsCards.forEach(card => {
    card.addEventListener('click', () => {
      const id = card.dataset.bts;
      // When user clicks a card, we want a persistent "pulse" on both the card and the UI element
      activateBTSCard(id, 'start');

      const targetEls = state.btsMapping[id];
      if (targetEls) {
        targetEls.forEach((targetEl, index) => {
          if (!targetEl) return;
          targetEl.classList.add('bts-highlight', 'pulse');
          if (index === 0) targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }

      // Allow manual click highlights to fade after a longer period (5s) unless it's a real AI task
      setTimeout(() => {
        // Check if there's an actual AI task running before removing
        const isStillActive = targetEls && targetEls.some(el => el.dataset.btsActive);
        if (!isStillActive) {
          card.classList.remove('pulse');
          if (targetEls) {
            targetEls.forEach(targetEl => {
              if (targetEl) targetEl.classList.remove('bts-highlight', 'pulse');
            });
          }
        }
      }, 5000);
    });
  });

  // Special shortcut detection
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      notifyBTS('shortcuts', 'pulse');
    }
  });

  // Settings Toggles
  // Prevent clicks on controls from bubbling up to the card
  document.querySelectorAll('.bts-card-controls').forEach(controls => {
    controls.addEventListener('click', (e) => e.stopPropagation());
  });

  if (DOM.togglePrewarm) {
    DOM.togglePrewarm.addEventListener('change', (e) => {
      state.settings.enablePrewarming = e.target.checked;
      if (!e.target.checked) {
        if (state.prewarmAbortController) {
          state.prewarmAbortController.abort();
          state.prewarmAbortController = null;
          state.prewarmPromise = null;
        }
        state.sampleImageAltText = "";
      } else {
        if (state.currentImageSource === DOM.sampleImageSource && !state.sampleImageAltText) {
          prewarmWithSampleImage();
        }
      }
      updateMetricsUI();
    });
  }
  if (DOM.toggleProactive) {
    DOM.toggleProactive.addEventListener('change', (e) => {
      state.settings.enableProactive = e.target.checked;
      if (!e.target.checked) {
        if (state.inferenceAbortController && state.activeInferenceHint === "") {
          state.inferenceAbortController.abort();
          state.inferenceAbortController = null;
          state.activeInferencePromise = null;
          state.activeInferenceHint = null;
        }
        if (state.cachedHint === "") {
          state.cachedAltText = "";
          state.cachedHint = null;
        }
      } else {
        if (state.currentImageSource && !state.cachedAltText && !state.activeInferencePromise) {
          startProactiveGeneration("");
        }
      }
      updateMetricsUI();
    });
  }
  if (DOM.toggleProactive2) {
    DOM.toggleProactive2.addEventListener('change', (e) => {
      state.settings.enableProactive2 = e.target.checked;
      if (!e.target.checked) {
        if (state.inferenceAbortController && state.activeInferenceHint !== "") {
          state.inferenceAbortController.abort();
          state.inferenceAbortController = null;
          state.activeInferencePromise = null;
          state.activeInferenceHint = null;
        }
        if (state.cachedHint !== "" && state.cachedHint !== null) {
          state.cachedAltText = "";
          state.cachedHint = null;
        }
      }
      updateMetricsUI();
    });
  }
  if (DOM.toggleTransitions) {
    DOM.toggleTransitions.addEventListener('change', (e) => {
      state.settings.enableTransitions = e.target.checked;
    });
  }
  
  if (DOM.toggleSimulateAIFail) {
    DOM.toggleSimulateAIFail.addEventListener('change', (e) => {
      state.settings.simulateAIFail = e.target.checked;
      
      const empatheticAICard = e.target.closest('.bts-card');
      
      // Clear input and history so placeholder is visible immediately
      DOM.altTextInput.value = "";
      state.lastGeneratedAltText = "";
      history.clear();
      history.push("", false);

      if (state.settings.simulateAIFail) {
        if (empatheticAICard) empatheticAICard.classList.add('simulate-fail-active');
        updateStatus('error', 'AI Failed');
        DOM.altTextInput.parentElement.classList.add('error-caution');
        if (DOM.altTextInput.value.trim() === "") {
          if (state.settings.useBlandPlaceholder) {
            DOM.altTextInput.placeholder = "Type description here.";
          } else {
            DOM.altTextInput.placeholder = "Even AI can't see these pixels. Tell the story for everyone—and everything—who can't see pixels.";
          }
        }
      } else {
        if (empatheticAICard) empatheticAICard.classList.remove('simulate-fail-active');
        DOM.altTextInput.parentElement.classList.remove('error-caution');
        if (state.settings.useBlandPlaceholder) {
          DOM.altTextInput.placeholder = "Type description here.";
        } else {
          DOM.altTextInput.placeholder = "Every image tells a short story. Write it for those who can't see the pixels...";
        }
        checkAIAvailability();
      }
    });
  }

  if (DOM.toggleBlandPlaceholder) {
    DOM.toggleBlandPlaceholder.addEventListener('change', (e) => {
      state.settings.useBlandPlaceholder = e.target.checked;
      
      const empatheticUICard = e.target.closest('.bts-card');
      
      // Clear input and history so placeholder is visible immediately
      DOM.altTextInput.value = "";
      state.lastGeneratedAltText = "";
      history.clear();
      history.push("", false);

      if (state.settings.useBlandPlaceholder) {
        if (empatheticUICard) empatheticUICard.classList.add('simulate-fail-active');
        DOM.altTextInput.placeholder = "Type description here.";
      } else {
        if (empatheticUICard) empatheticUICard.classList.remove('simulate-fail-active');
        // Restore based on AI fail state or default
        if (state.settings.simulateAIFail) {
          DOM.altTextInput.placeholder = "Even AI can't see these pixels. Tell the story for everyone—and everything—who can't see pixels.";
        } else {
          DOM.altTextInput.placeholder = "Every image tells a short story. Write it for those who can't see the pixels...";
        }
      }
    });
  }

  initTemporalSlider();
}

function initTemporalSlider() {
  if (!DOM.temporalMin || !DOM.temporalMax) return;

  const updateSliderUI = () => {
    let minVal = parseInt(DOM.temporalMin.value);
    let maxVal = parseInt(DOM.temporalMax.value);

    // Enforce min <= max
    if (minVal > maxVal) {
      // If we're dragging min, push max up. If dragging max, push min down (handled by event listeners below)
      if (document.activeElement === DOM.temporalMin) {
        DOM.temporalMax.value = minVal;
        maxVal = minVal;
      } else {
        DOM.temporalMin.value = maxVal;
        minVal = maxVal;
      }
    }

    state.temporal.minDelay = minVal;
    state.temporal.maxDelay = maxVal;

    DOM.temporalLabelMin.textContent = (minVal / 1000).toFixed(1) + 's';
    DOM.temporalLabelMax.textContent = (maxVal / 1000).toFixed(1) + 's';

    const maxRange = parseInt(DOM.temporalMin.max);
    const minPercent = (minVal / maxRange) * 100;
    const maxPercent = (maxVal / maxRange) * 100;

    if (DOM.temporalSliderFill) {
      DOM.temporalSliderFill.style.left = `${minPercent}%`;
      DOM.temporalSliderFill.style.width = `${maxPercent - minPercent}%`;
    }

    updateTemporalLatestUI();
  };

  DOM.temporalMin.addEventListener('input', updateSliderUI);
  DOM.temporalMax.addEventListener('input', updateSliderUI);

  if (DOM.temporalResetBtn) {
    DOM.temporalResetBtn.addEventListener('click', () => {
      DOM.temporalMin.value = 1000;
      DOM.temporalMax.value = 3000;
      updateSliderUI();
    });
  }

  // Initial setup
  DOM.temporalMin.value = state.temporal.minDelay;
  DOM.temporalMax.value = state.temporal.maxDelay;
  updateSliderUI();
}

export function updateTemporalLatestUI() {
  if (!DOM.temporalSliderLatest || state.temporal.latestDelay === null) {
    if (DOM.temporalSliderLatest) DOM.temporalSliderLatest.classList.add('hidden');
    return;
  }

  const maxRange = parseInt(DOM.temporalMin.max);
  const percent = (state.temporal.latestDelay / maxRange) * 100;
  
  DOM.temporalSliderLatest.style.left = `${percent}%`;
  DOM.temporalSliderLatest.classList.remove('hidden');
}


export function activateBTSCard(id, action = 'pulse') {
  let foundCard = null;
  DOM.btsCards.forEach(card => {
    if (card.dataset.bts === id) {
      card.classList.add('active');
      if (action === 'start') card.classList.add('pulse');
      if (action === 'end') card.classList.remove('pulse');
      if (action === 'pulse') {
        card.classList.add('pulse');
        setTimeout(() => card.classList.remove('pulse'), 2000);
      }
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      foundCard = card;
    } else if (action === 'pulse') {
      card.classList.remove('active');
    }
  });

  if (!foundCard) activateBTSCard('default');
  return foundCard;
}

export function setBTSState(btsState) {
  if (!DOM.btsPanel) return;
  console.log(`BTS: Switching to ${btsState} state.`);
  DOM.btsPanel.dataset.state = btsState;

  // Reset active cards when state changes
  DOM.btsCards.forEach(card => card.classList.remove('active'));

  // Activate specific cards based on state
  let cardToActivate = 'default';

  // Priority 1: Versioning if multiple exist
  if (history.stack.length > 1) {
    cardToActivate = 'versioning';
  }
  // Priority 2: Stage-specific defaults
  else if (btsState === 'staged') {
    cardToActivate = 'prewarm';
  } else if (btsState === 'composition') {
    cardToActivate = 'fallback';
  }

  const targetCard = document.querySelector(`.bts-card[data-bts="${cardToActivate}"]`);
  if (targetCard) targetCard.classList.add('active');
}

export function notifyBTS(id, action = 'pulse') {
  if (!DOM.btsPanel || !DOM.btsNotification) return;

  const isPanelOpen = DOM.btsPanel.classList.contains('show');

  // 1. Handle notification dot
  if (!isPanelOpen && action !== 'end') {
    DOM.btsNotification.classList.add('active');
  }

  // 2. Update Laboratory State (Card highlighting)
  const card = activateBTSCard(id, action);

  // 3. Update element highlights ONLY if the panel is open
  const targetEls = state.btsMapping[id];
  if (targetEls) {
    targetEls.forEach(el => {
      if (!el) return;
      if (action === 'start') {
        el.dataset.btsActive = "true";
        if (isPanelOpen) el.classList.add('bts-highlight', 'pulse');
      } else if (action === 'end') {
        el.classList.remove('bts-highlight', 'pulse');
        delete el.dataset.btsActive;
      } else {
        // One-off pulse
        if (isPanelOpen) {
          el.classList.add('bts-highlight', 'pulse');
          setTimeout(() => {
            if (!el.dataset.btsActive) el.classList.remove('bts-highlight', 'pulse');
          }, 2000);
        }
      }
    });
  }
}
