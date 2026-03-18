oooOO`
# title: The Enchanted Garden
# author: Worzel Test Suite
# speaker:narrator
# voice:alloy

VAR lantern_lit = false
VAR player_name = "stranger"
VAR courage = 0

-> menu

=== menu ===
# speaker:narrator # voice:alloy
Welcome to The Enchanted Garden. A short interactive story you can navigate by voice, or by tapping choices.

+ Begin the story # voice_hint:start, begin, play, go, let's go, yes
    -> start

+ About this demo # voice_hint:about, what is this, tell me more, info
    # speaker:narrator
    This is Fink, a voice-navigated interactive fiction demo. Speak naturally to pick choices, ask about the world, or just chat with characters. Your words are matched to story choices using AI.
    -> menu

=== start ===
# speaker:narrator # voice:alloy
You stand before an iron gate, half-hidden by ivy. Beyond it, a garden stretches into twilight.
~ courage = courage + 1

+ Push open the gate # voice_hint:open gate, push gate, go through, enter garden
    The gate swings open with a groan.
    -> garden

+ Call out # voice_hint:hello, call out, shout, anyone there
    "Hello?" you call. Only the wind answers.
    -> garden

+ Turn back # voice_hint:leave, go back, turn around, go home
    You turn away. Some gardens are not meant to be entered.
    -> ending_leave

=== garden ===
# speaker:narrator
{ lantern_lit:
    Warm amber light from your lantern reveals the path ahead.
- else:
    The garden is dark. Shapes move at the edges of your vision.
}

+ { not lantern_lit } Light the lantern # voice_hint:light, lantern, lamp, light it up
    # speaker:narrator # mood:calm
    ~ lantern_lit = true
    You find an old lantern on a post and strike a match.
    -> garden

+ Go deeper # voice_hint:go deeper, follow path, walk, continue, explore
    ~ courage = courage + 1
    -> deep_garden

+ Examine the flowers # voice_hint:flowers, look at flowers, examine, inspect
    # speaker:narrator # mood:mysterious
    The flowers glow faintly. They are no species you recognise.
    -> garden

=== deep_garden ===
# speaker:narrator
A stone bench beneath an ancient oak. A cat sits watching you with luminous green eyes.
# speaker:cat # voice:shimmer # foaf:name:Mr Whiskers # foaf:knows:narrator
"Mrow," says the cat.

+ Hello, cat # voice_hint:hello cat, hi, greet, talk to cat
    -> talk_to_cat

+ Sit on the bench # voice_hint:sit, sit down, bench, rest, wait
    -> sit_quietly

+ Go back # voice_hint:go back, return, entrance, leave
    -> garden

=== talk_to_cat ===
# speaker:cat # voice:shimmer # mood:curious
{
    - courage >= 2:
        "You have some nerve, coming this deep," it says. "I like that."
    - else:
        The cat yawns. "Come back when you've seen more of the garden."
        -> garden
}

+ Ask its name # voice_hint:name, what is your name, who are you
    # speaker:cat # voice:shimmer
    "They call me Mr Whiskers," the cat says. "And you?"
    -> ending_friendship

+ Ask about the garden # voice_hint:garden, tell me about, what is this place
    # speaker:cat # voice:shimmer # mood:mysterious
    "This garden remembers things the world outside has forgotten."
    -> ending_secret

=== sit_quietly ===
# speaker:narrator # mood:peaceful
You sit. The cat descends and curls up beside you. The garden hums softly.
-> ending_peaceful

=== ending_leave ===
# speaker:narrator # mood:melancholy
The gate disappears behind you. By morning, you will have forgotten it was there.
-> farewell

=== ending_peaceful ===
# speaker:narrator # mood:peaceful
You sit together as the stars come out, one by one.
-> farewell

=== ending_friendship ===
# speaker:cat # voice:shimmer # mood:warm
The cat purrs. "Well then, {player_name}. Welcome to the garden."
# speaker:narrator
And so begins a most unusual friendship.
-> farewell

=== ending_secret ===
# speaker:narrator # mood:mysterious
The cat leads you to a hidden corner where the flowers burn like tiny stars.
# speaker:cat # voice:shimmer
"Few are shown this," it whispers. "Remember it."
-> farewell

=== farewell ===
# speaker:narrator # voice:alloy
That's the end of this path through the garden. Thank you for playing.

+ Play again # voice_hint:again, restart, start over, play again, yes
    ~ lantern_lit = false
    ~ courage = 0
    -> menu

+ Goodbye # voice_hint:goodbye, bye, quit, stop, no
    # speaker:narrator
    Until next time.
    -> END
`;
