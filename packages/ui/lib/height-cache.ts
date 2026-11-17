/** Precise values can be known without moving an already-visible layout. */
export class HeightCache<T> {
  private entries = new Map<
    string,
    { item: T; height: number; applied: boolean }
  >();
  peek(key: string) {
    return this.entries.get(key);
  }
  resolve(key: string, item: T, measure: () => number) {
    if (this.entries.get(key)?.item === item) return false;
    this.entries.set(key, {
      item,
      height: Math.round(measure()),
      applied: false,
    });
    return true;
  }
  commit(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.entries.set(key, { ...entry, applied: true });
  }
}
