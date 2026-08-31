import assert from 'node:assert';
import test from 'node:test';
import * as Y from 'yjs';
import { AwarenessStore, YSweetPresenceClient } from '../dist/index.js';

test('AwarenessStore: manages local states, typing flags, and reaps stale users', () => {
  const store = new AwarenessStore(50); // 50ms TTL

  store.setLocalState({
    did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    handle: 'sentinel.acr',
    isTyping: true,
    status: 'ONLINE',
    lastActive: Date.now(),
    focusedRoomId: 'consensus-main',
  });

  assert.strictEqual(store.getTypingUsers('consensus-main').length, 1);
  assert.strictEqual(store.getTypingUsers('consensus-main')[0], 'sentinel.acr');

  // Fast forward expiry simulation
  const state = store.getState('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK')!;
  state.lastActive = Date.now() - 100;
  const reaped = store.reapStale();
  assert.strictEqual(reaped.length, 1);
  assert.strictEqual(store.getAllActive().length, 0);
});

test('YSweetPresenceClient: syncs Yjs CRDT presence maps across multiple client instances', () => {
  const client1 = new YSweetPresenceClient({
    serverUrl: 'wss://y-sweet.local/sync',
    docId: 'room-consensus',
    userDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    userHandle: 'sentinel.acr',
  });
  client1.connect();

  const client2 = new YSweetPresenceClient({
    serverUrl: 'wss://y-sweet.local/sync',
    docId: 'room-consensus',
    userDid: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    userHandle: 'operator.acr',
  });
  client2.connect();

  // Client 1 types
  client1.updateTyping(true, 'consensus-main');

  // Simulate Yjs CRDT vector sync between client1 and client2
  const update1 = Y.encodeStateAsUpdate(client1.getRawYjsDoc());
  Y.applyUpdate(client2.getRawYjsDoc(), update1);

  // Client 2 should observe client 1 typing
  const typingIn2 = client2.getAwareness().getTypingUsers('consensus-main');
  assert.strictEqual(typingIn2.includes('sentinel.acr'), true);
});
