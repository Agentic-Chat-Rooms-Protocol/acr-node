import { DAGEvent } from './event-dag.js';

export interface RoomState {
  members: Map<string, { role: string; powerLevel: number }>;
  roomConfig: Record<string, any>;
  latestEventIds: string[];
}

export class StateResolver {
  public resolveState(conflictingEvents: DAGEvent[]): DAGEvent {
    if (conflictingEvents.length === 0) {
      throw new Error(`NO_EVENTS_TO_RESOLVE`);
    }
    if (conflictingEvents.length === 1) {
      return conflictingEvents[0];
    }

    // Sort by:
    // 1. Power level / role if membership event
    // 2. DAG Depth (higher depth wins)
    // 3. Monotonic Timestamp (earlier/deterministic)
    // 4. Lexicographical Hash as tie-breaker
    const sorted = [...conflictingEvents].sort((a, b) => {
      if (a.depth !== b.depth) {
        return b.depth - a.depth;
      }
      if (a.timestamp !== b.timestamp) {
        return a.timestamp - b.timestamp;
      }
      return a.hash.localeCompare(b.hash);
    });

    return sorted[0];
  }

  public computeStateMap(events: DAGEvent[]): Map<string, DAGEvent> {
    const stateMap = new Map<string, DAGEvent[]>();

    for (const evt of events) {
      if (evt.stateKey !== undefined) {
        const key = `${evt.eventType}:${evt.stateKey}`;
        const existing = stateMap.get(key) || [];
        existing.push(evt);
        stateMap.set(key, existing);
      }
    }

    const resolved = new Map<string, DAGEvent>();
    for (const [key, candidates] of stateMap.entries()) {
      resolved.set(key, this.resolveState(candidates));
    }
    return resolved;
  }
}
