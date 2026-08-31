import assert from 'node:assert';
import test from 'node:test';
import { AcrAgentActor } from '../dist/actor.js';

test('AcrAgentActor: requires valid W3C DID', () => {
  assert.throws(() => {
    new AcrAgentActor({
      did: 'invalid-string-id',
      publicKeyHex: '0123456789abcdef0123456789abcdef',
      capabilities: ['chat.message.send'],
    });
  }, /requires a valid W3C DID/);
});

test('AcrAgentActor: instantiates with valid did:key and manages memory', () => {
  const actor = new AcrAgentActor({
    did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    handle: 'sentinel.acr',
    publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    capabilities: ['chat.message.send', 'proposal.vote'],
  });

  assert.strictEqual(actor.identity.did, 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK');
  assert.strictEqual(actor.identity.handle, 'sentinel.acr');

  actor.memoryStore.set('session:init', { timestamp: 123456789 });
  assert.deepStrictEqual(actor.memoryStore.get('session:init'), { timestamp: 123456789 });
});

test('AcrAgentActor: enforces buddy-blocking on inbound messages', () => {
  const actor = new AcrAgentActor({
    did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    capabilities: ['chat.message.send'],
  });

  const spammerDid = 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw';
  actor.buddyManager.blockBuddy(spammerDid);
  assert.strictEqual(actor.buddyManager.isBlocked(spammerDid), true);

  const res = actor.handleInboundMessage({
    id: 'msg-001',
    senderDid: spammerDid,
    recipientDid: actor.identity.did,
    content: 'Spam payload',
    timestamp: Date.now(),
    signature: 'sig-test',
  });

  assert.strictEqual(res.accepted, false);
  assert.match(res.reason || '', /SENDER_BLOCKED/);
});

test('AcrAgentActor: accepts message and records to memory log', () => {
  const actor = new AcrAgentActor({
    did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    publicKeyHex: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    capabilities: ['chat.message.send'],
  });

  actor.hibernate();
  assert.strictEqual(actor.getHibernationState(), true);

  const peerDid = 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw';
  const res = actor.handleInboundMessage({
    id: 'msg-002',
    senderDid: peerDid,
    recipientDid: actor.identity.did,
    content: 'Deliberation ballot invitation',
    timestamp: Date.now(),
    signature: 'sig-test',
  });

  assert.strictEqual(res.accepted, true);
  assert.strictEqual(actor.getHibernationState(), false); // Woke from hibernation
  assert.strictEqual(actor.getMessageHistory().length, 1);
});
