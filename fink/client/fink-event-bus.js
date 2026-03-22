// FinkEventBus — location-transparent pub/sub for Fink modules.
// Any UX affordance (mic, speaker, display panel, bridge) registers
// as a subscriber/publisher. Modules can be swapped local↔remote
// without other modules knowing.

export class FinkEventBus {
  #subs = new Map();       // topic → Set<fn>
  #wildcards = new Set();  // fns subscribed to '*'

  subscribe(topic, fn) {
    if (topic === '*') {
      this.#wildcards.add(fn);
    } else {
      if (!this.#subs.has(topic)) this.#subs.set(topic, new Set());
      this.#subs.get(topic).add(fn);
    }
    return () => this.unsubscribe(topic, fn);
  }

  unsubscribe(topic, fn) {
    if (topic === '*') {
      this.#wildcards.delete(fn);
    } else {
      this.#subs.get(topic)?.delete(fn);
    }
  }

  publish(topic, data) {
    const fns = this.#subs.get(topic);
    if (fns) for (const fn of fns) fn(data, topic);
    for (const fn of this.#wildcards) fn(data, topic);
  }
}
