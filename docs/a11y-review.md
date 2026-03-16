# /fink/ Accessibility Review

Date: 2026-03-16

Scope:
- `/home/danbri/working/worzel/worzel/fink/client/index.html`
- `/home/danbri/working/worzel/worzel/fink/client/fink.js`

Method:
- Static review of the current implementation only
- No code changes
- No live assistive technology test run in this review

## Summary

`/fink/` has some solid foundations:
- native `button` and `input` elements are used in key places
- visible focus styling exists for story choices
- choice cards are keyboard-operable once focused
- the product avoids some overtly screen-assuming copy

But the current implementation is not yet robustly accessible. The biggest issues are:
- status, narration, and turn updates are not exposed as reliable screen-reader announcements
- the mic control is pointer-driven in push-to-talk mode and is not equivalently operable from keyboard
- custom elements with shadow DOM are carrying most interaction and state, but without the semantic labeling and live-region support that assistive tech needs
- color contrast is inconsistent and likely fails in multiple secondary-text states
- motion and autoplay-style audio behavior are not paired with reduced-motion or clearer non-audio alternatives

## Findings

### 1. High: Push-to-talk mic interaction is effectively pointer-only

The main mic button starts and stops recording with `pointerdown` / `pointerup` in push-to-talk mode. There is no equivalent keyboard press-and-hold behavior, and Space is already overloaded for skip-ahead and choice activation.

Impact:
- keyboard-only users cannot use the primary interaction model
- switch users and some motor-impaired users are likely blocked
- assistive tech users may be able to toggle hot mic, but not the default push-to-talk path

Current behavior:
- hot mic has a click path
- push-to-talk does not have an equivalent keyboard path

Risk:
- this is a functional blocker, not just a polish issue

### 2. High: Status and story updates are not implemented as live regions

The app updates `.session-note`, `.last-heard`, narration paragraphs, and choice lists visually, but they are plain `div` / `p` content with no `aria-live`, `role="status"`, `role="log"`, or similar announcement strategy.

Impact:
- screen-reader users may miss turn-state changes like `Listening`, `Interpreting`, `Speaking`, `Ready`
- new narration may appear silently from the assistive tech point of view
- “you said” echoes and “next move” hints may not be announced when they change

This matters especially because `/fink/` is designed around rapid conversational turn-taking.

### 3. High: Mic, mode, and speed controls lack accessible names and state exposure

The controls are visually legible, but their programmatic labels and state are weak:
- the mic button has only an SVG icon and no explicit accessible name
- hot-mic mode is indicated by text and styling changes, but not exposed with pressed/selected state semantics
- speed buttons have visible active styling, but no semantic selected-state pattern

Impact:
- screen-reader users may hear vague or unhelpful control names
- users may not know whether hot mic is on
- users may not know which speaking speed is selected

### 4. High: Story transcript structure is visually rich but semantically thin

Narration is appended as generic paragraphs. Speaker labels are added as adjacent paragraphs, not grouped semantically. Choice areas and “next move” hints are visually separate but not given structural roles such as list, feed, log, or region labels.

Impact:
- screen-reader navigation through the story transcript will be noisy and ambiguous
- speaker changes may be hard to interpret
- choice updates may not feel like a coherent menu

### 5. Medium: Keyboard model is incomplete and discoverability is low

There is custom keyboard behavior:
- `Tab` cycles choices
- `Space` skips TTS or activates a focused choice

But there is no visible or announced help for this model, and standard expectations are partly overridden:
- `Tab` is intercepted when choices exist
- push-to-talk does not map to keyboard

Impact:
- keyboard users will have to guess the command model
- users relying on standard browser focus order may be surprised

### 6. Medium: Contrast is likely insufficient in several text states

The palette is attractive, but several combinations are suspect:
- muted text on dark blue backgrounds
- secondary text on translucent dark panels
- small metadata text in hints, status labels, and badges

Examples likely needing measurement:
- `--fink-text-muted: #5a5e73`
- `--fink-text-secondary: #8b8fa3`
- small 0.65rem to 0.82rem UI text on dark backgrounds

Impact:
- low-vision users and users in glare conditions may struggle
- small supporting text is especially at risk

### 7. Medium: Motion is present without reduced-motion handling

Narration paragraphs fade in via animation. Audio state changes also create a strong paced interaction model, but there is no `prefers-reduced-motion` handling in the reviewed files.

Impact:
- some users may prefer a calmer presentation
- the fade-in is not extreme, but it is repeated often in a story interface

### 8. Medium: Audio-dependent feedback is not fully mirrored in text semantics

The app does show visible text statuses, which is good. But because those statuses are not live regions and because some state is conveyed through audio interruption behavior, the non-audio path is incomplete.

Impact:
- deaf or hard-of-hearing users may not receive equivalent, timely turn-state feedback
- blind users not using audio output continuously may miss state transitions

### 9. Medium: Images are always inserted with empty `alt`

Story images are added with `alt=""` unconditionally.

Impact:
- if an image is decorative, empty alt is correct
- if an image conveys narrative content, that content is lost to non-visual users

The implementation currently assumes all images are decorative.

### 10. Low: Connect flow and page landmarks are minimal

The page has a header, connect bar, main area, and footer visually, but not as explicit semantic landmarks in the custom-element output.

Impact:
- screen-reader users lose some quick navigation affordances
- this is less severe than the live-region and control-label issues

## Positive Notes

- Choice cards are real `button` elements.
- Visible focus styling exists for choices.
- The app uses readable prose layouts instead of densely compressed controls.
- Status text is already present in the UI, which makes later semantic improvements straightforward.
- Modality-assuming copy has been reduced compared with earlier wording.

## Likely User Impact By Mode

### Screen-reader users

Current experience is likely poor:
- controls are under-labeled
- dynamic updates are not reliably announced
- transcript structure is hard to navigate

### Keyboard-only users

Current experience is mixed to poor:
- connect and some buttons are reachable
- choice selection is partly supported
- core push-to-talk behavior is not equivalently available

### Low-vision users

Current experience is mixed:
- layout is spacious
- text hierarchy is decent
- contrast of secondary and muted text is likely not strong enough

### Voice-only / hands-free users

Current experience is conceptually supported, but fragile:
- wording is improving
- status feedback exists
- junk-turns, accidental interruptions, and lack of robust nonvisual semantics still create friction

## Priority Recommendations

### Immediate

1. Make the mic interaction fully keyboard-operable.
2. Add proper live-region behavior for:
   - session status
   - narration updates
   - choice updates
   - “heard you say” / ignored-input feedback
3. Give mic, mode, and speed controls explicit accessible names and state semantics.

### Next

4. Rework the transcript and choice area into clearer semantic regions.
5. Audit and raise color contrast for small and secondary text.
6. Add reduced-motion handling for repeated narration animations.

### After that

7. Decide whether story images are decorative or meaningful, and expose alt text accordingly.
8. Add concise, discoverable keyboard help.
9. Test with:
   - VoiceOver on macOS
   - NVDA or JAWS on Windows
   - keyboard-only navigation
   - zoom at 200%

## Overall Assessment

Current rating: needs substantial accessibility work before it should be considered robustly accessible.

The good news is that the main problems are understandable and concentrated in a few areas:
- interaction semantics
- live updates
- keyboard parity
- contrast

The current UI is evocative and increasingly modality-neutral in wording, but its accessibility semantics have not yet caught up with its interaction ambition.
