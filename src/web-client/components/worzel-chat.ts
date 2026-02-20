/**
 * <worzel-chat> — Scrolling transcript of STT + LLM text.
 */
const template = document.createElement('template');
template.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      font-family: var(--worzel-font, system-ui, sans-serif);
    }
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .message {
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 0.95rem;
      line-height: 1.4;
      word-break: break-word;
    }
    .message.user {
      align-self: flex-end;
      background: var(--worzel-primary, #3b82f6);
      color: white;
      border-bottom-right-radius: 4px;
    }
    .message.assistant {
      align-self: flex-start;
      background: var(--worzel-assistant-bg, #f3f4f6);
      color: var(--worzel-text, #1f2937);
      border-bottom-left-radius: 4px;
    }
    .message.assistant.streaming {
      opacity: 0.8;
    }
    .empty {
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 1;
      color: var(--worzel-text-secondary, #9ca3af);
      font-style: italic;
    }
  </style>
  <div class="messages">
    <div class="empty">Press and hold to talk</div>
  </div>
`;

export class WorzelChat extends HTMLElement {
  private shadow: ShadowRoot;
  private container: HTMLElement;
  private currentAssistantMsg: HTMLElement | null = null;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    this.shadow.appendChild(template.content.cloneNode(true));
    this.container = this.shadow.querySelector('.messages')!;
  }

  /** Add a user message (STT result) */
  addUserMessage(text: string): void {
    this.clearEmpty();
    const el = document.createElement('div');
    el.className = 'message user';
    el.textContent = text;
    this.container.appendChild(el);
    this.scrollToBottom();
  }

  /** Start a new assistant message (TTS streaming) */
  startAssistantMessage(): void {
    this.clearEmpty();
    this.currentAssistantMsg = document.createElement('div');
    this.currentAssistantMsg.className = 'message assistant streaming';
    this.container.appendChild(this.currentAssistantMsg);
    this.scrollToBottom();
  }

  /** Append text to the current assistant message */
  appendAssistantText(text: string): void {
    if (this.currentAssistantMsg) {
      this.currentAssistantMsg.textContent += text;
      this.scrollToBottom();
    }
  }

  /** Finalize the current assistant message */
  endAssistantMessage(): void {
    if (this.currentAssistantMsg) {
      this.currentAssistantMsg.classList.remove('streaming');
      this.currentAssistantMsg = null;
    }
  }

  /** Clear all messages */
  clear(): void {
    this.container.innerHTML = '<div class="empty">Press and hold to talk</div>';
    this.currentAssistantMsg = null;
  }

  private clearEmpty(): void {
    const empty = this.container.querySelector('.empty');
    if (empty) empty.remove();
  }

  private scrollToBottom(): void {
    this.container.scrollTop = this.container.scrollHeight;
  }
}

customElements.define('worzel-chat', WorzelChat);
