export class TtlCache<V> {
  private readonly values = new Map<string, { value: V; expiresAt: number }>();
  constructor(private readonly ttlMs: number, private readonly maxEntries = 100) {}
  get(key: string): V | undefined {
    const hit = this.values.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) return undefined;
    return hit.value;
  }
  getStale(key: string): V | undefined {
    return this.values.get(key)?.value;
  }
  set(key: string, value: V): void {
    if (this.values.size >= this.maxEntries && !this.values.has(key)) this.values.delete(this.values.keys().next().value as string);
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }
}

/** Share concurrent requests without retaining signed stream URLs after they resolve. */
export class InFlight<V> {
  private readonly requests = new Map<string, Promise<V>>();

  run(key: string, load: () => Promise<V>): Promise<V> {
    const existing = this.requests.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(load).finally(() => this.requests.delete(key));
    this.requests.set(key, pending);
    return pending;
  }
}
