import type { AgentNode, AgoraState, EventRecord, HandoffReceipt, TaskRecord } from './types.js';

const now = () => new Date().toISOString();

export class TaskLedger {
  private state: AgoraState;
  private readonly initialSeed?: Partial<AgoraState>;

  constructor(seed?: Partial<AgoraState>) {
    this.initialSeed = seed;
    this.state = {
      agents: seed?.agents ?? [
        agent('planner-1', 'planner', 'Planner'),
        agent('researcher-1', 'researcher', 'Researcher'),
        agent('builder-1', 'builder', 'Builder'),
        agent('verifier-1', 'verifier', 'Verifier'),
        agent('critic-1', 'critic', 'Critic'),
        agent('recovery-1', 'recovery_coordinator', 'Recovery Coordinator'),
      ],
      tasks: seed?.tasks ?? [
        {
          id: 'task-agora-demo',
          title: 'Produce AGORA resilient agent report',
          status: 'running',
          assignedAgentId: 'builder-1',
          completedParts: ['requirements captured', 'task graph drafted'],
          failedParts: [],
          evidence: ['BuilderBase requires failure injection, fallback path, and UX continuity'],
          updatedAt: now(),
        },
      ],
      events: seed?.events ?? [],
      receipts: seed?.receipts ?? [],
    };
    if (this.state.events.length === 0) this.event('info', 'AGORA ledger initialized', 'planner-1');
  }

  reset(): AgoraState {
    this.state = new TaskLedger(this.initialSeed).snapshot();
    return this.snapshot();
  }

  snapshot(): AgoraState {
    return structuredClone(this.state);
  }

  event(
    severity: EventRecord['severity'],
    message: string,
    agentId?: string,
    taskId?: string,
    type = 'event',
  ): EventRecord {
    const record: EventRecord = {
      id: `evt-${this.state.events.length + 1}`,
      at: now(),
      type,
      message,
      agentId,
      taskId,
      severity,
    };
    this.state.events.push(record);
    return record;
  }

  markAgent(id: string, status: AgentNode['status'], currentTaskId?: string): void {
    const a = this.agent(id);
    a.status = status;
    a.currentTaskId = currentTaskId;
    a.lastHeartbeat = now();
    this.event(status === 'failed' ? 'error' : 'info', `${a.label} status -> ${status}`, id, currentTaskId, 'agent');
  }

  applyReceipt(receipt: HandoffReceipt): void {
    this.state.receipts.push(receipt);
    const task = this.task(receipt.taskId);
    task.previousAgentId = receipt.failedAgentId;
    task.assignedAgentId = receipt.takeoverAgentId;
    task.status = receipt.recoveryStatus === 'primary_restored' ? 'running' : 'partial';
    task.completedParts = [...receipt.completedParts];
    task.failedParts = [...receipt.failedParts];
    task.evidence = [...new Set([...task.evidence, ...receipt.evidenceSeen])];
    task.updatedAt = now();
    this.markAgent(receipt.takeoverAgentId, 'busy', receipt.taskId);
    this.event('success', `handoff receipt ${receipt.id}: ${receipt.failedAgentId} -> ${receipt.takeoverAgentId}`, receipt.takeoverAgentId, receipt.taskId, 'handoff');
  }

  startTask(taskId: string, title: string, assignedAgentId = 'planner-1'): void {
    const task = this.task(taskId);
    task.title = title;
    task.status = 'running';
    task.assignedAgentId = assignedAgentId;
    task.previousAgentId = undefined;
    task.completedParts = [];
    task.failedParts = [];
    task.evidence = [`task requested: ${title}`];
    task.artifacts = {};
    task.updatedAt = now();
    this.event('info', `task started: ${title}`, assignedAgentId, taskId, 'task');
  }

  saveArtifact(taskId: string, agentId: string, key: string, value: string): void {
    const task = this.task(taskId);
    task.artifacts ??= {};
    task.artifacts[`${agentId}:${key}`] = value;
    task.updatedAt = now();
    const preview = value.slice(0, 60).replace(/\s+/g, ' ');
    this.event('info', `artifact saved: ${key} (${value.length} chars) - "${preview}..."`, agentId, taskId, 'artifact');
  }

  complete(taskId: string, summary: string): void {
    const task = this.task(taskId);
    task.status = 'completed';
    if (!task.completedParts.includes(summary)) task.completedParts.push(summary);
    task.updatedAt = now();
    this.event('success', `task completed: ${summary}`, task.assignedAgentId, taskId, 'task');
  }

  degrade(taskId: string, summary: string): void {
    const task = this.task(taskId);
    task.status = 'degraded';
    if (!task.failedParts.includes(summary)) task.failedParts.push(summary);
    task.updatedAt = now();
    this.event('warn', `task degraded: ${summary}`, task.assignedAgentId, taskId, 'task');
  }

  private agent(id: string): AgentNode {
    const agent = this.state.agents.find(a => a.id === id);
    if (!agent) throw new Error(`unknown agent: ${id}`);
    return agent;
  }

  private task(id: string): TaskRecord {
    const task = this.state.tasks.find(t => t.id === id);
    if (!task) throw new Error(`unknown task: ${id}`);
    return task;
  }
}

function agent(id: AgentNode['id'], role: AgentNode['role'], label: string): AgentNode {
  return { id, role, label, status: 'healthy', lastHeartbeat: now() };
}
