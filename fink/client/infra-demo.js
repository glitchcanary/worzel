// ═══════════════════════════════════════════════════════════
//  SVG Scene Art (vibe-drawn replacements for real images)
// ═══════════════════════════════════════════════════════════

const SVG = {
  garden_gate: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="sky1" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1a1a3e"/>
        <stop offset="100%" stop-color="#2a2848"/>
      </linearGradient>
    </defs>
    <rect fill="url(#sky1)" width="400" height="200"/>
    <circle cx="340" cy="30" r="14" fill="#e8e4c8" opacity="0.8"/>
    <!-- stars -->
    <circle cx="50" cy="20" r="1" fill="#fff" opacity="0.6"/>
    <circle cx="120" cy="45" r="1.2" fill="#fff" opacity="0.5"/>
    <circle cx="200" cy="15" r="1" fill="#fff" opacity="0.7"/>
    <circle cx="280" cy="35" r="0.8" fill="#fff" opacity="0.4"/>
    <!-- ground -->
    <path d="M0 160 Q100 150 200 155 Q300 160 400 150 L400 200 L0 200Z" fill="#1a2a1a"/>
    <!-- gate posts -->
    <rect x="155" y="80" width="8" height="90" fill="#3a3a3a" rx="2"/>
    <rect x="237" y="80" width="8" height="90" fill="#3a3a3a" rx="2"/>
    <!-- gate bars -->
    <line x1="163" y1="85" x2="237" y2="85" stroke="#4a4a4a" stroke-width="3"/>
    <line x1="163" y1="165" x2="237" y2="165" stroke="#4a4a4a" stroke-width="3"/>
    <line x1="175" y1="85" x2="175" y2="165" stroke="#4a4a4a" stroke-width="2"/>
    <line x1="190" y1="85" x2="190" y2="165" stroke="#4a4a4a" stroke-width="2"/>
    <line x1="200" y1="85" x2="200" y2="165" stroke="#4a4a4a" stroke-width="2"/>
    <line x1="210" y1="85" x2="210" y2="165" stroke="#4a4a4a" stroke-width="2"/>
    <line x1="225" y1="85" x2="225" y2="165" stroke="#4a4a4a" stroke-width="2"/>
    <!-- gate arch -->
    <path d="M155 85 Q200 55 245 85" fill="none" stroke="#4a4a4a" stroke-width="3"/>
    <!-- ivy -->
    <circle cx="152" cy="100" r="5" fill="#2a5a2a" opacity="0.7"/>
    <circle cx="148" cy="110" r="6" fill="#2a6a2a" opacity="0.6"/>
    <circle cx="155" cy="120" r="4" fill="#3a6a3a" opacity="0.7"/>
    <circle cx="245" cy="95" r="5" fill="#2a5a2a" opacity="0.7"/>
    <circle cx="248" cy="108" r="6" fill="#2a6a2a" opacity="0.6"/>
    <circle cx="243" cy="118" r="4" fill="#3a6a3a" opacity="0.8"/>
    <!-- path beyond -->
    <path d="M180 165 Q200 150 220 165" fill="#1a3a1a" opacity="0.5"/>
    <!-- distant trees -->
    <ellipse cx="100" cy="140" rx="30" ry="35" fill="#1a3a1a" opacity="0.5"/>
    <ellipse cx="300" cy="135" rx="35" ry="38" fill="#1a3a1a" opacity="0.5"/>
    <!-- glowing flowers -->
    <circle cx="130" cy="165" r="2" fill="#a0d8a0" opacity="0.6"/>
    <circle cx="270" cy="162" r="2" fill="#a0c8d0" opacity="0.5"/>
    <circle cx="145" cy="170" r="1.5" fill="#d0a0d0" opacity="0.5"/>
  </svg>`,

  garden_deep: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <rect fill="#1a1a2e" width="400" height="200"/>
    <!-- oak tree -->
    <rect x="195" y="100" width="12" height="70" fill="#3a2a1a" rx="3"/>
    <ellipse cx="200" cy="85" rx="65" ry="50" fill="#1a3a1a" opacity="0.7"/>
    <ellipse cx="185" cy="80" rx="40" ry="35" fill="#2a4a2a" opacity="0.6"/>
    <ellipse cx="220" cy="78" rx="35" ry="30" fill="#1a4a2a" opacity="0.5"/>
    <!-- bench -->
    <rect x="160" y="155" width="80" height="6" fill="#5a4a3a" rx="2"/>
    <rect x="165" y="161" width="5" height="10" fill="#5a4a3a"/>
    <rect x="230" y="161" width="5" height="10" fill="#5a4a3a"/>
    <!-- cat silhouette on bench -->
    <ellipse cx="210" cy="148" rx="10" ry="7" fill="#2a2a3a"/>
    <circle cx="215" cy="142" r="6" fill="#2a2a3a"/>
    <path d="M211 136 L213 140 L215 136" fill="#2a2a3a"/>
    <path d="M215 136 L217 140 L219 136" fill="#2a2a3a"/>
    <!-- cat eyes -->
    <circle cx="213" cy="141" r="1.5" fill="#40d860"/>
    <circle cx="217" cy="141" r="1.5" fill="#40d860"/>
    <!-- tail -->
    <path d="M200 152 Q188 145 192 135" fill="none" stroke="#2a2a3a" stroke-width="3" stroke-linecap="round"/>
    <!-- ground -->
    <path d="M0 170 Q200 165 400 170 L400 200 L0 200Z" fill="#1a2a1a"/>
    <!-- glowing flowers -->
    <circle cx="100" cy="175" r="3" fill="#d0a0ff" opacity="0.4"/>
    <circle cx="120" cy="178" r="2" fill="#a0d0ff" opacity="0.5"/>
    <circle cx="290" cy="173" r="3" fill="#ffd0a0" opacity="0.4"/>
    <circle cx="310" cy="177" r="2" fill="#a0ffd0" opacity="0.5"/>
    <circle cx="80" cy="180" r="2" fill="#ffa0d0" opacity="0.3"/>
    <!-- stars -->
    <circle cx="60" cy="25" r="1.2" fill="#fff" opacity="0.6"/>
    <circle cx="150" cy="15" r="1" fill="#fff" opacity="0.5"/>
    <circle cx="300" cy="20" r="1.3" fill="#fff" opacity="0.7"/>
    <circle cx="350" cy="40" r="0.8" fill="#fff" opacity="0.4"/>
  </svg>`,

  garden_flowers: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <rect fill="#1a1a2e" width="400" height="200"/>
    <path d="M0 140 Q200 130 400 140 L400 200 L0 200Z" fill="#1a2a1a"/>
    <!-- big glowing flowers -->
    <g transform="translate(100,130)">
      <line x1="0" y1="0" x2="0" y2="30" stroke="#2a5a2a" stroke-width="2"/>
      <circle cx="0" cy="-5" r="8" fill="#d0a0ff" opacity="0.5"/>
      <circle cx="0" cy="-5" r="4" fill="#e0c0ff" opacity="0.7"/>
    </g>
    <g transform="translate(160,125)">
      <line x1="0" y1="0" x2="0" y2="35" stroke="#2a5a2a" stroke-width="2"/>
      <circle cx="0" cy="-5" r="10" fill="#a0d0ff" opacity="0.4"/>
      <circle cx="0" cy="-5" r="5" fill="#c0e0ff" opacity="0.6"/>
    </g>
    <g transform="translate(230,128)">
      <line x1="0" y1="0" x2="0" y2="32" stroke="#2a5a2a" stroke-width="2"/>
      <circle cx="0" cy="-5" r="9" fill="#ffd0a0" opacity="0.4"/>
      <circle cx="0" cy="-5" r="4" fill="#ffe0c0" opacity="0.6"/>
    </g>
    <g transform="translate(300,132)">
      <line x1="0" y1="0" x2="0" y2="28" stroke="#2a5a2a" stroke-width="2"/>
      <circle cx="0" cy="-5" r="7" fill="#a0ffd0" opacity="0.5"/>
      <circle cx="0" cy="-5" r="3" fill="#c0ffe0" opacity="0.7"/>
    </g>
    <!-- small ground flowers -->
    <circle cx="60" cy="155" r="2" fill="#ff80c0" opacity="0.4"/>
    <circle cx="340" cy="150" r="2" fill="#80c0ff" opacity="0.4"/>
    <circle cx="200" cy="158" r="1.5" fill="#c0ff80" opacity="0.5"/>
    <text x="200" y="95" text-anchor="middle" font-size="11" fill="#5a6080" font-style="italic" font-family="Georgia">No species you recognise.</text>
  </svg>`,

  circus_wagon: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <rect fill="#1a1510" width="400" height="200"/>
    <!-- ground mud -->
    <path d="M0 160 Q100 155 200 158 Q300 161 400 155 L400 200 L0 200Z" fill="#2a2218"/>
    <!-- wagon body -->
    <rect x="100" y="70" width="200" height="85" fill="#3a2a1a" rx="3"/>
    <rect x="95" y="65" width="210" height="10" fill="#4a3a2a" rx="2"/>
    <!-- window glow -->
    <rect x="150" y="85" width="40" height="30" fill="#4a3a20" rx="2"/>
    <rect x="152" y="87" width="36" height="26" fill="#6a5a30" opacity="0.6" rx="1"/>
    <rect x="220" y="85" width="40" height="30" fill="#4a3a20" rx="2"/>
    <rect x="222" y="87" width="36" height="26" fill="#6a5a30" opacity="0.5" rx="1"/>
    <!-- wheels -->
    <circle cx="140" cy="158" r="18" fill="none" stroke="#4a3a2a" stroke-width="4"/>
    <circle cx="140" cy="158" r="3" fill="#4a3a2a"/>
    <circle cx="260" cy="158" r="18" fill="none" stroke="#4a3a2a" stroke-width="4"/>
    <circle cx="260" cy="158" r="3" fill="#4a3a2a"/>
    <!-- steps -->
    <rect x="295" y="140" width="20" height="6" fill="#3a2a1a"/>
    <rect x="300" y="150" width="20" height="6" fill="#3a2a1a"/>
    <!-- door -->
    <rect x="285" y="90" width="15" height="60" fill="#2a1a10" rx="1"/>
    <circle cx="296" cy="120" r="2" fill="#8a7a5a"/>
    <!-- lantern -->
    <rect x="96" y="58" width="6" height="8" fill="#6a5a40" rx="1"/>
    <circle cx="99" cy="55" r="4" fill="#c0a040" opacity="0.6"/>
    <circle cx="99" cy="55" r="8" fill="#c0a040" opacity="0.15"/>
    <!-- distant tent -->
    <path d="M350 100 L370 160 L330 160 Z" fill="#2a2018" opacity="0.6"/>
    <line x1="350" y1="95" x2="350" y2="100" stroke="#4a3a2a" stroke-width="2"/>
    <!-- ruts -->
    <path d="M0 175 Q100 172 200 175 Q300 178 400 174" fill="none" stroke="#352a1a" stroke-width="2" opacity="0.5"/>
    <path d="M0 185 Q150 182 300 186 Q350 188 400 184" fill="none" stroke="#352a1a" stroke-width="2" opacity="0.4"/>
  </svg>`,

  circus_desk: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <rect fill="#2a2018" width="400" height="200"/>
    <!-- desk surface -->
    <path d="M50 110 L350 110 L370 200 L30 200Z" fill="#3a2a1a"/>
    <rect x="60" y="108" width="280" height="5" fill="#4a3a2a" rx="1"/>
    <!-- lamp -->
    <rect x="290" y="60" width="4" height="50" fill="#5a4a3a"/>
    <ellipse cx="292" cy="55" rx="18" ry="10" fill="#4a3a20"/>
    <circle cx="292" cy="52" r="6" fill="#c0a040" opacity="0.8"/>
    <circle cx="292" cy="52" r="20" fill="#c0a040" opacity="0.08"/>
    <!-- note -->
    <rect x="120" y="115" width="50" height="35" fill="#c8c0a0" rx="1" transform="rotate(-5 145 132)"/>
    <line x1="127" y1="123" x2="163" y2="121" stroke="#4a4030" stroke-width="1" opacity="0.5"/>
    <line x1="128" y1="130" x2="160" y2="128" stroke="#4a4030" stroke-width="1" opacity="0.5"/>
    <line x1="129" y1="137" x2="155" y2="135" stroke="#4a4030" stroke-width="1" opacity="0.4"/>
    <!-- photo -->
    <rect x="200" y="118" width="30" height="38" fill="#d8d0c0" rx="1" transform="rotate(3 215 137)"/>
    <rect x="204" y="122" width="22" height="26" fill="#8a7a6a" rx="1" transform="rotate(3 215 135)"/>
    <!-- ticket stubs -->
    <rect x="85" y="120" width="20" height="10" fill="#b85050" opacity="0.6" rx="1" transform="rotate(-12 95 125)"/>
    <rect x="90" y="125" width="20" height="10" fill="#b87050" opacity="0.5" rx="1" transform="rotate(5 100 130)"/>
    <!-- ledger -->
    <rect x="260" y="115" width="40" height="55" fill="#4a3a2a" rx="2"/>
    <rect x="263" y="118" width="34" height="49" fill="#c8c0a0" rx="1"/>
    <!-- canvas wall texture -->
    <line x1="0" y1="0" x2="0" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="40" y1="0" x2="40" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="80" y1="0" x2="80" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="120" y1="0" x2="120" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.2"/>
    <line x1="160" y1="0" x2="160" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="200" y1="0" x2="200" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.2"/>
    <line x1="240" y1="0" x2="240" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="280" y1="0" x2="280" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="320" y1="0" x2="320" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.2"/>
    <line x1="360" y1="0" x2="360" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
    <line x1="400" y1="0" x2="400" y2="110" stroke="#3a3028" stroke-width="1" opacity="0.3"/>
  </svg>`,

  circus_yard: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <rect fill="#1a1510" width="400" height="200"/>
    <!-- night sky -->
    <circle cx="50" cy="25" r="1" fill="#fff" opacity="0.4"/>
    <circle cx="180" cy="15" r="0.8" fill="#fff" opacity="0.5"/>
    <circle cx="350" cy="30" r="1.2" fill="#fff" opacity="0.3"/>
    <!-- big top silhouette -->
    <path d="M120 50 L200 10 L280 50 L290 150 L110 150Z" fill="#2a2018" opacity="0.6"/>
    <line x1="200" y1="5" x2="200" y2="10" stroke="#4a3a2a" stroke-width="2"/>
    <!-- flag -->
    <path d="M200 5 L215 10 L200 15" fill="#6a3030" opacity="0.5"/>
    <!-- smaller tent -->
    <path d="M320 80 L350 50 L380 80 L385 150 L315 150Z" fill="#2a2018" opacity="0.5"/>
    <!-- wagon silhouettes -->
    <rect x="30" y="120" width="60" height="30" fill="#2a2018" rx="2"/>
    <circle cx="45" cy="152" r="8" fill="none" stroke="#2a2018" stroke-width="3"/>
    <circle cx="80" cy="152" r="8" fill="none" stroke="#2a2018" stroke-width="3"/>
    <!-- ground -->
    <path d="M0 155 Q200 150 400 155 L400 200 L0 200Z" fill="#2a2218"/>
    <!-- lantern glow -->
    <circle cx="200" cy="140" r="4" fill="#c0a040" opacity="0.7"/>
    <circle cx="200" cy="140" r="15" fill="#c0a040" opacity="0.1"/>
    <circle cx="200" cy="140" r="30" fill="#c0a040" opacity="0.05"/>
    <!-- ruts -->
    <path d="M0 170 Q100 168 200 172 Q300 176 400 170" fill="none" stroke="#352a1a" stroke-width="2" opacity="0.4"/>
  </svg>`,

  garden_secret: `<svg viewBox="0 0 400 200" xmlns="http://www.w3.org/2000/svg">
    <rect fill="#10101e" width="400" height="200"/>
    <path d="M0 150 Q200 140 400 150 L400 200 L0 200Z" fill="#1a2a1a"/>
    <!-- burning star-flowers -->
    <g transform="translate(80,120)">
      <circle r="12" fill="#ffd080" opacity="0.2"/>
      <circle r="6" fill="#ffd080" opacity="0.4"/>
      <circle r="3" fill="#fff0c0" opacity="0.8"/>
    </g>
    <g transform="translate(150,110)">
      <circle r="10" fill="#d0a0ff" opacity="0.2"/>
      <circle r="5" fill="#d0a0ff" opacity="0.4"/>
      <circle r="2.5" fill="#e8c8ff" opacity="0.8"/>
    </g>
    <g transform="translate(220,125)">
      <circle r="14" fill="#80d0ff" opacity="0.2"/>
      <circle r="7" fill="#80d0ff" opacity="0.3"/>
      <circle r="3" fill="#c0e8ff" opacity="0.8"/>
    </g>
    <g transform="translate(290,115)">
      <circle r="11" fill="#ff80a0" opacity="0.2"/>
      <circle r="5" fill="#ff80a0" opacity="0.4"/>
      <circle r="2.5" fill="#ffc0d0" opacity="0.8"/>
    </g>
    <g transform="translate(350,130)">
      <circle r="9" fill="#a0ffa0" opacity="0.2"/>
      <circle r="4" fill="#a0ffa0" opacity="0.4"/>
      <circle r="2" fill="#d0ffd0" opacity="0.8"/>
    </g>
    <!-- cat silhouette leading -->
    <ellipse cx="180" cy="148" rx="8" ry="5" fill="#1a1a2a"/>
    <circle cx="184" cy="143" r="4.5" fill="#1a1a2a"/>
    <path d="M181 139 L182.5 142 L184 139" fill="#1a1a2a"/>
    <path d="M184 139 L185.5 142 L187 139" fill="#1a1a2a"/>
    <circle cx="183" cy="142.5" r="1" fill="#40d860"/>
    <circle cx="186" cy="142.5" r="1" fill="#40d860"/>
  </svg>`,

  // Character avatars
  avatar_narrator: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="20" fill="#232838"/>
    <circle cx="20" cy="15" r="8" fill="#5a6080"/>
    <path d="M6 36 Q20 24 34 36" fill="#5a6080"/>
  </svg>`,

  avatar_cat: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="20" fill="#1a2a1a"/>
    <circle cx="20" cy="20" r="10" fill="#2a3a2a"/>
    <path d="M14 12 L16 18 L18 12" fill="#2a3a2a"/>
    <path d="M22 12 L24 18 L26 12" fill="#2a3a2a"/>
    <circle cx="17" cy="19" r="2" fill="#40d860"/>
    <circle cx="23" cy="19" r="2" fill="#40d860"/>
    <path d="M18 23 Q20 25 22 23" fill="none" stroke="#4a6a4a" stroke-width="1"/>
  </svg>`,

  avatar_carney: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="20" fill="#2a2018"/>
    <circle cx="20" cy="17" r="8" fill="#5a4a3a"/>
    <rect x="12" y="8" width="16" height="8" fill="#3a2a1a" rx="2"/>
    <path d="M8 36 Q20 26 32 36" fill="#5a4a3a"/>
    <rect x="16" y="22" width="8" height="2" fill="#3a2a1a" rx="1"/>
  </svg>`,

  // TOC icon
  avatar_toc: `<svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <circle cx="20" cy="20" r="20" fill="#1a1a2e"/>
    <rect x="10" y="10" width="20" height="3" fill="#c97040" rx="1"/>
    <rect x="10" y="17" width="16" height="2" fill="#5a6080" rx="1"/>
    <rect x="10" y="23" width="18" height="2" fill="#5a6080" rx="1"/>
    <rect x="10" y="29" width="14" height="2" fill="#5a6080" rx="1"/>
  </svg>`
};


// ═══════════════════════════════════════════════════════════
//  Baked-in Story Content
// ═══════════════════════════════════════════════════════════

const STORIES = {
  garden: {
    title: "The Enchanted Garden",
    startKnot: "menu",
    voices: {
      narrator: { name: "Narrator", desc: "Warm storybook narrator", traits: ["clear","gentle","inviting"], providers: {openai:"alloy", elevenlabs:"JBFqnCBsd6RMkjVDRZzb", edge:"en-US-AriaNeural"}, avatar: "avatar_narrator" },
      cat: { name: "Mr Whiskers", desc: "Talking cat with playful mystery", traits: ["playful","mysterious","light"], providers: {openai:"shimmer", elevenlabs:"pFZP5JQG7iQjIQuC4Bku", edge:"en-GB-SoniaNeural"}, avatar: "avatar_cat" }
    },
    vars: { lantern_lit: false, courage: 0 },
    knots: {
      menu: {
        speaker: "narrator", mood: null,
        scene: "garden_gate",
        media: [],
        paragraphs: ["Welcome to The Enchanted Garden. A short interactive story you can navigate by voice, or by tapping choices."],
        choices: [
          { text: "Begin the story", target: "start", tags: {}, voice_hint: "start, begin, play" },
          { text: "About this demo", target: "about", tags: {}, voice_hint: "about, info" }
        ],
        teasers: []
      },
      about: {
        speaker: "narrator", mood: null,
        scene: "garden_gate",
        media: [],
        paragraphs: ["This is Fink, a voice-navigated interactive fiction demo. Speak naturally to pick choices, ask about the world, or just chat with characters. Your words are matched to story choices using AI."],
        choices: [
          { text: "Begin the story", target: "start", tags: {} },
          { text: "Back to menu", target: "menu", tags: {} }
        ],
        teasers: []
      },
      start: {
        speaker: "narrator", mood: null,
        scene: "garden_gate",
        media: [
          { type: "image", alt: "An iron gate half-hidden by ivy", position: "inline" },
          { type: "audio", role: "ambient", url: "ambient-garden.mp3", loop: true }
        ],
        onEnter(vars) { vars.courage++; },
        paragraphs: ["You stand before an iron gate, half-hidden by ivy. Beyond it, a garden stretches into twilight."],
        choices: [
          { text: "Push open the gate", target: "garden_enter", tags: { mood: "tense" }, voice_hint: "open gate, push" },
          { text: "Call out", target: "garden_call", tags: {}, voice_hint: "hello, call out" },
          { text: "Turn back", target: "ending_leave", tags: { risk: "low" }, voice_hint: "leave, go back" }
        ],
        teasers: []
      },
      garden_enter: {
        speaker: "narrator", mood: null,
        scene: "garden_gate",
        media: [{ type: "foley", name: "gate-creak", position: "inline" }],
        paragraphs: ["The gate swings open with a groan."],
        choices: [{ text: "Continue", target: "garden", tags: {} }],
        teasers: []
      },
      garden_call: {
        speaker: "narrator", mood: null,
        scene: "garden_gate",
        paragraphs: ['"Hello?" you call. Only the wind answers.'],
        media: [{ type: "foley", name: "wind-whisper" }],
        choices: [{ text: "Continue", target: "garden", tags: {} }],
        teasers: []
      },
      garden: {
        speaker: "narrator", mood: null,
        scene: "garden_gate",
        media: [{ type: "audio", role: "ambient", url: "ambient-garden.mp3", loop: true }],
        paragraphs(vars) {
          return vars.lantern_lit
            ? ["Warm amber light from your lantern reveals the path ahead."]
            : ["The garden is dark. Shapes move at the edges of your vision."];
        },
        choices(vars) {
          const c = [
            { text: "Go deeper", target: "deep_garden", tags: { mood: "tense" }, voice_hint: "go deeper, explore" },
            { text: "Examine the flowers", target: "flowers", tags: { mood: "mysterious" }, voice_hint: "flowers, look" }
          ];
          if (!vars.lantern_lit) {
            c.unshift({ text: "Light the lantern", target: "light_lantern", tags: { mood: "calm" }, voice_hint: "light, lantern" });
          }
          return c;
        },
        teasers: []
      },
      light_lantern: {
        speaker: "narrator", mood: "calm",
        scene: "garden_gate",
        media: [{ type: "foley", name: "match-strike" }],
        onEnter(vars) { vars.lantern_lit = true; },
        paragraphs: ["You find an old lantern on a post and strike a match."],
        choices: [{ text: "Continue", target: "garden", tags: {} }],
        teasers: []
      },
      flowers: {
        speaker: "narrator", mood: "mysterious",
        scene: "garden_flowers",
        media: [{ type: "image", alt: "Strange glowing flowers of no known species", position: "inline" }],
        paragraphs: ["The flowers glow faintly. They are no species you recognise."],
        choices: [{ text: "Go back", target: "garden", tags: {} }],
        teasers: []
      },
      deep_garden: {
        speaker: "narrator", mood: null,
        scene: "garden_deep",
        media: [{ type: "image", alt: "Stone bench beneath an ancient oak, a cat watching", position: "inline" }],
        onEnter(vars) { vars.courage++; },
        paragraphs: ["A stone bench beneath an ancient oak. A cat sits watching you with luminous green eyes."],
        choices: [
          { text: "Hello, cat", target: "talk_cat", tags: { mood: "curious" }, voice_hint: "hello cat, hi" },
          { text: "Sit on the bench", target: "sit_quietly", tags: { mood: "calm" }, voice_hint: "sit, bench" },
          { text: "Go back", target: "garden", tags: {} }
        ],
        teasers: [{ teaser: "Something glints in the undergrowth nearby..." }]
      },
      talk_cat: {
        speaker: "cat", mood: "curious",
        scene: "garden_deep",
        media: [],
        paragraphs(vars) {
          return vars.courage >= 2
            ? ['"You have some nerve, coming this deep," it says. "I like that."']
            : ['The cat yawns. "Come back when you\'ve seen more of the garden."'];
        },
        choices(vars) {
          if (vars.courage < 2) return [{ text: "Go back", target: "garden", tags: {} }];
          return [
            { text: "Ask its name", target: "ending_friendship", tags: { skill: "charm" } },
            { text: "Ask about the garden", target: "ending_secret", tags: { mood: "mysterious", skill: "perception" } }
          ];
        },
        teasers: []
      },
      sit_quietly: {
        speaker: "narrator", mood: "peaceful",
        scene: "garden_deep",
        media: [{ type: "audio", role: "ambient", url: "ambient-garden-night.mp3", loop: true }],
        paragraphs: ["You sit. The cat descends and curls up beside you. The garden hums softly."],
        choices: [{ text: "Continue", target: "ending_peaceful", tags: {} }],
        teasers: []
      },
      ending_leave: {
        speaker: "narrator", mood: "mysterious",
        scene: "garden_gate",
        media: [],
        paragraphs: ["You turn away. Some gardens are not meant to be entered.", "The gate disappears behind you. By morning, you will have forgotten it was there."],
        choices: [
          { text: "Play again", target: "menu", tags: {}, onChoose(vars) { vars.lantern_lit = false; vars.courage = 0; } },
          { text: "Back to Stories", target: "_switch_toc", tags: {} }
        ],
        teasers: []
      },
      ending_peaceful: {
        speaker: "narrator", mood: "peaceful",
        scene: "garden_secret",
        media: [{ type: "audio", role: "ambient", url: "ambient-night-crickets.mp3", loop: true }],
        paragraphs: ["You sit together as the stars come out, one by one.", "That's the end of this path through the garden. Thank you for playing."],
        choices: [
          { text: "Play again", target: "menu", tags: {}, onChoose(vars) { vars.lantern_lit = false; vars.courage = 0; } },
          { text: "Back to Stories", target: "_switch_toc", tags: {} }
        ],
        teasers: []
      },
      ending_friendship: {
        speaker: "cat", mood: "warm",
        scene: "garden_deep",
        media: [],
        paragraphs: ['"They call me Mr Whiskers," the cat says. "And you?"', 'The cat purrs. "Well then, stranger. Welcome to the garden."', "And so begins a most unusual friendship."],
        choices: [
          { text: "Play again", target: "menu", tags: {}, onChoose(vars) { vars.lantern_lit = false; vars.courage = 0; } },
          { text: "Back to Stories", target: "_switch_toc", tags: {} }
        ],
        teasers: []
      },
      ending_secret: {
        speaker: "narrator", mood: "mysterious",
        scene: "garden_secret",
        media: [{ type: "image", alt: "Flowers burning like tiny stars in a hidden corner", position: "inline" }],
        paragraphs: ["The cat leads you to a hidden corner where the flowers burn like tiny stars.", '"Few are shown this," it whispers. "Remember it."'],
        choices: [
          { text: "Play again", target: "menu", tags: {}, onChoose(vars) { vars.lantern_lit = false; vars.courage = 0; } },
          { text: "Back to Stories", target: "_switch_toc", tags: {} }
        ],
        teasers: []
      }
    }
  },

  bigtop: {
    title: "Bigtop Briefing",
    startKnot: "office_wagon",
    voices: {
      narrator: { name: "Barney the Carny", desc: "Noir circus proprietor, worn authority, theatrical edges", traits: ["deep","raspy","world-weary","showman"], providers: {openai:"ballad", elevenlabs:"wG54O0fjDbPBYb9MFXCb", edge:"en-US-AndrewNeural"}, avatar: "avatar_carney" }
    },
    vars: { saw_photo: false, read_note: false, asked_whisper: false, distrust_boss: 0, case_accepted: false },
    knots: {
      office_wagon: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        vizprom: "cramped circus office wagon at night, ledger books, cheap lamp, damp wood walls, anxious impresario, detective in a chair, noir carnival mood",
        media: [
          { type: "image", alt: "Cramped circus office wagon at night", position: "background" },
          { type: "audio", role: "ambient", url: "ambient-circus-night.mp3", loop: true }
        ],
        paragraphs: [
          "The wagon rocks once in the wind.",
          'The proprietor leans over the desk.',
          '"Detective. Brief version."',
          '"The gate was bad. The crowd was worse. Then my daughter vanished."',
          '"I need her back before this circus tears itself apart."'
        ],
        choices: [
          { text: "Hear him out.", target: "brief_version", tags: {} },
          { text: "Ask why he is whispering.", target: "ask_whisper", tags: { mood: "curious" } },
          { text: "Look at the desk first.", target: "inspect_desk", tags: { skill: "perception" } }
        ],
        teasers: [],
        timer: { seconds: 30, default_index: 0 }
      },
      brief_version: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        onEnter(vars) { vars.distrust_boss++; },
        paragraphs: [
          '"I have a note, a photograph, and no patience."',
          '"The note says keep the police out."',
          '"So I hired someone cheaper."'
        ],
        choices: [
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Read the note.", target: "note", tags: { skill: "perception" } },
          { text: "Accept the case.", target: "accept_case", tags: { risk: "medium" } },
          { text: "Ask why he is whispering.", target: "ask_whisper", tags: {} }
        ],
        teasers: []
      },
      ask_whisper: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        onEnter(vars) { vars.asked_whisper = true; },
        paragraphs: [
          '"Why are we whispering?"',
          "He blinks.",
          '"Because mysteries whisper."',
          "He winces at himself.",
          '"Also because canvas walls are thin."'
        ],
        choices: [
          { text: "Read the note.", target: "note", tags: {} },
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Tell him to get serious.", target: "serious", tags: { risk: "medium", mood: "tense" } }
        ],
        teasers: []
      },
      serious: {
        speaker: "narrator", mood: "tense",
        scene: "circus_wagon",
        media: [],
        onEnter(vars) { vars.distrust_boss++; },
        paragraphs: [
          '"Then get serious," you say.',
          "He nods once.",
          '"Fine. Someone inside this circus is lying."',
          '"I don\'t know who yet. I do know they know the lot better than I do."'
        ],
        choices: [
          { text: "Read the note.", target: "note", tags: {} },
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Accept the case.", target: "accept_case", tags: { risk: "medium" } }
        ],
        teasers: []
      },
      inspect_desk: {
        speaker: "narrator", mood: "noir",
        scene: "circus_desk",
        vizprom: "cluttered desk with ransom note, faded child photograph, cashbox, ticket stubs, circus ledger, harsh lamplight",
        media: [{ type: "image", alt: "Cluttered desk under harsh lamplight", position: "inline" }],
        paragraphs: [
          "On the desk:",
          "— a smudged note",
          "— a small photograph",
          "— gate receipts in messy stacks"
        ],
        choices: [
          { text: "Read the note.", target: "note", tags: { skill: "perception" } },
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Ask for the short version.", target: "brief_version", tags: {} }
        ],
        teasers: []
      },
      note: {
        speaker: "narrator", mood: "tense",
        scene: "circus_desk",
        vizprom: "ransom note on cheap paper, blocky handwriting, grease smudge, threat implied more than stated",
        media: [{ type: "image", alt: "Ransom note on cheap paper", position: "inline" }],
        onEnter(vars) { vars.read_note = true; },
        paragraphs: [
          "The note is short.",
          '"No police. No heroics. Wait for instructions."',
          "No signature.",
          '"Happy now?" he asks.'
        ],
        choices: [
          { text: "Not even slightly.", target: "not_happy", tags: { mood: "tense" } },
          { text: "Ask who had access.", target: "access", tags: { skill: "perception" } },
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Accept the case.", target: "accept_case", tags: { risk: "high" } }
        ],
        teasers: []
      },
      not_happy: {
        speaker: "narrator", mood: "noir",
        scene: "circus_desk",
        media: [],
        paragraphs: ['"Not even slightly."', '"Good," he says. "Neither am I."'],
        choices: [
          { text: "Ask who had access.", target: "access", tags: {} },
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Accept the case.", target: "accept_case", tags: {} }
        ],
        teasers: []
      },
      access: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        onEnter(vars) { vars.distrust_boss++; },
        paragraphs: [
          '"Who had access to her?"',
          '"Everyone. That\'s circus life."',
          '"Who had motive?"',
          "He looks away.",
          '"That list is longer."'
        ],
        choices: [
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Press him on motive.", target: "motive", tags: { risk: "medium", mood: "tense" } },
          { text: "Accept the case.", target: "accept_case", tags: {} }
        ],
        teasers: []
      },
      motive: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        paragraphs: [
          '"Start with the people I underpay," he says.',
          '"Then continue with the people I overrule."',
          '"Then include the ones who smile too fast."'
        ],
        choices: [
          { text: "Take the photograph.", target: "photo", tags: {} },
          { text: "Accept the case.", target: "accept_case", tags: { risk: "high" } }
        ],
        teasers: []
      },
      photo: {
        speaker: "narrator", mood: "noir",
        scene: "circus_desk",
        vizprom: "small portrait photograph of a missing girl, studio stiffness, soft flash glare",
        media: [{ type: "image", alt: "Small portrait photograph, studio flash", position: "inline" }],
        onEnter(vars) { vars.saw_photo = true; },
        paragraphs: [
          "He slides over the photograph.",
          '"Taken last spring," he says.',
          '"She hates sitting still. So this is already a lie."'
        ],
        choices: [
          { text: "Ask about her habits.", target: "habits", tags: { skill: "perception" } },
          { text: "Read the note.", target: "note", tags: {} },
          { text: "Accept the case.", target: "accept_case", tags: { risk: "medium" } }
        ],
        teasers: []
      },
      habits: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        paragraphs: [
          '"What does she do when nobody is watching?"',
          "His answer comes too slowly.",
          '"Climbs where she shouldn\'t. Listens where she shouldn\'t. Trusts the wrong adults."'
        ],
        choices: [
          { text: "Read the note.", target: "note", tags: {} },
          { text: "Accept the case.", target: "accept_case", tags: { risk: "high" } }
        ],
        teasers: []
      },
      accept_case: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        onEnter(vars) {
          if (!vars.saw_photo) return "photo_redirect";
          vars.case_accepted = true;
        },
        paragraphs(vars) {
          const p = ['"Fine," you say. "I\'ll look."', "He exhales for the first time.", '"Start outside. Listen more than you talk."'];
          if (vars.read_note) p.push('"And if anyone asks, you never saw that note."');
          return p;
        },
        choices: [
          { text: "Step down into the wagon yard.", target: "wagon_yard", tags: {} },
          { text: "Ask one last question.", target: "last_question", tags: { mood: "curious" } }
        ],
        teasers: []
      },
      photo_redirect: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        paragraphs: ['"Take the photograph first," you say.'],
        choices: [{ text: "Continue", target: "photo", tags: {} }],
        teasers: []
      },
      last_question: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        paragraphs: ['"One last question."', '"Make it cheap."'],
        choices: [
          { text: "Who do you trust here?", target: "trust", tags: { skill: "charm" } },
          { text: "Who scares you?", target: "fear", tags: { mood: "tense" } },
          { text: "Why hire me?", target: "why_me", tags: {} }
        ],
        teasers: []
      },
      trust: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        paragraphs: ['"Who do you trust here?"', '"The animals," he says.', '"They bite honestly."'],
        choices: [{ text: "Go.", target: "wagon_yard", tags: {} }],
        teasers: []
      },
      fear: {
        speaker: "narrator", mood: "tense",
        scene: "circus_wagon",
        media: [],
        paragraphs: ['"Who scares you?"', '"The quiet ones."', '"A circus only gets quiet when something has gone wrong."'],
        choices: [{ text: "Go.", target: "wagon_yard", tags: {} }],
        teasers: []
      },
      why_me: {
        speaker: "narrator", mood: "noir",
        scene: "circus_wagon",
        media: [],
        paragraphs: ['"Why hire me?"', '"Because you are available."', "He almost smiles.", '"And because you look like you can lose without quitting."'],
        choices: [{ text: "Go.", target: "wagon_yard", tags: {} }],
        teasers: []
      },
      wagon_yard: {
        speaker: "narrator", mood: "noir",
        scene: "circus_yard",
        vizprom: "muddy circus wagon yard at night, lantern glow, wheel ruts, distant animal noise, thin canvas walls, secrets in every shadow",
        media: [
          { type: "image", alt: "Muddy circus wagon yard at night", position: "background" },
          { type: "audio", role: "ambient", url: "ambient-circus-yard.mp3", loop: true },
          { type: "foley", name: "crowd-laugh-distant" }
        ],
        paragraphs(vars) {
          const p = [
            "Cold night air hits your face.",
            "The yard opens around you in wet ruts and lantern light.",
            "Somewhere beyond the wagons, a crowd laughs at something harmless.",
            "Here, nothing feels harmless."
          ];
          if (vars.asked_whisper) p.push("You can still hear him whispering to himself inside.");
          if (vars.distrust_boss > 1) p.push("You do not like your client.");
          return p;
        },
        choices: [
          { text: "Head toward the prop tent.", target: "the_end", tags: { risk: "medium" } },
          { text: "Move toward the animal tents.", target: "the_end", tags: { risk: "medium" } },
          { text: "Wait and watch who crosses the yard.", target: "the_end", tags: { skill: "perception", risk: "low" } }
        ],
        teasers: [{ teaser: "A shadow moves between the wagons..." }]
      },
      the_end: {
        speaker: "narrator", mood: "noir",
        scene: "circus_yard",
        media: [],
        paragraphs: ["The case begins."],
        choices: [
          { text: "Play again", target: "office_wagon", tags: {}, onChoose(vars) { Object.assign(vars, { saw_photo: false, read_note: false, asked_whisper: false, distrust_boss: 0, case_accepted: false }); } },
          { text: "Back to Stories", target: "_switch_toc", tags: {} }
        ],
        teasers: []
      }
    }
  },

  // ── Table of Contents ──────────────────────────────────
  toc: {
    title: "Fink Stories",
    startKnot: "main_menu",
    voices: {
      narrator: { name: "Narrator", desc: "Story menu narrator", traits: ["clear","neutral"], providers: {openai:"alloy", elevenlabs:"JBFqnCBsd6RMkjVDRZzb", edge:"en-US-AriaNeural"}, avatar: "avatar_toc" }
    },
    vars: {},
    knots: {
      main_menu: {
        speaker: "narrator", mood: null,
        scene: null,
        media: [],
        paragraphs: ["Welcome to Fink. Choose a story to begin."],
        choices: [
          { text: "The Enchanted Garden", target: "_switch_garden", tags: {}, voice_hint: "enchanted garden, garden" },
          { text: "Bigtop Briefing", target: "_switch_bigtop", tags: { mood: "noir" }, voice_hint: "bigtop, briefing, circus" },
          { text: "Radio Foundation Quiz", target: "_switch_radio", tags: {}, voice_hint: "radio quiz, foundation, ham radio" }
        ],
        teasers: []
      }
    }
  },

  // ── Radio Foundation Quiz (demo excerpt) ───────────────
  radio: {
    title: "Radio Foundation Quiz",
    startKnot: "intro",
    voices: {
      narrator: { name: "Barney the Carny", desc: "Gruff old-school radio operator, theatrical authority", traits: ["deep","raspy","world-weary","showman"], providers: {elevenlabs:"wG54O0fjDbPBYb9MFXCb"}, avatar: "avatar_carney" }
    },
    vars: { score: 0, total: 20, q: 0 },
    knots: {
      intro: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        paragraphs: [
          "Right then. Sit down.",
          "I'm not here to hold your hand. I've been on the air since before you were born, and I've seen too many people key up without knowing what they're doing.",
          "You want your Foundation licence? Prove you deserve it. 20 questions. No waffle. Get it right or learn something.",
          "I'll give you memory tricks along the way. Old hams didn't pass exams by being clever — we passed by having good mnemonics and stubborn practice."
        ],
        choices: [
          { text: "Let's go", target: "q1", tags: {}, voice_hint: "let's go, start, begin" },
          { text: "I'm not ready...", target: "not_ready", tags: {}, voice_hint: "not ready, wait" }
        ],
        teasers: []
      },
      not_ready: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        paragraphs: ["Nobody's ever ready. That's why we practise. Now stop dithering."],
        choices: [
          { text: "Fine, go ahead", target: "q1", tags: {}, voice_hint: "fine, go ahead, ok" }
        ],
        teasers: []
      },
      q1: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        onEnter(vars) { vars.q = 1; },
        paragraphs: ["Question 1. Basic stuff.", "What does the letter F stand for in \"RF\"?"],
        choices: [
          { text: "Frequency", target: "q1_right", tags: {}, voice_hint: "frequency" },
          { text: "Foundation", target: "q1_wrong", tags: {}, voice_hint: "foundation" },
          { text: "Field", target: "q1_wrong", tags: {}, voice_hint: "field" }
        ],
        teasers: []
      },
      q1_right: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        onEnter(vars) { vars.score++; },
        paragraphs: [
          "Correct. Radio Frequency. The clue's in the name. RF — the energy we work with every time we transmit.",
          "RF sits between about 3 kHz and 300 GHz. You don't need to memorise all that for Foundation, but you DO need to know it's not magic — it's electromagnetic waves."
        ],
        choices: [
          { text: "Next question", target: "q2", tags: {}, voice_hint: "next" }
        ],
        teasers: []
      },
      q1_wrong: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        paragraphs: [
          "No. Radio FREQUENCY. Basic terminology. If you can't get the words right, how will you get the operating right?",
          "RF — Radio Frequency — the electromagnetic energy we use to communicate. Remember it."
        ],
        choices: [
          { text: "Next question", target: "q2", tags: {}, voice_hint: "next" }
        ],
        teasers: []
      },
      q2: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        onEnter(vars) { vars.q = 2; },
        paragraphs: ["Question 2.", "A UK Foundation licence callsign starts with which prefix?"],
        choices: [
          { text: "M7", target: "q2_right", tags: {}, voice_hint: "m7" },
          { text: "M0", target: "q2_wrong", tags: {}, voice_hint: "m0" },
          { text: "G4", target: "q2_wrong", tags: {}, voice_hint: "g4" },
          { text: "2E0", target: "q2_wrong", tags: {}, voice_hint: "2e0, two e zero" }
        ],
        teasers: []
      },
      q2_right: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        onEnter(vars) { vars.score++; },
        paragraphs: [
          "Good. M7 — that's you as a Foundation licensee. Three letters after it, assigned by Ofcom.",
          "Full licence is M0. Intermediate is 2E0. The old G-prefixed calls are legacy."
        ],
        choices: [
          { text: "Next", target: "q3", tags: {}, voice_hint: "next" }
        ],
        teasers: []
      },
      q2_wrong: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        paragraphs: [
          "No. Foundation is M7. Intermediate is 2E0. Full is M0. Learn the hierarchy."
        ],
        choices: [
          { text: "Next", target: "q3", tags: {}, voice_hint: "next" }
        ],
        teasers: []
      },
      q3: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        onEnter(vars) { vars.q = 3; },
        paragraphs: ["Question 3.", "What is the maximum transmit power for a UK Foundation licence holder?"],
        choices: [
          { text: "10 watts", target: "q3_right", tags: {}, voice_hint: "10 watts, ten watts" },
          { text: "50 watts", target: "q3_wrong", tags: {}, voice_hint: "50 watts" },
          { text: "100 watts", target: "q3_wrong", tags: {}, voice_hint: "100 watts" },
          { text: "5 watts", target: "q3_wrong", tags: {}, voice_hint: "5 watts" }
        ],
        teasers: []
      },
      q3_right: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        onEnter(vars) { vars.score++; },
        paragraphs: [
          "Right. 10 watts. Not a lot, but you'd be amazed what you can do with 10 watts and a decent aerial.",
          "Some Foundation bands allow less — check the band plan. But 10 watts is your ceiling."
        ],
        choices: [
          { text: "Next", target: "demo_end", tags: {}, voice_hint: "next" }
        ],
        teasers: []
      },
      q3_wrong: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        paragraphs: [
          "Wrong. 10 watts. That's your lot on a Foundation licence.",
          "50 watts is Intermediate. Full licence gets you 400 watts on most bands. But YOU get 10."
        ],
        choices: [
          { text: "Next", target: "demo_end", tags: {}, voice_hint: "next" }
        ],
        teasers: []
      },
      demo_end: {
        speaker: "narrator", mood: "noir",
        scene: null,
        media: [],
        paragraphs(vars) {
          return [
            `Score so far: ${vars.score} out of ${vars.q}.`,
            "This is a demo excerpt — the full quiz has 20 questions covering Ohm's Law, decibels, propagation, Q codes, safety, and more.",
            "Switch to Live mode to play the full story, or pick another story."
          ];
        },
        choices: [
          { text: "Play again", target: "intro", tags: {}, onChoose(vars) { vars.score = 0; vars.q = 0; } },
          { text: "Back to Stories", target: "_switch_toc", tags: {} },
          { text: "Back to Stories", target: "_switch_toc", tags: {} },
          { text: "Back to Stories", target: "_switch_toc", tags: {} }
        ],
        teasers: []
      }
    }
  }
};


// ═══════════════════════════════════════════════════════════
//  Engine
// ═══════════════════════════════════════════════════════════

let currentStoryKey = "radio";
window.currentStoryKey = currentStoryKey; // exposed for mode toggle
let currentKnotKey = "";
let vars = {};
let streamStates = {};
let timerInterval = null;

const $ = id => document.getElementById(id);

window.switchStory = switchStory; // exposed for mode toggle
function switchStory(key) {
  currentStoryKey = key;
  window.currentStoryKey = key;
  const story = STORIES[key];
  vars = { ...story.vars };
  document.querySelectorAll('.topbar-tab[data-story]').forEach(t => t.classList.toggle('active', t.dataset.story === key));
  enterKnot(story.startKnot);
}

function enterKnot(knotKey) {
  if (knotKey === "_switch_bigtop") return switchStory("bigtop");
  if (knotKey === "_switch_garden") return switchStory("garden");
  if (knotKey === "_switch_radio") return switchStory("radio");
  if (knotKey === "_switch_toc") return switchStory("toc");

  const story = STORIES[currentStoryKey];
  const knot = story.knots[knotKey];
  if (!knot) return;

  // onEnter
  if (knot.onEnter) {
    const redirect = knot.onEnter(vars);
    if (redirect) return enterKnot(redirect);
  }

  currentKnotKey = knotKey;

  // Header
  $("storyTitle").textContent = story.title;
  $("storyKnot").textContent = knotKey;

  // Scene image
  const sceneKey = knot.scene || "";
  const sceneEl = $("sceneImage");
  if (sceneKey && SVG[sceneKey]) {
    sceneEl.innerHTML = SVG[sceneKey] + '<span class="media-badge">SVG scene</span>';
    sceneEl.style.display = "";
  } else {
    sceneEl.style.display = "none";
  }

  // Narration
  const narEl = $("narration");
  narEl.innerHTML = "";
  if (knot.vizprom) {
    const vp = document.createElement("div");
    vp.className = "vizprom";
    vp.textContent = "VIZPROM: " + knot.vizprom;
    narEl.appendChild(vp);
  }
  const paras = typeof knot.paragraphs === "function" ? knot.paragraphs(vars) : knot.paragraphs;
  const speaker = knot.speaker;
  const voice = story.voices[speaker];

  paras.forEach((text, i) => {
    const p = document.createElement("div");
    p.className = "para";
    if (knot.mood) p.dataset.mood = knot.mood;
    p.style.animationDelay = (i * 0.12) + "s";
    if (i === 0 && voice) {
      const lbl = document.createElement("span");
      lbl.className = "speaker-label";
      lbl.textContent = voice.name;
      p.appendChild(lbl);
    }
    p.appendChild(document.createTextNode(text));
    narEl.appendChild(p);
  });
  narEl.scrollTop = narEl.scrollHeight;

  // Choices
  const choicesEl = $("choices");
  choicesEl.innerHTML = "";
  const choices = typeof knot.choices === "function" ? knot.choices(vars) : knot.choices;
  const teasers = knot.teasers || [];

  // Timer bar
  if (knot.timer) {
    const tb = document.createElement("div");
    tb.className = "timer-bar";
    tb.innerHTML = '<div class="timer-fill" id="timerFill" style="width:100%"></div>';
    choicesEl.appendChild(tb);
    startTimer(knot.timer.seconds, knot.timer.default_index, choices);
  } else {
    clearTimer();
  }

  choices.forEach((c, i) => {
    const btn = document.createElement("button");
    btn.className = "choice-btn";
    btn.innerHTML = `<span class="choice-num">${i + 1}</span><span class="choice-text">${c.text}</span>`;

    // Tags
    if (c.tags && Object.keys(c.tags).length > 0) {
      const tagsEl = document.createElement("span");
      tagsEl.className = "choice-tags";
      for (const [k, v] of Object.entries(c.tags)) {
        const tag = document.createElement("span");
        if (k === "risk") {
          tag.className = `choice-tag risk-${v}`;
          tag.textContent = `risk:${v}`;
        } else if (k === "skill") {
          tag.className = "choice-tag skill";
          tag.textContent = v;
        } else if (k === "mood") {
          tag.className = "choice-tag mood";
          tag.textContent = v;
        }
        tagsEl.appendChild(tag);
      }
      btn.appendChild(tagsEl);
    }

    btn.onclick = () => {
      clearTimer();
      if (c.onChoose) c.onChoose(vars);
      enterKnot(c.target);
    };
    choicesEl.appendChild(btn);
  });

  teasers.forEach(t => {
    const te = document.createElement("div");
    te.className = "teaser";
    te.innerHTML = `<span class="teaser-lock">&#x1f512;</span> ${t.teaser}`;
    choicesEl.appendChild(te);
  });

  // ── Infra panels ──
  updateVoicePanel(speaker, voice);
  updateStreamsPanel(knot);
  updateProtocolPanel(knotKey, knot, paras, choices, teasers);
  updateMediaPanel(knot);
  updateStatus(knotKey);
}

function startTimer(seconds, defaultIdx, choices) {
  clearTimer();
  const start = Date.now();
  const duration = seconds * 1000;
  timerInterval = setInterval(() => {
    const elapsed = Date.now() - start;
    const pct = Math.max(0, 100 - (elapsed / duration * 100));
    const fill = document.getElementById("timerFill");
    if (fill) fill.style.width = pct + "%";
    if (elapsed >= duration) {
      clearTimer();
      const c = choices[defaultIdx] || choices[0];
      if (c) enterKnot(c.target);
    }
  }, 100);
}

function clearTimer() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
}

function updateVoicePanel(speaker, voice) {
  const el = $("voicePanel");
  if (!voice) { el.innerHTML = '<div style="font-size:10px;color:#4a4e63">no voice active</div>'; return; }
  el.innerHTML = `
    <div class="voice-card">
      <div class="voice-avatar">${SVG[voice.avatar] || ""}</div>
      <div class="voice-info">
        <div class="voice-name">${voice.name}</div>
        <div class="voice-desc">${voice.desc}</div>
        <div class="voice-providers">
          ${Object.entries(voice.providers).map(([k,v]) => `<span class="voice-provider">${k}: ${v}</span>`).join("")}
        </div>
      </div>
    </div>
  `;
}

function updateStreamsPanel(knot) {
  const media = knot.media || [];
  const hasAmbient = media.some(m => m.role === "ambient");
  const hasFoley = media.some(m => m.type === "foley");
  const hasImage = media.some(m => m.type === "image");

  streamStates = {
    narration: "active",
    ambient: hasAmbient ? "active" : "pending",
    foley: hasFoley ? "active" : "pending",
    choices: "pending",
    image: hasImage ? "active" : "pending"
  };

  // After a short delay, advance states
  setTimeout(() => {
    streamStates.narration = "complete";
    streamStates.choices = "active";
    if (streamStates.foley === "active") streamStates.foley = "complete";
    renderStreams();
  }, 800);

  renderStreams();
}

function renderStreams() {
  const el = $("streamsPanel");
  const widths = { active: "70%", complete: "100%", pending: "0%" };
  el.innerHTML = Object.entries(streamStates).map(([name, state]) => `
    <div class="stream-row">
      <span class="stream-name">${name}</span>
      <div class="stream-bar">
        <div class="stream-fill ${name}" style="width:${widths[state]}"></div>
      </div>
      <span class="stream-state ${state}">${state}</span>
    </div>
  `).join("");
}

function syntaxHL(json) {
  return json
    .replace(/"([^"]+)":/g, '"<span class="jk">$1</span>":')
    .replace(/: "([^"]*)"/g, ': "<span class="js">$1</span>"')
    .replace(/: (\d+)/g, ': <span class="jn">$1</span>')
    .replace(/: (true|false|null)/g, ': <span class="jb">$1</span>');
}

function updateProtocolPanel(knotKey, knot, paras, choices, teasers) {
  const story = STORIES[currentStoryKey];
  const voice = story.voices[knot.speaker];
  const proto = {
    type: "ink_state",
    knot: knotKey,
    narration: paras.map((text, i) => ({
      text,
      speaker: i === 0 ? knot.speaker : undefined,
      voice: i === 0 && voice ? Object.values(voice.providers)[0] : undefined,
      mood: knot.mood || undefined
    })),
    choices: choices.map((c, i) => ({
      index: i,
      text: c.text,
      tags: Object.keys(c.tags).length > 0 ? c.tags : undefined
    })),
    hidden_teasers: teasers.length > 0 ? teasers : undefined,
    choice_mode: "guided",
    timer: knot.timer || undefined
  };
  $("protocolPanel").innerHTML = syntaxHL(JSON.stringify(proto, null, 2));
}

function updateMediaPanel(knot) {
  const media = knot.media || [];
  if (media.length === 0) {
    $("mediaPanel").innerHTML = '<span class="jp">// no media at this beat</span>';
    return;
  }
  const descriptors = media.map(m => {
    const d = { type: m.type };
    if (m.url) d.url = m.url;
    if (m.name) d.name = m.name;
    if (m.alt) d.alt = m.alt;
    if (m.role) d.role = m.role;
    if (m.loop) d.loop = m.loop;
    if (m.position) d.position = m.position;
    return d;
  });
  $("mediaPanel").innerHTML = syntaxHL(JSON.stringify(descriptors, null, 2));
}

function updateStatus(knotKey) {
  const story = STORIES[currentStoryKey];
  const knot = story.knots[knotKey];
  const mediaCount = (knot.media || []).length;
  const varStr = Object.entries(vars).map(([k,v]) => `${k}=${v}`).join("  ");
  $("statusText").textContent = `knot: ${knotKey}  |  media: ${mediaCount}  |  ${varStr}`;
  $("statusStreams").textContent = `choice_mode: guided`;
}


// ── Init ──
document.querySelectorAll('.topbar-tab[data-story]').forEach(btn => {
  btn.addEventListener('click', () => switchStory(btn.dataset.story));
});

switchStory("radio");


// ═══════════════════════════════════════════════════════════
//  Event Bus Wiring — for Live / Local modes
//  Called from the module script in infra-demo.html.
//  All existing Demo-mode code above is untouched.
// ═══════════════════════════════════════════════════════════

window.connectLive = function connectLive(bus) {
  // ink_state → narration panel + choices + protocol panel
  bus.subscribe('ink_state', (data) => {
    // Header
    $("storyTitle").textContent = data.storyId || 'Live Story';
    $("storyKnot").textContent = data.knot || '';

    // Narration
    const narEl = $("narration");
    narEl.innerHTML = "";
    const paras = data.narration || [];
    paras.forEach((seg, i) => {
      const p = document.createElement("div");
      p.className = "para";
      if (seg.mood) p.dataset.mood = seg.mood;
      p.style.animationDelay = (i * 0.12) + "s";
      if (i === 0 && seg.speaker) {
        const lbl = document.createElement("span");
        lbl.className = "speaker-label";
        lbl.textContent = seg.speaker;
        p.appendChild(lbl);
      }
      p.appendChild(document.createTextNode(seg.text));
      narEl.appendChild(p);
    });
    narEl.scrollTop = narEl.scrollHeight;

    // Choices
    const choicesEl = $("choices");
    choicesEl.innerHTML = "";
    const choices = data.choices || [];
    choices.forEach((c, i) => {
      const btn = document.createElement("button");
      btn.className = "choice-btn";
      btn.innerHTML = `<span class="choice-num">${i + 1}</span><span class="choice-text">${c.text}</span>`;

      const tags = c.tags || {};
      if (Object.keys(tags).length > 0) {
        const tagsEl = document.createElement("span");
        tagsEl.className = "choice-tags";
        for (const [k, v] of Object.entries(tags)) {
          const tag = document.createElement("span");
          if (k === "risk") { tag.className = `choice-tag risk-${v}`; tag.textContent = `risk:${v}`; }
          else if (k === "skill") { tag.className = "choice-tag skill"; tag.textContent = v; }
          else if (k === "mood") { tag.className = "choice-tag mood"; tag.textContent = v; }
          tagsEl.appendChild(tag);
        }
        btn.appendChild(tagsEl);
      }

      btn.onclick = () => bus.publish('ink:choose', { choiceIndex: c.index ?? i });
      choicesEl.appendChild(btn);
    });

    if (data.isEnded) {
      const endEl = document.createElement("div");
      endEl.className = "teaser";
      endEl.textContent = "— Story ended —";
      choicesEl.appendChild(endEl);
    }

    // Protocol panel (raw event)
    $("protocolPanel").innerHTML = syntaxHL(JSON.stringify(data, null, 2));

    // Status
    $("statusText").textContent = `knot: ${data.knot || '?'}  |  turn: ${data.turnCount || '?'}  |  mode: live`;
    $("statusStreams").textContent = data.choice_mode ? `choice_mode: ${data.choice_mode}` : '';
  });

  // voice → voice panel
  bus.subscribe('voice', (data) => {
    const el = $("voicePanel");
    el.innerHTML = `
      <div class="voice-card">
        <div class="voice-avatar"></div>
        <div class="voice-info">
          <div class="voice-name">${data.speaker || 'unknown'}</div>
          <div class="voice-desc">${data.voiceId || ''}</div>
          <div class="voice-providers">
            ${data.provider ? `<span class="voice-provider">${data.provider}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  });

  // tts → streams panel
  bus.subscribe('tts', (data) => {
    const states = { start: 'active', sentence_start: 'active', sentence_end: 'active', stop: 'complete' };
    streamStates.narration = states[data.state] || 'pending';
    renderStreams();
  });

  // media → media panel
  bus.subscribe('media', (data) => {
    const el = $("mediaPanel");
    // Append rather than replace, so multiple media show
    const existing = el.textContent.startsWith('//') ? '' : el.innerHTML;
    const entry = syntaxHL(JSON.stringify(data, null, 2));
    el.innerHTML = existing + (existing ? '\n' : '') + entry;
  });

  // stt → status bar
  bus.subscribe('stt', (data) => {
    $("statusText").textContent = `stt: "${data.text}"`;
  });

  // Wildcard → recent event stream in status bar
  let recentEvents = [];
  bus.subscribe('*', (data, topic) => {
    if (topic === 'ink_state') return; // already handled above
    recentEvents.push({ t: topic, ts: Date.now() });
    if (recentEvents.length > 20) recentEvents.shift();
    const recent = recentEvents.slice(-5).map(e => e.t).join(' → ');
    $("statusStreams").textContent = recent;
  });
};

window.disconnectLive = function disconnectLive() {
  $("statusText").textContent = "ready — tap a choice or switch stories";
  $("statusStreams").textContent = "";
};
