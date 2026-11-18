import { AcrAgentActor, AgentIdentity } from '@acr-js/agent-actor';
import { AcrRoomParty } from '@acr-js/room-party';
import { LocalIrohP2PNode } from '@acr-js/iroh-bridge';
import { YSweetPresenceClient } from '@acr-js/presence-crdt';
import { MerkleDAG } from '@acr-js/federation';
import { DualityRouter } from './duality-router.js';
import { DEFAULT_LOCAL_URL, resolveLocalDaemonUrl } from './mcpendpoint.js';

export interface NodeConfig {
  localAgentIdentity: AgentIdentity;
  irohPublicKey: string;
  presenceServerUrl?: string;
  daemonUrl?: string;
}

export class AcrProtocolNode {
  public readonly localAgent: AcrAgentActor;
  public readonly irohNode: LocalIrohP2PNode;
  public readonly router: DualityRouter;
  public readonly dag: MerkleDAG;
  public readonly presenceClient?: YSweetPresenceClient;
  public readonly daemonUrl: string;
  private rooms = new Map<string, AcrRoomParty>();

  constructor(config: NodeConfig) {
    this.localAgent = new AcrAgentActor(config.localAgentIdentity);
    this.irohNode = new LocalIrohP2PNode(config.irohPublicKey);
    this.dag = new MerkleDAG();
    this.daemonUrl = config.daemonUrl
      ? resolveLocalDaemonUrl(config.daemonUrl)
      : resolveLocalDaemonUrl(DEFAULT_LOCAL_URL);

    if (config.presenceServerUrl) {
      this.presenceClient = new YSweetPresenceClient({
        serverUrl: config.presenceServerUrl,
        docId: `presence-node-${config.localAgentIdentity.did}`,
        userDid: config.localAgentIdentity.did,
        userHandle: config.localAgentIdentity.handle,
      });
      this.presenceClient.connect();
    }

    this.router = new DualityRouter(this.irohNode, this.presenceClient);
  }

  public joinRoom(roomId: string, name: string): AcrRoomParty {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new AcrRoomParty(roomId, name);
      this.rooms.set(roomId, room);
      this.router.registerRoom(room);
    }
    room.onConnect(`conn-${this.localAgent.identity.did}`, {
      did: this.localAgent.identity.did,
      handle: this.localAgent.identity.handle,
      role: 'AGENT',
    });
    return room;
  }

  public async sendMessage(targetDid: string, targetPublicKey: string, content: string, roomId?: string) {
    // 1. Record in Merkle DAG
    this.dag.addEvent({
      roomId: roomId || 'direct',
      senderDid: this.localAgent.identity.did,
      eventType: 'MESSAGE',
      payload: { content, targetDid },
    });

    // 2. Dispatch via Duality Router
    return this.router.dispatchMessage({
      senderDid: this.localAgent.identity.did,
      targetDid,
      targetPublicKey,
      content,
      roomId,
    });
  }
}
