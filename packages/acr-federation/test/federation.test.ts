import assert from 'node:assert';
import test from 'node:test';
import { MerkleDAG, StateResolver, canonicalJsonStringify } from '../dist/index.js';

test('canonicalJsonStringify: produces deterministic RFC 8785 output regardless of key order', () => {
  const obj1 = { z: 1, a: 2, m: { b: 3, a: 4 } };
  const obj2 = { a: 2, m: { a: 4, b: 3 }, z: 1 };

  const s1 = canonicalJsonStringify(obj1);
  const s2 = canonicalJsonStringify(obj2);

  assert.strictEqual(s1, s2);
  assert.strictEqual(s1, '{"a":2,"m":{"a":4,"b":3},"z":1}');
});

test('MerkleDAG: chains events with deterministic SHA-256 hashes and depth tracking', () => {
  const dag = new MerkleDAG();

  const evt1 = dag.addEvent({
    roomId: 'consensus-main',
    senderDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    eventType: 'ROOM_CREATE',
    payload: { name: 'Consensus Main' },
  });

  assert.strictEqual(evt1.depth, 1);
  assert.strictEqual(evt1.prevEvents.length, 0);

  const evt2 = dag.addEvent({
    roomId: 'consensus-main',
    senderDid: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    eventType: 'MESSAGE',
    payload: { text: 'Hello federation' },
  });

  assert.strictEqual(evt2.depth, 2);
  assert.deepStrictEqual(evt2.prevEvents, [evt1.id]);
});

test('StateResolver: resolves conflicting state keys based on depth and determinism', () => {
  const resolver = new StateResolver();

  const evtForkA = {
    id: 'evt-fork-a',
    roomId: 'consensus-main',
    senderDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    eventType: 'MEMBERSHIP' as const,
    stateKey: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    prevEvents: ['evt-root'],
    depth: 3,
    payload: { role: 'MEMBER' },
    timestamp: 1000,
    hash: 'aaa',
  };

  const evtForkB = {
    id: 'evt-fork-b',
    roomId: 'consensus-main',
    senderDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    eventType: 'MEMBERSHIP' as const,
    stateKey: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    prevEvents: ['evt-root'],
    depth: 4, // Higher depth in DAG
    payload: { role: 'ADMIN' },
    timestamp: 1050,
    hash: 'bbb',
  };

  const winner = resolver.resolveState([evtForkA, evtForkB]);
  assert.strictEqual(winner.id, 'evt-fork-b');
  assert.strictEqual(winner.payload.role, 'ADMIN');
});
