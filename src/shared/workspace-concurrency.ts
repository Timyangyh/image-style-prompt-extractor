export const WORKSPACE_CONCURRENCY_LIMIT = 5;

export const WORKFLOW_LINEAGE_MARKERS = [1, 2, 3, 4, 5] as const;

export type WorkflowLineageMarker = (typeof WORKFLOW_LINEAGE_MARKERS)[number];

export const WORKSPACE_CAPACITY_REACHED = "WORKSPACE_CAPACITY_REACHED" as const;

export type WorkspaceKind = "extraction" | "generation" | "image_edit";

export type WorkspaceLifecycleStatus =
  | "setup"
  | "queued"
  | "running"
  | "succeeded"
  | "partial_failed"
  | "failed"
  | "canceled";

export interface WorkflowOperationToken {
  workflowId: string;
  operationId: string;
  revision: number;
}

export interface WorkflowIdentityState {
  id: string;
  revision: number;
  operationId?: string;
}

export interface BatchAdmission<T> {
  accepted: T[];
  rejected: T[];
  occupied: number;
  available: number;
}

export interface WorkspaceCapacityDetails {
  code: typeof WORKSPACE_CAPACITY_REACHED;
  workspace: WorkspaceKind;
  limit: number;
  occupied: number;
  rejectedCount: number;
}

export const createWorkflowLineageMarkerMap = (
  lineageKeys: readonly string[],
  existingMarkers: ReadonlyMap<string, WorkflowLineageMarker> = new Map()
): Map<string, WorkflowLineageMarker> => {
  const visibleKeys = Array.from(
    new Set(lineageKeys.map((rawKey) => rawKey.trim()).filter(Boolean))
  );
  const markerByKey = new Map<string, WorkflowLineageMarker>();
  const usedMarkers = new Set<WorkflowLineageMarker>();
  for (const key of visibleKeys) {
    const existingMarker = existingMarkers.get(key);
    if (!existingMarker || usedMarkers.has(existingMarker)) continue;
    markerByKey.set(key, existingMarker);
    usedMarkers.add(existingMarker);
  }
  for (const key of visibleKeys) {
    if (markerByKey.has(key)) continue;
    const marker =
      WORKFLOW_LINEAGE_MARKERS.find((candidate) => !usedMarkers.has(candidate)) ||
      WORKFLOW_LINEAGE_MARKERS[markerByKey.size % WORKFLOW_LINEAGE_MARKERS.length];
    markerByKey.set(key, marker);
    usedMarkers.add(marker);
  }
  return markerByKey;
};

export const workflowLineageMarkerForKey = (
  markerByKey: ReadonlyMap<string, WorkflowLineageMarker>,
  lineageKey: string
): WorkflowLineageMarker => markerByKey.get(lineageKey) ?? WORKFLOW_LINEAGE_MARKERS[0];

export const isWorkspaceStatusActive = (status: WorkspaceLifecycleStatus): boolean =>
  status === "setup" || status === "queued" || status === "running";

export const isWorkspaceStatusTerminal = (status: WorkspaceLifecycleStatus): boolean =>
  !isWorkspaceStatusActive(status);

export const countActiveWorkflows = <T extends { status: WorkspaceLifecycleStatus }>(workflows: readonly T[]): number =>
  workflows.reduce((count, workflow) => count + (isWorkspaceStatusActive(workflow.status) ? 1 : 0), 0);

export const remainingWorkspaceCapacity = <T extends { status: WorkspaceLifecycleStatus }>(
  workflows: readonly T[],
  limit = WORKSPACE_CONCURRENCY_LIMIT
): number => Math.max(0, limit - countActiveWorkflows(workflows));

export const admitBatchInputs = <T, Workflow extends { status: WorkspaceLifecycleStatus }>(
  inputs: readonly T[],
  workflows: readonly Workflow[],
  limit = WORKSPACE_CONCURRENCY_LIMIT
): BatchAdmission<T> => {
  const occupied = countActiveWorkflows(workflows);
  const available = Math.max(0, limit - occupied);
  return {
    accepted: inputs.slice(0, available),
    rejected: inputs.slice(available),
    occupied,
    available
  };
};

export const updateWorkflowById = <T extends { id: string }>(
  workflows: readonly T[],
  workflowId: string,
  updater: (workflow: T) => T
): T[] => {
  let changed = false;
  const next = workflows.map((workflow) => {
    if (workflow.id !== workflowId) return workflow;
    const updated = updater(workflow);
    changed ||= updated !== workflow;
    return updated;
  });
  return changed ? next : (workflows as T[]);
};

export const isWorkflowOperationCurrent = (
  workflow: WorkflowIdentityState | undefined,
  token: WorkflowOperationToken
): boolean =>
  Boolean(
    workflow &&
      workflow.id === token.workflowId &&
      workflow.revision === token.revision &&
      workflow.operationId === token.operationId
  );

export const updateWorkflowForOperation = <T extends WorkflowIdentityState>(
  workflows: readonly T[],
  token: WorkflowOperationToken,
  updater: (workflow: T) => T
): T[] => {
  const workflow = workflows.find((item) => item.id === token.workflowId);
  if (!isWorkflowOperationCurrent(workflow, token)) return workflows as T[];
  return updateWorkflowById(workflows, token.workflowId, updater);
};

export const workspaceCapacityDetails = (
  workspace: WorkspaceKind,
  occupied: number,
  rejectedCount = 1,
  limit = WORKSPACE_CONCURRENCY_LIMIT
): WorkspaceCapacityDetails => ({
  code: WORKSPACE_CAPACITY_REACHED,
  workspace,
  limit,
  occupied,
  rejectedCount
});
