# UX & Design Decisions

## AI History Deduplication
- **Feedback over Friction:** Instead of silently ignoring duplicate generations, we proactively snap the user to the existing identical entry in history.
- **Visual Delight:** To communicate that the AI generated a previously seen result, we use a distinct sequence of animations:
  - **Double-Take Icon:** The active AI icon (sparkle or enhance) spins rapidly and clinks, indicating "I've seen this before."
  - **Text Wave:** The text input area performs a subtle wave to draw attention to the restored content.
  - **History Pulse:** The history stepper index pulses to emphasize that we've navigated to a past state.
  - **Witty Bubble:** A playful tooltip (e.g., "Cache hit!", "Deja vu?") pops out of the AI icon at a -35 degree angle, adding personality to the deduplication event.

## Animation & UI State
- **Interaction Blocking During Text Animation:** To prevent jarring state corruption or race conditions, history navigation (stepper UI and arrow keys) is explicitly disabled while the typewriter or word-morph animations are actively writing text to the screen. 
- **Graceful Loading:** Loading arrays are rotated to keep the waiting experience engaging without feeling repetitive (e.g., "Squinting at the pixels...").

## System Prewarming & Proactivity
- **Shift to Page Load:** Prewarming the AI model with the sample image was moved from "hover on the sample image button" to "immediately on page load (if AI is available)". This maximizes parallelization and reduces the perceived time to first active generation.
- **Smart Fallback:** If a user navigates away or accidentally clears text, the system caches and can smartly restore content rather than forcing an expensive re-run.

## Empathy & Time Tracking
- **Time Lost vs. Time Saved:** We track system response times strictly to show users the tangible value of proactive AI (time saved) and prewarming. If these features are toggled off by the user, we invert the metric to show "Time Lost," emphasizing the cost of disabling optimizations.
