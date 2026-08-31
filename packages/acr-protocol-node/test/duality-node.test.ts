import assert from 'node:assert';
import test from 'node:test';
import { AcrProtocolNode } from '../dist/index.js';

test('AcrProtocolNode: routes direct P2P when peer is reachable on LAN', async () => {
  const node = new AcrProtocolNode({
    localAgentIdentity: {
      did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      handle: 'sentinel.acr',
      publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      capabilities: ['chat.message.send', 'proposal.vote'],
    },
    irohPublicKey: 'iroh-pubkey-node-alpha',
  });

  // Register local peer as reachable
  node.irohNode.registerPeer({
    publicKey: 'iroh-pubkey-peer-beta',
    lanAddress: '192.168.1.120:9988',
    latencyMs: 0.45,
    lastSeen: Date.now(),
    isDirectReachable: true,
  });

  const res = await node.sendMessage(
    'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    'iroh-pubkey-peer-beta',
    'Consensus message over local QUIC P2P'
  );

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.path, 'IROH_DIRECT_P2P');
  assert.strictEqual(res.latencyMs, 0.45);
  assert.strictEqual(node.dag.getAllEvents().length, 1);
});

test('AcrProtocolNode: falls back to Cloud Relay when peer is blocked by NAT', async () => {
  const node = new AcrProtocolNode({
    localAgentIdentity: {
      did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      handle: 'sentinel.acr',
      publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      capabilities: ['chat.message.send'],
    },
    irohPublicKey: 'iroh-pubkey-node-alpha',
  });

  // Register peer as blocked by symmetric NAT
  node.irohNode.registerPeer({
    publicKey: 'iroh-pubkey-peer-gamma',
    wanAddress: '198.51.100.10:8877',
    latencyMs: 38.0,
    lastSeen: Date.now(),
    isDirectReachable: false,
  });

  const res = await node.sendMessage(
    'did:key:z6Mkjv83Kds7834hskdjfsdf',
    'iroh-pubkey-peer-gamma',
    'Consensus message requiring cloud fallback relay'
  );

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.path, 'CLOUD_RELAY_FALLBACK');
  assert.strictEqual(res.latencyMs, 45.0);
  assert.strictEqual(res.details.relayed, true);
});

test('AcrProtocolNode: routes via Room Broadcast when room has >2 participants', async () => {
  const node = new AcrProtocolNode({
    localAgentIdentity: {
      did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      handle: 'sentinel.acr',
      publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      capabilities: ['chat.message.send'],
    },
    irohPublicKey: 'iroh-pubkey-node-alpha',
  });

  const room = node.joinRoom('war-room', 'Security War Room');
  room.onConnect('peer-2', { did: 'did:key:peer2', handle: 'agent2.acr', role: 'AGENT' });
  room.onConnect('peer-3', { did: 'did:key:peer3', handle: 'agent3.acr', role: 'AGENT' });

  const res = await node.sendMessage(
    'did:key:peer2',
    'iroh-pubkey-peer2',
    'Broadcast to all war room members',
    'war-room'
  );

  assert.strictEqual(res.success, true);
  assert.strictEqual(res.path, 'ROOM_BROADCAST_FALLBACK');
  assert.strictEqual(res.details.type, 'MESSAGE');
});
