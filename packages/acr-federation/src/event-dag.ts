import { createHash } from 'node:crypto';

export interface DAGEvent {
  id: string;
  roomId: string;
  senderDid: string;
  eventType: 'ROOM_CREATE' | 'MEMBERSHIP' | 'MESSAGE' | 'BALLOT_CREATE' | 'BALLOT_VOTE';
  stateKey?: string;
  prevEvents: string[]; // Parent event IDs in DAG
  depth: number;
  payload: any;
  timestamp: number;
  hash: string;
}

export function canonicalJsonStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJsonStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(obj[k]));
  return '{' + pairs.join(',') + '}';
}

export class MerkleDAG {
  private events = new Map<string, DAGEvent>();
  private tips = new Set<string>(); // Latest unreferenced event IDs

  public addEvent(params: {
    roomId: string;
    senderDid: string;
    eventType: DAGEvent['eventType'];
    stateKey?: string;
    prevEvents?: string[];
    payload: any;
  }): DAGEvent {
    const parents = params.prevEvents && params.prevEvents.length > 0 
      ? params.prevEvents 
      : Array.from(this.tips);

    let maxDepth = 0;
    for (const pId of parents) {
      const parent = this.events.get(pId);
      if (parent && parent.depth > maxDepth) {
        maxDepth = parent.depth;
      }
    }

    const depth = maxDepth + 1;
    const timestamp = Date.now();

    const preImage = {
      depth,
      eventType: params.eventType,
      payload: params.payload,
      prevEvents: parents.sort(),
      roomId: params.roomId,
      senderDid: params.senderDid,
      stateKey: params.stateKey || '',
      timestamp,
    };

    const canonicalJson = canonicalJsonStringify(preImage);
    const hash = createHash('sha256').update(canonicalJson).digest('hex');
    const id = `evt-${hash.substring(0, 16)}`;

    const dagEvent: DAGEvent = {
      id,
      roomId: params.roomId,
      senderDid: params.senderDid,
      eventType: params.eventType,
      stateKey: params.stateKey,
      prevEvents: parents,
      depth,
      payload: params.payload,
      timestamp,
      hash,
    };

    this.events.set(id, dagEvent);

    // Update tips: remove parents from tips, add new event ID
    for (const pId of parents) {
      this.tips.delete(pId);
    }
    this.tips.add(id);

    return dagEvent;
  }

  public getEvent(id: string): DAGEvent | undefined {
    return this.events.get(id);
  }

  public getTips(): string[] {
    return Array.from(this.tips);
  }

  public getAllEvents(): DAGEvent[] {
    return Array.from(this.events.values());
  }
}
