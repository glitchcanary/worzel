/**
 * <worzel-status> — Connection state, latency, provider info.
 */
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: var(--worzel-font, system-ui, sans-serif);
      font-size: 0.85rem;
      color: var(--worzel-text-secondary, #666);
    }
    .indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--worzel-color-disconnected, #ccc);
    }
    :host([state="connected"]) .indicator { background: var(--worzel-color-connected, #22c55e); }
    :host([state="connecting"]) .indicator { background: var(--worzel-color-connecting, #f59e0b); animation: pulse 1s infinite; }
    :host([state="authenticating"]) .indicator { background: var(--worzel-color-connecting, #f59e0b); animation: pulse 1s infinite; }
    :host([state="error"]) .indicator { background: var(--worzel-color-error, #ef4444); }
    @keyframes pulse { 50% { opacity: 0.5; } }
    .label { user-select: none; }
  </style>
  <span class="indicator"></span>
  <span class="label">Disconnected</span>
`;

export class WorzelStatus extends HTMLElement {
  static get observedAttributes() { return ['state', 'session-id']; }

  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.appendChild(template.content.cloneNode(true));
  }

  attributeChangedCallback(name: string, _old: string, value: string) {
    if (name === 'state') {
      const label = this.shadow.querySelector('.label')!;
      const labels: Record<string, string> = {
        disconnected: 'Disconnected',
        connecting: 'Connecting...',
        authenticating: 'Authenticating...',
        connected: 'Connected',
        error: 'Connection Error',
      };
      label.textContent = labels[value] ?? value;
    }
  }
}

customElements.define('worzel-status', WorzelStatus);
