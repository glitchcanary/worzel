// fink-echo-pilot.js — mark Fink's own speech with a quiet near-ultrasonic
// pilot tone, and detect that tone at the microphone, so a listening client
// can ignore audio that came from a Fink speaker (this tab, another tab, or
// another device in the room).
//
// Off by default. Turn on with ?pilot=1 (or localStorage 'fink-pilot' = '1').
// Options: ?pilot_id=0..8 (code this output carries), ?pilot_alt=1 (alternate
// the tone between the left and right channels, one symbol each).
//
// Why speech recognition is not affected:
//   - The tones are 18.0-19.1 kHz. Whisper (and the Worzel server path) works
//     on 16 kHz audio, so everything above 8 kHz is removed when the
//     microphone signal is resampled. The server never receives the pilot.
//   - Detection runs on a SEPARATE microphone stream at the device rate
//     (usually 48 kHz) with echo cancellation OFF. With echo cancellation on,
//     the browser subtracts its own output from the mic, pilot included.
//
// Limits (not testable in CI; measure on real hardware):
//   - Many laptop and phone speakers and mics roll off above 16-18 kHz.
//   - Bluetooth headsets in call mode (HFP, 8/16 kHz) and phone lines remove
//     the pilot completely. The ESP32 client runs at 16 kHz and cannot carry it.
//   - Some children, young adults and pets can hear 18 kHz.
//
// Code: a repeating frame of three 100 ms symbols, [SYNC, d1, d0], where SYNC
// is tone 3 and d1/d0 are base-3 digits on tones 0-2 (ids 0..8). Frequency
// steps are phase-continuous (one OscillatorNode), so they do not click.

export const PILOT_TONES = [18000, 18375, 18750, 19125];
const SYNC = 3;
const SYMBOL_S = 0.1;
const LEVEL = 0.03;          // about -30 dBFS
const SNR_DB = 15;           // tone bin above band median
const HANGOVER_MS = 400;     // stay "present" this long after the last detection

export function pilotConfigFromPage() {
  const q = new URLSearchParams(window.location.search);
  let stored = null;
  try { stored = localStorage.getItem('fink-pilot'); } catch {}
  const enabled = q.has('pilot') ? q.get('pilot') !== '0' : stored === '1';
  const id = Math.max(0, Math.min(8, parseInt(q.get('pilot_id') ?? '0', 10) || 0));
  const alternate = q.get('pilot_alt') === '1';
  return { enabled, id, alternate };
}

function symbolsFor(id) {
  return [SYNC, Math.floor(id / 3) % 3, id % 3];
}

/** Emits the pilot into an AudioContext while Fink speaks. */
export class EchoPilotEmitter {
  constructor(ctx, { id = 0, alternate = false, level = LEVEL } = {}) {
    this.ctx = ctx;
    this.id = id;
    this.alternate = alternate;
    this.level = level;
    this.supported = ctx.sampleRate >= 2 * (PILOT_TONES[PILOT_TONES.length - 1] + 500);
    this._osc = null;
    this._gain = null;
    this._pan = null;
    this._timer = null;
    this._next = 0;
    this._step = 0;
    this.active = false;
    if (!this.supported) {
      console.warn(`[fink-pilot] output rate ${ctx.sampleRate} Hz is too low for the pilot`);
    }
  }

  start() {
    if (!this.supported || this.active) return;
    const ctx = this.ctx;
    this._osc = ctx.createOscillator();
    this._gain = ctx.createGain();
    this._gain.gain.value = 0;
    this._osc.connect(this._gain);
    let out = this._gain;
    if (this.alternate && typeof ctx.createStereoPanner === 'function') {
      this._pan = ctx.createStereoPanner();
      this._gain.connect(this._pan);
      out = this._pan;
    }
    out.connect(ctx.destination);
    const now = ctx.currentTime;
    this._osc.frequency.setValueAtTime(PILOT_TONES[SYNC], now);
    this._gain.gain.setTargetAtTime(this.level, now, 0.01);
    this._osc.start(now);
    this._next = now;
    this._step = 0;
    this.active = true;
    this._schedule();
    this._timer = setInterval(() => this._schedule(), 50);
  }

  _schedule() {
    if (!this.active) return;
    const symbols = symbolsFor(this.id);
    const horizon = this.ctx.currentTime + 0.3;
    while (this._next < horizon) {
      const sym = symbols[this._step % symbols.length];
      this._osc.frequency.setValueAtTime(PILOT_TONES[sym], this._next);
      if (this._pan) this._pan.pan.setValueAtTime(this._step % 2 === 0 ? -1 : 1, this._next);
      this._next += SYMBOL_S;
      this._step++;
    }
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    clearInterval(this._timer);
    this._timer = null;
    const now = this.ctx.currentTime;
    try {
      this._gain.gain.cancelScheduledValues(now);
      this._gain.gain.setTargetAtTime(0, now, 0.01);
      this._osc.stop(now + 0.08);
    } catch {}
    const osc = this._osc, gain = this._gain, pan = this._pan;
    setTimeout(() => {
      try { osc.disconnect(); gain.disconnect(); pan?.disconnect(); } catch {}
    }, 150);
    this._osc = this._gain = this._pan = null;
  }
}

/**
 * Listens for the pilot on its own raw microphone stream.
 * `present` is true while any Fink output is audible to this mic.
 */
export class EchoPilotDetector extends EventTarget {
  constructor() {
    super();
    this.present = false;
    this.lastId = null;
    this.supported = false;
    this.snrDb = 0;
    this._lastHit = 0;
    this._symbols = [];
    this._lastSym = -1;
    this._symFrames = 0;
  }

  async start() {
    if (this._ctx) return this.supported;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (err) {
      console.warn('[fink-pilot] detector has no microphone:', err?.message ?? err);
      return false;
    }
    this._ctx = new AudioContext();
    const rate = this._ctx.sampleRate;
    this.supported = rate >= 2 * (PILOT_TONES[PILOT_TONES.length - 1] + 500);
    if (!this.supported) {
      console.warn(`[fink-pilot] mic rate ${rate} Hz is too low; detector off`);
      return false;
    }
    const src = this._ctx.createMediaStreamSource(this._stream);
    this._analyser = this._ctx.createAnalyser();
    this._analyser.fftSize = 4096;
    this._analyser.smoothingTimeConstant = 0;
    src.connect(this._analyser);
    this._bins = new Float32Array(this._analyser.frequencyBinCount);
    const hz = rate / this._analyser.fftSize;
    this._toneBins = PILOT_TONES.map(f => Math.round(f / hz));
    this._bandLo = Math.round(17000 / hz);
    this._bandHi = Math.min(this._bins.length - 1, Math.round(20000 / hz));
    this._timer = setInterval(() => this._poll(), 25);
    console.log(`[fink-pilot] detector on (${rate} Hz, ${hz.toFixed(1)} Hz/bin)`);
    return true;
  }

  _poll() {
    if (this._ctx?.state === 'suspended') this._ctx.resume().catch(() => {});
    this._analyser.getFloatFrequencyData(this._bins);
    const band = Array.from(this._bins.subarray(this._bandLo, this._bandHi)).sort((a, b) => a - b);
    const floor = band[Math.floor(band.length / 2)];
    let best = -1, bestSnr = -Infinity;
    this._toneBins.forEach((b, i) => {
      const p = Math.max(this._bins[b - 1], this._bins[b], this._bins[b + 1]);
      const snr = p - floor;
      if (snr > bestSnr) { bestSnr = snr; best = i; }
    });
    this.snrDb = bestSnr;
    const now = performance.now();
    if (bestSnr >= SNR_DB) {
      this._lastHit = now;
      this._trackSymbol(best);
    } else {
      this._trackSymbol(-1);
    }
    const present = now - this._lastHit < HANGOVER_MS;
    if (present !== this.present) {
      this.present = present;
      this.dispatchEvent(new CustomEvent('change', { detail: { present, id: this.lastId } }));
    }
  }

  // Symbols are 100 ms and polls 25 ms: a tone held for 2+ polls is a symbol.
  _trackSymbol(sym) {
    if (sym === this._lastSym) { this._symFrames++; return; }
    if (this._lastSym >= 0 && this._symFrames >= 2) {
      // A run of 4 polls is one symbol; equal digits (id 0 = [SYNC,0,0]) merge into one run.
      const count = Math.max(1, Math.round(this._symFrames / 4));
      for (let k = 0; k < count; k++) this._symbols.push(this._lastSym);
      while (this._symbols.length > 6) this._symbols.shift();
      const [a, b, c] = this._symbols.slice(-3);
      if (a === SYNC && b < 3 && c < 3) this.lastId = b * 3 + c;
    }
    this._lastSym = sym;
    this._symFrames = 1;
  }

  stop() {
    clearInterval(this._timer);
    this._timer = null;
    this._stream?.getTracks().forEach(t => t.stop());
    this._ctx?.close().catch(() => {});
    this._ctx = null;
    this.present = false;
  }
}
