# Looms Journey Card Swiping Design Document

## Overview
Enable smooth left/right touch and pointer swiping for cards in "The Complete Looms Journey" section (`#process`) across mobile phones, tablets, and touch-screen laptops.

## Goals
1. Allow users on touch devices (iOS/Android mobile & tablet) and touch-screen laptops (Windows Touch/Pointer events) to swipe left/right to navigate between the 7 process cards/panes.
2. Auto-scroll the top stepper tab bar (`#stepper-nav-bar`) smoothly so the active stage button remains centered/visible in the tab bar.
3. Preserve vertical page scrolling by enforcing directional delta checks (`|diffX| > |diffY|` and `|diffX| > 40px`).
4. Ensure video playback for active step auto-starts seamlessly when swiped into view.

## Architecture & Implementation Details

### File Modifications
- **[js/main.js](file:///c:/Users/Admin/Desktop/Websi/website/js/main.js)**:
  - Upgrade `initProcessStepper()` to maintain a `currentStep` index state.
  - Implement a `goToStep(index)` helper function that updates tab styles, activates the correct process pane, plays active videos, and auto-scrolls the active tab into view in `#stepper-nav-bar`.
  - Add unified `touchstart`/`touchend` and `pointerdown`/`pointerup` event listeners on the `#process` section / `.process-pane` container.
  - Evaluate horizontal swipe gesture (`diffX > 40px` and `|diffX| > |diffY|`) to trigger `goToStep(currentStep + 1)` (Swipe Left) or `goToStep(currentStep - 1)` (Swipe Right).

- **[css/style.css](file:///c:/Users/Admin/Desktop/Websi/website/css/style.css)**:
  - Add `touch-action: pan-y;` on `.process-pane` to ensure native vertical page scrolling remains fluid while capturing horizontal swipe gestures cleanly on mobile and touch devices.

## Verification Plan
1. **Desktop & Mobile Emulation Verification**: Test card tab clicking and swipe simulation using touch event emulation in browser DevTools across desktop, tablet, and mobile device viewports.
2. **Gesture Precision**: Verify swiping left advances from Step 01 to Step 07 and swiping right goes back.
3. **Tab Bar Sync**: Verify the horizontal tab bar (`#stepper-nav-bar`) automatically scrolls to reveal the active tab when swiped.
4. **Video Playback**: Verify video playback in stages 02 and 04 starts automatically upon swiping to those cards.
