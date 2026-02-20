/**
 * <worzel-app> — Root component. Connects children and manages state.
 *
 * Usage: <worzel-app server="http://localhost:3000"></worzel-app>
 *
 * Droppable into any page — framework-free, self-contained.
 */

import { WsClient } from '../lib/ws-client.js';
import './worzel-connect.js';
import './worzel-status.js';
import './worzel-chat.js';
import './worzel-audio.js';
import './worzel-settings.js';

const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      max-height: 100vh;
      font-family: var(--worzel-font, system-ui, -apple-system, sans-serif);
      background: var(--worzel-bg, #fff);
      color: var(--worzel-text, #1f2937);
      border: 1px solid var(--worzel-border, #e5e7eb);
      border-radius: 12px;
      overflow: hidden;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--worzel-border, #e5e7eb);
      background: var(--worzel-header-bg, #f9fafb);
    }
    .title {
      font-weight: 600;
      font-size: 1rem;
    }
    .main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .connect-bar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--worzel-border, #e5e7eb);
    }
    footer {
      border-top: 1px solid var(--worzel-border, #e5e7eb);
    }
    .settings-toggle {
      background: none;
      border: none;
      cursor: pointer;
      font-size: 1.2rem;
      padding: 4px;
      color: var(--worzel-text-secondary, #6b7280);
    }
    .settings-panel {
      display: none;
      border-top: 1px solid var(--worzel-border, #e5e7eb);
    }
    .settings-panel.open { display: block; }
  </style>

  <header>
    <span class="title">Worzel</span>
    <worzel-status state="disconnected"></worzel-status>
    <button class="settings-toggle" title="Settings">&#9881;</button>
  </header>

  <div class="connect-bar">
    <worzel-connect></worzel-connect>
  </div>

  <div class="main">
    <worzel-chat></worzel-chat>
  </div>

  <footer>
    <worzel-audio></worzel-audio>
  </footer>

  <div class="settings-panel">
    <worzel-settings></worzel-settings>
  </div>
`;

export class WorzelApp extends HTMLElement {
  static get observedAttributes() { return ['server']; }

  private shadow: ShadowRoot;
  private client: WsClient | null = null;
  private statusEl!: HTMLElement;
  private connectEl!: HTMLElement;
  private chatEl!: HTMLElement;
  private audioEl!: HTMLElement;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.appendChild(template.content.cloneNode(true));

    this.statusEl = this.shadow.querySelector('worzel-status')!;
    this.connectEl = this.shadow.querySelector('worzel-connect')!;
    this.chatEl = this.shadow.querySelector('worzel-chat')!;
    this.audioEl = this.shadow.querySelector('worzel-audio')!;

    // Settings toggle
    this.shadow.querySelector('.settings-toggle')!.addEventListener('click', () => {
      this.shadow.querySelector('.settings-panel')!.classList.toggle('open');
    });

    // Connect/disconnect events
    this.connectEl.addEventListener('worzel-connect', (e: Event) => {
      const detail = (e as CustomEvent).detail as { serverUrl: string };
      this.doConnect(detail.serverUrl);
    });
    this.connectEl.addEventListener('worzel-disconnect', () => {
      this.client?.disconnect();
    });

    // Recording events
    this.audioEl.addEventListener('worzel-recording-start', () => {
      this.client?.startListening();
    });
    this.audioEl.addEventListener('worzel-recording-stop', () => {
      this.client?.stopListening();
    });
    this.audioEl.addEventListener('worzel-audio-data', (e: Event) => {
      const pcm = (e as CustomEvent).detail.pcm as ArrayBuffer;
      this.client?.sendAudio(pcm);
    });
  }

  connectedCallback(): void {
    const serverUrl = this.getAttribute('server');
    if (serverUrl) {
      (this.connectEl as any).serverUrl = serverUrl;
    }
  }

  attributeChangedCallback(name: string, _old: string, value: string): void {
    if (name === 'server') {
      (this.connectEl as any).serverUrl = value;
    }
  }

  private doConnect(serverUrl: string): void {
    this.client = new WsClient({ serverUrl });

    this.client.on('stateChange', (state) => {
      this.statusEl.setAttribute('state', state);
      (this.connectEl as any).connected = state === 'connected';
      if (state === 'connected') {
        (this.audioEl as any).enable();
      } else {
        (this.audioEl as any).disable();
      }
    });

    this.client.on('stt', (text) => {
      (this.chatEl as any).addUserMessage(text);
    });

    this.client.on('tts', (event) => {
      if (event.state === 'start') {
        (this.chatEl as any).startAssistantMessage();
      } else if (event.state === 'sentence_start' && event.text) {
        (this.chatEl as any).appendAssistantText(event.text + ' ');
      } else if (event.state === 'stop') {
        (this.chatEl as any).endAssistantMessage();
      }
    });

    this.client.on('error', (message) => {
      console.error('[worzel]', message);
    });

    this.client.on('audio', (_data) => {
      // TODO: Play received audio through speakers
      // In Phase 2+, this would feed to an AudioWorklet for playback
    });

    this.client.connect();
  }
}

customElements.define('worzel-app', WorzelApp);
