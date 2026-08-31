import { Buffer } from 'node:buffer';
import { P2PStreamHandler, P2PFrame } from './stream-handler.js';

export interface PeerEndpoint {
  publicKey: string;
  lanAddress?: string;
  wanAddress?: string;
  latencyMs: number;
  lastSeen: number;
  isDirectReachable: boolean;
}

export class LocalIrohP2PNode {
  public readonly nodePublicKey: string;
  private peerTable = new Map<string, PeerEndpoint>();
  private streamHandler = new P2PStreamHandler();
  private messageListeners = new Set<(frame: P2PFrame) => void>();

  constructor(nodePublicKey: string) {
    if (!nodePublicKey || nodePublicKey.length < 16) {
      throw new Error(`Invalid Iroh node public key`);
    }
    this.nodePublicKey = nodePublicKey;
  }

  public registerPeer(endpoint: PeerEndpoint): void {
    this.peerTable.set(endpoint.publicKey, {
      ...endpoint,
      lastSeen: Date.now(),
    });
  }

  public getPeer(publicKey: string): PeerEndpoint | undefined {
    return this.peerTable.get(publicKey);
  }

  public async dialPeer(targetPublicKey: string): Promise<{ success: boolean; latencyMs: number; reason?: string }> {
    const peer = this.peerTable.get(targetPublicKey);
    if (!peer) {
      return {
        success: false,
        latencyMs: -1,
        reason: 'PEER_NOT_IN_ROUTING_TABLE: No known endpoint for target public key',
      };
    }

    if (!peer.isDirectReachable) {
      return {
        success: false,
        latencyMs: peer.latencyMs,
        reason: 'NAT_HOLE_PUNCH_FAILED: Symmetric NAT blocked direct UDP hole-punching',
      };
    }

    // Direct QUIC stream established
    return {
      success: true,
      latencyMs: peer.latencyMs || 0.4, // Sub-millisecond on LAN
    };
  }

  public sendDirectMessage(targetPublicKey: string, messageText: string): { success: boolean; frame?: P2PFrame; reason?: string } {
    const peer = this.peerTable.get(targetPublicKey);
    if (!peer || !peer.isDirectReachable) {
      return {
        success: false,
        reason: 'CANNOT_SEND_DIRECT: Peer not direct reachable, fallback required',
      };
    }

    const payload = Buffer.from(messageText, 'utf-8');
    const encoded = this.streamHandler.encodeFrame(this.nodePublicKey, targetPublicKey, payload);
    const { frame } = this.streamHandler.decodeFrame(encoded);

    for (const listener of this.messageListeners) {
      listener(frame);
    }

    return {
      success: true,
      frame,
    };
  }

  public onMessage(callback: (frame: P2PFrame) => void): () => void {
    this.messageListeners.add(callback);
    return () => this.messageListeners.delete(callback);
  }

  public listReachablePeers(): PeerEndpoint[] {
    return Array.from(this.peerTable.values()).filter((p) => p.isDirectReachable);
  }
}
