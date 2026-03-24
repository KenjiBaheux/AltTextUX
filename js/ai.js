import { DOM } from './dom.js';
import { state } from './state.js';
import { AltTextAITaskOrchestrator } from './orchestrator.js';

const engine = new AltTextAITaskOrchestrator();
import { PROMPTS } from './prompts.js';
import { history } from './history.js';
import { notifyBTS, updateTemporalLatestUI } from './bts.js';
import { typeWriterEffect, rewriteTextEffect, LoadingMessageManager, ensureImageLoaded } from './utils.js';
import { recordInferenceStart, recordInferenceDuration, consumeSavings, clearUnconsumedSavings, recordLossStart, recordLossEnd } from './metrics.js';
import { updateStatus, updateGenerateButtonState, updateShareButtonState, updateGenerateButtonUI, showProgressUI, hideProgressUI, triggerDoubleTakeAnimation, showErrorState, showUnavailableState, clearErrorState } from './ui.js';

function handleAIError(error, context, originalAltText = null) {
  if (error.name === 'AbortError') {
    return; // Don't show error UI for user-initiated aborts
  }

  console.error(`AI Error in ${context}:`, error);

  const transientUnknownErrorKeywords = ['generic failures occurred', 'unknown error occurred: kErrorUnknown'];
  const isTransient = error.name === 'InvalidStateError'
    || (error.message && error.message.includes('destroyed'))
    || (error.name === 'UnknownError' && transientUnknownErrorKeywords.some(keyword => error.message.includes(keyword)));

  if (isTransient) {
    cleanupAISession();
    state.aiSession = null;
    state.aiSessionPromise = null;
  }

  showErrorState(originalAltText);
}

function validateAIInput(imageSource, hint = "") {
  if (!imageSource) {
    throw new Error("InvalidStateError: No image source provided.");
  }
  if (imageSource instanceof HTMLImageElement) {
    if (imageSource.naturalWidth === 0) {
      throw new Error("InvalidStateError: Image source is not usable (naturalWidth is 0).");
    }
  }
  if (hint !== null && typeof hint !== 'string' && typeof hint !== 'undefined') {
    throw new Error("InvalidStateError: Hint must be a string.");
  }
  return true;
}

export async function checkAIAvailability() {
  if (!window.LanguageModel) {
    updateStatus('unavailable', 'AI API not found');
    showUnavailableState();
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
        state.aiAvailable = true;
        updateGenerateButtonState();

        // Show progress bar container immediately
        showProgressUI();

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
                showProgressUI(100);

                setTimeout(() => {
                  hideProgressUI();
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
        showUnavailableState();
        break;
    }
  } catch (error) {
    console.error("Error checking AI availability:", error);
    updateStatus('unavailable', 'Error in prerequisites steps');
    showUnavailableState();
  }
}

export async function prepareAISession(forceNew = false) {
  if (state.aiSession && !forceNew) return state.aiSession;
  if (state.aiSessionPromise && !forceNew) return state.aiSessionPromise;

  // Cleanup old session if forcing new
  if (forceNew) {
    cleanupAISession();
  }

  if (!window.LanguageModel) {
    updateStatus('unavailable', 'AI API not found');
    showUnavailableState();
    throw new Error("AI API not found");
  }

  state.aiSessionPromise = (async () => {
    const MAX_RETRIES = 3;
    let attempt = 0;

    while (attempt <= MAX_RETRIES) {
      try {
        // Create session allowing image input and text output
        const session = await window.LanguageModel.create({
          monitor(m) {
            let progressEventsCount = 0;
            m.addEventListener('downloadprogress', (e) => {
              progressEventsCount++;
              state.isModelDownloading = true; // Legitimately downloading!

              if (e.loaded < e.total && progressEventsCount > 3) {
                showProgressUI();

                // Only update the label to "Downloading" if we prove we're getting real bytes
                updateStatus('downloading', 'Downloading AI Model...');

                // Ensure badge is visible so they see the downloading label
                if (!state.isBadgeResolved) {
                  state.isBadgeResolved = true;
                  const container = document.querySelector('.status-badge-container');
                  if (container) container.classList.add('resolved');
                }
              }
              if (e.total) {
                const percent = e.total ? Math.round((e.loaded / e.total) * 100) : 0;
                showProgressUI(percent);

                if (percent >= 100) {
                  hideProgressUI(500);
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
        attempt++;
        const isTransient = error.name === 'InvalidStateError' || (error.message && error.message.includes('destroyed'));

        if (isTransient && attempt <= MAX_RETRIES) {
          const delay = Math.pow(2, attempt - 1) * 500;
          console.warn(`Failed to create AI session (attempt ${attempt}/${MAX_RETRIES + 1}). Retrying in ${delay}ms...`, error);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        console.error("Failed to create session after retries", error);
        state.aiSessionPromise = null; // Reset so next call can retry
        handleAIError(error, "prepareAISession");
        throw error;
      }
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

  try {
    await ensureImageLoaded(targetImageSource);
  } catch (e) {
    console.warn("Proactive generation image source not ready", e);
    return;
  }

  const currentEntry = history.stack[history.currentIndex];
  const normalizedHint = (currentEntry && currentEntry.isAI && hint === currentEntry.text) ? "" : hint;

  const promise = engine.execute(targetImageSource, normalizedHint, async (signal) => {
    const session = await prepareAISession();
    if (!session) throw new Error("No session");
    
    validateAIInput(targetImageSource, normalizedHint);
    const clone = await session.clone();
    
    const promptMessage = [{ type: "image", value: targetImageSource }];
    if (normalizedHint) {
      promptMessage.push({ type: "text", value: PROMPTS.USER_GUIDANCE(normalizedHint) });
    } else {
      promptMessage.push({ type: "text", value: PROMPTS.USER_DEFAULT });
    }

    const btsType = isProactive2 ? 'proactive-2' : (normalizedHint ? 'guidance' : 'proactive-1');
    notifyBTS(btsType, 'start');
    const metricType = isProactive2 ? 'proactive2' : 'proactive';
    recordInferenceStart(metricType);

    try {
      const result = await clone.prompt([{ role: "user", content: promptMessage }], { signal });
      const duration = performance.now() - state.inferenceStartTimes.get(metricType);
      recordInferenceDuration(metricType, duration);
      notifyBTS(btsType, 'end');
      return result;
    } catch (error) {
      notifyBTS(btsType, 'end');
      if (state.unconsumedSavings && state.unconsumedSavings.type === metricType && !state.unconsumedSavings.duration) {
        clearUnconsumedSavings();
      }
      throw error;
    } finally {
      clone.destroy();
    }
  }, { force: false, speculative: true }).catch(error => { // Proactive matches speculative nature
    if (error.name !== 'AbortError') {
      handleAIError(error, "startProactiveGeneration");
    }
  });

  return promise;
}

export async function prewarmWithSampleImage() {
  if (!state.settings.enablePrewarming) return false;
  if (!state.aiAvailable || !DOM.sampleImageSource) return false;

  // With mapping, checking ongoing tasks is handled elegantly, we check if one is running for this exact key
  if (engine.ongoingTasks.has(engine._getKey(DOM.sampleImageSource, ""))) return false;
  if (engine.hasCache(DOM.sampleImageSource, "")) return false;

  try {
    await ensureImageLoaded(DOM.sampleImageSource);
  } catch (e) {
    console.warn("Sample image failed to load for prewarming");
    return false;
  }

  engine.execute(DOM.sampleImageSource, "", async (signal) => {
    const session = await prepareAISession();
    if (!session) throw new Error("No session");
    validateAIInput(DOM.sampleImageSource);

    notifyBTS('prewarm');
    const clone = await session.clone();

    const promptMessage = [
      { type: "image", value: DOM.sampleImageSource },
      { type: "text", value: PROMPTS.USER_DEFAULT }
    ];

    recordInferenceStart('prewarm');

    try {
      const result = await clone.prompt([{ role: "user", content: promptMessage }], { signal });
      const duration = performance.now() - state.inferenceStartTimes.get('prewarm');
      recordInferenceDuration('prewarm', duration);
      notifyBTS('prewarm', 'end');
      return result;
    } catch (error) {
      notifyBTS('prewarm', 'end');
      if (state.unconsumedSavings && state.unconsumedSavings.type === 'prewarm' && !state.unconsumedSavings.duration) {
        clearUnconsumedSavings();
      }
      throw error;
    } finally {
      clone.destroy();
    }
  }, { force: false, speculative: true }).catch(error => {  // Prewarm is speculative
    if (error.name !== 'AbortError') {
      handleAIError(error, "prewarmWithSampleImage");
    }
  });

  return true;
}

export async function generateAltText() {
  if (state.isGenerating) {
    abortGeneration();
    return;
  }
  if (!state.currentImageSource || !state.aiAvailable) return;

  state.wasAltTextManuallyCleared = false;
  const rawInput = DOM.altTextInput.value.trim();
  const currentEntry = history.stack[history.currentIndex];
  state.originalAltText = (currentEntry && currentEntry.isAI && rawInput === currentEntry.text) ? "" : rawInput;

  history.prepareForAI(state.originalAltText);
  DOM.altTextInput.classList.add('text-shimmer');
  clearErrorState();
  DOM.altTextInput.disabled = true;
  const currentIcon = state.originalAltText ? DOM.iconEnhance : DOM.iconSparkle;
  if (currentIcon) currentIcon.classList.add('icon-hidden-transition');

  state.isGenerating = true;
  updateShareButtonState();
  updateGenerateButtonUI();
  history.updateUI(); 
  notifyBTS(state.originalAltText ? 'guidance' : 'chameleon', 'start');

  DOM.generateLoader.classList.remove('hidden');

  if (state.generationAbortController) {
    state.generationAbortController.abort();
  }
  state.generationAbortController = new AbortController();
  const signal = state.generationAbortController.signal;

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

    // A real user-invoked generation is NOT speculative. It aborts unmatching prior ongoing inferences!
    const prediction = await engine.execute(state.currentImageSource, state.originalAltText, async (engineSignal) => {
      // Setup listener to bridge UI abort to engine abort
      const onUiAbort = () => engine.abort();
      signal.addEventListener('abort', onUiAbort, { once: true });

      clearUnconsumedSavings();
      await ensureImageLoaded(state.currentImageSource);
      
      const session = await prepareAISession();
      if (!session) throw new Error("No AI Session");
      validateAIInput(state.currentImageSource, state.originalAltText);
      const clone = await session.clone();

      const promptMessage = [{ type: "image", value: state.currentImageSource }];
      if (state.originalAltText) {
        promptMessage.push({ type: "text", value: PROMPTS.USER_GUIDANCE(state.originalAltText) });
      } else {
        promptMessage.push({ type: "text", value: PROMPTS.USER_DEFAULT });
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

      if (lostTrickType) recordLossStart(lostTrickType);

      try {
        return await clone.prompt([{ role: "user", content: promptMessage }], { signal: engineSignal });
      } finally {
        recordLossEnd();
        clone.destroy();
        signal.removeEventListener('abort', onUiAbort);
      }
    });

    if (prediction.type === 'cached' || prediction.type === 'adopted') {
      consumeSavings();
    }
    resultText = prediction.result;
    engine.consume(state.currentImageSource, state.originalAltText);

    const elapsed = performance.now() - requestTimestamp;
    const remainingDelay = targetDelay - elapsed;

    if (remainingDelay > 0) {
      notifyBTS('temporal');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(resolve, remainingDelay);
        signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException("AbortError", "AbortError"));
        }, { once: true });
      });
    } else {
      state.temporal.latestDelay = 0;
      updateTemporalLatestUI();
    }

    if (signal.aborted) {
      throw new DOMException("AbortError", "AbortError");
    }

    if (loadingManager) {
      loadingManager.stop();
    }

    const existingIndex = history.stack.findIndex(entry => entry.isAI && entry.text === resultText);

    if (existingIndex !== -1) {
      console.log(`History: Match found for AI generated text at index ${existingIndex}. Triggering Double-Take.`);
      history.cancelAI();
      history.currentIndex = existingIndex;
      history.applyCurrent();

      const WITTY_MESSAGES = [
        "Nailed it, twice!", "Still perfection.", "Encore!", "I'm my own favorite.",
        "Deja vu?", "Staying on message.", "Cache hit!", "Consistency is key.",
        "Why change a classic?", "Great minds think alike.", "Too good to change.", "If it ain't broke..."
      ];
      const wittyMessage = WITTY_MESSAGES[Math.floor(Math.random() * WITTY_MESSAGES.length)];
      triggerDoubleTakeAnimation(wittyMessage);

      state.lastGeneratedAltText = resultText;
      startProactiveGeneration(resultText, null, true);
    } else {
      history.finalizeAI(resultText);
      state.lastGeneratedAltText = resultText;
      startProactiveGeneration(resultText, null, true);

      if (state.originalAltText && DOM.altTextInput.classList.contains('text-shimmer')) {
        DOM.altTextInput.classList.remove('text-shimmer');
        await rewriteTextEffect(DOM.altTextInput, resultText, false, signal);
      } else {
        DOM.altTextInput.classList.remove('text-dimming');
        await typeWriterEffect(resultText, signal);
      }

      if (signal && signal.aborted) {
        if (state.originalAltText) {
          // Unwind the rewriting and delete the entry if it was a refine task
          history.stack.splice(history.currentIndex, 1);
          history.currentIndex--;
          if (history.stack.length === 0) {
            history.push("", false);
          } else if (history.currentIndex < 0) {
            history.currentIndex = 0;
          }
          history.applyCurrent();
        } else {
          // Stop midway if it was a Draft task
          history.updateCurrent(DOM.altTextInput.value, true);
        }
      }
    }
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log("Generation aborted by user");
      history.cancelAI();
      return;
    }
    handleAIError(error, "generateAltText", state.originalAltText);
  } finally {
    if (loadingManager) {
      loadingManager.stop();
    }
    DOM.altTextInput.classList.remove('text-shimmer');
    DOM.altTextInput.classList.remove('text-dimming');
    DOM.altTextInput.disabled = false;
    DOM.generateLoader.classList.add('hidden');
    state.isGenerating = false;
    state.generationAbortController = null;
    updateGenerateButtonUI();
    updateShareButtonState();
    history.updateUI();

    const isUserDrafting = (document.activeElement === DOM.postContent);
    if (!isUserDrafting) {
      DOM.altTextInput.focus();
      DOM.altTextInput.setSelectionRange(0, 0);
    }
    notifyBTS(state.originalAltText ? 'guidance' : 'chameleon', 'end');
  }
}

export function abortGeneration() {
  if (state.generationAbortController) {
    state.generationAbortController.abort();
    state.generationAbortController = null;
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


export function getSmartFallbackData(imageSource, hint = "") {
  if (!imageSource) return null;
  const key = engine._getKey(imageSource, hint);
  if (engine.hasCache(imageSource, hint)) {
    return { type: "cached", result: engine.getCachedResult(imageSource, hint) };
  }
  if (engine.ongoingTasks.has(key)) {
    return { type: "promise", promise: engine.ongoingTasks.get(key).promise };
  }
  return null;
}

export function consumeSmartFallback(imageSource, hint = "") {
  engine.consume(imageSource, hint);
}
