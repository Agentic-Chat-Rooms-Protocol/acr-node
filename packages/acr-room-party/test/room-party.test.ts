import assert from 'node:assert';
import test from 'node:test';
import { AcrRoomParty, ConsensusEngine } from '../dist/index.js';

test('AcrRoomParty: handles connect, disconnect, and broadcast', () => {
  const room = new AcrRoomParty('consensus-main', 'Consensus Main Floor');

  room.onConnect('conn-1', {
    did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    handle: 'sentinel.acr',
    role: 'AGENT',
  });

  room.onConnect('conn-2', {
    did: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    handle: 'operator.acr',
    role: 'OPERATOR',
  });

  assert.strictEqual(room.getActiveParticipants().length, 2);

  const env = room.broadcastMessage('did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK', 'Proposing network re-keying');
  assert.strictEqual(env.type, 'MESSAGE');
  assert.strictEqual(room.getMessageHistory().length, 1);

  room.onDisconnect('conn-1');
  assert.strictEqual(room.getActiveParticipants().length, 1);
});

test('ConsensusEngine: creates proposal and records votes', () => {
  const engine = new ConsensusEngine();
  const proposal = engine.createProposal({
    id: 'prop-001',
    roomId: 'consensus-main',
    creatorDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    title: 'Authorize Plugin Installation',
    description: 'Install @acr/plugin-webrtc v1.2.0',
    quorumThreshold: 2,
  });

  assert.strictEqual(proposal.status, 'OPEN');

  engine.castVote({
    proposalId: 'prop-001',
    voterDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    choice: 'APPROVE',
    signature: 'sig-approve',
  });

  assert.strictEqual(proposal.status, 'VOTING');
});

test('ConsensusEngine: GAP-08 strict mandatory dissent validation', () => {
  const engine = new ConsensusEngine();
  engine.createProposal({
    id: 'prop-002',
    roomId: 'consensus-main',
    creatorDid: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
    title: 'Migrate State Chain',
    description: 'Upgrade to protocol v0.9.3',
  });

  // Rejection of empty / whitespace dissent
  assert.throws(() => {
    engine.castVote({
      proposalId: 'prop-002',
      voterDid: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
      choice: 'DISSENT',
      rationale: '   ',
      signature: 'sig-dissent',
    });
  }, /GAP_08_VIOLATION/);

  // Rejection of short (<10 chars) dissent
  assert.throws(() => {
    engine.castVote({
      proposalId: 'prop-002',
      voterDid: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
      choice: 'DISSENT',
      rationale: 'No way',
      signature: 'sig-dissent',
    });
  }, /GAP_08_VIOLATION/);

  // Acceptance of valid dissent with substantial rationale
  const vote = engine.castVote({
    proposalId: 'prop-002',
    voterDid: 'did:key:z6MkrJVnaZkeFydQy385MaoHbj6QjgPfyZq7YDRKgBQnfEPw',
    choice: 'DISSENT',
    rationale: 'Cryptographic signature verification requires Ed25519 seed rotation before migration can safely proceed.',
    signature: 'sig-dissent-valid',
  });

  assert.strictEqual(vote.choice, 'DISSENT');
  assert.match(vote.rationale || '', /Ed25519 seed rotation/);
});
