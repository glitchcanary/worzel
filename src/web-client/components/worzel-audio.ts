/**
 * <worzel-audio> — Push-to-talk button with audio level indicator.
 */

import { OPUS_WORKLET_CODE } from '../lib/opus-worklet.js';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: flex;
      justify-content: center;
      padding: 16px;
      font-family: var(--worzel-font, system-ui, sans-serif);
    }
    button {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      border: 3px solid var(--worzel-primary, #3b82f6);
      background: var(--worzel-bg, #fff);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
      position: relative;
      overflow: hidden;
    }
    button:hover { background: var(--worzel-hover-bg, #f0f4ff); }
    button.recording {
      background: var(--worzel-primary, #3b82f6);
      border-color: var(--worzel-primary, #3b82f6);
    }
    button:disabled { opacity: 0.4; cursor: default; }
    .icon {
      width: 28px;
      height: 28px;
      fill: var(--worzel-primary, #3b82f6);
    }
    button.recording .icon { fill: white; }
    .level {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(59, 130, 246, 0.2);
      transition: height 0.05s;
      height: 0%;
    }
    .hint {
      margin-top: 8px;
      font-size: 0.75rem;
      color: var(--worzel-text-secondary, #9ca3af);
      text-align: center;
    }
  </style>
  <div>
    <button disabled>
      <div class="level"></div>
      <svg class="icon" viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
    </button>
    <div class="hint">Hold to talk</div>
  </div>
`;

export class WorzelAudio extends HTMLElement {
  private shadow: ShadowRoot;
  private button: HTMLButtonElement;
  private levelEl: HTMLElement;
  private recording = false;
  private audioContext: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.appendChild(template.content.cloneNode(true));
    this.button = this.shadow.querySelector('button')!;
    this.levelEl = this.shadow.querySelector('.level')!;

    // Push-to-talk: mousedown/touchstart to start, mouseup/touchend to stop
    this.button.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.startRecording();
    });
    this.button.addEventListener('pointerup', () => this.stopRecording());
    this.button.addEventListener('pointerleave', () => {
      if (this.recording) this.stopRecording();
    });
  }

  /** Enable the button (when connected) */
  enable(): void {
    this.button.disabled = false;
  }

  /** Disable the button (when disconnected) */
  disable(): void {
    this.button.disabled = true;
    if (this.recording) this.stopRecording();
  }

  /** Set audio level (0-1) for visual feedback */
  setLevel(level: number): void {
    this.levelEl.style.height = `${Math.round(level * 100)}%`;
  }

  private async startRecording(): Promise<void> {
    if (this.recording) return;
    this.recording = true;
    this.button.classList.add('recording');

    try {
      // Get microphone
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      // Set up AudioWorklet
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const blob = new Blob([OPUS_WORKLET_CODE], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await this.audioContext.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      this.workletNode = new AudioWorkletNode(this.audioContext, 'worzel-audio-processor');
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'audio') {
          this.dispatchEvent(new CustomEvent('worzel-audio-data', {
            bubbles: true,
            detail: { pcm: event.data.pcm },
          }));
        }
      };

      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      source.connect(this.workletNode);

      this.dispatchEvent(new CustomEvent('worzel-recording-start', { bubbles: true }));
    } catch (err) {
      this.recording = false;
      this.button.classList.remove('recording');
      this.dispatchEvent(new CustomEvent('worzel-error', {
        bubbles: true,
        detail: { message: `Microphone error: ${(err as Error).message}` },
      }));
    }
  }

  private stopRecording(): void {
    if (!this.recording) return;
    this.recording = false;
    this.button.classList.remove('recording');
    this.setLevel(0);

    // Cleanup audio resources
    this.workletNode?.disconnect();
    this.workletNode = null;
    if (this.audioContext?.state !== 'closed') {
      this.audioContext?.close();
    }
    this.audioContext = null;
    this.mediaStream?.getTracks().forEach(t => t.stop());
    this.mediaStream = null;

    this.dispatchEvent(new CustomEvent('worzel-recording-stop', { bubbles: true }));
  }
}

customElements.define('worzel-audio', WorzelAudio);
