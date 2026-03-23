oooOO`
# title: Radio Foundation Quiz
# author: Fink Stories
# speaker:narrator # voice:barney_the_carny
# mood:noir

VAR score = 0
VAR total = 20
VAR q = 0

-> intro

=== intro ===
# speaker:narrator # voice:barney_the_carny # mood:noir
#BG:#112
Right then. Sit down.

I'm not here to hold your hand. I've been on the air since before you were born, and I've seen too many people key up without knowing what they're doing.

You want your Foundation licence? Prove you deserve it. {total} questions. No waffle. Get it right or learn something.

I'll give you memory tricks along the way. Old hams didn't pass exams by being clever — we passed by having good mnemonics and stubborn practice.

+ [Let's go] # voice_hint:let's go -> q1
+ [I'm not ready...] # voice_hint:i'm not ready..., im -> not_ready

=== not_ready ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Nobody's ever ready. That's why we practise. Now stop dithering.

+ [Fine, go ahead] # voice_hint:fine, go ahead, fine, -> q1

=== q1 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 1
Question {q}. Basic stuff.

What does the letter F stand for in "RF"?

+ [Foundation] # voice_hint:foundation -> q1_wrong
+ [Frequency] # voice_hint:frequency -> q1_right
+ [Field] # voice_hint:field -> q1_wrong

=== q1_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Correct. Radio Frequency. The clue's in the name. RF — the energy we work with every time we transmit.

RF sits between about 3 kHz and 300 GHz. You don't need to memorise all that for Foundation, but you DO need to know it's not magic — it's electromagnetic waves.

+ [Next question] # voice_hint:next question -> q2

=== q1_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Radio FREQUENCY. Basic terminology. If you can't get the words right, how will you get the operating right?

RF — Radio Frequency — the electromagnetic energy we use to communicate. Remember it.

+ [Next question] # voice_hint:next question -> q2

=== q2 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 2
Question {q}.

A UK Foundation licence callsign starts with which prefix?

+ [2E0] # voice_hint:2e0 -> q2_wrong_2e0
+ [M0] # voice_hint:m0 -> q2_wrong_m0
+ [G4] # voice_hint:g4 -> q2_wrong_g4
+ [M7] # voice_hint:m7 -> q2_right

=== q2_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Good. M7 — that's you as a Foundation licensee. Three letters after it, assigned by Ofcom. Not chosen by you, before you ask.

Full licence is M0. Intermediate is 2E0. The old G-prefixed calls are legacy — earned when the exams were harder, some would say.

+ [Next] # voice_hint:next -> q3

=== q2_wrong_m0 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. M0 is a Full licence call. You haven't earned that yet.

Foundation is M7. Intermediate is 2E0. Full is M0. Learn the hierarchy.

+ [Next] # voice_hint:next -> q3

=== q2_wrong_g4 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. G4 is a legacy Full licence prefix from years back. Foundation calls start M7.

M7 — Foundation. 2E0 — Intermediate. M0 — Full. That's the progression.

+ [Next] # voice_hint:next -> q3

=== q2_wrong_2e0 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 2E0 is Intermediate. You need to walk before you can run.

Foundation is M7. That's where you start. Intermediate 2E0. Full M0.

+ [Next] # voice_hint:next -> q3

=== q3 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 3
Question {q}.

What is the maximum transmit power for a UK Foundation licence holder?

+ [5 watts] # voice_hint:5 watts -> q3_wrong
+ [100 watts] # voice_hint:100 watts -> q3_wrong
+ [10 watts] # voice_hint:10 watts -> q3_right
+ [50 watts] # voice_hint:50 watts -> q3_wrong

=== q3_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. 10 watts. Not a lot, but you'd be amazed what you can do with 10 watts and a decent aerial. I've worked across Europe on less.

Some Foundation bands allow less than 10 watts — check the band plan. But 10 watts is your ceiling. Go over it and Ofcom will be very interested in having a word.

+ [Next] # voice_hint:next -> q4

=== q3_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Wrong. 10 watts. That's your lot on a Foundation licence.

50 watts is Intermediate. Full licence gets you 400 watts on most bands. But YOU get 10. Use them wisely.

+ [Next] # voice_hint:next -> q4

=== q4 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 4
Question {q}. Safety now — this matters.

You're setting up an HF antenna in your garden. What's the FIRST thing you check?

+ [SWR reading] # voice_hint:swr reading -> q4_wrong_swr
+ [Coax cable length] # voice_hint:coax cable length, coax -> q4_wrong_coax
+ [Band conditions] # voice_hint:band conditions -> q4_wrong_band
+ [Distance from overhead power lines] # voice_hint:distance from overhead power lines, distance -> q4_right

=== q4_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Exactly right. Power lines KILL. Full stop. No discussion.

An antenna touching or even near a power line is lethal. No radio contact is worth dying for. Check above, check around, then — and only then — start putting up wire.

The exam takes safety seriously. So should you.

+ [Next] # voice_hint:next -> q5

=== q4_wrong_swr ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No! You can't measure SWR if you're dead!

POWER LINES. That's the first thing. Always. An antenna near overhead cables is a death sentence. Check for power lines before you do ANYTHING else.

+ [Next] # voice_hint:next -> q5

=== q4_wrong_band ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Band conditions don't matter if you've electrocuted yourself putting the aerial up.

POWER LINES. Check for overhead power lines first. Every time. No exceptions.

+ [Next] # voice_hint:next -> q5

=== q4_wrong_coax ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Coax length? You're thinking about feed loss when you should be thinking about not dying.

POWER LINES. Check for overhead power lines before you touch any antenna work. This isn't optional.

+ [Next] # voice_hint:next -> q5

=== q5 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 5
Question {q}.

In the NATO phonetic alphabet, how do you say the letter M?

+ [Mango] # voice_hint:mango -> q5_wrong
+ [Metro] # voice_hint:metro -> q5_wrong
+ [Mike] # voice_hint:mike -> q5_right
+ [Mary] # voice_hint:mary -> q5_wrong

=== q5_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Correct. Alpha, Bravo, Charlie... Mike.

The phonetic alphabet isn't a suggestion — it's how we communicate clearly. "M" and "N" sound identical on a noisy channel. "Mike" and "November" don't. Use it every time you give your callsign.

+ [Next] # voice_hint:next -> q6

=== q5_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. It's MIKE. M-I-K-E.

The NATO phonetic alphabet is standardised worldwide. You don't make up your own. Alpha Bravo Charlie Delta Echo Foxtrot Golf Hotel India Juliet Kilo Lima Mike. Learn it. Live it.

+ [Next] # voice_hint:next -> q6

=== q6 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 6
Question {q}.

What does "CQ" mean when you hear it on the air?

+ [Emergency call] # voice_hint:emergency call -> q6_wrong_emergency
+ [Channel Quality check] # voice_hint:channel quality check, channel -> q6_wrong_cq
+ [Calling a specific station] # voice_hint:calling a specific station, calling -> q6_wrong_specific
+ [General call — seeking any station] # voice_hint:general call — seeking any station, general -> q6_right

=== q6_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. CQ — "seek you" — a general call to anyone listening. "CQ CQ CQ, this is Mike Seven Alpha Bravo Charlie, Mike Seven Alpha Bravo Charlie, calling CQ and standing by."

That's how you make contacts. You put out a call, someone comes back. Simple as that. Been working since Marconi's day.

+ [Next] # voice_hint:next -> q7

=== q6_wrong_emergency ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No! An emergency call is MAYDAY on voice, or SOS in Morse. Getting those confused could cause real problems.

CQ means "general call" — calling any station. Think "seek you." It's an invitation to chat, not a cry for help.

+ [Next] # voice_hint:next -> q7

=== q6_wrong_cq ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Made that up, didn't you? CQ doesn't stand for "Channel Quality."

CQ is a general call — "seek you." You transmit it when you want any station to come back to you. It's one of the oldest conventions in radio.

+ [Next] # voice_hint:next -> q7

=== q6_wrong_specific ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. If you're calling a specific station, you use their callsign. "Golf Four Alpha Bravo Charlie, this is Mike Seven..."

CQ is a GENERAL call — you're calling anyone. Any station can respond. That's the whole point.

+ [Next] # voice_hint:next -> q7

=== q7 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 7
Question {q}.

What frequency band is the "2 metre" band?

+ [28 - 29.7 MHz] # voice_hint:28 - 29.7 mhz, 28 -> q7_wrong_10m
+ [3.5 - 3.8 MHz] # voice_hint:3.5 - 3.8 mhz, 3.5 -> q7_wrong_80m
+ [430 - 440 MHz] # voice_hint:430 - 440 mhz, 430 -> q7_wrong_70cm
+ [144 - 146 MHz] # voice_hint:144 - 146 mhz, 144 -> q7_right

=== q7_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Good. 144 to 146 MHz — VHF. The workhorse band for local communication. Most repeaters live here. Your first radio will probably be a 2 metre handheld.

The name comes from the wavelength. Speed of light divided by frequency gives you roughly 2 metres. Physics, not arbitrary naming.

+ [Next] # voice_hint:next -> q8

=== q7_wrong_10m ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 28 MHz is 10 metres — that's HF. Completely different propagation.

2 metres is 144 to 146 MHz. VHF. Line-of-sight mostly, though you get some nice lifts with temperature inversions. Your bread-and-butter local band.

+ [Next] # voice_hint:next -> q8

=== q7_wrong_70cm ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 430 MHz is 70 centimetres — close but wrong direction. That's UHF.

2 metres is 144 to 146 MHz. VHF. Longer wavelength than 70cm, generally better for getting over hills. Know your bands.

+ [Next] # voice_hint:next -> q8

=== q7_wrong_80m ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 3.5 MHz is 80 metres — that's HF, down in the weeds. Good for ragchewing on winter evenings.

2 metres is 144 to 146 MHz. VHF. Totally different part of the spectrum. Foundation licensees use 2m a LOT.

+ [Next] # voice_hint:next -> q8

=== q8 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 8
Question {q}.

What does a high SWR reading on your antenna system indicate?

+ [Good antenna performance] # voice_hint:good antenna performance, good -> q8_wrong
+ [Strong signal being received] # voice_hint:strong signal being received, strong -> q8_wrong
+ [Poor match between radio and antenna] # voice_hint:poor match between radio and antenna, poor -> q8_right
+ [Low battery] # voice_hint:low battery -> q8_wrong

=== q8_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Correct. SWR — Standing Wave Ratio. When your antenna isn't matched properly to your radio and feedline, power reflects back. High SWR means wasted power and potential damage to your transmitter.

A perfect match is 1:1. Under 1.5:1 is fine. Over 3:1 and you need to stop transmitting and fix the problem. Your radio's final amplifier won't thank you otherwise.

+ [Next] # voice_hint:next -> q9

=== q8_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Not even close. SWR is Standing Wave Ratio — it tells you how well your antenna system is matched.

High SWR means power is bouncing back down the coax instead of being radiated. Bad for your radio, bad for your signal. Keep it low — under 1.5:1 ideally.

+ [Next] # voice_hint:next -> q9

=== q9 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 9
Question {q}.

You want to use a repeater. What does it mean to use a "tone" or CTCSS?

+ [A Morse code identifier] # voice_hint:a morse code identifier, a -> q9_wrong
+ [A type of modulation] # voice_hint:a type of modulation, a -> q9_wrong
+ [A sub-audible tone that opens the repeater's squelch] # voice_hint:a sub-audible tone that opens the repeater's squelch, a -> q9_right
+ [An audio filter for your receiver] # voice_hint:an audio filter for your receiver, an -> q9_wrong

=== q9_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. CTCSS — Continuous Tone-Coded Squelch System. A low-frequency tone below the voice range that tells the repeater "this transmission is meant for me."

Without the right tone, the repeater ignores you. Different repeaters use different tones. Check before you transmit — the keeper won't appreciate you hammering away with the wrong tone. Look up the repeater details on ukrepeater.net.

+ [Next] # voice_hint:next -> q10

=== q9_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. CTCSS is a sub-audible tone — a low frequency signal sent alongside your voice. The repeater won't open unless it hears the correct tone.

Think of it as a key for the repeater's front door. Wrong key, door stays shut. Check the repeater's required tone before you try to use it.

+ [Next] # voice_hint:next -> q10

=== q10 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 10
Question {q}.

Why must you identify your station with your callsign?

+ [It's a legal requirement of your licence] # voice_hint:it's a legal requirement of your licence, its -> q10_right
+ [Only needed during contests] # voice_hint:only needed during contests, only -> q10_wrong
+ [It's just good practice but optional] # voice_hint:it's just good practice but optional, its -> q10_wrong
+ [Only on HF, not VHF] # voice_hint:only on hf, not vhf, only -> q10_wrong

=== q10_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Exactly. It's the LAW. Your licence conditions require you to identify with your callsign at regular intervals and at the start and end of a contact.

Your callsign is your identity on the air. It's traceable. It means you're accountable. That's why we have licences — so the spectrum isn't a free-for-all. Identify. Every. Time.

+ [Next] # voice_hint:next -> q11

=== q10_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
WRONG. It's a LEGAL REQUIREMENT. Not optional. Not "good practice." It's a condition of your licence from Ofcom.

You transmit without identifying, you're breaking the law. Simple as that. Your callsign proves you're a licensed operator and makes you accountable.

+ [Next] # voice_hint:next -> q11

=== q11 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 11
Question {q}. Ohm's Law. If you remember ONE formula from this exam, it's this one.

A 12-volt supply is connected across a 4-ohm resistor. What current flows?

+ [0.33 amps] # voice_hint:0.33 amps -> q11_wrong
+ [16 amps] # voice_hint:16 amps -> q11_wrong
+ [3 amps] # voice_hint:3 amps -> q11_right
+ [48 amps] # voice_hint:48 amps -> q11_wrong

=== q11_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Good. V = I times R. Voltage equals Current times Resistance. So I = V divided by R. 12 divided by 4 is 3 amps.

MEMORY TRICK: Think of a triangle. V on top, I and R on the bottom. Cover what you want to find — whatever's left is the formula. Cover V, you see I times R. Cover I, you see V over R. Cover R, you see V over I.

Just draw the VIR triangle on scrap paper in the exam. V on top, I and R below. Whatever you need, cover it and read off the formula. KNOW this cold.

+ [Next] # voice_hint:next -> q12

=== q11_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. V = I times R. You need I, so I = V / R = 12 / 4 = 3 amps.

MEMORY TRICK: Draw a triangle — V on top, I and R on the bottom. Cover what you want. It's the single most useful trick in the exam. Practice it until it's automatic.

"VIR triangle" — V on top, I and R below. Learn it, love it, pass your exam with it.

+ [Next] # voice_hint:next -> q12

=== q12 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 12
Question {q}. The 300 Rule.

The wavelength of a 145 MHz signal is approximately...?

+ [About 10 metres] # voice_hint:about 10 metres, about -> q12_wrong_10
+ [About 70 centimetres] # voice_hint:about 70 centimetres, about -> q12_wrong_70
+ [About 80 metres] # voice_hint:about 80 metres, about -> q12_wrong_80
+ [About 2 metres] # voice_hint:about 2 metres, about -> q12_right

=== q12_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. Wavelength in metres equals 300 divided by frequency in MHz. 300 / 145 is roughly 2. That's why it's called the 2 metre band.

MEMORY TRICK: "300 over MHz." That's it. Three hundred divided by the frequency in megahertz gives wavelength in metres. Works the other way too — 300 divided by wavelength gives frequency.

So 70cm? 300 / 0.7 = about 430 MHz. 10m? 300 / 10 = 30 MHz. 80m? 300 / 80 = about 3.7 MHz. One formula, every band.

+ [Next] # voice_hint:next -> q13

=== q12_wrong_70 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 70cm is the 430 MHz band. Different band entirely.

THE 300 RULE: Wavelength = 300 / frequency in MHz. So 300 / 145 = roughly 2 metres.

Tattoo "300 over MHz" on your brain. It converts any frequency to wavelength and back. You WILL need this in the exam.

+ [Next] # voice_hint:next -> q13

=== q12_wrong_10 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 10 metres is around 28 MHz — that's HF.

THE 300 RULE: Wavelength = 300 / frequency in MHz. 300 / 145 = about 2 metres.

This one formula handles every wavelength-to-frequency question in the exam.

+ [Next] # voice_hint:next -> q13

=== q12_wrong_80 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 80 metres is around 3.5 MHz — way down in HF territory.

THE 300 RULE: Wavelength = 300 / frequency in MHz. 300 / 145 = about 2 metres. Learn the rule, not the individual answers.

+ [Next] # voice_hint:next -> q13

=== q13 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 13
Question {q}. Modulation — how we put information onto a radio wave.

On 2 metres FM, what does "FM" stand for?

+ [Frequency Multiplier] # voice_hint:frequency multiplier -> q13_wrong
+ [Full Modulation] # voice_hint:full modulation -> q13_wrong
+ [Foundation Mode] # voice_hint:foundation mode -> q13_wrong
+ [Frequency Modulation] # voice_hint:frequency modulation -> q13_right

=== q13_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. Frequency Modulation — the carrier frequency shifts up and down to carry your voice.

The exam needs you to know three main types. MEMORY TRICK — "AFS":

A — AM, Amplitude Modulation. The signal gets louder and quieter. Used on medium wave broadcast radio. Simple but wastes power.

F — FM, Frequency Modulation. The frequency wobbles. Cleaner sound, used on 2m and 70cm. What you'll use most.

S — SSB, Single Sideband. Strips out the carrier and one sideband. Very efficient. Used on HF. "SSB Saves Bandwidth" — that's why DXers love it.

+ [Next] # voice_hint:next -> q14

=== q13_wrong ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Frequency Modulation. The frequency of the carrier wave shifts to carry your voice signal.

Remember "AFS" — the three modulation types you need:
AM (Amplitude Modulation) — signal strength varies.
FM (Frequency Modulation) — frequency varies. Used on VHF/UHF.
SSB (Single Sideband) — efficient, used on HF. "SSB Saves Bandwidth."

+ [Next] # voice_hint:next -> q14

=== q14 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 14
Question {q}. Propagation — how your signal gets from A to B.

VHF signals (like 2 metres) primarily travel by which method?

+ [Tropospheric ducting] # voice_hint:tropospheric ducting -> q14_wrong_tropo
+ [Sky wave / ionospheric reflection] # voice_hint:sky wave / ionospheric reflection, sky -> q14_wrong_sky
+ [Line of sight] # voice_hint:line of sight, line -> q14_right
+ [Ground wave] # voice_hint:ground wave -> q14_wrong_ground

=== q14_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Correct. VHF and UHF are essentially line-of-sight. That's why height matters — get your aerial up and you'll work further. Hills block you. That's life on VHF.

MEMORY TRICK for propagation modes:

"HF Skips, VHF Sees, Ground Hugs."

HF SKIPS off the ionosphere — that's sky wave. Bounces between ground and ionosphere. Why you can work thousands of miles on 20 metres.

VHF SEES — line of sight. What you can see from your antenna, roughly, is what you can work. Repeaters on hilltops extend this.

GROUND wave HUGS the earth's surface. Medium wave radio uses this. Short range on HF.

Tropospheric ducting does happen on VHF — rare treats when weather conditions bend signals over the horizon. But it's not the PRIMARY mode. The exam wants "line of sight."

+ [Next] # voice_hint:next -> q15

=== q14_wrong_sky ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Sky wave is for HF — signals bouncing off the ionosphere. VHF punches straight through the ionosphere into space. That's why VHF is line-of-sight.

"HF Skips, VHF Sees, Ground Hugs." VHF sees — line of sight. Height is everything on VHF.

+ [Next] # voice_hint:next -> q15

=== q14_wrong_ground ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Ground wave hugs the earth's surface — it's a factor on lower HF and medium wave, not VHF.

"HF Skips, VHF Sees, Ground Hugs." VHF is line-of-sight. Get your antenna high.

+ [Next] # voice_hint:next -> q15

=== q14_wrong_tropo ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Close — tropospheric ducting DOES happen on VHF, and it's exciting when it does. But it's not the primary mode. The exam answer is line of sight.

"HF Skips, VHF Sees." VHF signals travel in straight lines. Tropo ducting is a bonus, not the norm.

+ [Next] # voice_hint:next -> q15

=== q15 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 15
Question {q}. Decibels — the exam LOVES these.

If you double the power of your transmitter, how many decibels have you gained?

+ [10 dB] # voice_hint:10 db -> q15_wrong_10
+ [1 dB] # voice_hint:1 db -> q15_wrong_1
+ [6 dB] # voice_hint:6 db -> q15_wrong_6
+ [3 dB] # voice_hint:3 db -> q15_right

=== q15_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Spot on. 3 dB is a doubling of power. This is THE key decibel fact for the exam.

MEMORY TRICK — "3-10-20":

3 dB = DOUBLE (or half) the power. 5 watts to 10 watts? That's 3 dB.

10 dB = TEN TIMES the power. 1 watt to 10 watts? 10 dB.

20 dB = HUNDRED TIMES. 10 dB is x10, another 10 dB is x10 again. 10 x 10 = 100.

And it stacks: 13 dB? That's 10 dB (x10) plus 3 dB (x2) = x20.

Also works for loss. Lose 3 dB in your coax? You've lost HALF your power before it reaches the antenna. That's why good coax matters.

+ [Next] # voice_hint:next -> q16

=== q15_wrong_6 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 6 dB is doubling TWICE — that's four times the power. 3 dB is one doubling.

THE RULE: 3 dB = double. 10 dB = ten times. They stack — 13 dB = x20. This comes up repeatedly in the exam.

+ [Next] # voice_hint:next -> q16

=== q15_wrong_10 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 10 dB is ten times the power. Doubling is only 3 dB.

"3 dB doubles, 10 dB tens." Simplest way to remember it. And they add: 13 dB = 10 + 3 = x10 then x2 = x20.

+ [Next] # voice_hint:next -> q16

=== q15_wrong_1 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 1 dB is barely perceptible. You need 3 dB to double the power.

"3 doubles, 10 tens." Two numbers. That's all you need. And minus 3 dB means you've HALVED it — like lossy coax eating your signal.

+ [Next] # voice_hint:next -> q16

=== q16 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 16
Question {q}. Q codes — shorthand from the telegraph days, still used today.

What does QTH mean?

+ [Your location / "my location is..."] # voice_hint:your location / "my location is...", your -> q16_right
+ [Your frequency] # voice_hint:your frequency -> q16_wrong_freq
+ [Please wait] # voice_hint:please wait -> q16_wrong_wait
+ [Your signal report] # voice_hint:your signal report, your -> q16_wrong_sig

=== q16_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. QTH — your location.

MEMORY TRICK — Q codes, think of what the THIRD letter suggests:

QTH — "The House." Where you live. Your location.
QSY — "Shift Yourself." Change frequency.
QRZ — "Who is calling me?" Someone's calling, who are you?
QSL — "Stamp the Letter." Confirm receipt. Also the cards we exchange as proof of contact.
QRM — "Man-made interference." Other stations, electrical noise.
QRN — "Natural interference." Static, thunderstorms, atmospheric noise.

M for Man-made, N for Natural. That's the trick for QRM vs QRN — comes up in the exam.

+ [Next] # voice_hint:next -> q17

=== q16_wrong_freq ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Frequency changes are QSY — "Shift Yourself" to remember it.

QTH is your location — "The House." QTH, QSY, QRZ, QSL — learn the common ones. The third letter is your memory hook.

+ [Next] # voice_hint:next -> q17

=== q16_wrong_sig ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Signal reports use the RST system, not Q codes. QTH means your location.

"QTH = The House." Where are you? That's QTH.

+ [Next] # voice_hint:next -> q17

=== q16_wrong_wait ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. QTH is your location. "The House" — where you are.

"Please wait" would be "stand by" or QRX. But QTH is the one you absolutely must know.

+ [Next] # voice_hint:next -> q17

=== q17 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 17
Question {q}. Signal reports.

You receive a signal report of "5 and 9." What does the 5 refer to?

+ [Number of watts received] # voice_hint:number of watts received, number -> q17_wrong_watts
+ [Readability — perfectly readable] # voice_hint:readability — perfectly readable, readability -> q17_right
+ [Audio quality on a scale of 1-5] # voice_hint:audio quality on a scale of 1-5, audio -> q17_wrong_audio
+ [Signal strength — very strong] # voice_hint:signal strength — very strong, signal -> q17_wrong_strength

=== q17_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Good. The RST system: Readability, Signal strength, Tone.

On phone (voice), you give RS — Readability 1-5, Signal strength 1-9. "5 and 9" means perfectly readable and extremely strong. On CW (Morse) you add T for tone quality.

MEMORY TRICK: "RS — Read the Signal."

Readability: 1 = unreadable, 5 = perfectly clear. Only goes to 5.
Signal: 1 = faint, 9 = extremely strong. Goes to 9.

So "5 and 9" is the best possible voice report. You'll hear a LOT of "5-9" on the air — sometimes honestly, sometimes... optimistically.

+ [Next] # voice_hint:next -> q18

=== q17_wrong_strength ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No — the 9 is signal strength. The FIRST number (5) is readability.

RST: Readability (1-5), Signal (1-9), Tone (1-9, CW only). "Read the Signal" — R comes first. 5 and 9 means perfectly readable and extremely strong.

+ [Next] # voice_hint:next -> q18

=== q17_wrong_audio ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Close thinking but no. It's Readability — how clearly your words can be understood, not audio fidelity. Scale of 1 to 5, where 5 is perfect.

RST — "Read the Signal." Readability first, then Signal strength.

+ [Next] # voice_hint:next -> q18

=== q17_wrong_watts ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. Signal reports have nothing to do with watts. It's the RST system.

R = Readability (1-5). S = Signal strength (1-9). "5 and 9" means perfectly readable, very strong signal.

+ [Next] # voice_hint:next -> q18

=== q18 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 18
Question {q}. Interference — your neighbours will care about this even if you don't.

Your transmissions are causing interference to a neighbour's television. What should you do FIRST?

+ [Increase your power to override the interference] # voice_hint:increase your power to override the interference, increase -> q18_wrong_power
+ [Stop transmitting permanently] # voice_hint:stop transmitting permanently, stop -> q18_wrong_stop
+ [Ignore it — their TV is their problem] # voice_hint:ignore it — their tv is their problem, ignore -> q18_wrong_ignore
+ [Speak to your neighbour and offer a filter] # voice_hint:speak to your neighbour and offer a filter, speak -> q18_right

=== q18_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right approach. Talk to them. Be polite. Offer to help. A simple filter on their TV aerial lead often fixes it completely. Ofcom can provide guidance too.

MEMORY TRICK for interference types:

"TVI and BCI — the Two Angry Neighbours."

TVI — Television Interference. Your signal gets into their telly.
BCI — Broadcast receiver interference. Your signal gets into their radio.

Most interference isn't YOUR fault as such — it's their equipment not rejecting out-of-band signals. But it IS your problem to help fix. Being a good neighbour is part of being a good amateur. The exam tests your attitude as much as your knowledge here.

A ferrite choke on their aerial lead costs a couple of quid and fixes most cases. Keep some in your shack — you'll need them.

+ [Next] # voice_hint:next -> q19

=== q18_wrong_power ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Absolutely NOT! More power makes interference WORSE! That's like fixing a noise complaint by shouting louder.

Talk to your neighbour. Offer a filter. Be diplomatic. The exam specifically tests whether you understand the cooperative approach.

+ [Next] # voice_hint:next -> q19

=== q18_wrong_ignore ===
# speaker:narrator # voice:barney_the_carny # mood:noir
That attitude will lose you your licence. Ofcom takes interference complaints seriously, and "not my problem" is not an acceptable response.

Speak to the neighbour. Offer help. Fit a filter. Being a responsible operator is a licence condition.

+ [Next] # voice_hint:next -> q19

=== q18_wrong_stop ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Overreaction. You have a right to transmit under your licence. But you also have a responsibility to minimise interference.

Talk to the neighbour, offer to fit a filter, check your own station is clean. Most TVI is easily fixed. Don't throw in the towel — fix the problem.

+ [Next] # voice_hint:next -> q19

=== q19 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 19
Question {q}. EMF safety — Electromagnetic Field exposure.

Foundation licensees must ensure people aren't exposed to excessive RF. What's the simplest way to comply?

+ [Only transmit at night when people are indoors] # voice_hint:only transmit at night when people are indoors, only -> q19_wrong_night
+ [Wrap the antenna in insulation] # voice_hint:wrap the antenna in insulation, wrap -> q19_wrong_insulate
+ [Keep people away from the antenna while transmitting] # voice_hint:keep people away from the antenna while transmitting, keep -> q19_right
+ [Use a dummy load at all times] # voice_hint:use a dummy load at all times, use -> q19_wrong_dummy

=== q19_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. Distance is your friend. RF energy drops off rapidly with distance — it follows the inverse square law. Double the distance, quarter the field strength.

MEMORY TRICK: "DISTANCE DEFEATS RF."

At Foundation power levels (10 watts), you're unlikely to cause problems if your antenna is a few metres from people. But the exam wants you to KNOW that EMF compliance is your responsibility.

Key points: Keep antennas away from where people walk or sit. Don't transmit with a handheld pressed against your head for hours on end. Vertical antennas on the roof are generally fine — the radiation is going sideways, not down through your ceiling. Use common sense and keep your distance.

Ofcom publishes a simple EMF calculator. At 10 watts, the exclusion zone is small. But you must still demonstrate awareness.

+ [Next] # voice_hint:next -> q20

=== q19_wrong_night ===
# speaker:narrator # voice:barney_the_carny # mood:noir
What? No. People don't become RF-proof after dark.

DISTANCE is the answer. Keep your antenna away from where people are. RF energy drops with distance. That's the key principle.

+ [Next] # voice_hint:next -> q20

=== q19_wrong_dummy ===
# speaker:narrator # voice:barney_the_carny # mood:noir
A dummy load absorbs all your RF as heat — great for testing, useless for actual communication since nothing gets radiated!

The answer is distance. Keep your antenna away from people. Simple, effective, and what the exam expects you to know.

+ [Next] # voice_hint:next -> q20

=== q19_wrong_insulate ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Insulation doesn't block RF. Radio waves go through plastic, fibreglass, wood — most building materials too.

Distance. That's what reduces RF exposure. Inverse square law — double the distance, quarter the field. Keep the antenna away from people.

+ [Next] # voice_hint:next -> q20

=== q20 ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ q = 20
Last question. Let's see what you've retained.

What does "73" mean at the end of a contact?

+ [Best regards] # voice_hint:best regards -> q20_right
+ [Goodbye forever] # voice_hint:goodbye forever -> q20_wrong_goodbye
+ [Signal report 7-3] # voice_hint:signal report 7-3, signal -> q20_wrong_signal
+ [73 watts of power used] # voice_hint:73 watts of power used, 73 -> q20_wrong_watts

=== q20_right ===
# speaker:narrator # voice:barney_the_carny # mood:noir
~ score = score + 1
Right. 73 — best regards. Not "73s" — that's like saying "best regardses." Just 73.

It comes from the old telegraph codes, 19th century. Still used every day on amateur radio. You'll hear it at the end of nearly every contact.

Other common ones: 88 means "love and kisses" — used between partners on the air, not random strangers! And 55 is "best of luck" in some traditions.

But 73 is the one. Best regards. A proper sign-off from one amateur to another.

+ [Get my results] # voice_hint:get my results, get -> results

=== q20_wrong_goodbye ===
# speaker:narrator # voice:barney_the_carny # mood:noir
Not quite that dramatic! 73 means "best regards" — a friendly sign-off, not a farewell forever.

It's from the old telegraph number codes. 73 = best regards. You'll use it at the end of every contact. Just "73" — never "73s."

+ [Get my results] # voice_hint:get my results, get -> results

=== q20_wrong_signal ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No. 73 isn't a signal report — it means "best regards." A friendly sign-off used since the telegraph days.

Signal reports use the RST system — remember? Readability 1-5, Signal 1-9. "73" is social, not technical.

+ [Get my results] # voice_hint:get my results, get -> results

=== q20_wrong_watts ===
# speaker:narrator # voice:barney_the_carny # mood:noir
No! 73 means "best regards." Nothing to do with power.

It's one of the oldest traditions in radio — a simple, friendly sign-off. You'll say it hundreds of times once you're licensed.

+ [Get my results] # voice_hint:get my results, get -> results

=== results ===
# speaker:narrator # voice:barney_the_carny # mood:noir
#BG:#112

Right. You scored {score} out of {total}.

{score >= 18:
Well well. {score}/{total}. I'm genuinely impressed. You know your stuff. Go book that Foundation exam — you'll walk it. 73 and welcome to the hobby.
}

{score >= 14 && score < 18:
{score}/{total}. Decent. You've got a solid foundation — pun intended — but brush up on what you got wrong. The exam pass mark is about 73%, so you're in the right area, but don't get cocky.
}

{score >= 10 && score < 14:
{score}/{total}. Middling. You know some of it but you'd be shaky in the exam. Get the RSGB Foundation Licence Now! book. Read it properly, do the practice papers. Remember the memory tricks — VIR triangle, 300 rule, 3 dB doubles. They'll carry you through.
}

{score < 10:
{score}/{total}. Honest answer? You need more study. But EVERYONE starts here. Get the Foundation study materials, find a local club — most run training courses. The memory tricks I've given you will help: VIR triangle for Ohm's Law, "300 over MHz" for wavelength, "HF Skips VHF Sees" for propagation. Write them on flashcards. Drill them. Come back when you're ready.
}

MEMORY TRICKS CHEAT SHEET — take this with you:

VIR TRIANGLE: V on top, I and R below. Cover what you need.
300 RULE: Wavelength = 300 / freq in MHz.
3-10-20: 3 dB doubles, 10 dB = x10, 20 dB = x100.
AFS: AM, FM, SSB — the three modulation types.
HF SKIPS, VHF SEES: Propagation modes.
QTH = The House. QSY = Shift Yourself. QRM = Man-made, QRN = Natural.
RS = Read the Signal: Readability 1-5, Strength 1-9.
DISTANCE DEFEATS RF: EMF safety in three words.
POWER LADDER: Foundation 10W, Intermediate 50W, Full 400W.

The real exam is 26 multiple choice questions. You need 19 to pass — about 73%. It covers everything we talked about and more.

Find a club. Get on the air under supervision. Listen more than you talk — at least at first.

Now get out of my shack. I've got a pileup to work.

+ [Try again] # voice_hint:try again -> intro
+ [73 — thanks] # voice_hint:73 — thanks, 73 -> goodbye

=== goodbye ===
# speaker:narrator # voice:barney_the_carny # mood:noir
#BG:#223
73, and good luck with the exam.

Remember: the licence is just the beginning. The real learning happens on the air.

Now go study.

-> END
`
