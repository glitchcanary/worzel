oooOO`
# title: Confirmation Loop Lab
# speaker:narrator # voice:narrator

This story tests explicit confirmation before action.

You are about to pull a large red lever.

+ Pull it # voice_hint:pull it, pull lever, yes
    -> confirm_pull
+ Walk away # voice_hint:walk away, leave, no
    You leave it alone.
    -> END

=== confirm_pull ===
# speaker:narrator # voice:narrator
I heard: pull the lever. Confirm?

+ Confirm # voice_hint:confirm, yes, do it
    The lever crashes downward. Bells ring somewhere underground.
    -> END
+ Cancel # voice_hint:cancel, no, stop
    You step back from the lever.
    -> END
`
