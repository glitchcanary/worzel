# title: The Enchanted Garden
# author: Worzel Test Suite
# speaker:narrator
# voice:alloy

VAR lantern_lit = false
VAR player_name = "stranger"
VAR courage = 0

-> start

=== start ===
# speaker:narrator # voice:alloy
You stand before an old iron gate, half-hidden by ivy. Beyond it, a garden stretches into the twilight.
~ courage = courage + 1

+ Push open the gate # voice_hint:open gate, push gate, go through, enter garden
    You set your hand against the cold iron and push. The gate swings open with a groan.
    -> garden

+ Call out # voice_hint:hello, call out, shout, anyone there
    "Hello?" you call into the dusk. Only the wind answers.
    -> garden

+ Turn back # voice_hint:leave, go back, turn around, go home
    You turn away. Some gardens are not meant to be entered.
    -> ending_leave

=== garden ===
# speaker:narrator
{ lantern_lit:
    The garden is bathed in warm amber light from your lantern.
- else:
    The garden is dark. Shapes move at the edges of your vision.
}
A stone path winds between overgrown flower beds.

+ { not lantern_lit } Light the lantern # voice_hint:light, lantern, lamp, light it up
    # speaker:narrator # mood:calm
    ~ lantern_lit = true
    You find an old lantern hanging from a post. A match from your pocket brings it to life.
    -> garden

+ Follow the path deeper # voice_hint:go deeper, follow path, walk, continue, explore
    ~ courage = courage + 1
    -> deep_garden

+ Examine the flowers # voice_hint:flowers, look at flowers, examine, inspect
    # speaker:narrator # mood:mysterious
    The flowers glow faintly in the dark. They are not any species you recognise.
    -> garden

=== deep_garden ===
# speaker:narrator
You reach a stone bench beneath an ancient oak. A cat sits on the bench, watching you with luminous green eyes.
# speaker:cat # voice:shimmer # foaf:name:Mr Whiskers # foaf:knows:narrator
"Mrow," says the cat, tilting its head.

+ Hello, cat # voice_hint:hello cat, hi, greet, talk to cat
    -> talk_to_cat

+ Sit quietly on the bench # voice_hint:sit, sit down, bench, rest, wait
    -> sit_quietly

+ Go back to the entrance # voice_hint:go back, return, entrance, leave
    -> garden

=== talk_to_cat ===
# speaker:cat # voice:shimmer # mood:curious
{
    - courage >= 2:
        The cat blinks slowly. "You have some nerve, coming this deep," it says. "I like that."
    - else:
        The cat yawns. "Come back when you've seen more of the garden."
        -> garden
}

+ Ask the cat its name # voice_hint:name, what is your name, who are you
    # speaker:cat # voice:shimmer
    "They call me Mr Whiskers," the cat says with dignity. "And you?"
    -> ask_player_name

+ Ask about the garden # voice_hint:garden, tell me about, what is this place
    # speaker:cat # voice:shimmer # mood:mysterious
    "This garden remembers things," says the cat. "Things the world outside has forgotten."
    -> ending_secret

=== ask_player_name ===
# speaker:narrator
The cat looks at you expectantly.
-> ending_friendship

=== sit_quietly ===
# speaker:narrator # mood:peaceful
You sit. The cat regards you for a long moment, then descends from the bench and curls up beside you. The garden hums softly in the dark.
-> ending_peaceful

=== ending_leave ===
# speaker:narrator # mood:melancholy
The gate disappears behind you. By morning, you will have forgotten it was ever there.
-> END

=== ending_peaceful ===
# speaker:narrator # mood:peaceful
You sit together in the garden as the stars come out, one by one.
-> END

=== ending_friendship ===
# speaker:cat # voice:shimmer # mood:warm
The cat purrs. "Well then, {player_name}. Welcome to the garden. You may stay as long as you like."
# speaker:narrator
And so begins a most unusual friendship.
-> END

=== ending_secret ===
# speaker:narrator # mood:mysterious
The cat leads you to a hidden corner of the garden where the flowers burn like tiny stars.
# speaker:cat # voice:shimmer
"Few are shown this," the cat whispers. "Remember it."
-> END
