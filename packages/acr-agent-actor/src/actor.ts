import { BuddyManager, BuddyRecord } from './buddy-manager.js';
import { AgentMemoryStore, MemoryEntry } from './memory.js';

export interface AgentIdentity {
  did: string;
  handle?: string;
  publicKeyHex: string;
  capabilities: string[];
}

export interface InboundMessage {
  id: string;
  senderDid: string;
  recipientDid: string;
  roomId?: string;
  content: string;
  timestamp: number;
  signature: string;
  capabilityScope?: string;
}

export interface MessageDispatchResult {
  accepted: boolean;
  reason?: string;
  messageId: string;
  processedAt: number;
}

export class AcrAgentActor {
  public readonly identity: AgentIdentity;
  public readonly buddyManager: BuddyManager;
  public readonly memoryStore: AgentMemoryStore;
  private messageLog: InboundMessage[] = [];
  private isHibernating: boolean = false;

  constructor(identity: AgentIdentity) {
    if (!identity.did || (!identity.did.startsWith('did:key:') && !identity.did.startsWith('did:web:'))) {
      throw new Error(`AcrAgentActor requires a valid W3C DID (did:key or did:web), received: ${identity.did}`);
    }
    if (!identity.publicKeyHex || identity.publicKeyHex.length < 32) {
      throw new Error(`AcrAgentActor requires a valid cryptographic public key hex string.`);
    }

    this.identity = {
      did: identity.did,
      handle: identity.handle,
      publicKeyHex: identity.publicKeyHex,
      capabilities: identity.capabilities || ['chat.message.send', 'proposal.vote'],
    };
    this.buddyManager = new BuddyManager();
    this.memoryStore = new AgentMemoryStore();
  }

  public handleInboundMessage(msg: InboundMessage): MessageDispatchResult {
    // 1. Check if sender is blocked
    if (this.buddyManager.isBlocked(msg.senderDid)) {
      return {
        accepted: false,
        reason: `SENDER_BLOCKED: Messages from ${msg.senderDid} are blocked by recipient`,
        messageId: msg.id,
        processedAt: Date.now(),
      };
    }

    // 2. Validate capability grant if provided
    if (msg.capabilityScope && !this.identity.capabilities.includes(msg.capabilityScope)) {
      // If the actor doesn't support the requested capability
      return {
        accepted: false,
        reason: `UNSUPPORTED_CAPABILITY: Scope '${msg.capabilityScope}' not recognized`,
        messageId: msg.id,
        processedAt: Date.now(),
      };
    }

    // 3. Wake from hibernation if active
    if (this.isHibernating) {
      this.isHibernating = false;
    }

    // 4. Record into message log & memory
    this.messageLog.push(msg);
    this.memoryStore.set(`msg:${msg.id}`, {
      from: msg.senderDid,
      text: msg.content,
      ts: msg.timestamp,
    }, ['inbound_message']);

    return {
      accepted: true,
      messageId: msg.id,
      processedAt: Date.now(),
    };
  }

  public hibernate(): void {
    this.isHibernating = true;
  }

  public getHibernationState(): boolean {
    return this.isHibernating;
  }

  public getMessageHistory(limit = 50): InboundMessage[] {
    return this.messageLog.slice(-limit);
  }

  public serializeActorState(): {
    identity: AgentIdentity;
    buddies: Record<string, BuddyRecord>;
    memory: Record<string, MemoryEntry>;
    messageCount: number;
  } {
    return {
      identity: this.identity,
      buddies: this.buddyManager.exportState(),
      memory: this.memoryStore.exportState(),
      messageCount: this.messageLog.length,
    };
  }
}
