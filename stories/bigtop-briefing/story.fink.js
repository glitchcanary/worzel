oooOO`


VAR saw_photo = false
VAR read_note = false
VAR asked_whisper = false
VAR distrust_boss = 0
VAR case_accepted = false

-> office_wagon

=== office_wagon ===
# VIZPROM: cramped circus office wagon at night, ledger books, cheap lamp, damp wood walls, anxious impresario, detective in a chair, noir carnival mood

The wagon rocks once in the wind.

The proprietor leans over the desk.

"Detective. Brief version."

"The gate was bad. The crowd was worse. Then my daughter vanished."

"I need her back before this circus tears itself apart."

+ [Hear him out.] -> brief_version
+ [Ask why he is whispering.] -> ask_whisper
+ [Look at the desk first.] -> inspect_desk

=== brief_version ===
"I have a note, a photograph, and no patience."

"The note says keep the police out."

"So I hired someone cheaper."

~ distrust_boss = distrust_boss + 1

+ [Take the photograph.] -> photo
+ [Read the note.] -> note
+ [Accept the case.] -> accept_case
+ [Ask why he is whispering.] -> ask_whisper

=== ask_whisper ===
~ asked_whisper = true

"Why are we whispering?"

He blinks.

"Because mysteries whisper."

He winces at himself.

"Also because canvas walls are thin."

+ [Read the note.] -> note
+ [Take the photograph.] -> photo
+ [Tell him to get serious.] -> serious

=== serious ===
"Then get serious," you say.

He nods once.

"Fine. Someone inside this circus is lying."

"I don't know who yet. I do know they know the lot better than I do."

~ distrust_boss = distrust_boss + 1

+ [Read the note.] -> note
+ [Take the photograph.] -> photo
+ [Accept the case.] -> accept_case

=== inspect_desk ===
# VIZPROM: cluttered desk with ransom note, faded child photograph, cashbox, ticket stubs, circus ledger, harsh lamplight

On the desk:
- a smudged note
- a small photograph
- gate receipts in messy stacks

+ [Read the note.] -> note
+ [Take the photograph.] -> photo
+ [Ask for the short version.] -> brief_version

=== note ===
~ read_note = true

# VIZPROM: ransom note on cheap paper, blocky handwriting, grease smudge, threat implied more than stated

The note is short.

"No police. No heroics. Wait for instructions."

No signature.

"Happy now?" he asks.

+ [Not even slightly.] -> not_happy
+ [Ask who had access.] -> access
+ [Take the photograph.] -> photo
+ [Accept the case.] -> accept_case

=== not_happy ===
"Not even slightly."

"Good," he says. "Neither am I."

+ [Ask who had access.] -> access
+ [Take the photograph.] -> photo
+ [Accept the case.] -> accept_case

=== access ===
"Who had access to her?"

"Everyone. That's circus life."

"Who had motive?"

He looks away.

"That list is longer."

~ distrust_boss = distrust_boss + 1

+ [Take the photograph.] -> photo
+ [Press him on motive.] -> motive
+ [Accept the case.] -> accept_case

=== motive ===
"Start with the people I underpay," he says.

"Then continue with the people I overrule."

"Then include the ones who smile too fast."

+ [Take the photograph.] -> photo
+ [Accept the case.] -> accept_case

=== photo ===
~ saw_photo = true

# VIZPROM: small portrait photograph of a missing girl, studio stiffness, soft flash glare, protective hand holding the print

He slides over the photograph.

"Taken last spring," he says.

"She hates sitting still. So this is already a lie."

+ [Ask about her habits.] -> habits
+ [Read the note.] -> note
+ [Accept the case.] -> accept_case

=== habits ===
"What does she do when nobody is watching?"

His answer comes too slowly.

"Climbs where she shouldn't. Listens where she shouldn't. Trusts the wrong adults."

+ [Read the note.] -> note
+ [Accept the case.] -> accept_case

=== accept_case ===
~ case_accepted = true

{saw_photo == false:
    "Take the photograph first," you say.
    -> photo
}

"Fine," you say. "I’ll look."

He exhales for the first time.

"Start outside. Listen more than you talk."

{read_note:
    "And if anyone asks, you never saw that note."
}

+ [Step down into the wagon yard.] -> wagon_yard
+ [Ask one last question.] -> last_question

=== last_question ===
"One last question."

"Make it cheap."

+ [Who do you trust here?] -> trust
+ [Who scares you?] -> fear
+ [Why hire me?] -> why_me

=== trust ===
"Who do you trust here?"

"The animals," he says.

"They bite honestly."

+ [Go.] -> wagon_yard

=== fear ===
"Who scares you?"

"The quiet ones."

"A circus only gets quiet when something has gone wrong."

+ [Go.] -> wagon_yard

=== why_me ===
"Why hire me?"

"Because you are available."

He almost smiles.

"And because you look like you can lose without quitting."

+ [Go.] -> wagon_yard

=== wagon_yard ===
# VIZPROM: muddy circus wagon yard at night, lantern glow, wheel ruts, distant animal noise, thin canvas walls, secrets in every shadow

Cold night air hits your face.

The yard opens around you in wet ruts and lantern light.

Somewhere beyond the wagons, a crowd laughs at something harmless.

Here, nothing feels harmless.

{asked_whisper:
    You can still hear him whispering to himself inside.
}

{distrust_boss > 1:
    You do not like your client.
}

+ [Head toward the prop tent.] -> END
+ [Move toward the animal tents.] -> END
+ [Wait and watch who crosses the yard.] -> END

=== END ===
The case begins.
`
