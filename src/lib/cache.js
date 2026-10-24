// Small in-memory TTL cache with in-flight de-duplication and an LRU-ish size cap.

export class TtlCache {
  constructor({ ttlMs, max = 1000 }) {
    this.ttlMs = ttlMs;
    this.max = max;
    this.map = new Map(); // key -> { at, value, promise }
  }

  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.at > (hit.ttl ?? this.ttlMs)) { this.map.delete(key); return undefined; }
    // refresh recency
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key, value, ttlMs) {
    this.map.delete(key);
    this.map.set(key, { at: Date.now(), value, ttl: ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }

  delete(key) { this.map.delete(key); }

  /**
   * Return the cached value or compute it once, sharing the promise between
   * concurrent callers. Failed computations are not cached.
   * `keep(value)` decides whether a successful value should be cached.
   */
  async wrap(key, fn, { ttlMs, keep = () => true } = {}) {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    this.inflight ??= new Map();
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      try {
        const v = await fn();
        if (keep(v)) this.set(key, v, ttlMs);
        return v;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }
}
