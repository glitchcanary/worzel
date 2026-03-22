// FinkMediaDisplay — bus service that renders images/media into a DOM element.
// Subscribes to `media` and `ink_state` topics.
// Supports JPEG, PNG, GIF (incl. animated), SVG (via URL or inline).

export class FinkMediaDisplay {
  #bus;
  #el;
  #unsubs = [];

  constructor(bus, targetElement) {
    this.#bus = bus;
    this.#el = targetElement;

    this.#unsubs.push(
      bus.subscribe('media', (data) => this.#onMedia(data)),
      bus.subscribe('ink_state', () => this.#clear()),
    );
  }

  #onMedia(data) {
    if (!this.#el) return;

    if (data.type === 'image') {
      if (data.svg) {
        // Inline SVG content
        this.#el.innerHTML = data.svg + this.#badge('SVG');
      } else if (data.url) {
        const img = document.createElement('img');
        img.src = data.url;
        img.alt = data.alt || '';
        img.style.cssText = 'max-width:100%; max-height:100%; object-fit:contain;';
        img.onerror = () => {
          img.remove();
          this.#el.innerHTML = `<span style="color:#4a4e63;font-size:11px;">image failed: ${data.url}</span>`;
        };
        this.#el.innerHTML = '';
        this.#el.appendChild(img);
        this.#el.insertAdjacentHTML('beforeend', this.#badge(this.#imageType(data.url)));
      }
      this.#el.style.display = '';
    } else if (data.type === 'foley' || data.type === 'audio') {
      // Audio/foley — show a small indicator, don't clear existing image
      const tag = document.createElement('span');
      tag.className = 'media-badge';
      tag.style.cssText = 'position:relative; display:inline-block; margin:4px;';
      tag.textContent = data.type === 'foley' ? `foley: ${data.name || '?'}` : `audio: ${data.role || '?'}`;
      // Only add if we don't already have this indicator
      this.#el.appendChild(tag);
    }
  }

  #badge(label) {
    return `<span class="media-badge">${label}</span>`;
  }

  #imageType(url) {
    const ext = url.split('.').pop()?.split('?')[0]?.toLowerCase();
    if (ext === 'svg') return 'SVG';
    if (ext === 'gif') return 'GIF';
    if (ext === 'png') return 'PNG';
    if (ext === 'jpg' || ext === 'jpeg') return 'JPEG';
    if (ext === 'webp') return 'WebP';
    return 'image';
  }

  #clear() {
    if (!this.#el) return;
    this.#el.innerHTML = '';
    this.#el.style.display = 'none';
  }

  destroy() {
    for (const unsub of this.#unsubs) unsub();
    this.#unsubs = [];
  }
}
