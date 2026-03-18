oooOO`
# title: Brief Prompts Lab
# speaker:narrator # voice:narrator

Welcome. This story tests very short prompts and very short replies.

+ Start # voice_hint:start, begin, go
    -> scene

=== scene ===
# speaker:narrator # voice:narrator
Door.

+ Open it # voice_hint:open, open it, door
    The door opens.
    -> end_open
+ Leave it # voice_hint:leave, no, stop
    You leave it closed.
    -> end_leave

=== end_open ===
# speaker:narrator # voice:narrator
Done.
-> END

=== end_leave ===
# speaker:narrator # voice:narrator
Also done.
-> END
`;
