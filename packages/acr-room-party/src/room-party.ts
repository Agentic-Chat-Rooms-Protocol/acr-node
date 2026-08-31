import { ConsensusEngine, Proposal, Vote } from './consensus-engine.js';

export interface RoomParticipant {
  did: string;
  handle?: string;
  role: 'OPERATOR' | 'AGENT' | 'OBSERVER';
  joinedAt: number;
  connectionId: string;
}

export interface BroadcastEnvelope {
  type: 'MESSAGE' | 'BALLOT_NEW' | 'BALLOT_VOTE' | 'PRESENCE_SYNC' | 'MEMBERSHIP_EVENT';
  roomId: string;
  senderDid: string;
  payload: any;
  timestamp: number;
}

export class AcrRoomParty {
  public readonly roomId: string;
  public readonly name: string;
  public readonly isPrivate: boolean;
  public readonly consensusEngine: ConsensusEngine;
  private participants = new Map<string, RoomParticipant>(); // key: connectionId
  private messageHistory: BroadcastEnvelope[] = [];

  constructor(roomId: string, name: string, isPrivate = false) {
    this.roomId = roomId;
    this.name = name;
    this.isPrivate = isPrivate;
    this.consensusEngine = new ConsensusEngine();
  }

  public onConnect(connectionId: string, participant: Omit<RoomParticipant, 'joinedAt' | 'connectionId'>): RoomParticipant {
    const p: RoomParticipant = {
      ...participant,
      connectionId,
      joinedAt: Date.now(),
    };
    this.participants.set(connectionId, p);
    return p;
  }

  public onDisconnect(connectionId: string): RoomParticipant | undefined {
    const p = this.participants.get(connectionId);
    if (p) {
      this.participants.delete(connectionId);
    }
    return p;
  }

  public broadcastMessage(senderDid: string, content: string, msgType: BroadcastEnvelope['type'] = 'MESSAGE'): BroadcastEnvelope {
    const envelope: BroadcastEnvelope = {
      type: msgType,
      roomId: this.roomId,
      senderDid,
      payload: { content },
      timestamp: Date.now(),
    };
    this.messageHistory.push(envelope);
    return envelope;
  }

  public getActiveParticipants(): RoomParticipant[] {
    return Array.from(this.participants.values());
  }

  public getMessageHistory(limit = 100): BroadcastEnvelope[] {
    return this.messageHistory.slice(-limit);
  }
}
