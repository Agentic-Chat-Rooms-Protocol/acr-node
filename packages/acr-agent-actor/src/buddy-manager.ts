export type BuddyStatus = 'PENDING' | 'ACCEPTED' | 'BLOCKED';

export interface BuddyRecord {
  targetDid: string;
  status: BuddyStatus;
  requestedAt: number;
  updatedAt: number;
  scopes: string[];
}

export class BuddyManager {
  private buddies = new Map<string, BuddyRecord>();

  public requestBuddy(targetDid: string, scopes: string[] = ['chat.message.send']): BuddyRecord {
    if (!targetDid.startsWith('did:key:') && !targetDid.endsWith('.acr')) {
      throw new Error(`Invalid target DID or ANS handle: ${targetDid}`);
    }
    const existing = this.buddies.get(targetDid);
    if (existing && existing.status === 'BLOCKED') {
      throw new Error(`Cannot request buddy relationship with blocked DID: ${targetDid}`);
    }
    const record: BuddyRecord = {
      targetDid,
      status: 'PENDING',
      requestedAt: existing?.requestedAt || Date.now(),
      updatedAt: Date.now(),
      scopes,
    };
    this.buddies.set(targetDid, record);
    return record;
  }

  public acceptBuddy(targetDid: string): BuddyRecord {
    const existing = this.buddies.get(targetDid);
    if (!existing) {
      throw new Error(`No pending buddy request found from ${targetDid}`);
    }
    if (existing.status === 'BLOCKED') {
      throw new Error(`Cannot accept request from blocked DID: ${targetDid}`);
    }
    existing.status = 'ACCEPTED';
    existing.updatedAt = Date.now();
    this.buddies.set(targetDid, existing);
    return existing;
  }

  public blockBuddy(targetDid: string): BuddyRecord {
    const record: BuddyRecord = {
      targetDid,
      status: 'BLOCKED',
      requestedAt: this.buddies.get(targetDid)?.requestedAt || Date.now(),
      updatedAt: Date.now(),
      scopes: [],
    };
    this.buddies.set(targetDid, record);
    return record;
  }

  public unblockBuddy(targetDid: string): boolean {
    const existing = this.buddies.get(targetDid);
    if (existing && existing.status === 'BLOCKED') {
      this.buddies.delete(targetDid);
      return true;
    }
    return false;
  }

  public isBlocked(targetDid: string): boolean {
    return this.buddies.get(targetDid)?.status === 'BLOCKED';
  }

  public isAccepted(targetDid: string): boolean {
    return this.buddies.get(targetDid)?.status === 'ACCEPTED';
  }

  public getRecord(targetDid: string): BuddyRecord | undefined {
    return this.buddies.get(targetDid);
  }

  public getAll(): BuddyRecord[] {
    return Array.from(this.buddies.values());
  }

  public exportState(): Record<string, BuddyRecord> {
    return Object.fromEntries(this.buddies.entries());
  }

  public importState(data: Record<string, BuddyRecord>): void {
    this.buddies = new Map(Object.entries(data));
  }
}
