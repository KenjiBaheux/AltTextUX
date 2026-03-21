export const state = {
  currentImageFile: null,
  currentImageSource: null,
  currentPreviewUrl: null,
  aiAvailable: false,
  aiSession: null,
  aiSessionPromise: null,
  isModelDownloading: false,
  availabilityPollAttempts: 0,
  availabilityPollInterval: null,
  isBadgeResolved: false,
  lastGeneratedAltText: "",
  isGenerating: false,
  isAnimating: false,
  wasAltTextManuallyCleared: false,

  cachedAltText: "",
  cachedHint: "",
  sampleImageAltText: "",
  activeInferencePromise: null,
  activeInferenceHint: null,
  inferenceAbortController: null,
  generationAbortController: null,
  prewarmAbortController: null,
  prewarmPromise: null,
  currentProactiveImageSrc: null,

  originalAltText: "",
  btsMapping: {},

  settings: {
    enablePrewarming: true,
    enableProactive: true,
    enableProactive2: true,
    enableTransitions: true,
    simulateAIFail: false,
    useBlandPlaceholder: false
  },
  temporal: {
    minDelay: 1000,
    maxDelay: 2500,
    latestDelay: null
  },
  metrics: {
    timeSavedPrewarm: 0,
    timeLostPrewarm: 0,
    timeSavedProactive: 0,
    timeLostProactive: 0,
    timeSavedProactive2: 0,
    timeLostProactive2: 0
  },
  inferenceStartTimes: new Map(),
  inferenceDurations: new Map(),
  unconsumedSavings: null,
  activeManualGeneration: null,
  metricsInterval: null
};
