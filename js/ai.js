import { DOM } from './dom.js';
import { state } from './state.js';
import { PROMPTS } from './prompts.js';
import { history } from './history.js';
import { notifyBTS, updateTemporalLatestUI } from './bts.js';
import { typeWriterEffect, rewriteTextEffect, LoadingMessageManager, ensureImageLoaded } from './utils.js';
import { recordInferenceStart, recordInferenceDuration, consumeSavings, clearUnconsumedSavings, recordLossStart, recordLossEnd } from './metrics.js';
import { updateStatus, updateGenerateButtonState, updateShareButtonState, updateGenerateButtonUI, showProgressUI, hideProgressUI, triggerDoubleTakeAnimation, showErrorState, showUnavailableState, clearErrorState } from './ui.js';

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
        // In a real app we might monitor progress when create() is called
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
        updateStatus('unavailable', 'Failed to load model');
        showUnavailableState();
        state.aiSessionPromise = null; // Reset so next call can retry
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

  // Normalize hint: if the current text is an AI entry, it's not a user refinement
  const currentEntry = history.stack[history.currentIndex];
  const normalizedHint = (currentEntry && currentEntry.isAI && hint === currentEntry.text) ? "" : hint;

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
  recordInferenceStart(metricType);

  state.activeInferencePromise = (async () => {
    try {
      const result = await clone.prompt([{ role: "user", content: promptMessage }], { signal: state.inferenceAbortController.signal });
      const duration = performance.now() - state.inferenceStartTimes.get(metricType);
      recordInferenceDuration(metricType, duration);
      
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
        clearUnconsumedSavings();
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

  try {
    await ensureImageLoaded(DOM.sampleImageSource);
  } catch (e) {
    console.warn("Sample image failed to load for prewarming");
    return false;
  }

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

  recordInferenceStart('prewarm');

  state.prewarmPromise = (async () => {
    try {
      const result = await clone.prompt([{ role: "user", content: promptMessage }], { signal: state.prewarmAbortController.signal });
      const duration = performance.now() - state.inferenceStartTimes.get('prewarm');
      recordInferenceDuration('prewarm', duration);

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
        clearUnconsumedSavings();
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

  // If the current text is an AI entry from history, we shouldn't treat it as a user hint
  const currentEntry = history.stack[history.currentIndex];
  state.originalAltText = (currentEntry && currentEntry.isAI && rawInput === currentEntry.text) ? "" : rawInput;
  
  // Rule 2 & 3: Generate and Refine always insert a new entry.
  // We handle the shimmer visually without hacking the history stack in ai.js.
  // history.js will handle the actual stack manipulation.
  
  if (state.originalAltText) {
    DOM.altTextInput.classList.add('text-shimmer');
  }

  clearErrorState();

  DOM.generateBtn.disabled = true;
  DOM.altTextInput.disabled = true; 
  const currentIcon = state.originalAltText ? DOM.iconEnhance : DOM.iconSparkle;
  if (currentIcon) currentIcon.classList.add('icon-hidden-transition');

  state.isGenerating = true;
  updateShareButtonState();
  history.updateUI(); // Lock history navigation buttons
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
      consumeSavings();

      resultText = state.cachedAltText;

      state.cachedAltText = "";
      state.cachedHint = null;
    }
    else if (state.activeInferencePromise && state.activeInferenceHint === state.originalAltText) {
      consumeSavings();

      resultText = await state.activeInferencePromise;
    }
    else {
      if (state.inferenceAbortController) {
        state.inferenceAbortController.abort();
        state.inferenceAbortController = null;
      }
      state.activeInferencePromise = null;
      state.activeInferenceHint = null;
      
      clearUnconsumedSavings();

      try {
        await ensureImageLoaded(state.currentImageSource);
      } catch (e) {
        throw new Error("InvalidStateError: The image source is not usable.");
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
        recordLossStart(lostTrickType);
      }

      try {
        resultText = await clone.prompt([{ role: "user", content: promptMessage }]);
      } finally {
        recordLossEnd();
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

    if (loadingManager) {
      loadingManager.stop();
    }

    const existingIndex = history.stack.findIndex(entry => entry.isAI && entry.text === resultText);
    
    if (existingIndex !== -1) {
      console.log(`History: Match found for AI generated text at index ${existingIndex}. Triggering Double-Take.`);
      
      // Navigate history to the existing matching entry
      history.currentIndex = existingIndex;
      history.applyCurrent();

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
      
      const wittyMessage = WITTY_MESSAGES[Math.floor(Math.random() * WITTY_MESSAGES.length)];
      triggerDoubleTakeAnimation(wittyMessage);

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

    showErrorState(state.originalAltText);
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
    history.updateUI(); // Unlock history navigation buttons

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
