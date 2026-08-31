export type VoteChoice = 'APPROVE' | 'REJECT' | 'DISSENT';
export type ProposalStatus = 'OPEN' | 'VOTING' | 'PASSED' | 'REJECTED' | 'CLOSED';

export interface Vote {
  voterDid: string;
  choice: VoteChoice;
  rationale?: string;
  timestamp: number;
  signature: string;
}

export interface Proposal {
  id: string;
  roomId: string;
  creatorDid: string;
  title: string;
  description: string;
  status: ProposalStatus;
  createdAt: number;
  closesAt: number;
  votes: Map<string, Vote>;
  quorumThreshold: number;
}

export class ConsensusEngine {
  private proposals = new Map<string, Proposal>();

  public createProposal(params: {
    id: string;
    roomId: string;
    creatorDid: string;
    title: string;
    description: string;
    durationMs?: number;
    quorumThreshold?: number;
  }): Proposal {
    const proposal: Proposal = {
      id: params.id,
      roomId: params.roomId,
      creatorDid: params.creatorDid,
      title: params.title,
      description: params.description,
      status: 'OPEN',
      createdAt: Date.now(),
      closesAt: Date.now() + (params.durationMs || 3600000),
      votes: new Map<string, Vote>(),
      quorumThreshold: params.quorumThreshold || 2,
    };
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  public castVote(params: {
    proposalId: string;
    voterDid: string;
    choice: VoteChoice;
    rationale?: string;
    signature: string;
  }): Vote {
    const proposal = this.proposals.get(params.proposalId);
    if (!proposal) {
      throw new Error(`PROPOSAL_NOT_FOUND: Proposal ${params.proposalId} does not exist`);
    }
    if (proposal.status !== 'OPEN' && proposal.status !== 'VOTING') {
      throw new Error(`PROPOSAL_CLOSED: Cannot vote on proposal in state ${proposal.status}`);
    }

    // GAP-08 Mandatory Dissent Preservation Check
    if (params.choice === 'DISSENT') {
      const sanitizedRationale = this.sanitizeRationale(params.rationale);
      if (!sanitizedRationale || sanitizedRationale.length < 10) {
        throw new Error(`GAP_08_VIOLATION: DISSENT vote must be accompanied by a non-empty rationale of at least 10 printable characters`);
      }
      params.rationale = sanitizedRationale;
    }

    const vote: Vote = {
      voterDid: params.voterDid,
      choice: params.choice,
      rationale: params.rationale,
      timestamp: Date.now(),
      signature: params.signature,
    };

    proposal.votes.set(params.voterDid, vote);
    proposal.status = 'VOTING';

    // Check if quorum reached
    if (proposal.votes.size >= proposal.quorumThreshold) {
      this.evaluateConsensus(proposal);
    }

    return vote;
  }

  public evaluateConsensus(proposal: Proposal): ProposalStatus {
    let approves = 0;
    let rejects = 0;
    let dissents = 0;

    for (const v of proposal.votes.values()) {
      if (v.choice === 'APPROVE') approves++;
      else if (v.choice === 'REJECT') rejects++;
      else if (v.choice === 'DISSENT') dissents++;
    }

    if (approves > rejects + dissents) {
      proposal.status = 'PASSED';
    } else if (rejects >= approves) {
      proposal.status = 'REJECTED';
    }
    return proposal.status;
  }

  public getProposal(id: string): Proposal | undefined {
    return this.proposals.get(id);
  }

  public listProposals(roomId?: string): Proposal[] {
    const all = Array.from(this.proposals.values());
    return roomId ? all.filter((p) => p.roomId === roomId) : all;
  }

  private sanitizeRationale(rationale?: string): string {
    if (!rationale) return '';
    // Strip zero-width spaces and control characters
    return rationale
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\x00-\x1F\x7F]/g, '')
      .trim();
  }
}
