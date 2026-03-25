import { DOM } from './dom.js';
import { notifyBTS } from './bts.js';
import { state } from './state.js';

export async function ensureImageLoaded(imageSource) {
  if (imageSource instanceof HTMLImageElement) {
    if (!imageSource.complete) {
      await new Promise((resolve, reject) => {
        imageSource.addEventListener('load', resolve, { once: true });
        imageSource.addEventListener('error', reject, { once: true });
      });
    }
    if (imageSource.naturalWidth === 0) {
      throw new Error("Image source is not usable (naturalWidth is 0)");
    }
  }
  return true;
}

export async function typeWriterEffect(text, signal = null) {
  if (!state.settings.enableTransitions) {
    DOM.altTextInput.value = text;
    return;
  }

  state.isAnimating = true;
  DOM.altTextInput.value = '';

  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Configuration for "Super-Human" feel
  const BASE_SPEED = 15;     // Base ms per char
  const VARIANCE = 25;       // Random jitter
  const WORD_PAUSE = 60;    // Pause after a space
  const TYPO_CHANCE = 0.01;  // Cance to make a typo
  const BACKSPACE_PAUSE = 80; // Pause after a backspace
  const OOPS_PAUSE = 40; // Pause after a typo
  const BURST_FACTOR = 0.5; // Factor to reduce delay for the middle of words

  let i = 0;
  while (i < text.length) {
    if (signal && signal.aborted) {
      break;
    }
    const char = text.charAt(i);
    const isSpace = char === ' ';

    // 1. Probabilistic Typo Logic
    if (!isSpace && Math.random() < TYPO_CHANCE) {
      const adjacentKeys = "qwertyuiopasdfghjklzxcvbnm";
      const randomChar = adjacentKeys[Math.floor(Math.random() * adjacentKeys.length)];

      DOM.altTextInput.value += randomChar;
      await sleep(BASE_SPEED + OOPS_PAUSE); // Small "oops" pause

      // Delete the typo
      DOM.altTextInput.value = DOM.altTextInput.value.slice(0, -1);
      await sleep(BACKSPACE_PAUSE); // Backspace pause
      // Continue to type the correct character below
    }

    // 2. Type the actual character
    DOM.altTextInput.value += char;

    // 3. Calculate Delay (The Rhythm)
    let delay = BASE_SPEED + Math.random() * VARIANCE;

    if (isSpace) {
      delay += WORD_PAUSE; // The "slug" between words
    } else {
      // "Burst" effect: faster typing for the middle of words
      // Slower for the start of a word as the "typist" finds the key
      const nextChar = text.charAt(i + 1);
      if (nextChar && nextChar !== ' ') {
        delay = (BASE_SPEED + (Math.random() * (VARIANCE / 2))) * BURST_FACTOR;
      }
    }

    await sleep(delay);
    i++;
  }

  state.isAnimating = false;
}

export async function rewriteTextEffect(element, newText, fast = false, signal = null) {
  if (!state.settings.enableTransitions) {
    element.value = newText;
    notifyBTS('morph');
    return;
  }
  
  state.isAnimating = true;
  
  const originalText = element.value;
  const originalWords = originalText.split(' ');
  const newWords = newText.split(' ');
  const maxLength = Math.max(originalWords.length, newWords.length);

  element.value = '';

  for (let i = 0; i < maxLength; i++) {
    if (signal && signal.aborted) {
      break;
    }
    // Determine the current state of the text
    let currentText = [];

    // Keep words up to "i" from the new text
    if (i < newWords.length) {
      currentText.push(...newWords.slice(0, i));
    } else {
      currentText.push(...newWords);
    }

    // Add a scramble/shimmer effect character at the transition point if we are still typing new words
    if (i < newWords.length) {
      const chars = "!<>-_\\\\/[]{}—=+*^?#________";
      currentText.push(chars[Math.floor(Math.random() * chars.length)]);
    }

    // Keep the rest of the old words
    if (i + 1 < originalWords.length) {
      currentText.push(...originalWords.slice(i + 1));
    }

    element.value = currentText.join(' ');

    // We want the rewrite to be relatively fast
    if (fast) {
      await new Promise(r => setTimeout(r, 15 + Math.random() * 20));
    } else {
      await new Promise(r => setTimeout(r, 50 + Math.random() * 50));
    }
  }

  notifyBTS('morph');
  // Final confirmation step
  element.value = newText;
  
  state.isAnimating = false;
}
export const LOADING_MESSAGES = [
  "Squinting at the pixels...",
  "Don’t let me slow you down, get that draft going!",
  "Lost a good version? Your history is right there; go back anytime.",
  "You handle the plot, I’ll handle the scenery.",
  "Translating pixels into helpful prose...",
  "Running locally! No quotas, no credits, no limits.",
  "Sifting through my internal dictionary...",
  "Want more detail? You can steer me with a quick edit.",
  "Looking for the perfect nouns...",
  "Zero credits used. Try a million variants; No one will mind.",
  "Spinning a visual yarn for you...",
  "Just putting on the finishing touches...",
];

export class LoadingMessageManager {
  constructor(element) {
    this.element = element;
    this.timer = null;
    this.messageIndex = 0;
    this.isActive = false;
  }

  start() {
    this.isActive = true;
    this.messageIndex = 0;
    
    // Clear initial input
    this.element.value = '';
    
    // Add dimming and shimmer
    this.element.classList.add('text-dimming');
    this.element.classList.add('text-shimmer');
    DOM.imagePreviewWrapper?.classList.add('image-scanning');
    
    // Delay first message by 600ms to avoid flashes on fast generation
    this.timer = setTimeout(() => {
      this.cycleMessages();
    }, 600);
  }

  cycleMessages() {
    if (!this.isActive) return;
    
    this.element.value = LOADING_MESSAGES[this.messageIndex];
    this.messageIndex = (this.messageIndex + 1) % LOADING_MESSAGES.length;
    
    // Switch messages every 2.5 seconds
    this.timer = setTimeout(() => {
      this.cycleMessages();
    }, 2500);
  }

  stop() {
    this.isActive = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    
    this.element.classList.remove('text-dimming');
    this.element.classList.remove('text-shimmer');
    DOM.imagePreviewWrapper?.classList.remove('image-scanning');
    
    // Only clear if the current value is still a loading message
    // (don't clear if it's already been set to the result)
    if (LOADING_MESSAGES.includes(this.element.value)) {
        this.element.value = '';
    }
  }
}
