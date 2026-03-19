// fink-local-svg.js — experimental local SVG generation via built-in browser AI.

function getLanguageModelApi() {
  if (typeof globalThis.LanguageModel !== 'undefined') return globalThis.LanguageModel;
  if (globalThis.ai && globalThis.ai.languageModel) return globalThis.ai.languageModel;
  return null;
}

function languageModelOptions() {
  return {
    expectedInputs: [
      { type: 'text', languages: ['en'] },
    ],
    expectedOutputs: [
      { type: 'text', languages: ['en'] },
    ],
  };
}

function extractSvg(text) {
  const match = String(text || '').match(/<svg[\s\S]*<\/svg>/i);
  return match ? match[0] : null;
}

export class FinkLocalSvgGenerator {
  #availability = null;
  #dismissKey = 'finkapp-local-ai-notice-dismissed-v1';

  async probe() {
    if (this.#availability) return this.#availability;

    const api = getLanguageModelApi();
    if (!api || typeof api.availability !== 'function' || typeof api.create !== 'function') {
      this.#availability = {
        available: false,
        reason: 'Chrome Prompt API not present',
      };
      return this.#availability;
    }

    try {
      const state = await api.availability(languageModelOptions());
      this.#availability = {
        available: state === 'available' || state === 'readily',
        state,
        reason: state === 'available' || state === 'readily'
          ? null
          : `Prompt API state: ${state}`,
      };
      return this.#availability;
    } catch (err) {
      this.#availability = {
        available: false,
        reason: err instanceof Error ? err.message : String(err),
      };
      return this.#availability;
    }
  }

  async generate(promptText) {
    const api = getLanguageModelApi();
    if (!api || typeof api.create !== 'function') {
      throw new Error('Chrome Prompt API not available');
    }

    const session = await api.create(languageModelOptions());
    try {
      const response = await session.prompt(
        [
          'Return only a compact standalone SVG image.',
          'No markdown fences. No explanation. No surrounding text.',
          'Use viewBox and simple shapes.',
          'Illustration brief:',
          promptText,
        ].join('\n')
      );

      const svg = extractSvg(response);
      return {
        svg,
        raw: String(response || ''),
      };
    } finally {
      if (typeof session.destroy === 'function') session.destroy();
    }
  }

  shouldShowStartupNotice() {
    try {
      return localStorage.getItem(this.#dismissKey) !== '1';
    } catch {
      return true;
    }
  }

  dismissStartupNotice() {
    try {
      localStorage.setItem(this.#dismissKey, '1');
    } catch {
      // Ignore storage failures.
    }
  }

  async ensureReady({ onProgress } = {}) {
    const api = getLanguageModelApi();
    if (!api || typeof api.create !== 'function') {
      throw new Error('Chrome Prompt API not available');
    }

    const availability = await this.probe();
    if (availability.available) return availability;
    if (availability.state === 'unavailable') {
      throw new Error('On-device AI is unavailable on this browser/device');
    }

    const session = await api.create({
      ...languageModelOptions(),
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          if (typeof onProgress === 'function') {
            onProgress(event.loaded);
          }
        });
      },
    });

    if (typeof session.destroy === 'function') session.destroy();
    this.#availability = {
      available: true,
      state: 'available',
      reason: null,
    };
    return this.#availability;
  }
}
