export interface MemoryEntry {
  key: string;
  value: any;
  createdAt: number;
  updatedAt: number;
  tags: string[];
}

export class AgentMemoryStore {
  private store = new Map<string, MemoryEntry>();

  public get<T = any>(key: string): T | undefined {
    const entry = this.store.get(key);
    return entry ? (entry.value as T) : undefined;
  }

  public set(key: string, value: any, tags: string[] = []): MemoryEntry {
    const existing = this.store.get(key);
    const entry: MemoryEntry = {
      key,
      value,
      createdAt: existing ? existing.createdAt : Date.now(),
      updatedAt: Date.now(),
      tags: Array.from(new Set([...(existing?.tags || []), ...tags])),
    };
    this.store.set(key, entry);
    return entry;
  }

  public delete(key: string): boolean {
    return this.store.delete(key);
  }

  public listByTag(tag: string): MemoryEntry[] {
    return Array.from(this.store.values()).filter((e) => e.tags.includes(tag));
  }

  public exportState(): Record<string, MemoryEntry> {
    return Object.fromEntries(this.store.entries());
  }

  public importState(data: Record<string, MemoryEntry>): void {
    this.store = new Map(Object.entries(data));
  }
}
