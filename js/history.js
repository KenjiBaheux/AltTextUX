import { DOM } from './dom.js';
import { rewriteTextEffect } from './utils.js';
import { notifyBTS, setBTSState } from './bts.js';
import { updateGenerateButtonUI } from './ui.js';
import { state } from './state.js';

export class AltTextHistory {
  constructor(maxSize = 25) {
    this.stack = [];
    this.currentIndex = -1;
    this.maxSize = maxSize;
  }

  push(text, isAI = false, force = false) {
    const trimmed = text.trim();

    // Avoid duplicate pushes for the exact same text at the current position
    // BUT we allow slot 0 to be blank, so do not prevent pushing exactly what is there if forcefully requested, but wait, if it's identical we don't need a push.
    if (!force && this.currentIndex >= 0 && this.stack[this.currentIndex] && this.stack[this.currentIndex].text === trimmed) {
      if (isAI) this.stack[this.currentIndex].isAI = isAI;
      return;
    }

    // Preserve the future: insert the new entry immediately after the current index
    this.currentIndex++;
    this.stack.splice(this.currentIndex, 0, { text: trimmed, isAI });
    
    while (this.stack.length > this.maxSize) {
      if (this.stack.length > 1) {
        this.stack.splice(1, 1);
        this.currentIndex--;
      } else {
        break;
      }
    }
    
    console.log(`History: Pushed version ${this.stack.length}. Current index: ${this.currentIndex}`);
    this.updateUI();
  }

  pushAIResult(aiText, userHint) {
    const aiTrimmed = aiText.trim();
    const hintTrimmed = userHint ? userHint.trim() : "";

    // If there's a user hint, ensure the current index captures the user's hint before we push the AI result
    if (hintTrimmed) {
        if (this.currentIndex >= 0 && this.stack[this.currentIndex].text !== hintTrimmed) {
             // We need to push the user's hint first
             this.push(hintTrimmed, false, false);
        } else if (this.currentIndex >= 0 && this.stack[this.currentIndex].text === hintTrimmed) {
             // Make sure we mark it as user input, not AI, if they typed it
             this.stack[this.currentIndex].isAI = false;
        }
    }

    // Now push the AI result as a NEW entry
    // Preserve future, insert immediately after current position
    this.currentIndex++;
    this.stack.splice(this.currentIndex, 0, { text: aiTrimmed, isAI: true });
    
    // Ensure we don't exceed max size, but preserve the 0th empty entry
    while (this.stack.length > this.maxSize) {
      if (this.stack.length > 1) {
        // Remove the oldest entry that is not the 0th entry
        this.stack.splice(1, 1);
        this.currentIndex--;
      } else {
        break; // Should never happen unless maxSize is < 2
      }
    }
    
    console.log(`History: pushAIResult inserted version ${this.stack.length}. Current index: ${this.currentIndex}`);
    this.updateUI();
  }

  updateCurrent(text, isAI = false) {
    if (this.currentIndex < 0) return;
    
    const trimmed = text.trim();
    if (this.stack[this.currentIndex].text === trimmed) {
      this.stack[this.currentIndex].isAI = isAI;
      return;
    }

    this.stack[this.currentIndex] = { text: trimmed, isAI };
    this.updateUI();
  }

  prev() {
    if (state.isAnimating) return false;
    
    if (this.currentIndex > 0) {
      const goingFrom = this.currentIndex;
      this.currentIndex--;
      this._purgeIfEmptyUser(goingFrom);
      this.applyCurrent();
      return true;
    }
    return false;
  }

  next() {
    if (state.isAnimating) return false;
    
    if (this.currentIndex < this.stack.length - 1) {
      const goingFrom = this.currentIndex;
      this.currentIndex++;
      this._purgeIfEmptyUser(goingFrom);
      this.applyCurrent();
      return true;
    }
    return false;
  }

  _purgeIfEmptyUser(index) {
    // Rule 4: If the user deletes everything in an entry and moves to another entry, cull this empty entry.
    // The 0th entry is allowed to be empty.
    if (index > 0 && index < this.stack.length) {
      const node = this.stack[index];
      if (node && !node.isAI && node.text === "") {
        this.stack.splice(index, 1);
        if (this.currentIndex >= index) {
          this.currentIndex--;
        }
      }
    }
  }

  applyCurrent() {
    if (this.currentIndex < 0 || !this.stack[this.currentIndex]) return;
    const text = this.stack[this.currentIndex].text;
    this.updateUI();

    // Notify UI to update the generate button right away
    if (typeof updateGenerateButtonUI === 'function') {
      updateGenerateButtonUI(text);
    }

    // Use the fast morph effect for history navigation
    if (DOM.altTextInput.value !== text) {
      rewriteTextEffect(DOM.altTextInput, text, true);
    }
  }

  clear() {
    this.stack = [];
    this.currentIndex = -1;
    this.updateUI();
  }

  updateUI() {
    const stepper = DOM.historyStepper;
    const indexLabel = DOM.historyIndex;
    const prevBtn = DOM.historyPrev;
    const nextBtn = DOM.historyNext;

    if (!stepper || !indexLabel || !prevBtn || !nextBtn) return;

    if (this.stack.length > 1) {
      const wasHidden = stepper.classList.contains('hidden');
      stepper.classList.remove('hidden');
      indexLabel.textContent = `${this.currentIndex + 1}/${this.stack.length}`;
      prevBtn.disabled = this.currentIndex <= 0 || state.isGenerating;
      nextBtn.disabled = this.currentIndex >= this.stack.length - 1 || state.isGenerating;

      // When the stepper first appears, vocalize it to the BTS panel
      if (wasHidden && typeof notifyBTS === 'function') {
        notifyBTS('versioning', 'pulse');
      }
    } else {
      stepper.classList.add('hidden');
    }

    // Refresh BTS state to ensure the correct card is active
    if (typeof setBTSState === 'function') {
      const currentState = DOM.btsPanel?.dataset?.state || 'welcome';
      setBTSState(currentState);
    }
  }
}

export const history = new AltTextHistory();
