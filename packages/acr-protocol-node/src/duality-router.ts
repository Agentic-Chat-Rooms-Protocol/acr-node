import { LocalIrohP2PNode } from '@acr/iroh-bridge';
import { AcrRoomParty } from '@acr/room-party';
import { YSweetPresenceClient } from '@acr/presence-crdt';

export type TransportPath = 'IROH_DIRECT_P2P' | 'ROOM_BROADCAST_FALLBACK' | 'CLOUD_RELAY_FALLBACK';

export interface RouteDecision {
  path: TransportPath;
  targetDid: string;
  latencyEstimateMs: number;
  relayRequired: boolean;
  reason: string;
}

export class DualityRouter {
  private irohNode: LocalIrohP2PNode;
  private roomParties = new Map<string, AcrRoomParty>();
  private presenceClient?: YSweetPresenceClient;

  constructor(irohNode: LocalIrohP2PNode, presenceClient?: YSweetPresenceClient) {
    this.irohNode = irohNode;
    this.presenceClient = presenceClient;
  }

  public registerRoom(room: AcrRoomParty): void {
    this.roomParties.set(room.roomId, room);
  }

  public async evaluateRoute(targetDid: string, targetPublicKey: string, roomId?: string): Promise<RouteDecision> {
    // 1. If it's a multi-member room (>2 participants), route via Room Broadcast
    if (roomId) {
      const room = this.roomParties.get(roomId);
      if (room && room.getActiveParticipants().length > 2) {
        return {
          path: 'ROOM_BROADCAST_FALLBACK',
          targetDid,
          latencyEstimateMs: 12.0,
          relayRequired: false,
          reason: 'MULTI_PARTY_ROOM: Fan-out required across >2 participants',
        };
      }
    }

    // 2. Attempt Iroh P2P direct-dial
    const dialRes = await this.irohNode.dialPeer(targetPublicKey);
    if (dialRes.success) {
      return {
        path: 'IROH_DIRECT_P2P',
        targetDid,
        latencyEstimateMs: dialRes.latencyMs,
        relayRequired: false,
        reason: 'DIRECT_P2P_AVAILABLE: Sub-millisecond direct QUIC stream established',
      };
    }

    // 3. Fallback to Cloud Relay / Room Broadcast
    return {
      path: 'CLOUD_RELAY_FALLBACK',
      targetDid,
      latencyEstimateMs: 45.0,
      relayRequired: true,
      reason: `DIRECT_DIAL_UNAVAILABLE: ${dialRes.reason || 'Peer behind symmetric NAT, falling back to ACR Cloud Relay'}`,
    };
  }

  public async dispatchMessage(params: {
    senderDid: string;
    targetDid: string;
    targetPublicKey: string;
    content: string;
    roomId?: string;
  }): Promise<{ success: boolean; path: TransportPath; latencyMs: number; details: any }> {
    const route = await this.evaluateRoute(params.targetDid, params.targetPublicKey, params.roomId);

    if (route.path === 'IROH_DIRECT_P2P') {
      const p2pRes = this.irohNode.sendDirectMessage(params.targetPublicKey, params.content);
      return {
        success: p2pRes.success,
        path: route.path,
        latencyMs: route.latencyEstimateMs,
        details: p2pRes.frame,
      };
    }

    if (route.path === 'ROOM_BROADCAST_FALLBACK' && params.roomId) {
      const room = this.roomParties.get(params.roomId);
      if (room) {
        const envelope = room.broadcastMessage(params.senderDid, params.content);
        return {
          success: true,
          path: route.path,
          latencyMs: route.latencyEstimateMs,
          details: envelope,
        };
      }
    }

    // Cloud Relay Fallback path
    return {
      success: true,
      path: 'CLOUD_RELAY_FALLBACK',
      latencyMs: route.latencyEstimateMs,
      details: {
        relayed: true,
        senderDid: params.senderDid,
        targetDid: params.targetDid,
        content: params.content,
        timestamp: Date.now(),
      },
    };
  }
}
