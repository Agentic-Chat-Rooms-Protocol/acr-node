export interface UserAwarenessState {
  did: string;
  handle?: string;
  isTyping: boolean;
  status: 'ONLINE' | 'AWAY' | 'BUSY' | 'OFFLINE';
  lastActive: number;
  focusedRoomId?: string;
}

export class AwarenessStore {
  private states = new Map<string, UserAwarenessState>();
  private readonly ttlMs: number;

  constructor(ttlMs = 15000) {
    this.ttlMs = ttlMs;
  }

  public setLocalState(state: UserAwarenessState): void {
    this.states.set(state.did, {
      ...state,
      lastActive: Date.now(),
    });
  }

  public applyRemoteUpdate(states: Record<string, UserAwarenessState>): void {
    for (const [did, state] of Object.entries(states)) {
      this.states.set(did, {
        ...state,
        lastActive: Date.now(),
      });
    }
  }

  public reapStale(): string[] {
    const now = Date.now();
    const reaped: string[] = [];
    for (const [did, state] of this.states.entries()) {
      if (now - state.lastActive > this.ttlMs) {
        this.states.delete(did);
        reaped.push(did);
      }
    }
    return reaped;
  }

  public getState(did: string): UserAwarenessState | undefined {
    return this.states.get(did);
  }

  public getAllActive(roomId?: string): UserAwarenessState[] {
    const all = Array.from(this.states.values());
    return roomId ? all.filter((s) => s.focusedRoomId === roomId) : all;
  }

  public getTypingUsers(roomId: string): string[] {
    return Array.from(this.states.values())
      .filter((s) => s.focusedRoomId === roomId && s.isTyping)
      .map((s) => s.handle || s.did);
  }
}
