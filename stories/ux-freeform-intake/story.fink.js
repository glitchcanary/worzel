oooOO`
# title: Freeform Intake Lab
# speaker:narrator # voice:narrator

This story tests whether a clear freeform prompt works better than open conversation.

What should I call you?
# input:freeform
-> got_name

=== got_name ===
# speaker:narrator # voice:narrator
Thank you. I have your name.

+ Ask what happens next # voice_hint:what happens next, next, continue
    I will hand control back to a simple choice menu.
    -> menu2

=== menu2 ===
# speaker:narrator # voice:narrator
Choose one.

+ North # voice_hint:north, one
    North selected.
    -> END
+ South # voice_hint:south, two
    South selected.
    -> END
`;
