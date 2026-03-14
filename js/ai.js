import { DOM } from './dom.js';
import { state } from './state.js';
import { PROMPTS } from './prompts.js';
import { history } from './history.js';
import { notifyBTS, updateMetricsUI, startMetricsLoop, updateTemporalLatestUI } from './bts.js';
import { typeWriterEffect, rewriteTextEffect, LoadingMessageManager } from './utils.js';
import { updateStatus, updateGenerateButtonState, updateShareButtonState, updateGenerateButtonUI } from './ui.js';

export async function checkAIAvailability() {
  if (!window.LanguageModel) {
    updateStatus('unavailable', 'AI API not found');
    return;
  }

  try {
    const options = {
      expectedInputs: [
        { type: "image" },
        { type: "text", languages: ["en"] /* fallback/system prompt lang */ }
      ],
      expectedOutputs: [
        { type: "text", languages: ["en"] }
      ]
    }
    const availability = await window.LanguageModel.availability(options);

    switch (availability) {
      case 'available':
        updateStatus('available', 'AI Ready');
        state.aiAvailable = true;
        updateGenerateButtonState();
        prepareAISession(); // Pre-warm the session
        break;
      case 'downloadable':
        updateStatus('downloadable', 'Model Ready to Download');
        state.aiAvailable = true;
        updateGenerateButtonState();
        break;
      case 'downloading':
        updateStatus('downloading', 'Checking AI Model...');
        // In a real app we might monitor progress when create() is called
        state.aiAvailable = true;
        updateGenerateButtonState();

        // Show progress bar container immediately
        if (DOM.progressContainer) {
          DOM.progressContainer.classList.add('show');
          if (DOM.progressPercent) DOM.progressPercent.textContent = '...';
        }

        // Polling workaround for Chrome restoration bug & slow connections
        if (!state.availabilityPollInterval) {
          state.availabilityPollInterval = setInterval(async () => {
            try {
              if (state.isModelDownloading) {
                // Legitimate download started (progress events received), cancel bug workaround
                clearInterval(state.availabilityPollInterval);
                state.availabilityPollInterval = null;
                return;
              }

              const currentStatus = await window.LanguageModel.availability(options);
              if (currentStatus !== 'downloading') {
                clearInterval(state.availabilityPollInterval);
                state.availabilityPollInterval = null;
                console.log(`Chrome component update finished or bug resolved. Status is now: ${currentStatus}`);

                // Force bar to 100% completion for mental model consistency before hiding
                if (DOM.progressFill) DOM.progressFill.style.width = '100%';
                if (DOM.progressPercent) DOM.progressPercent.textContent = '100%';

                setTimeout(() => {
                  if (DOM.progressContainer) DOM.progressContainer.classList.remove('show');
                  checkAIAvailability(); // Re-run with the properly resolved state
                }, 500);
              }
            } catch (e) {
              clearInterval(state.availabilityPollInterval);
              state.availabilityPollInterval = null;
            }
          }, 1000);
        }
        break;
      case 'unavailable':
      default:
        updateStatus('unavailable', 'AI Model Unavailable');
        break;
    }
  } catch (error) {
    console.error("Error checking AI availability:", error);
    updateStatus('unavailable', 'Error in prerequisites steps');
  }
}

export async function prepareAISession(forceNew = false) {
  if (state.aiSession && !forceNew) return state.aiSession;
  if (state.aiSessionPromise && !forceNew) return state.aiSessionPromise;

  // Cleanup old session if forcing new
  if (forceNew) {
    cleanupAISession();
  }

  state.aiSessionPromise = (async () => {
    try {
      // Create session allowing image input and text output
      const session = await window.LanguageModel.create({
        monitor(m) {
          let progressEventsCount = 0;
          m.addEventListener('downloadprogress', (e) => {
            progressEventsCount++;
            state.isModelDownloading = true; // Legitimately downloading!

            if (e.loaded < e.total && DOM.progressContainer && progressEventsCount > 3) {
              DOM.progressContainer.classList.add('show');
              DOM.progressContainer.style.transitionDelay = '0s'; // override delay if real progress!

              // Only update the label to "Downloading" if we prove we're getting real bytes
              updateStatus('downloading', 'Downloading AI Model...');

              // Ensure badge is visible so they see the downloading label
              if (!state.isBadgeResolved) {
                state.isBadgeResolved = true;
                const container = document.querySelector('.status-badge-container');
                if (container) container.classList.add('resolved');
              }
            }
            if (DOM.progressFill && DOM.progressPercent) {
              const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
              DOM.progressFill.style.width = `${percent}%`;
              DOM.progressPercent.textContent = `${percent}%`;

              if (percent >= 100) {
                setTimeout(() => DOM.progressContainer && DOM.progressContainer.classList.remove('show'), 500);
              }
            }
          });
        },
        initialPrompts: [
          {
            role: "system",
            content: PROMPTS.SYSTEM
          }
        ],
        expectedInputs: [
          { type: "image" },
          { type: "text", languages: ["en"] /* fallback/system prompt lang */ }
        ],
        expectedOutputs: [
          { type: "text", languages: ["en"] }
        ]
      });
      state.aiSession = session;

      updateStatus('available', 'AI Ready');
      return session;
    } catch (error) {
      console.error("Failed to create session", error);
      updateStatus('unavailable', 'Failed to load model');
      state.aiSessionPromise = null; // Reset so next call can retry
      throw error;
    }
  })();

  return state.aiSessionPromise;
}

export function triggerModelDownload() {
  const isActionable = DOM.statusBadge.classList.contains('status-downloadable') || DOM.statusBadge.classList.contains('status-downloading');
  if (!state.aiSession && state.aiAvailable && isActionable) {
    prepareAISession().catch(e => console.error("Background download failed", e));
  }
}

export async function startProactiveGeneration(hint = "", imageSrcOverride = null, isProactive2 = false) {
  if (isProactive2 && !state.settings.enableProactive2) return;
  if (!isProactive2 && !state.settings.enableProactive && !imageSrcOverride) return;

  const targetImageSource = imageSrcOverride || state.currentImageSource;
  if (!targetImageSource || !state.aiAvailable) return;

  // Normalize hint: if it matches the last AI output, it's not a user refinement
  const normalizedHint = (hint === state.lastGeneratedAltText) ? "" : hint;

  // OPTIMIZATION: In-Flight Prewarm Adoption
  if (state.prewarmPromise && targetImageSource === DOM.sampleImageSource && normalizedHint === "") {
    console.log("BTS: Adopting in-flight Warm-up Lap.");
    state.activeInferenceHint = "";
    state.currentProactiveImageSrc = targetImageSource;
    state.activeInferencePromise = state.prewarmPromise.then(result => {
      state.cachedAltText = result;
      state.cachedHint = "";
      state.activeInferencePromise = null;
      state.activeInferenceHint = null;
      return result;
    });
    return state.activeInferencePromise;
  }

  // Abort any ongoing prewarming if we are starting unrelated real work
  if (state.prewarmAbortController) {
    console.log("BTS: Aborting Warm-up Lap for real workload.");
    state.prewarmAbortController.abort();
    state.prewarmAbortController = null;
    state.prewarmPromise = null;
  }

  // If we're requesting the sample image and it's already pre-cached, use it!
  if (targetImageSource === DOM.sampleImageSource && state.sampleImageAltText) {
    console.log("BTS: Sample Image cache hit from Warm-up Lap.");
    state.cachedAltText = state.sampleImageAltText;
    state.cachedHint = "";
    state.currentProactiveImageSrc = targetImageSource;

    // Consume the pre-cache so a fresh one can be generated for the next journey
    state.sampleImageAltText = "";
    return Promise.resolve(state.cachedAltText);
  }

  // Don't restart if we are already fulfilling this exact request
  if (state.activeInferencePromise && state.activeInferenceHint === normalizedHint && state.currentProactiveImageSrc === targetImageSource) return;

  // Don't restart if we already have it cached
  if (state.cachedAltText && state.cachedHint === normalizedHint && state.currentProactiveImageSrc === targetImageSource) return;

  // If there's an active inference doing something else, abort it
  if (state.inferenceAbortController) {
    state.inferenceAbortController.abort();
    state.inferenceAbortController = null;
  }
  const session = await prepareAISession();
  if (!session) return;

  state.inferenceAbortController = new AbortController();
  state.activeInferenceHint = normalizedHint;
  state.currentProactiveImageSrc = targetImageSource;

  // Utilize session cloning for a fresh baseline
  const clone = await session.clone();

  const promptMessage = [
    { type: "image", value: targetImageSource },
  ];

  if (normalizedHint) {
    promptMessage.push({
      type: "text",
      value: PROMPTS.USER_GUIDANCE(normalizedHint)
    });
  } else {
    promptMessage.push({
      type: "text",
      value: PROMPTS.USER_DEFAULT
    });
  }

  const btsType = isProactive2 ? 'proactive-2' : (normalizedHint ? 'guidance' : 'proactive-1');
  notifyBTS(btsType, 'start');

  const metricType = isProactive2 ? 'proactive2' : 'proactive';
  state.inferenceStartTimes.set(metricType, performance.now());
  state.unconsumedSavings = { type: metricType, startTime: state.inferenceStartTimes.get(metricType), duration: null };
  startMetricsLoop();

  state.activeInferencePromise = (async () => {
    try {
      const result = await clone.prompt([{ role: "user", content: promptMessage }], { signal: state.inferenceAbortController.signal });
      const duration = performance.now() - state.inferenceStartTimes.get(metricType);
      state.inferenceDurations.set(metricType, duration);
      if (state.unconsumedSavings && state.unconsumedSavings.type === metricType) {
        state.unconsumedSavings.duration = duration;
      }
      updateMetricsUI();
      
      state.cachedAltText = result;
      state.cachedHint = normalizedHint;
      notifyBTS(btsType, 'end');
      return result;
    } catch (error) {
      notifyBTS(normalizedHint ? 'guidance' : 'proactive-1', 'end');
      // Ignore abort errors
      if (error.name !== 'AbortError') {
        console.error("Proactive generation failed:", error);
      }
      if (state.unconsumedSavings && state.unconsumedSavings.type === metricType && !state.unconsumedSavings.duration) {
        state.unconsumedSavings = null;
        updateMetricsUI();
      }
      throw error;
    } finally {
      state.activeInferencePromise = null;
      state.activeInferenceHint = null;
      clone.destroy(); // Cleanup clone
    }
  })();

  return state.activeInferencePromise;
}

export async function prewarmWithSampleImage() {
  if (!state.settings.enablePrewarming) return false;
  if (!state.aiAvailable || !DOM.sampleImageSource || state.sampleImageAltText || state.prewarmAbortController) return false;

  const session = await prepareAISession();
  if (!session) return;

  state.prewarmAbortController = new AbortController();
  console.log("BTS: Starting Warm-up Lap with sample image.");
  notifyBTS('prewarm');

  const clone = await session.clone();

  const promptMessage = [
    { type: "image", value: DOM.sampleImageSource },
    { type: "text", value: PROMPTS.USER_DEFAULT }
  ];

  state.inferenceStartTimes.set('prewarm', performance.now());
  state.unconsumedSavings = { type: 'prewarm', startTime: state.inferenceStartTimes.get('prewarm'), duration: null };
  startMetricsLoop();

  state.prewarmPromise = (async () => {
    try {
      const result = await clone.prompt([{ role: "user", content: promptMessage }], { signal: state.prewarmAbortController.signal });
      const duration = performance.now() - state.inferenceStartTimes.get('prewarm');
      state.inferenceDurations.set('prewarm', duration);
      if (state.unconsumedSavings && state.unconsumedSavings.type === 'prewarm') {
        state.unconsumedSavings.duration = duration;
      }
      updateMetricsUI();

      state.sampleImageAltText = result;
      console.log("BTS: Warm-up Lap complete. Sample image alt text cached.");
      notifyBTS('prewarm', 'end');
      return result;
    } catch (error) {
      notifyBTS('prewarm', 'end');
      if (error.name !== 'AbortError') {
        console.error("Warm-up Lap failed:", error);
      }
      if (state.unconsumedSavings && state.unconsumedSavings.type === 'prewarm' && !state.unconsumedSavings.duration) {
        state.unconsumedSavings = null;
        updateMetricsUI();
      }
      throw error;
    } finally {
      clone.destroy();
      state.prewarmAbortController = null;
      state.prewarmPromise = null;
    }
  })();

  return true; // Work started
}

export async function generateAltText() {
  if (!state.currentImageSource || !state.aiAvailable) return;

  state.wasAltTextManuallyCleared = false;

  const rawInput = DOM.altTextInput.value.trim();

  state.originalAltText = (rawInput === state.lastGeneratedAltText) ? "" : rawInput;
  
  // Rule 2 & 3: Generate and Refine always insert a new entry.
  // We handle the shimmer visually without hacking the history stack in ai.js.
  // history.js will handle the actual stack manipulation.
  
  if (state.originalAltText) {
    DOM.altTextInput.classList.add('text-shimmer');
  }

  DOM.altTextInput.parentElement.classList.remove('error-caution');

  DOM.generateBtn.disabled = true;
  DOM.altTextInput.disabled = true; 
  const currentIcon = state.originalAltText ? DOM.iconEnhance : DOM.iconSparkle;
  if (currentIcon) currentIcon.classList.add('hidden');

  state.isGenerating = true;
  updateShareButtonState();
  notifyBTS(state.originalAltText ? 'guidance' : 'chameleon', 'start');

  DOM.generateLoader.classList.remove('hidden');

  let loadingManager = null;
  if (!state.originalAltText) {
    loadingManager = new LoadingMessageManager(DOM.altTextInput);
    loadingManager.start();
  }

  let resultText = "";

  const requestTimestamp = performance.now();
  const minD = state.temporal.minDelay;
  const maxD = state.temporal.maxDelay;
  const targetDelay = minD + Math.random() * (maxD - minD);
  state.temporal.latestDelay = Math.round(targetDelay);
  updateTemporalLatestUI();

  try {
    if (state.settings.simulateAIFail) {
      throw new Error("Simulated AI Failure");
    }

    if (state.cachedAltText && state.cachedHint === state.originalAltText) {
      // Record time saved from consumption
      if (state.unconsumedSavings) {
        const actualSaved = state.unconsumedSavings.duration || (performance.now() - state.unconsumedSavings.startTime);
        if (state.unconsumedSavings.type === 'prewarm') {
          state.metrics.timeSavedPrewarm += actualSaved;
        } else {
          state.metrics.timeSavedProactive += actualSaved;
        }
        state.unconsumedSavings = null;
      }
      updateMetricsUI();

      resultText = state.cachedAltText;

      state.cachedAltText = "";
      state.cachedHint = null;
    }
    else if (state.activeInferencePromise && state.activeInferenceHint === state.originalAltText) {
      if (state.unconsumedSavings) {
        const actualSaved = state.unconsumedSavings.duration || (performance.now() - state.unconsumedSavings.startTime);
        if (state.unconsumedSavings.type === 'prewarm') {
          state.metrics.timeSavedPrewarm += actualSaved;
        } else {
          state.metrics.timeSavedProactive += actualSaved;
        }
        state.unconsumedSavings = null;
      }
      updateMetricsUI();

      resultText = await state.activeInferencePromise;
    }
    else {
      if (state.inferenceAbortController) {
        state.inferenceAbortController.abort();
        state.inferenceAbortController = null;
      }
      state.activeInferencePromise = null;
      state.activeInferenceHint = null;
      
      if (state.unconsumedSavings) {
        state.unconsumedSavings = null;
        updateMetricsUI();
      }

      const session = await prepareAISession();
      if (!session) return;

      const clone = await session.clone();

      const promptMessage = [
        { type: "image", value: state.currentImageSource },
      ];

      if (state.originalAltText) {
        promptMessage.push({
          type: "text",
          value: PROMPTS.USER_GUIDANCE(state.originalAltText)
        });
      } else {
        promptMessage.push({
          type: "text",
          value: PROMPTS.USER_DEFAULT
        });
      }

      let lostTrickType = null;
      if (state.originalAltText) {
        if (!state.settings.enableProactive) lostTrickType = 'proactive';
      } else {
        if (history.stack.length <= 2) {
          if (state.currentImageSource === DOM.sampleImageSource) {
            if (!state.settings.enablePrewarming) lostTrickType = 'prewarm';
          } else {
            if (!state.settings.enableProactive) lostTrickType = 'proactive';
          }
        } else {
          if (!state.settings.enableProactive2) lostTrickType = 'proactive2';
          else if (!state.settings.enableProactive) lostTrickType = 'proactive';
        }
      }

      if (lostTrickType) {
        state.activeManualGeneration = { type: lostTrickType, startTime: performance.now() };
        startMetricsLoop();
      }

      try {
        resultText = await clone.prompt([{ role: "user", content: promptMessage }]);
      } finally {
        if (state.activeManualGeneration) {
          const duration = performance.now() - state.activeManualGeneration.startTime;
          if (lostTrickType === 'prewarm') state.metrics.timeLostPrewarm += duration;
          else if (lostTrickType === 'proactive') state.metrics.timeLostProactive += duration;
          else if (lostTrickType === 'proactive2') state.metrics.timeLostProactive2 += duration;
          state.activeManualGeneration = null;
          updateMetricsUI();
        }
        clone.destroy();
      }

      state.cachedAltText = resultText;
      state.cachedHint = state.originalAltText;
    }

    const elapsed = performance.now() - requestTimestamp;
    const remainingDelay = targetDelay - elapsed;

    if (remainingDelay > 0) {
      notifyBTS('temporal');
      await new Promise(resolve => setTimeout(resolve, remainingDelay));
    } else {
      state.temporal.latestDelay = 0;
      updateTemporalLatestUI();
    }
    DOM.generateLoader.classList.add('hidden');

    if (loadingManager) {
      loadingManager.stop();
    }

    const existingIndex = history.stack.findIndex(entry => entry.isAI && entry.text === resultText);
    
    if (existingIndex !== -1) {
      console.log(`History: Match found for AI generated text at index ${existingIndex}. Triggering Double-Take.`);
      
      const WITTY_MESSAGES = [
        "Nailed it twice.",
        "Still perfection.",
        "Encore!",
        "I’m my own favorite.",
        "Deja vu?",
        "Staying on message.",
        "Cache hit!",
        "Consistency is key.",
        "Why change a classic?",
        "Great minds think alike.",
        "Too good to change.",
        "If it ain't broke..."
      ];
      
      const wasRefine = DOM.iconEnhance && !DOM.iconEnhance.classList.contains('hidden');
      const activeIcon = wasRefine ? DOM.iconEnhance : DOM.iconSparkle;
      const inactiveIcon = wasRefine ? DOM.iconSparkle : DOM.iconEnhance;
      
      // Navigate history to the existing matching entry
      history.currentIndex = existingIndex;
      history.applyCurrent(); 
      
      // Trigger Double-Take Animation on the contextually active Icon
      if (activeIcon) {
         activeIcon.classList.remove('hidden');
         if (inactiveIcon) inactiveIcon.classList.add('hidden');
         activeIcon.classList.remove('icon-double-take');
         void activeIcon.offsetWidth; // trigger reflow
         activeIcon.classList.add('icon-double-take');
      }
      
      // Trigger Wave Animation on Text
      DOM.altTextInput.classList.remove('text-wave');
      DOM.altTextInput.classList.remove('text-shimmer');
      DOM.altTextInput.classList.remove('text-dimming');
      void DOM.altTextInput.offsetWidth; // trigger reflow
      DOM.altTextInput.classList.add('text-wave');
      
      // Trigger History Stepper Pulse
      if (DOM.historyIndex) {
         DOM.historyIndex.classList.remove('history-index-pulse');
         void DOM.historyIndex.offsetWidth; // trigger reflow
         DOM.historyIndex.classList.add('history-index-pulse');
      }
      
      // Trigger Witty Bubble
      if (DOM.wittyBubble) {
         DOM.wittyBubble.textContent = WITTY_MESSAGES[Math.floor(Math.random() * WITTY_MESSAGES.length)];
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
         updateGenerateButtonUI(); // Restore to normal state for the current history item
      }, 2500);

      state.lastGeneratedAltText = resultText;
      startProactiveGeneration(resultText, null, true);

    } else {
      // Insert the new AI generated text into history
      history.pushAIResult(resultText, state.originalAltText);

      state.lastGeneratedAltText = resultText;

      startProactiveGeneration(resultText, null, true);

      if (state.originalAltText && DOM.altTextInput.classList.contains('text-shimmer')) {
        DOM.altTextInput.classList.remove('text-shimmer');
        await rewriteTextEffect(DOM.altTextInput, resultText);
      } else {
        DOM.altTextInput.classList.remove('text-dimming');
        await typeWriterEffect(resultText);
      }
    }

  } catch (error) {
    if (error.name === 'AbortError') return; 

    console.error("Generation error:", error);

    if (error.name === 'InvalidStateError' || (error.message && error.message.includes('destroyed'))) {
      state.aiSession = null;
    }

    updateStatus('error', 'AI Failed');

    DOM.altTextInput.parentElement.classList.add('error-caution');

    if (state.originalAltText === "") {
      DOM.altTextInput.placeholder = "Even AI can't see these pixels. Tell the story for everyone—and everything—who can't see pixels.";
    } else {
      DOM.altTextInput.value = state.originalAltText;
    }
  } finally {
    if (loadingManager) {
      loadingManager.stop();
    }
    DOM.altTextInput.classList.remove('text-shimmer');
    DOM.altTextInput.classList.remove('text-dimming');
    DOM.generateBtn.disabled = false;
    DOM.altTextInput.disabled = false; 
    DOM.generateLoader.classList.add('hidden');
    updateGenerateButtonUI(); 
    state.isGenerating = false;
    updateShareButtonState();

    const isUserDrafting = (document.activeElement === DOM.postContent);
    if (!isUserDrafting) {
      DOM.altTextInput.focus();
      DOM.altTextInput.setSelectionRange(0, 0);
    }

    notifyBTS(state.originalAltText ? 'guidance' : 'chameleon', 'end');
  }
}

export function cleanupAISession() {
  if (state.aiSession) {
    try {
      if (typeof state.aiSession.destroy === 'function') {
        state.aiSession.destroy();
      }
    } catch (e) {
      console.error("Error destroying session", e);
    }
    state.aiSession = null;
  }
}
