/**
 * <worzel-settings> — Language, voice, device name configuration.
 */
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: block;
      padding: 12px;
      font-family: var(--worzel-font, system-ui, sans-serif);
      font-size: 0.9rem;
      color: var(--worzel-text, #1f2937);
    }
    .field {
      margin-bottom: 12px;
    }
    label {
      display: block;
      font-size: 0.8rem;
      color: var(--worzel-text-secondary, #6b7280);
      margin-bottom: 4px;
    }
    select, input {
      width: 100%;
      padding: 6px 8px;
      border: 1px solid var(--worzel-border, #d1d5db);
      border-radius: 6px;
      font-size: 0.9rem;
      background: var(--worzel-input-bg, #fff);
      color: var(--worzel-text, #1f2937);
      box-sizing: border-box;
    }
  </style>
  <div class="field">
    <label>Language</label>
    <select id="language">
      <option value="en">English</option>
      <option value="zh">Chinese</option>
      <option value="ja">Japanese</option>
      <option value="de">German</option>
      <option value="fr">French</option>
    </select>
  </div>
  <div class="field">
    <label>Voice</label>
    <select id="voice">
      <option value="en-US-AriaNeural">Aria (English)</option>
      <option value="en-US-GuyNeural">Guy (English)</option>
      <option value="en-GB-SoniaNeural">Sonia (British)</option>
    </select>
  </div>
  <div class="field">
    <label>Device Name</label>
    <input type="text" id="device-name" placeholder="My Worzel Device" />
  </div>
`;

export class WorzelSettings extends HTMLElement {
  private shadow: ShadowRoot;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.appendChild(template.content.cloneNode(true));

    // Dispatch change events
    for (const el of this.shadow.querySelectorAll('select, input')) {
      el.addEventListener('change', () => {
        this.dispatchEvent(new CustomEvent('worzel-settings-change', {
          bubbles: true,
          detail: this.getSettings(),
        }));
      });
    }
  }

  getSettings(): { language: string; voice: string; deviceName: string } {
    return {
      language: (this.shadow.getElementById('language') as HTMLSelectElement).value,
      voice: (this.shadow.getElementById('voice') as HTMLSelectElement).value,
      deviceName: (this.shadow.getElementById('device-name') as HTMLInputElement).value,
    };
  }
}

customElements.define('worzel-settings', WorzelSettings);
