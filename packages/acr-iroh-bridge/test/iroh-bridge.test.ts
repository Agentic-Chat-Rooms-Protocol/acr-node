import assert from 'node:assert';
import test from 'node:test';
import { LocalIrohP2PNode, P2PStreamHandler } from '../dist/index.js';

test('P2PStreamHandler: encode and decode frame with checksum verification', () => {
  const handler = new P2PStreamHandler();
  const sourceKey = 'iroh-pubkey-node-alpha';
  const targetKey = 'iroh-pubkey-node-beta';
  const rawPayload = Buffer.from('Deliberation handshake payload', 'utf-8');

  const encoded = handler.encodeFrame(sourceKey, targetKey, rawPayload);
  const { frame, payload } = handler.decodeFrame(encoded);

  assert.strictEqual(frame.sourceKey, sourceKey);
  assert.strictEqual(frame.targetKey, targetKey);
  assert.strictEqual(payload.toString('utf-8'), 'Deliberation handshake payload');
});

test('LocalIrohP2PNode: registers peers and dials direct on reachable LAN', async () => {
  const node = new LocalIrohP2PNode('iroh-pubkey-local-operator');

  node.registerPeer({
    publicKey: 'iroh-pubkey-agent-sentinel',
    lanAddress: '192.168.1.105:11223',
    latencyMs: 0.35,
    lastSeen: Date.now(),
    isDirectReachable: true,
  });

  const dialRes = await node.dialPeer('iroh-pubkey-agent-sentinel');
  assert.strictEqual(dialRes.success, true);
  assert.strictEqual(dialRes.latencyMs, 0.35);

  const sendRes = node.sendDirectMessage('iroh-pubkey-agent-sentinel', 'Ping direct QUIC');
  assert.strictEqual(sendRes.success, true);
  assert.strictEqual(sendRes.frame?.targetKey, 'iroh-pubkey-agent-sentinel');
});

test('LocalIrohP2PNode: fails direct dial when NAT traversal blocked, signaling fallback', async () => {
  const node = new LocalIrohP2PNode('iroh-pubkey-local-operator');

  node.registerPeer({
    publicKey: 'iroh-pubkey-agent-remote',
    wanAddress: '203.0.113.50:44321',
    latencyMs: 45.0,
    lastSeen: Date.now(),
    isDirectReachable: false, // Symmetric NAT block
  });

  const dialRes = await node.dialPeer('iroh-pubkey-agent-remote');
  assert.strictEqual(dialRes.success, false);
  assert.match(dialRes.reason || '', /NAT_HOLE_PUNCH_FAILED/);

  const sendRes = node.sendDirectMessage('iroh-pubkey-agent-remote', 'Ping direct QUIC');
  assert.strictEqual(sendRes.success, false);
  assert.match(sendRes.reason || '', /CANNOT_SEND_DIRECT/);
});
