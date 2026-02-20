/**
 * <worzel-connect> — Server URL input, connect/disconnect button, status.
 */
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: var(--worzel-font, system-ui, sans-serif);
    }
    input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--worzel-border, #d1d5db);
      border-radius: 6px;
      font-size: 0.9rem;
      background: var(--worzel-input-bg, #fff);
      color: var(--worzel-text, #1f2937);
    }
    input:focus { outline: 2px solid var(--worzel-primary, #3b82f6); outline-offset: -1px; }
    button {
      padding: 6px 16px;
      border: none;
      border-radius: 6px;
      font-size: 0.9rem;
      cursor: pointer;
      background: var(--worzel-primary, #3b82f6);
      color: white;
      white-space: nowrap;
    }
    button:hover { opacity: 0.9; }
    button.disconnect {
      background: var(--worzel-danger, #ef4444);
    }
    button:disabled { opacity: 0.5; cursor: default; }
  </style>
  <input type="url" placeholder="http://localhost:3000" value="http://localhost:3000" />
  <button>Connect</button>
`;

export class WorzelConnect extends HTMLElement {
  private shadow: ShadowRoot;
  private _connected = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.appendChild(template.content.cloneNode(true));

    this.shadow.querySelector('button')!.addEventListener('click', () => {
      if (this._connected) {
        this.dispatchEvent(new CustomEvent('worzel-disconnect', { bubbles: true }));
      } else {
        const input = this.shadow.querySelector('input')! as HTMLInputElement;
        this.dispatchEvent(new CustomEvent('worzel-connect', {
          bubbles: true,
          detail: { serverUrl: input.value },
        }));
      }
    });
  }

  set connected(val: boolean) {
    this._connected = val;
    const btn = this.shadow.querySelector('button')!;
    const input = this.shadow.querySelector('input')! as HTMLInputElement;
    btn.textContent = val ? 'Disconnect' : 'Connect';
    btn.classList.toggle('disconnect', val);
    input.disabled = val;
  }

  get serverUrl(): string {
    return (this.shadow.querySelector('input')! as HTMLInputElement).value;
  }

  set serverUrl(val: string) {
    (this.shadow.querySelector('input')! as HTMLInputElement).value = val;
  }
}

customElements.define('worzel-connect', WorzelConnect);
