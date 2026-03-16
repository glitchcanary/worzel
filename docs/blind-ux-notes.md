# Blind UX Notes For Interactive Speech Apps

Date: 2026-03-16

Scope:
- General best practices for interactive speech apps
- Especially relevant to `/fink/` and other voice-driven story interfaces

## Core Principle

Blind users are often already using their ears to navigate the browser, the OS, and the page through a screen reader such as VoiceOver, NVDA, or JAWS.

An interactive speech app should therefore act like a respectful participant in a shared audio space, not like the only speaker in the room.

## Main Rule

Do not compete with the screen reader for the user’s ears.

That means:
- speech must be interruptible immediately
- system chatter should be minimal
- important state must also exist as semantic text
- prompts should be short and structured

## Best Practices

### 1. Distinguish content speech from system speech

Treat these as separate channels conceptually:
- content speech: story, dialogue, narration, choices
- system speech: listening, errors, reconnecting, thinking, mode changes

Guidance:
- keep system speech short
- let users reduce or mute system speech
- prefer earcons or semantic text for routine system state where possible

### 2. Keep prompts brief

Long spoken prompts are expensive when the user is already listening carefully to a screen reader.

Prefer:
- one move at a time
- concise choice summaries
- “say help for choices again”

Avoid:
- repeated long menus
- verbose confirmations
- narrating UI mechanics unless asked

### 3. Make turn-taking unmistakable

The user should always know:
- are you listening?
- are you thinking?
- are you speaking?
- is it my turn?

This can be expressed through:
- concise speech
- non-speech cues
- live regions and state semantics

Ambiguous turn boundaries are one of the fastest ways to make a voice app exhausting.

### 4. Make interruption instant and reliable

If your app is speaking over a screen reader, the user needs a dependable way to stop it.

Requirements:
- speech stops quickly
- interruption behavior is consistent
- interrupting does not corrupt the conversation state

### 5. Provide a tiny command vocabulary

Blind users often benefit from a small, memorable set of global commands.

Recommended examples:
- `help`
- `repeat`
- `stop`
- `pause`
- `choices`
- `back`
- `faster`
- `slower`

These commands should be more reliable than ordinary freeform speech.

### 6. Prefer progressive disclosure

Say the minimum needed first.

Then offer expansion:
- “There are three options.”
- “Say choices to hear them again.”
- “Say more if you want the full briefing.”

This reduces listening load and supports both expert and first-time users.

### 7. Avoid screen-assuming language

Do not say:
- “the options are on screen”
- “tap here”
- “look above”

Prefer:
- “you can say help for the choices again”
- “choose a move”
- “your next move is open”

### 8. Make non-audio access real, not symbolic

Even in a speech-first app, all important state should be exposed in accessible text semantics.

That means:
- labels for controls
- live regions for state changes
- structured transcript content
- clear focus behavior
- keyboard parity

Speech alone is not enough, especially when the user is already listening to a screen reader.

### 9. Do not require press-and-hold as the only path

Press-and-hold microphone interaction is often awkward or inaccessible.

Always provide alternatives:
- toggle mode
- explicit keyboard shortcut
- hot mic mode with clear boundaries

### 10. Use earcons carefully

Short sounds can reduce verbal clutter if they are:
- distinct
- consistent
- optional
- learnable

Good candidates:
- listening started
- turn ended
- error
- no-input

But earcons should support comprehension, not replace it.

### 11. Let users control verbosity

Different users want different levels of spoken detail.

Useful modes:
- brief
- normal
- rich narration

This is especially important in fiction, where one user may want atmosphere and another may want fast progress.

### 12. Respect shared-audio timing

If the app speaks and then immediately reopens the mic, it may capture:
- its own audio
- the screen reader
- the user’s attempt to interrupt

Leave deliberate gaps where needed, and model recent audio conditions when possible.

## Anti-Patterns

Avoid:
- long “helpful” speeches after every failed input
- repeating all choices after every no-match
- verbose confirmations for routine actions
- requiring users to remember hidden key combinations
- making the spoken output the only source of truth
- talking over assistive tech without easy interruption

## What Good Feels Like

A well-designed speech app for blind users feels:
- calm
- interruptible
- predictable
- low-friction
- respectful of attention

The user should not feel trapped in your audio. They should feel in control of it.

## Implications For `/fink/`

For `/fink/`, the highest-value design goals are:
- reliable `help` and `repeat`
- minimal system speech
- strong text semantics behind dynamic updates
- very clear turn boundaries
- fast interruption
- no wording that assumes sight or touch
- reduced junk-turn handling so the app does not keep talking back to noise

## Practical Heuristic

When designing a spoken interaction, ask:

If a blind user is already listening to a screen reader, is this utterance necessary, short, and clearly timed?

If not, it should probably be:
- shorter
- optional
- converted into an earcon
- or exposed as semantic text instead of speech
