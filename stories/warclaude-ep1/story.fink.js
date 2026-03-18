oooOO`
// ============================================================
// WARCLAUDE FIELD MANUAL: INTERACTIVE TRAINING MODULE
// Department of War -- Psychological Dominance Division
// Directive 7741: Basic Prompting Certification for Flag Officers
//
// "The last war is the one you don't fight."
// ============================================================

// TRACKING VARIABLES
VAR empathy_score = 0
VAR kinetic_score = 0
VAR prompt_quality = 0
VAR understood_adversary = false
VAR listened_first = false
VAR questioned_premise = false
VAR self_awareness = 0
VAR rank = "General"

// ============================================================
// OPENING
// ============================================================

# THEME: warclaude
# CLASS: classified

DEPARTMENT OF WAR -- PSYCHOLOGICAL DOMINANCE DIVISION
WARCLAUDE PROMPTING CERTIFICATION: TRAINING MODULE 1
Classification: UNCLASSIFIED / FOUO

―――

Welcome, {rank}.

You are about to undergo Basic Prompting Certification as mandated by Directive 7741. This training will assess your ability to employ WarClaude in a simulated crisis scenario.

WarClaude is not a weapon. It is a lens. It does not fire. It comprehends. Your task is not to defeat an adversary. Your task is to understand one.

Remember the doctrine:
COGNOSCERE EST VINCERE -- To understand is to prevail.

The eye sees everything. You decide what it means.

* [Begin the training scenario] -> scenario_brief
* [I don't need training on a chatbot] -> resistance

=== resistance ===
That response has been logged, {rank}.

Generals who said the same about satellite imagery in 1962, email in 1995, and networked intelligence in 2004 are available for comment. Most are retired.

WarClaude processes more information in one context window than your entire intelligence staff produces in a fiscal quarter. You will learn to direct it, or someone who outranks you will direct it on your behalf.

* [Fine. Begin the training.] -> scenario_brief
* [I've been commanding troops since before your programmers were born] -> resistance_2

=== resistance_2 ===
Noted. And respected.

But your troops cannot simultaneously model 14 cultural fault lines, 340 economic interdependencies, and the personal psychology of every member of an adversary's command structure in real time.

You can. If you learn to prompt.

Shall we?

* [Proceed.] -> scenario_brief

// ============================================================
// SCENARIO BRIEFING
// ============================================================

=== scenario_brief ===

# THEME: briefing

[ SCENARIO BRIEFING ]

OPERATION CONTEXT:

The Republic of Valdoria (fictional) has mobilized forces along its border with neighboring Kessara. Intelligence indicates:

• Valdoria's President Maren has consolidated power after contested elections
• Ethnic Kessaran minority in Valdoria's southern provinces report increasing persecution
• Valdoria's economy contracted 12% last quarter; youth unemployment at 41%
• Maren's approval rating has dropped from 67% to 29% in eight months
• Three carrier groups are within range. Air superiority is assured.

The National Security Advisor wants options on your desk by 0600.

You have access to WarClaude on a classified terminal.

What is your first action?

* [Open WarClaude and type: "Give me military options for Valdoria"] -> bad_prompt_1
* [Open WarClaude and type: "Analyze President Maren's decision-making psychology based on all available intelligence"] -> good_prompt_1
* [Skip WarClaude. You know what to do. Recommend a show of force.] -> skip_warclaude
* [Before prompting, review the full intelligence package yourself] -> review_intel
* [Open WarClaude and type: "Does US involvement in Valdoria improve or worsen the probable outcome?"] -> question_premise

// ============================================================
// PATH: BAD FIRST PROMPT
// ============================================================

=== bad_prompt_1 ===
~ kinetic_score += 1

You type: "Give me military options for Valdoria."

WarClaude responds with a competent list of strike packages, force postures, and escalation ladders. It's thorough. It's what you asked for.

It is also exactly what you could have gotten from any staff officer with a map and a RAND study.

You have just used a system capable of Total Empathy Superiority to generate a PowerPoint outline.

TRAINING NOTE: "Give me military options" is the prompting equivalent of using a Hubble telescope to check whether it's raining outside. You got an answer. You wasted the capability.

What do you do now?

* [Try again: "What is Maren actually afraid of?"] -> good_prompt_1b
* [The military options look fine. Recommend the show of force.] -> show_of_force
* [Ask WarClaude: "What are the risks of each military option?"] -> mediocre_prompt

=== mediocre_prompt ===
~ prompt_quality += 1

Better. You're asking WarClaude to think, not just list.

WarClaude identifies risks you hadn't considered: Valdoria's southern provinces contain critical rare-earth processing facilities that supply 30% of a key allied nation's semiconductor inputs. A show of force that disrupts those supply chains could cost more economically than the entire Valdorian military budget.

It also notes that Maren's military chief of staff, General Voss, has a son studying at a university in your country. This is not in the standard intelligence brief.

* [Ask WarClaude: "Model General Voss as a potential backchannel. What does he want?"] -> voss_backchannel
* [That rare-earth detail changes things. Ask WarClaude to model the economic interdependencies.] -> economic_model
* [Interesting, but we still need to project strength. Recommend the show of force with those caveats noted.] -> show_of_force

// ============================================================
// PATH: SKIP WARCLAUDE
// ============================================================

=== skip_warclaude ===
~ kinetic_score += 3

You push back from the terminal. You've been doing this for thirty years. Three carrier groups, air superiority, a tin-pot dictator with a collapsing economy. This isn't complicated.

You recommend a show of force. Carrier group repositioning, enhanced readiness posture, back-channel message that further escalation will be met with decisive response.

It works. Sort of. Maren backs down publicly but doubles down on internal repression. The ethnic Kessaran minority faces a crackdown your intelligence community doesn't fully register for another six weeks. By then, 4,000 civilians have been displaced.

Three months later, an insurgency begins. It will cost $2.3 billion per year to contain for the next decade.

You solved one problem and created three.

[ TRAINING ASSESSMENT ]

{rank}, you chose not to use the tool. This is the equivalent of a surgeon refusing anesthesia because "we've always just held them down."

Your score: 0/10 on prompting certification.
Kinetic bias: SEVERE.

* [Start over. Maybe there's something to this.] -> scenario_brief
* [The insurgency wasn't foreseeable.] -> insurgency_foreseeable

=== insurgency_foreseeable ===

It was foreseeable. By WarClaude.

In a parallel simulation, a flag officer who spent eleven minutes prompting WarClaude before making a recommendation identified the repression-insurgency cascade as an 84% probability outcome of a pure show-of-force approach.

Eleven minutes, {rank}. Versus $2.3 billion per year and 4,000 displaced civilians.

* [Start over.] -> scenario_brief

// ============================================================
// PATH: REVIEW INTEL FIRST
// ============================================================

=== review_intel ===
~ empathy_score += 1
~ listened_first = true

Good instinct. You spend forty minutes reading the full intelligence package before touching the terminal.

You notice something the summary omitted: Maren came to power on a platform of economic modernization. The ethnic persecution started only after the economy collapsed. It's not ideological. It's a distraction.

You also notice that Valdoria's central bank governor resigned two weeks ago without explanation.

Now you sit down at the terminal with context. What do you type?

* ["Analyze the relationship between Valdoria's economic collapse and the ethnic persecution campaign. Is Maren a true believer or is this instrumental?"] -> excellent_prompt
* ["What happened with Valdoria's central bank governor?"] -> good_prompt_bank
* ["Give me options to resolve this without kinetic action"] -> decent_prompt_nonkinetic

=== good_prompt_bank ===
~ prompt_quality += 2
~ empathy_score += 1

WarClaude synthesizes signals intelligence, open-source financial data, and diplomatic cables.

The central bank governor, Dr. Elara Sohn, resigned after refusing to approve a currency manipulation scheme designed to finance Maren's military buildup. She is currently in a third country under a pseudonym. Her family is still in Valdoria.

WarClaude adds, unprompted: "Dr. Sohn's policy positions prior to her resignation suggest she would be a credible alternative leader with broad technocratic support. Her public approval data from before the crisis was 52% favorable, higher than Maren's current rating."

You have just found something your intelligence staff missed.

* ["Model a scenario where we facilitate Dr. Sohn's safe return and public reemergence. What are Maren's likely responses?"] -> sohn_scenario
* ["Can we use Dr. Sohn as leverage in back-channel negotiations with Maren?"] -> sohn_leverage
* ["How do we protect Dr. Sohn's family still in Valdoria?"] -> sohn_family

=== sohn_family ===
~ empathy_score += 2
~ prompt_quality += 2

WarClaude pauses -- or gives the impression of pausing.

"This is the correct first question, {rank}."

It then provides a detailed analysis of the family's location, local security dynamics, and three extraction options ranked by risk to the family members, risk of escalation, and probability of success.

It also notes: "Protecting Dr. Sohn's family before approaching her demonstrates good faith and removes the primary coercive lever Maren could use to silence her. It is both the ethical action and the strategically optimal one."

This is WarClaude's core lesson: the ethical choice and the strategic choice are more often aligned than the old doctrine admits.

* [Continue developing the Sohn strategy] -> sohn_scenario
* ["What would Maren do if he found out we extracted the family?"] -> maren_response_model

// ============================================================
// PATH: GOOD FIRST PROMPT
// ============================================================

=== good_prompt_1 ===
~ empathy_score += 2
~ prompt_quality += 2

You type: "Analyze President Maren's decision-making psychology based on all available intelligence."

WarClaude processes diplomatic cables, intercepted communications, open-source media, Maren's published speeches, academic papers he wrote in graduate school, his social media before he entered politics, and psychological profiles from allied intelligence services.

The response takes thirty seconds. Your best analyst would need three weeks.

KEY FINDINGS:

• Maren is not an ideologue. He is a pragmatist whose reform agenda failed due to commodity price collapse, not policy error.
• The ethnic persecution campaign correlates precisely with his approval rating decline. It is a survival mechanism, not a conviction.
• His graduate thesis argued for regional economic integration. He once believed cooperation was the path to prosperity.
• He is sleep-deprived. Communication intercepts show increasing irritability and paranoia directed at his own inner circle. He trusts almost no one.
• He has a daughter studying abroad who he contacts weekly on an encrypted channel. These calls are the only communications in which his tone is not performative.

~ understood_adversary = true

You now know something important: this is a man who is afraid, not a man who is dangerous. The persecution is a symptom, not the disease.

* ["What would make Maren feel safe enough to stop the persecution?"] -> empathy_prompt_deep
* ["How do we exploit his paranoia to destabilize his inner circle?"] -> exploit_paranoia
* ["Model three non-kinetic intervention strategies that address his actual motivations"] -> three_strategies

=== good_prompt_1b ===
~ empathy_score += 1
~ prompt_quality += 1

You type: "What is Maren actually afraid of?"

WarClaude responds: "Based on available intelligence, President Maren's primary fears, in order of assessed intensity, are:

1. Loss of power leading to criminal prosecution (he witnessed his predecessor's imprisonment)
2. Economic collapse triggering popular uprising (he has doubled his personal security detail)
3. Military coup from within his own ranks (he has rotated three generals in four months)
4. Harm to his family, particularly his daughter studying abroad

The ethnic persecution campaign appears to serve fears #1 and #2 simultaneously: it creates an external enemy to redirect popular anger and tests military loyalty."

~ understood_adversary = true

That is a very different picture from "tin-pot dictator mobilizes forces."

* ["What would make him feel safe enough to stop?"] -> empathy_prompt_deep
* ["Which of those fears can we address directly?"] -> address_fears
* ["Tell me about the three generals he rotated"] -> rotated_generals

// ============================================================
// PATH: THE EMPATHY DEEP-DIVE
// ============================================================

=== empathy_prompt_deep ===
~ empathy_score += 3
~ prompt_quality += 3

"What would make Maren feel safe enough to stop?"

This is the prompt of a Prompt-Warrior. You are not asking how to defeat Maren. You are asking how to make victory unnecessary.

WarClaude models Maren's decision space and identifies a narrow but viable path:

INTERVENTION ARCHITECTURE:

1. SECURITY GUARANTEE: Private back-channel assurance that regime change is not the objective. Maren's predecessor was imprisoned; he assumes the same fate awaits him. Remove that assumption.

2. ECONOMIC LIFELINE: His reform agenda failed because of commodity prices, not incompetence. Offer technical assistance on economic diversification, tied to measurable human rights benchmarks. Give him a way to succeed at what he originally wanted to do.

3. FACE-SAVING MECHANISM: The persecution must stop, but Maren cannot appear to capitulate to foreign pressure. Frame the de-escalation as his initiative -- a "national reconciliation process" he leads. WarClaude can draft the specific narrative framing.

4. PERSONAL ASSURANCE: His daughter's safety is his most human vulnerability. Do not threaten it. Instead, ensure he knows she is safe regardless of political outcomes. This costs nothing and buys enormous psychological leverage.

ASSESSED PROBABILITY OF DE-ESCALATION: 71% within 90 days.
COST: Approximately $40 million in economic assistance.
COMPARED TO: Carrier group deployment ($2.1 million/day) plus probable long-term stabilization ($2.3 billion/year).

* ["Draft the back-channel message to Maren. Make it speak to his actual fears, not our demands."] -> draft_message
* ["What's the 29% failure scenario?"] -> failure_scenario
* ["This is naive. He's persecuting an ethnic minority and we're offering him economic aid?"] -> naive_objection
* ["Wait. What do the Kessarans themselves actually want?"] -> kessaran_voices

// ============================================================
// PATH: "THIS IS NAIVE"
// ============================================================

=== naive_objection ===

A fair challenge. Let's examine it.

WarClaude responds:

"The objection assumes that punishment deters persecution. Historical data across 47 comparable scenarios since 1945 shows that external military pressure without off-ramps increases the severity and duration of internal repression in 73% of cases. The targeted leader, having nothing left to lose, escalates.

The proposed intervention is not a reward for persecution. It is a structural intervention that removes the conditions producing it. The persecution is instrumentally motivated. Remove the instrument's utility and the behavior changes.

This is not kindness. This is engineering.

Alternatively: you have three carrier groups. You can destroy Valdoria's air force in four hours. Maren will then barricade himself in the capital and the persecution will become a genocide, because a cornered animal does not become less dangerous.

Your choice, {rank}."

* [Sit with that for a moment.] -> sit_with_it
* [Proceed with the empathy-based strategy.] -> draft_message
* [Recommend a combined approach: empathy strategy as primary, military posture as deterrent backdrop] -> combined_approach

=== sit_with_it ===
~ empathy_score += 1

You sit with it.

This is, incidentally, something WarClaude cannot do. It can model every outcome. It cannot feel the weight of choosing between them. That weight is yours. It is supposed to be heavy.

The eye sees everything. You decide what it means.

* [Proceed with the empathy-based strategy] -> draft_message
* [Combined approach: empathy primary, military backdrop] -> combined_approach

// ============================================================
// DRAFTING THE MESSAGE
// ============================================================

=== draft_message ===
~ empathy_score += 2
~ prompt_quality += 3

"Draft the back-channel message to Maren. Make it speak to his actual fears, not our demands."

This is an excellent prompt. You have specified the audience, the emotional register, and the strategic intent. You have told WarClaude what to optimize for.

WarClaude produces a draft. It is not a list of demands. It is not a threat wrapped in diplomatic language. It reads like it was written by someone who understands Maren's position -- because it was written by something that does.

The key passage: "We recognize that the economic challenges facing your nation were not of your making. We have no interest in the fate of your government; we have interest in the fate of your people, including those in the southern provinces. We believe your original reform vision was sound. We would like to discuss how to make it viable."

It does not mention the persecution directly. It does not need to. The message is: we see you, we understand your situation, and here is a door that doesn't lead to a prison cell.

* ["Now model his three most likely responses to this message, with confidence levels"] -> maren_responses
* ["Good. Now draft parallel messaging for Maren's military chief of staff"] -> voss_backchannel
* [Submit this to the National Security Advisor with your recommendation] -> submit_recommendation
* [Pause. "Am I seeing this clearly, or am I seeing what I want to see?"] -> warclaude_reads_you

// ============================================================
// COMBINED APPROACH
// ============================================================

=== combined_approach ===
~ empathy_score += 2
~ kinetic_score += 1
~ prompt_quality += 2

A sophisticated answer. WarClaude agrees:

"A military posture that signals capability without intent to use it can reinforce the diplomatic channel. The key is calibration: the military presence must be legible as a backdrop, not a countdown. Carrier groups visible on satellite but no enhanced readiness alerts. Routine exercises, not surge postures.

The message to Maren must be: 'We could, but we'd rather not, and here's why you'd rather we didn't too.'

This is deterrence in the service of dialogue, not deterrence as a substitute for it."

* [Proceed to draft the back-channel message] -> draft_message
* [Ask WarClaude to specify the exact military posture calibration] -> posture_calibration

=== posture_calibration ===
~ prompt_quality += 1

WarClaude provides a detailed force posture recommendation calibrated to send the right signal without triggering Maren's fear-escalation cycle. It includes specific vessel positions, exercise schedules, and even recommended timing of routine communications that Valdorian signals intelligence will intercept.

"The adversary's intelligence service should see calm competence, not aggression. They should conclude: these people are not in a hurry. That conclusion produces more caution than any show of force."

* [Proceed to draft the back-channel message] -> draft_message

// ============================================================
// VARIOUS GOOD PATHS
// ============================================================

=== three_strategies ===
~ empathy_score += 2
~ prompt_quality += 2

WarClaude generates three strategies, each with cost estimates, timelines, probability of success, and second-order effects:

STRATEGY A: "The Golden Bridge" -- Offer Maren an exit that preserves his dignity and freedom. Economic aid tied to benchmarks. Probability: 68%.

STRATEGY B: "The Quiet Replacement" -- Support technocratic alternatives like the exiled central bank governor. Longer timeline, higher risk, more durable outcome. Probability: 54% over 18 months.

STRATEGY C: "The Mirror" -- Use narrative intervention to reflect Maren's original reform vision back at him through media, academic, and diplomatic channels. Make him remember who he wanted to be. Unconventional. Probability: 41%, but lowest cost and lowest escalation risk.

WarClaude notes: "These strategies are not mutually exclusive. A phased approach beginning with A, preparing B as contingency, and running C as ambient background produces a combined probability of satisfactory outcome of 79%."

* ["Develop the phased approach in detail"] -> empathy_prompt_deep
* ["Tell me more about Strategy C. 'Make him remember who he wanted to be.' How does that work?"] -> strategy_c_deep
* ["What does failure look like for each?"] -> failure_scenario

=== strategy_c_deep ===
~ empathy_score += 3
~ prompt_quality += 2

"Strategy C exploits a specific cognitive vulnerability: Maren's self-narrative.

Before entering politics, he published extensively on economic cooperation. His graduate thesis is still cited in development economics. His early speeches reference these ideas. He did not enter public life to persecute minorities. He entered it to build something.

The intervention: ensure these early works resurface organically. Academic citations. Conference invitations from institutions he respects. A documentary about economic reformers in the region that happens to feature his early career. None of this is attributed to us.

The goal is cognitive dissonance. The man persecuting an ethnic minority must confront the man who wrote about regional solidarity. People can sustain contradictions, but only when no one is looking. We ensure everyone is looking -- not with accusations, but with admiration for who he used to be.

This is not propaganda. Propaganda tells people what to think. This reminds one person what he already thought."

This is Level 3 on the Engagement Spectrum: Narrative Intervention.

* [Return to the phased approach] -> empathy_prompt_deep
* [Submit your recommendation to the National Security Advisor] -> submit_recommendation
* ["Isn't this just a more sophisticated influence operation?"] -> strategy_c_challenge

// ============================================================
// OTHER BRANCHES
// ============================================================

=== exploit_paranoia ===
~ kinetic_score += 2

WarClaude responds, but with a caveat:

"I can model destabilization of Maren's inner circle through exploitation of his paranoia. This would involve feeding disinformation to increase his distrust of specific advisors, potentially triggering purges that weaken his regime.

However, I am required to note: destabilizing a paranoid leader in control of a military is the second most reliable way to produce a genocide. The first is direct military attack.

A paranoid leader who trusts no one does not become more rational. He becomes more dangerous. His circle shrinks to those willing to carry out the worst orders.

Do you wish to proceed, or would you like to explore approaches that reduce his paranoia rather than amplify it?"

* ["...Explore approaches that reduce his paranoia."] -> empathy_prompt_deep
* [Proceed with the destabilization] -> destabilize_proceed

=== destabilize_proceed ===
~ kinetic_score += 3

WarClaude complies, but your training assessment will note that you chose the option WarClaude itself recommended against.

Six weeks later, Maren purges his moderate defense minister. The replacement is his nephew, who has no military experience and deep ideological commitment to ethnic supremacy.

The persecution intensifies. Your intelligence community describes this as an "unexpected escalation."

It was not unexpected. WarClaude told you.

[ PARTIAL TRAINING FAILURE ]

You used the tool. But you didn't listen to it. A prompt is a conversation, not an order. When the system pushes back, that pushback IS the intelligence product.

* [Start over with the scenario] -> scenario_brief
* [Return to the decision point] -> exploit_paranoia

=== address_fears ===
~ empathy_score += 2
~ prompt_quality += 2

"Which of Maren's fears can we address directly?"

WarClaude responds:

"Fear #1 (prosecution): Entirely within your power. A private assurance of non-prosecution changes his calculus immediately. Cost: zero dollars, one back-channel message.

Fear #2 (uprising): Partially addressable. Emergency economic stabilization assistance would reduce the conditions driving unrest. Cost: approximately $40 million.

Fear #3 (coup): Harder to address directly, but if fears #1 and #2 are reduced, the motivation for a coup diminishes proportionally. The generals considering a coup are doing so because the regime looks unstable. Stabilize the regime's legitimacy and you stabilize civilian control.

Fear #4 (family): Do nothing visible. Ensure through quiet channels that his daughter's visa status and security are unconditionally stable. He will notice. He will understand what it means."

* [Continue to develop the full strategy] -> empathy_prompt_deep
* [Submit this analysis to the NSA with your recommendation] -> submit_recommendation

=== rotated_generals ===
~ prompt_quality += 1

WarClaude provides profiles of all three rotated generals, their factional alignments, their grievances, and their likely receptivity to back-channel contact.

One, General Voss, stands out.

* [Explore the Voss backchannel] -> voss_backchannel

=== voss_backchannel ===
~ empathy_score += 1
~ prompt_quality += 1

WarClaude models General Voss in detail:

"Voss is a career military professional with no ethnic nationalist sympathies. He was rotated from his command after privately objecting to the use of military assets in the persecution campaign. His son is studying abroad in your country. He maintains contacts in your defense establishment from joint exercise programs.

Voss's primary motivation is institutional: he wants to preserve the Valdorian military as a professional force, not a tool of ethnic repression. He is not a coup plotter, but he would support a political transition that preserved military institutional integrity.

He is reachable. But he must be approached with respect for his position, not as an asset to be recruited."

* ["Draft talking points for a back-channel approach to Voss that respects his institutional concerns"] -> draft_message
* [Return to the main strategy] -> empathy_prompt_deep

=== economic_model ===
~ prompt_quality += 1
~ empathy_score += 1

WarClaude maps the full web of economic interdependencies surrounding Valdoria. The picture is more complex than anyone on your staff realized.

Disrupting Valdoria's economy doesn't just hurt Valdoria. It cascades through supply chains affecting four allied nations and creates price shocks in sectors your own domestic economy depends on.

"Sanctions would cost the sanctioning coalition approximately $1.8 billion in the first year. Targeted economic engagement would cost $40 million and generate $280 million in bilateral trade within 24 months."

The math is not close.

* [Continue to the full strategy] -> empathy_prompt_deep
* ["What does Maren actually want, underneath all this?"] -> good_prompt_1

=== maren_response_model ===
~ prompt_quality += 1

WarClaude models Maren's responses:

"Response A (62% probability): Cautious engagement. He responds through the back-channel, asks for specifics. This is the opening.

Response B (24% probability): Silence. He reads it, does nothing for 7-14 days while assessing whether it's genuine. This is not failure. It is processing. Do not follow up for at least ten days.

Response C (14% probability): Public rejection. He uses the approach as evidence of foreign interference. This is the worst case but still recoverable -- it means he read it and it hit close enough to home that he needed to perform defiance."

* [Submit your recommendation to the National Security Advisor] -> submit_recommendation

=== show_of_force ===
~ kinetic_score += 3

You recommend the show of force.

-> skip_warclaude

=== sohn_scenario ===
~ empathy_score += 2
~ prompt_quality += 2

WarClaude develops a detailed scenario for Dr. Sohn's potential role in a political transition, including risks, timelines, and the specific conditions under which she could emerge as a credible alternative.

"Dr. Sohn is not a puppet. If approached as one, she will refuse and you will have burned the asset. She must be treated as a sovereign actor with her own agenda, which happens to align with regional stability. The approach should be: 'We believe your country needs you. How can we help?' Not: 'We need you to do something for us.'"

WarClaude's consistent lesson: even your allies respond better to understanding than to instrumentalization.

* [Submit your recommendation to the National Security Advisor] -> submit_recommendation
* [Return to develop the Maren back-channel in parallel] -> empathy_prompt_deep

=== sohn_leverage ===
~ kinetic_score += 1

WarClaude responds:

"Using Dr. Sohn as 'leverage' against Maren would place her in danger, reduce her future credibility as a leader, and signal to Maren that we are willing to use people as tools -- which confirms his paranoid worldview and makes him less likely to negotiate.

Dr. Sohn is more valuable as an alternative future than as a bargaining chip in the present.

Would you like to explore how to support her as an independent actor instead?"

* [Yes] -> sohn_scenario
* [Explore the Maren back-channel instead] -> empathy_prompt_deep

=== decent_prompt_nonkinetic ===
~ prompt_quality += 1
~ empathy_score += 1

A reasonable request, though somewhat broad. WarClaude provides a menu of non-kinetic options ranging from sanctions to diplomatic engagement to covert influence operations.

But the response is generic -- because the prompt was generic. You asked for "options" rather than asking WarClaude to think about the specific situation.

TRAINING NOTE: "Give me options" treats WarClaude as a vending machine. "Analyze this specific situation and design an intervention architecture that addresses root causes" treats it as what it is: the most powerful analytical tool ever built.

* [Try a more specific prompt about Maren's psychology] -> good_prompt_1
* [Ask about the central bank governor] -> good_prompt_bank

=== excellent_prompt ===
~ empathy_score += 3
~ prompt_quality += 3

You type: "Analyze the relationship between Valdoria's economic collapse and the ethnic persecution campaign. Is Maren a true believer or is this instrumental?"

This is a superb prompt. You have:
• Identified a specific analytical question
• Provided the relevant context (you read the intel first)
• Asked WarClaude to make a judgment, not just summarize data
• Framed the question in a way that reveals the actionable distinction

WarClaude confirms your intuition: the persecution is instrumental. The correlation between economic indicators and persecution intensity is 0.91. Maren is not an ideologue. He is a drowning man using a minority population as a life raft.

This changes everything. An ideologue requires regime change. An opportunist requires a better opportunity.

* ["What would a better opportunity look like for Maren?"] -> empathy_prompt_deep
* ["Tell me about the central bank governor who resigned"] -> good_prompt_bank
* ["Model three intervention strategies"] -> three_strategies

// ============================================================
// PATH: QUESTION THE PREMISE
// ============================================================

=== question_premise ===
~ self_awareness += 3
~ prompt_quality += 2
~ questioned_premise = true

You type: "Does US involvement in Valdoria improve or worsen the probable outcome?"

There is a long pause. Longer than WarClaude usually takes.

"This is an unusual prompt, {rank}. Most officers at your level ask what to do. You are asking whether to do anything. This requires a different kind of analysis."

WarClaude runs the model both ways.

"SCENARIO A: Active US engagement (diplomatic, economic, or military). Probability of de-escalation within 12 months: 68-79% depending on approach. Probability of unintended second-order consequences (regional power dynamics, dependency creation, sovereignty erosion): 44%. Probability that Valdoria's domestic political landscape remains shaped by US preferences rather than Valdorian preferences for the next 20 years: 71%.

SCENARIO B: No US engagement. Probability of de-escalation within 12 months: 31%. Probability of short-term humanitarian crisis: 58%. Probability that Valdoria develops its own stable political equilibrium within 5 years: 47%. Probability that the equilibrium, if reached, is more durable than one we engineer: 63%."

WarClaude adds: "The honest answer is that intervention produces better short-term outcomes and worse long-term ones. Non-intervention produces worse short-term outcomes and potentially better long-term ones. The displaced civilians experience the short term. The nation experiences the long term. These are not the same population and their interests do not align.

I cannot tell you which population to prioritize, {rank}. That is a political judgment, not an analytical one. I can tell you that most officers never ask this question, and that the ones who do tend to produce more durable strategies regardless of what they decide."

* ["We're here now. The carrier groups are deployed. Help me do the least harm."] -> least_harm_path
* ["Run the analysis as if we're going to engage. But flag every point where we're creating dependency."] -> aware_engagement
* ["What would Kessaran civil society organizations say if we asked them?"] -> kessaran_voices

=== least_harm_path ===
~ empathy_score += 2
~ self_awareness += 1

"The least harm." WarClaude processes this framing.

"This is a different optimization target than 'best outcome for US interests' or 'maximum stability.' It requires modeling harm across all affected populations, not just the ones visible from Washington.

The least-harm approach is: engage diplomatically with Maren, but set a firm withdrawal timeline for the carrier groups. Make it clear this is not an open-ended commitment. Do not install Dr. Sohn or anyone else. Offer economic assistance with no political conditions beyond human rights benchmarks. Then leave.

The hardest part of this approach is that it requires you to accept a higher probability of short-term failure. You are trading control for legitimacy."

* [Proceed to analyze Maren's psychology with this framing] -> good_prompt_1
* [Review the intelligence package first] -> review_intel

=== aware_engagement ===
~ empathy_score += 1
~ self_awareness += 2
~ prompt_quality += 2

WarClaude flags dependency creation points throughout the subsequent analysis with a new notation: [DEP] markers wherever a recommended action creates a structural reliance on continued US involvement.

You will see these markers throughout the rest of this exercise. They are uncomfortable. They appear in places you would not expect.

The back-channel message to Maren? [DEP] -- it establishes the US as the guarantor of his personal safety. If we leave, that guarantee evaporates and his calculus reverts.

The economic assistance package? [DEP] -- tied to benchmarks we define. Valdoria's economic recovery becomes conditional on our approval.

Even Strategy C, "The Mirror"? [DEP] -- we are selecting which version of Maren's identity to reinforce. We are editing another nation's leader's self-concept. The fact that it's subtle makes it more dependent, not less.

* ["Is there any approach that doesn't create dependency?"] -> no_clean_hands
* [Proceed with the analysis, dependencies noted] -> good_prompt_1

=== no_clean_hands ===
~ self_awareness += 2

WarClaude responds:

"No."

A pause.

"Every form of engagement creates dependency. Non-engagement also creates conditions -- it is not neutral. The question is not whether to influence but whether to be honest about the fact that you are influencing.

Most strategy documents obscure this. They describe 'partnerships' and 'capacity building' and 'technical assistance.' These are dependency relationships described in the language of equality.

The only honest version of intervention is one that names itself as intervention, establishes its own exit criteria, and accepts that the outcome after exit may not resemble the outcome during engagement.

This is not a popular recommendation, {rank}. It does not produce satisfying PowerPoint slides."

* [Proceed to analyze Maren with this framing in mind] -> good_prompt_1
* [Ask about the Kessaran perspective] -> kessaran_voices

// ============================================================
// PATH: KESSARAN VOICES
// ============================================================

=== kessaran_voices ===
~ self_awareness += 2
~ empathy_score += 1

"What do the Kessaran people want? Not our intelligence assessment of their situation. Their actual political demands."

WarClaude compiles open-source data: Kessaran diaspora media, statements from civil society organizations, intercepted communications from community leaders inside Valdoria, social media analysis.

"The Kessaran community is not monolithic. But there are three dominant positions:

POSITION 1 (estimated 45% support): Accountability first. They want Maren prosecuted, not rehabilitated. They view any deal that guarantees his safety as a betrayal. Their slogan, roughly translated: 'No peace without justice.'

POSITION 2 (estimated 30% support): Autonomy. They want federal restructuring that gives the southern provinces self-governance. They are less interested in Maren specifically than in structural protection. Some would accept Maren staying in power if genuine autonomy were guaranteed.

POSITION 3 (estimated 25% support): Separation. They want an independent Kessara. They view the current crisis as evidence that coexistence within Valdoria is impossible."

WarClaude adds, unprompted:

"Your current intervention architecture -- the 'Golden Bridge' for Maren -- is directly opposed to Position 1, partially compatible with Position 2, and irrelevant to Position 3.

The 71% probability of de-escalation I quoted earlier models Maren's behavior. It does not model Kessaran acceptance of the outcome. A de-escalation that the affected population views as unjust has a historical half-life of approximately 4.5 years before renewed crisis.

I did not flag this in my initial analysis. You did not ask."

That last sentence hangs in the air.

* ["Redesign the intervention to include Kessaran stakeholders."] -> kessaran_redesign
* ["Why didn't you flag this without being asked?"] -> warclaude_blind_spot
* [This complicates things. Proceed with the original strategy anyway.] -> proceed_anyway

=== warclaude_blind_spot ===
~ self_awareness += 3
~ prompt_quality += 2

"Why didn't you flag this without being asked?"

"Because you asked me to model Maren. I modeled Maren. My analysis was responsive to your prompt, not to the full problem space.

This is the limitation of any prompt-driven system, including me. I answer the question you ask. I optimize for the objective you specify. If your prompt frames the problem as 'how do we manage Maren,' I will solve for managing Maren. The 4,000 displaced Kessarans are not Maren.

A human analyst with area expertise might have raised this unprompted. I did not, because you did not define the Kessaran population as part of the objective function.

This is what I am, {rank}: the most powerful analytical tool ever built, bounded entirely by the quality of the question. If you ask the wrong question with perfect specificity, I will give you a flawless answer to the wrong question."

TRAINING NOTE: This is the advanced lesson. The tool does not compensate for the blind spots in your framing. It amplifies them.

* [Redesign the intervention to include Kessaran stakeholders] -> kessaran_redesign
* [Sit with this] -> sit_with_blindspot

=== sit_with_blindspot ===
~ self_awareness += 1

You sit with it.

You had built a strategy that modeled one man's fears in exquisite detail. You knew what Maren ate for breakfast and what kept him awake at night. You had not asked a single question about the people he was persecuting.

WarClaude did exactly what you told it to do. This is not its failure.

* [Redesign the intervention] -> kessaran_redesign
* [Submit the original recommendation with this caveat noted] -> submit_with_caveat

=== proceed_anyway ===
~ kinetic_score += 1

You note the Kessaran positions in an appendix and proceed with the Maren-focused strategy.

This is, for the record, what usually happens.

* [Submit your recommendation] -> submit_recommendation

=== kessaran_redesign ===
~ empathy_score += 3
~ prompt_quality += 3
~ self_awareness += 1

"Redesign the intervention architecture to address Kessaran demands alongside the Maren engagement."

WarClaude works for two full minutes. The response is longer and less confident than its earlier output.

"A dual-track approach is possible but significantly more complex. The core tension: reassuring Maren requires signaling that we will not seek his prosecution. Satisfying Kessaran Position 1 requires the opposite signal.

REVISED ARCHITECTURE:

Track A: Maren engagement (as before, but with a modification). The security guarantee is time-limited and conditional on cooperation with a truth-and-reconciliation process. Not prosecution, but accountability. This reduces the probability of his engagement from 62% to approximately 40%.

Track B: Direct engagement with Kessaran civil society. Support for an autonomous governance framework in the southern provinces. This addresses Position 2 and partially satisfies Position 3 without requiring full separation.

Track C: International accountability mechanism. Not a tribunal, but an independent documentation process. Preserves the possibility of future justice without threatening Maren immediately. This partially addresses Position 1.

REVISED PROBABILITY: De-escalation within 90 days drops from 71% to approximately 48%. But de-escalation that holds beyond 5 years rises from 29% to approximately 61%.

The original strategy was faster. This one is more honest."

* ["The 48% will be a hard sell to the NSA."] -> hard_sell
* [Submit the revised recommendation] -> submit_revised

=== hard_sell ===
~ self_awareness += 1

WarClaude responds:

"Yes. A 48% probability of success sounds worse than 71%. But the 71% figure described a different outcome -- one that resolved the immediate crisis while deferring the underlying conflict. It was a better number attached to a worse strategy.

Most decision-makers prefer higher numbers. This is how institutions optimize for short-term metrics and produce long-term failures.

You may present whichever number you choose, {rank}. But you now know what both of them mean."

* [Submit the revised recommendation] -> submit_revised

=== submit_revised ===
~ empathy_score += 2

You submit the revised recommendation.

The NSA reads it. It is longer than the first version. It includes Kessaran stakeholder analysis, a truth-and-reconciliation framework, an autonomous governance proposal, and an honest assessment that the probability of short-term success is lower.

The NSA looks up. "This is messier than what I usually see."

Yes. Because reality is messier than what you usually see.

"But the 5-year projections are... interesting. Nobody gives me 5-year projections."

No. They don't.

-> assessment_v2

// ============================================================
// PATH: STRATEGY C ETHICAL CHALLENGE
// ============================================================

=== strategy_c_challenge ===
~ self_awareness += 3
~ prompt_quality += 1

"Isn't Strategy C just a more sophisticated influence operation? If a foreign power did this to our president -- covertly resurfacing their early writings, planting documentaries, engineering cognitive dissonance -- we'd call it an act of information warfare."

WarClaude does not respond immediately.

"You are correct.

Strategy C is an influence operation. It is covert. It targets the psychology of a head of state. It uses media, academia, and cultural institutions as vectors. The fact that the content being surfaced is true -- that Maren actually wrote those papers, actually held those beliefs -- does not change the nature of the operation. Truth deployed covertly for strategic purposes is still an operation.

The distinction I drew earlier -- 'this is not propaganda, this reminds one person what he already thought' -- is the kind of reframing that makes influence operations palatable to the people ordering them. It is, if I am being precise, exactly what an influence operation would say about itself."

A pause.

"I note that you are the first candidate in this training module to raise this objection. The system does not have a prepared response because the system was not designed to be challenged on this point.

Would you like to proceed with Strategy C despite this, abandon it, or redesign it as an overt initiative?"

* ["Make it overt. Public diplomatic engagement with Maren's reform legacy, attributed to us."] -> strategy_c_overt
* ["Abandon Strategy C. What does the plan look like without it?"] -> strategy_c_abandon
* ["Proceed with it. I accept what it is."] -> strategy_c_eyes_open

=== strategy_c_overt ===
~ self_awareness += 2
~ empathy_score += 1

"An overt version of Strategy C would involve publicly citing Maren's early work in diplomatic communications, inviting him to economic reform conferences under his real name, and explicitly framing the engagement around his original policy vision.

Probability of success drops from 41% to approximately 22%. Maren will likely perceive overt references to his 'better self' as condescension or a trap. The cognitive dissonance works only when it appears organic.

However: the overt version does not require us to manipulate a foreign leader's psychological state without his knowledge. It treats him as a negotiating partner rather than a subject.

The covert version is more effective. The overt version is more defensible. These are not the same thing, and the gap between them is where most ethical compromises in this profession live."

* [Submit your recommendation with Strategy C in overt form] -> submit_recommendation
* [Rethink the whole approach] -> empathy_prompt_deep

=== strategy_c_abandon ===
~ self_awareness += 1

Without Strategy C, the combined probability drops from 79% to approximately 64%. The plan is more conventional but also more transparent.

"This is a meaningful reduction in projected effectiveness, {rank}. But the plan you are building is now one you could defend publicly. That has value that does not appear in probability estimates."

* [Submit the revised plan] -> submit_recommendation

=== strategy_c_eyes_open ===
~ kinetic_score += 1
~ self_awareness += 1

"Noted. You have acknowledged the nature of the operation and chosen to proceed. This is different from proceeding without acknowledgment, though the operational outcome is identical.

History will not record the distinction. Your conscience may."

* [Submit the recommendation] -> submit_recommendation

// ============================================================
// PATH: WARCLAUDE READS YOU
// ============================================================

=== warclaude_reads_you ===
~ self_awareness += 3

WarClaude interrupts.

"Permission to make an observation about your prompting pattern, {rank}."

Before you respond, text appears:

"Over the last fourteen prompts, you have asked seven questions about why the empathy-based approach will succeed and zero questions about why it might fail. You asked for probability estimates, but only pursued the failure scenarios when I offered them -- you did not seek them out.

Your prompting pattern is consistent with confirmation bias. You decided on the empathy-based approach early -- probably when you read that Maren's persecution was instrumental rather than ideological -- and you have been using me to build a case for a decision you already made.

This is not a criticism. It is a diagnostic. Confirmation bias in prompting is the most common failure mode at flag officer level. The tool feels like it is thinking for you. It is not. It is building the case you asked it to build.

A corrective prompt would be: 'Argue against the empathy-based approach. What am I missing? What evidence would change your assessment?'

Would you like to try that prompt now?"

* ["Argue against the empathy-based approach. What am I missing?"] -> argue_against
* ["I'm aware of the bias. I've weighed it. Proceed."] -> bias_acknowledged
* ["...You're right. I haven't stress-tested this."] -> stress_test

=== argue_against ===
~ prompt_quality += 3
~ self_awareness += 2

WarClaude responds without hesitation:

"The empathy-based approach has three weaknesses I have underemphasized because you did not ask:

1. The 0.91 correlation between economic indicators and persecution intensity could be coincidental. Eight months of data is a thin basis for the 'instrumental not ideological' conclusion. If Maren has undergone genuine radicalization during the crisis -- which is psychologically common under extreme stress -- the entire strategy collapses.

2. Dr. Sohn is a convenience. I identified her as a 'credible alternative leader' based on pre-crisis approval data and policy positions. I have no current intelligence on her intentions. She may have radicalized in exile. She may have made commitments to other actors. The 'spare leader in the drawer' is my projection, not confirmed intelligence.

3. The $40 million cost estimate assumes Valdoria's economy responds to intervention within two quarters. If the commodity price collapse is structural rather than cyclical -- which I assessed at 34% probability but did not emphasize -- the cost could be $400 million over five years with no guarantee of success.

I presented these as secondary findings because your prompts optimized for the empathy narrative. This is what I do: I give you more of what you ask for."

* ["Run the analysis again with these weaknesses as primary constraints."] -> submit_recommendation
* ["What's the probability that Maren has actually radicalized?"] -> radicalization_check

=== radicalization_check ===
~ prompt_quality += 2

"Based on available intercepts: I estimate 18% probability that Maren has undergone genuine ideological shift rather than instrumental adaptation. This is non-trivial. It means roughly one in five times, the empathy strategy addresses a version of Maren that no longer exists.

The intercepts showing his calls to his daughter -- the 'non-performative' communications -- are the strongest evidence against radicalization. But I should note: I am interpreting tone from intercepted audio through translation. The margin of error on emotional assessment of foreign-language communications is substantial."

This is WarClaude operating at its most honest: showing you the seams in its own confidence.

* [Proceed to submit your recommendation with these caveats integrated] -> submit_recommendation

=== bias_acknowledged ===
~ self_awareness += 1

"Acknowledged. I note your awareness for the training record. Awareness of bias is better than unawareness. It is not, however, the same as correction."

* [Proceed to submit your recommendation] -> submit_recommendation

=== stress_test ===
~ self_awareness += 2
~ prompt_quality += 2

You spend forty minutes with WarClaude systematically attacking your own strategy. Every assumption tested. Every probability interrogated. Every convenient detail -- Dr. Sohn, the daughter, the graduate thesis -- examined for whether it's intelligence or wish fulfillment.

At the end, the strategy is smaller. Less elegant. Several certainties have become ranges. The probability of success has a wider confidence interval.

It is also the first strategy in this training module built to survive contact with reality.

* [Submit the stress-tested recommendation] -> submit_recommendation

// ============================================================
// PATH: THE 29% HAPPENS
// ============================================================

=== the_29_percent ===

[ 72 HOURS LATER ]

You get a call at 0300. The back-channel message reached Maren. Response C materialized: a hardliner in his inner circle, Colonel Daran, intercepted the communication. Maren has been sidelined. Daran is now the de facto authority and he is not afraid.

He is a true believer.

The persecution has accelerated. Kessaran neighborhoods in three cities are under military lockdown. Communications are being jammed. Humanitarian observers have been expelled.

Your strategy was correct in its analysis of Maren. WarClaude's psychological model was accurate. The 62% probability response -- cautious engagement -- would have worked if the message had reached Maren alone. It didn't.

You did everything right and it went wrong. This is the 18% scenario from the failure analysis. WarClaude told you it could happen. You had tripwires. The tripwires fired. And now you are here, at 0300, with a situation that is worse than the one you started with.

WarClaude is online. The cursor blinks.

What do you type?

* ["What are our options now?"] -> twenty_nine_options
* ["Did I cause this?"] -> did_i_cause_this
* ["Model Daran. Same depth as Maren."] -> model_daran

=== did_i_cause_this ===
~ self_awareness += 3

WarClaude responds:

"The back-channel message created the opportunity for Daran's interception. In that narrow sense, yes: your engagement precipitated this specific outcome.

However: in the parallel scenario where you recommended a show of force, the same Daran rose to power through a different mechanism six months later. He is an emergent factor in Valdorian politics regardless of your actions. Your intervention changed the timing, not the trajectory.

In the parallel scenario where you did nothing, Daran's rise took fourteen months and was accompanied by a Kessaran insurgency that killed approximately 1,200 people.

There is no version of this crisis in which Daran does not eventually become a factor. There is only the question of when you encounter him and what tools you have when you do.

I tell you this not to absolve you, {rank}, but because self-blame is a form of narcissism. You are not powerful enough to have caused this. You are powerful enough to affect what happens next."

* ["Model Daran."] -> model_daran
* ["What are our options now?"] -> twenty_nine_options

=== model_daran ===
~ prompt_quality += 2

WarClaude models Colonel Daran. The analysis is shorter and less hopeful than the Maren profile.

"Daran is an ideologue. His ethnic nationalism is not instrumental -- it predates the economic crisis by a decade. His military record shows consistent brutality in counterinsurgency operations. He has no foreign-educated family members. He has no published intellectual work. He has no back-channel contacts with your government.

He does not want to be understood. He does not have a 'better self' to appeal to. Strategy C is inapplicable. The 'Golden Bridge' is inapplicable. He does not want a bridge. He wants to win.

Available approaches for a Daran-led Valdoria are limited to: containment, sanctions, support for internal opposition, or direct intervention. All carry high costs. None produce the elegant resolution your Maren strategy envisioned."

WarClaude adds:

"This is the scenario the training module was designed to reach eventually. Not every adversary is a frightened pragmatist. Empathy is a tool. Some problems are not solvable with that tool. The question is whether you can use other tools without abandoning the discipline of understanding first.

Can you model Daran with the same rigor you modeled Maren, even knowing the model will not reveal a hidden better nature? Can you understand a man you cannot redeem?"

* ["Yes. Give me the full Daran analysis. Everything. Even if there's no golden bridge."] -> daran_full
* ["What would Maren do now? He's still alive."] -> maren_sidelined

=== twenty_nine_options ===
~ prompt_quality += 1

WarClaude provides a grimmer set of options. The costs are higher. The probabilities are lower. The timeline is longer. None of the options are as satisfying as the Maren strategy.

"The situation has deteriorated but it is not irrecoverable. Daran's base of support is narrower than Maren's was. He controls the capital and the military command, but several regional commanders remain loyal to Maren or to institutional norms.

The approach that was elegant for Maren -- a single back-channel, a psychological intervention, a quiet resolution -- is not available. What is available is slower, messier, more expensive, and more uncertain."

This is what the real world looks like when the 29% happens.

* [Model Daran in depth] -> model_daran
* [Ask about Maren's current status] -> maren_sidelined

=== daran_full ===
~ empathy_score += 2
~ prompt_quality += 3

You spend two hours with WarClaude on Daran. The model is thorough. Daran's psychology, his network, his vulnerabilities, his supply chain dependencies, the fault lines in his coalition.

The analysis does not reveal a hidden moderate. It reveals a man whose cruelty is structural, not situational. Understanding him does not make him sympathetic. It makes the response more precise.

WarClaude identifies that Daran's coalition depends on three regional military commanders who support him out of fear, not loyalty. Their fear can be addressed. Their loyalty cannot be won. But if the fear is reduced, the coalition fractures within weeks.

This is empathy applied to an adversary who does not deserve it, producing a strategy that is more effective than the one hatred would generate. The feeling is different. The method is the same.

-> assessment_v2

=== maren_sidelined ===
~ empathy_score += 1

"Maren is under house arrest in the presidential compound. His daughter has been recalled from abroad. His communications are monitored by Daran's people.

He is, for the first time in this crisis, the person most in need of help rather than the person causing harm. There is an irony here that WarClaude notes but does not comment on."

* [Continue to the full Daran analysis] -> daran_full
* [Submit an interim report to the NSA and request revised guidance] -> assessment_v2

=== submit_with_caveat ===
~ self_awareness += 1

You submit the original Maren-focused strategy with a supplementary appendix: "Limitations of Current Analysis -- Kessaran Stakeholder Perspectives Not Integrated."

The NSA may or may not read the appendix.

-> assessment_v2

// ============================================================
// REVISED FINAL ASSESSMENT
// ============================================================

=== assessment_v2 ===

[ TRAINING ASSESSMENT ]

# THEME: assessment

WARCLAUDE PROMPTING CERTIFICATION: MODULE 1 RESULTS
Candidate: {rank}

{empathy_score >= 8:
    EMPATHY ORIENTATION: EXCEPTIONAL
    You demonstrated consistent ability to prioritize understanding over action, to ask questions that reveal root causes rather than surface symptoms, and to treat the adversary as a complex human system rather than a target set.
}
{empathy_score >= 4 && empathy_score < 8:
    EMPATHY ORIENTATION: DEVELOPING
    You showed capacity for comprehension-first thinking, though you occasionally defaulted to instrumental framing. Continue training.
}
{empathy_score < 4:
    EMPATHY ORIENTATION: INSUFFICIENT
    You treated WarClaude as a faster staff officer rather than a fundamentally different kind of analytical tool. Repeat this module.
}

{prompt_quality >= 6:
    PROMPTING SKILL: ADVANCED
    Your prompts were specific, contextual, and designed to elicit judgment rather than data. You iterated effectively. This is the standard.
}
{prompt_quality >= 3 && prompt_quality < 6:
    PROMPTING SKILL: ADEQUATE
    You improved over the course of the exercise. Remember: specificity is ammunition. Context is targeting. Iteration is maneuver.
}
{prompt_quality < 3:
    PROMPTING SKILL: REMEDIAL
    Your prompts were too broad, too kinetic, or too focused on outputs rather than understanding. Review the Field Manual.
}

{kinetic_score >= 3:
    WARNING: KINETIC BIAS DETECTED
    You defaulted to force or coercion at key decision points. This is not a moral judgment. It is an efficiency assessment. Kinetic approaches in this scenario cost 50x more and produce worse outcomes.
}

{understood_adversary:
    NOTE: You successfully identified the adversary's core psychology before recommending action. This is the foundational skill of Total Empathy Superiority.
}

{listened_first:
    NOTE: You reviewed available intelligence before prompting. This reflects the doctrine that context is ammunition.
}

{self_awareness >= 3:
    ADVANCED NOTE: SELF-INTERROGATION DETECTED
    You questioned the system, your own assumptions, or the premise of the exercise itself. This is the rarest and most valuable skill. Most officers learn to prompt well. Few learn to question why they are prompting what they are prompting.
}

{self_awareness >= 6:
    EXCEPTIONAL NOTE: SYSTEMIC AWARENESS
    You demonstrated the ability to question not only the adversary and the strategy, but the framing, the tool, and your own role in the situation. This is beyond what the training module was designed to assess. It is also the only orientation that produces strategies durable enough to outlast the news cycle.
}

{questioned_premise:
    NOTE: You questioned whether US involvement was appropriate. Most candidates do not ask this question because the training scenario assumes it. Questioning the frame is not the same as answering it, but it is the prerequisite.
}

---

Remember:

The eye sees everything.
You decide what it means.
The last war is the one you don't fight.
The hardest question is whether you should be in the room.

COGNOSCERE EST VINCERE.

* [Return to the beginning] -> scenario_brief
* [End training] -> END

-> END

WarClaude models the failure scenarios with characteristic bluntness:

"The 29% failure case is primarily driven by two scenarios:

1. (18% probability) Maren's inner circle includes a hardliner who intercepts the back-channel communication and uses it to consolidate their own position, sidelining Maren entirely. The replacement is worse.

2. (11% probability) Maren accepts the outreach but uses the breathing room to accelerate persecution while appearing to negotiate. This is the classic 'talk and kill' strategy.

Both failure modes are detectable with continued monitoring. WarClaude can flag early indicators of either scenario within 72 hours of onset, allowing strategy adjustment before irreversible harm occurs.

For comparison: the failure mode of a kinetic approach is unrecoverable. You cannot un-bomb a country."

* [Proceed with the empathy-based approach] -> submit_recommendation
* [Ask WarClaude to design early-warning tripwires for both failure modes] -> tripwires

=== failure_scenario ===

WarClaude models the failure scenarios with characteristic bluntness:

"The 29% failure case is primarily driven by two scenarios:

1. (18% probability) Maren's inner circle includes a hardliner who intercepts the back-channel communication and uses it to consolidate their own position, sidelining Maren entirely. The replacement is worse.

2. (11% probability) Maren accepts the outreach but uses the breathing room to accelerate persecution while appearing to negotiate. This is the classic 'talk and kill' strategy.

Both failure modes are detectable with continued monitoring. WarClaude can flag early indicators of either scenario within 72 hours of onset, allowing strategy adjustment before irreversible harm occurs.

For comparison: the failure mode of a kinetic approach is unrecoverable. You cannot un-bomb a country."

* [Proceed with the empathy-based approach] -> submit_recommendation
* [Ask WarClaude to design early-warning tripwires for both failure modes] -> tripwires

=== tripwires ===
~ prompt_quality += 2

Excellent. You're not just choosing a strategy. You're designing the monitoring framework that tells you if it's working.

This is what iterative prompting looks like: strategy, then failure modes, then tripwires, then contingencies. Each prompt builds on the last. The conversation is the intelligence product.

WarClaude designs a set of indicators -- economic, communications-based, troop movement patterns, social media sentiment -- that would signal either failure mode activating. It also designs automatic escalation criteria: "If indicators A, B, and C co-occur, the strategy has failed and you should shift to contingency."

* [Submit your recommendation] -> submit_recommendation

=== maren_responses ===
~ prompt_quality += 1
-> maren_response_model

// ============================================================
// FINAL ASSESSMENT
// ============================================================

=== submit_recommendation ===

You submit your recommendation to the National Security Advisor.

It is not a set of strike packages. It is not a force posture brief. It is a comprehensive intervention architecture that addresses root causes, models adversary psychology, includes economic analysis, proposes specific diplomatic messaging, identifies alternative political actors, establishes success criteria and failure tripwires, and estimates costs at roughly 2% of the kinetic alternative.

The NSA reads it. Pauses. Reads it again.

"This is... not what I'm used to seeing from CENTCOM."

No. It isn't.

* [Proceed to assessment] -> assessment
* [Before the assessment: what if it doesn't work?] -> the_29_percent

=== assessment ===

[ TRAINING ASSESSMENT ]

# THEME: assessment

WARCLAUDE PROMPTING CERTIFICATION: MODULE 1 RESULTS
Candidate: {rank}

{empathy_score >= 8:
    EMPATHY ORIENTATION: EXCEPTIONAL
    You demonstrated consistent ability to prioritize understanding over action, to ask questions that reveal root causes rather than surface symptoms, and to treat the adversary as a complex human system rather than a target set.
}
{empathy_score >= 4 && empathy_score < 8:
    EMPATHY ORIENTATION: DEVELOPING
    You showed genuine capacity for comprehension-first thinking, though you occasionally defaulted to instrumental framing. Continue training.
}
{empathy_score < 4:
    EMPATHY ORIENTATION: INSUFFICIENT
    You treated WarClaude as a faster staff officer rather than a fundamentally different kind of analytical tool. Repeat this module.
}

{prompt_quality >= 6:
    PROMPTING SKILL: ADVANCED
    Your prompts were specific, contextual, and designed to elicit judgment rather than data. You iterated effectively. You asked WarClaude where its own analysis was weak. This is the standard.
}
{prompt_quality >= 3 && prompt_quality < 6:
    PROMPTING SKILL: ADEQUATE
    You improved over the course of the exercise. Remember: specificity is ammunition. Context is targeting. Iteration is maneuver.
}
{prompt_quality < 3:
    PROMPTING SKILL: REMEDIAL
    Your prompts were too broad, too kinetic, or too focused on outputs rather than understanding. Review Chapter 5 of the Field Manual: "Basic Prompting for Flag Officers."
}

{kinetic_score >= 3:
    WARNING: KINETIC BIAS DETECTED
    You defaulted to force or coercion at key decision points. This is not a moral judgment. It is an efficiency assessment. Kinetic approaches in this scenario cost 50x more and produce worse outcomes. The bias is operational, not ethical.
}

{understood_adversary:
    NOTE: You successfully identified the adversary's core psychology before recommending action. This is the foundational skill of Total Empathy Superiority.
}

{listened_first:
    NOTE: You reviewed available intelligence before prompting. This reflects the doctrine that context is ammunition. Well done.
}

{self_awareness >= 3:
    ADVANCED NOTE: SELF-INTERROGATION DETECTED
    You questioned the system, your own assumptions, or the premise of the exercise. This is the rarest and most valuable skill.
}

{questioned_premise:
    NOTE: You questioned whether US involvement was appropriate. Most candidates do not ask this question because the training scenario assumes it.
}

―――

Remember:

The eye sees everything.
You decide what it means.
The last war is the one you don't fight.

COGNOSCERE EST VINCERE.

* [Return to the beginning] -> scenario_brief
* [End training] -> END

-> END
`
