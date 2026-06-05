export type AgentRole = 'planner' | 'researcher' | 'builder' | 'verifier' | 'critic' | 'recovery_coordinator';

export type AgentStatus = 'healthy' | 'busy' | 'degraded' | 'failed';

export type FailureKind =
  | 'timeout'
  | 'bad_output'
  | 'contradiction'
  | 'stale_context'
  | 'tool_error'
  | 'lost_agent'
  | 'human_boundary';

export type TaskStatus = 'pending' | 'running' | 'blocked' | 'partial' | 'completed' | 'degraded' | 'failed';

export interface AgentNode {
  id: string;
  role: AgentRole;
  label: string;
  status: AgentStatus;
  currentTaskId?: string;
  lastHeartbeat: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  status: TaskStatus;
  assignedAgentId: string;
  previousAgentId?: string;
  completedParts: string[];
  failedParts: string[];
  evidence: string[];
  artifacts?: Record<string, string>;
  updatedAt: string;
}

export interface EventRecord {
  id: string;
  at: string;
  type: string;
  message: string;
  agentId?: string;
  taskId?: string;
  severity: 'info' | 'warn' | 'error' | 'success';
}

export interface HandoffReceipt {
  id: string;
  failedAgentId: string;
  takeoverAgentId: string;
  taskId: string;
  failureKind: FailureKind;
  evidenceSeen: string[];
  completedParts: string[];
  failedParts: string[];
  recoveryStatus: 'degraded_mode' | 'reassigned' | 'primary_restored';
  gateway?: GatewayEvidence;
  createdAt: string;
}

export interface GatewayEvidence {
  gateway_mode: 'live' | 'simulation';
  model_used: string;
  fallback_triggered: boolean;
}

export interface AgoraState {
  agents: AgentNode[];
  tasks: TaskRecord[];
  events: EventRecord[];
  receipts: HandoffReceipt[];
}
