import { ulid } from 'ulid'

export type CockpitProposalType =
  | 'cancel_issue'
  | 'restart_issue'
  | 'bulk_update_status'
  | 'create_issue'

export interface CockpitProposalParams {
  cancel_issue: { issueId: string }
  restart_issue: { issueId: string }
  bulk_update_status: { issueIds: string[], statusId: 'todo' | 'working' | 'review' | 'done' }
  create_issue: { projectId: string, title: string, statusId?: 'todo' | 'working' | 'review' | 'done' }
}

export interface CockpitProposal<T extends CockpitProposalType = CockpitProposalType> {
  id: string
  type: T
  params: CockpitProposalParams[T]
  summary: string
  createdAt: number
  status: 'pending' | 'approved' | 'rejected' | 'failed'
  result?: unknown
  error?: string
}

const PROPOSAL_TTL_MS = 30 * 60 * 1000 // 30 min

class ProposalStore {
  private map = new Map<string, CockpitProposal>()

  propose<T extends CockpitProposalType>(
    type: T,
    params: CockpitProposalParams[T],
    summary: string,
  ): CockpitProposal<T> {
    const proposal: CockpitProposal<T> = {
      id: ulid(),
      type,
      params,
      summary,
      createdAt: Date.now(),
      status: 'pending',
    }
    this.map.set(proposal.id, proposal as CockpitProposal)
    return proposal
  }

  get(id: string): CockpitProposal | undefined {
    const p = this.map.get(id)
    if (!p) return undefined
    if (p.status === 'pending' && Date.now() - p.createdAt > PROPOSAL_TTL_MS) {
      this.map.delete(id)
      return undefined
    }
    return p
  }

  listPending(): CockpitProposal[] {
    const now = Date.now()
    const out: CockpitProposal[] = []
    for (const [id, p] of this.map) {
      if (p.status !== 'pending') continue
      if (now - p.createdAt > PROPOSAL_TTL_MS) {
        this.map.delete(id)
        continue
      }
      out.push(p)
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }

  list(): CockpitProposal[] {
    return [...this.map.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /** Mark a proposal as approved (caller is responsible for dispatch). */
  markApproved(id: string, result: unknown): CockpitProposal | undefined {
    const p = this.get(id)
    if (!p || p.status !== 'pending') return undefined
    p.status = 'approved'
    p.result = result
    return p
  }

  markRejected(id: string): CockpitProposal | undefined {
    const p = this.get(id)
    if (!p || p.status !== 'pending') return undefined
    p.status = 'rejected'
    return p
  }

  markFailed(id: string, error: string): CockpitProposal | undefined {
    const p = this.get(id)
    if (!p || p.status !== 'pending') return undefined
    p.status = 'failed'
    p.error = error
    return p
  }

  /** Test-only: clear all proposals. */
  clear(): void {
    this.map.clear()
  }
}

export const proposalStore = new ProposalStore()
