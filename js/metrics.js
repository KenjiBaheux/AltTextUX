import { state } from './state.js';
import { DOM } from './dom.js';

export function startMetricsLoop() {
  if (!state.metricsInterval) {
    state.metricsInterval = setInterval(() => {
      const isGenerating = (state.unconsumedSavings && !state.unconsumedSavings.duration) || state.activeManualGeneration;
      const isPanelOpen = DOM.btsPanel && DOM.btsPanel.classList.contains('show');
      
      if (isGenerating && isPanelOpen) {
        updateMetricsUI();
      }
    }, 500);
  }
}

export function updateMetricsUI() {
  let pwLabel = state.settings.enablePrewarming ? "Time saved:" : "Time lost:";
  let pwRaw = state.settings.enablePrewarming ? state.metrics.timeSavedPrewarm : state.metrics.timeLostPrewarm;
  let pwLost = !state.settings.enablePrewarming;
  
  let proLabel = state.settings.enableProactive ? "Time saved:" : "Time lost:";
  let proRaw = state.settings.enableProactive ? state.metrics.timeSavedProactive : state.metrics.timeLostProactive;
  let proLost = !state.settings.enableProactive;

  let pro2Label = state.settings.enableProactive2 ? "Time saved:" : "Time lost:";
  let pro2Raw = state.settings.enableProactive2 ? state.metrics.timeSavedProactive2 : state.metrics.timeLostProactive2;
  let pro2Lost = !state.settings.enableProactive2;

  if (state.unconsumedSavings) {
    const expected = state.unconsumedSavings.duration || (performance.now() - state.unconsumedSavings.startTime);
    if (state.unconsumedSavings.type === 'prewarm' && !pwLost) {
      pwLabel = "Expected time saved:";
      pwRaw = state.metrics.timeSavedPrewarm + expected;
    } else if (state.unconsumedSavings.type === 'proactive' && !proLost) {
      proLabel = "Expected time saved:";
      proRaw = state.metrics.timeSavedProactive + expected;
    } else if (state.unconsumedSavings.type === 'proactive2' && !pro2Lost) {
      pro2Label = "Expected time saved:";
      pro2Raw = state.metrics.timeSavedProactive2 + expected;
    }
  }

  if (state.activeManualGeneration) {
    const expected = performance.now() - state.activeManualGeneration.startTime;
    if (state.activeManualGeneration.type === 'prewarm' && pwLost) {
      pwLabel = "Expected time lost:";
      pwRaw = state.metrics.timeLostPrewarm + expected;
    } else if (state.activeManualGeneration.type === 'proactive' && proLost) {
      proLabel = "Expected time lost:";
      proRaw = state.metrics.timeLostProactive + expected;
    } else if (state.activeManualGeneration.type === 'proactive2' && pro2Lost) {
      pro2Label = "Expected time lost:";
      pro2Raw = state.metrics.timeLostProactive2 + expected;
    }
  }

  let pwVal = Math.round(pwRaw);
  let proVal = Math.round(proRaw);
  let pro2Val = Math.round(pro2Raw);

  const formatVal = (v) => v > 0 ? v : "-";

  if (DOM.metricLabelPrewarm) {
    DOM.metricLabelPrewarm.textContent = pwLabel;
    if (pwLost) DOM.metricLabelPrewarm.classList.add('metric-lost');
    else DOM.metricLabelPrewarm.classList.remove('metric-lost');
  }
  if (DOM.metricPrewarm) {
    DOM.metricPrewarm.textContent = formatVal(pwVal);
    if (pwLost) DOM.metricPrewarm.classList.add('metric-lost');
    else DOM.metricPrewarm.classList.remove('metric-lost');
  }

  if (DOM.metricLabelProactive) {
    DOM.metricLabelProactive.textContent = proLabel;
    if (proLost) DOM.metricLabelProactive.classList.add('metric-lost');
    else DOM.metricLabelProactive.classList.remove('metric-lost');
  }
  if (DOM.metricProactive) {
    DOM.metricProactive.textContent = formatVal(proVal);
    if (proLost) DOM.metricProactive.classList.add('metric-lost');
    else DOM.metricProactive.classList.remove('metric-lost');
  }

  if (DOM.metricLabelProactive2) {
    DOM.metricLabelProactive2.textContent = pro2Label;
    if (pro2Lost) DOM.metricLabelProactive2.classList.add('metric-lost');
    else DOM.metricLabelProactive2.classList.remove('metric-lost');
  }
  if (DOM.metricProactive2) {
    DOM.metricProactive2.textContent = formatVal(pro2Val);
    if (pro2Lost) DOM.metricProactive2.classList.add('metric-lost');
    else DOM.metricProactive2.classList.remove('metric-lost');
  }
}

export function recordInferenceStart(type) {
  state.inferenceStartTimes.set(type, performance.now());
  state.unconsumedSavings = { type, startTime: state.inferenceStartTimes.get(type), duration: null };
  startMetricsLoop();
}

export function recordInferenceDuration(type, duration) {
  state.inferenceDurations.set(type, duration);
  if (state.unconsumedSavings && state.unconsumedSavings.type === type) {
    state.unconsumedSavings.duration = duration;
  }
  updateMetricsUI();
}

export function consumeSavings() {
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
}

export function clearUnconsumedSavings() {
  if (state.unconsumedSavings) {
    state.unconsumedSavings = null;
    updateMetricsUI();
  }
}

export function recordLossStart(type) {
  state.activeManualGeneration = { type, startTime: performance.now() };
  startMetricsLoop();
}

export function recordLossEnd() {
  if (state.activeManualGeneration) {
    const duration = performance.now() - state.activeManualGeneration.startTime;
    const type = state.activeManualGeneration.type;
    if (type === 'prewarm') state.metrics.timeLostPrewarm += duration;
    else if (type === 'proactive') state.metrics.timeLostProactive += duration;
    else if (type === 'proactive2') state.metrics.timeLostProactive2 += duration;
    
    state.activeManualGeneration = null;
    updateMetricsUI();
  }
}
