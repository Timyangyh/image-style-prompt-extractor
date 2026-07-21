import { describe, expect, it } from "vitest";
import {
  WORKSPACE_CAPACITY_REACHED,
  WORKSPACE_CONCURRENCY_LIMIT,
  admitBatchInputs,
  countActiveWorkflows,
  createWorkflowLineageMarkerMap,
  isWorkspaceStatusActive,
  isWorkspaceStatusTerminal,
  isWorkflowOperationCurrent,
  remainingWorkspaceCapacity,
  updateWorkflowById,
  updateWorkflowForOperation,
  workflowLineageMarkerForKey,
  workspaceCapacityDetails,
  type WorkspaceLifecycleStatus
} from "./workspace-concurrency";

type TestWorkflow = {
  id: string;
  revision: number;
  operationId?: string;
  status: WorkspaceLifecycleStatus;
  value: string;
};

const workflow = (id: string, status: WorkspaceLifecycleStatus = "setup"): TestWorkflow => ({
  id,
  revision: 0,
  status,
  value: id
});

describe("workspace concurrency rules", () => {
  it("treats setup, queued and running as active and every terminal status as released", () => {
    expect(["setup", "queued", "running"].every((status) => isWorkspaceStatusActive(status as WorkspaceLifecycleStatus))).toBe(true);
    expect(["succeeded", "partial_failed", "failed", "canceled"].every((status) => isWorkspaceStatusTerminal(status as WorkspaceLifecycleStatus))).toBe(true);
  });

  it("admits the first five workflows and rejects the sixth deterministically", () => {
    const decision = admitBatchInputs(["A", "B", "C", "D", "E", "F"], []);
    expect(decision.accepted).toEqual(["A", "B", "C", "D", "E"]);
    expect(decision.rejected).toEqual(["F"]);
    expect(decision.available).toBe(WORKSPACE_CONCURRENCY_LIMIT);
  });

  it("partially accepts a batch in input order based on remaining capacity", () => {
    const active = [workflow("1", "running"), workflow("2", "setup"), workflow("done", "succeeded")];
    const decision = admitBatchInputs(["A", "B", "C", "D", "E"], active);
    expect(decision.accepted).toEqual(["A", "B", "C"]);
    expect(decision.rejected).toEqual(["D", "E"]);
    expect(decision.occupied).toBe(2);
  });

  it("counts extraction, generation and image-edit pools independently", () => {
    const extraction = Array.from({ length: 5 }, (_, index) => workflow(`extract-${index}`, "running"));
    const generation = Array.from({ length: 4 }, (_, index) => workflow(`generate-${index}`, "queued"));
    const imageEdit: TestWorkflow[] = [];
    expect(remainingWorkspaceCapacity(extraction)).toBe(0);
    expect(remainingWorkspaceCapacity(generation)).toBe(1);
    expect(remainingWorkspaceCapacity(imageEdit)).toBe(5);
  });

  it("releases capacity for every terminal state but not for collapsed active rows", () => {
    const states: WorkspaceLifecycleStatus[] = [
      "setup",
      "queued",
      "running",
      "succeeded",
      "partial_failed",
      "failed",
      "canceled"
    ];
    const items = states.map((status, index) => ({ ...workflow(String(index), status), collapsed: true }));
    expect(countActiveWorkflows(items)).toBe(3);
    expect(remainingWorkspaceCapacity(items)).toBe(2);
  });

  it("updates only the workflow selected by stable id", () => {
    const items = [workflow("A"), workflow("B"), workflow("C")];
    const next = updateWorkflowById(items, "B", (item) => ({ ...item, value: "updated" }));
    expect(next.map((item) => item.value)).toEqual(["A", "updated", "C"]);
    expect(next[0]).toBe(items[0]);
    expect(next[2]).toBe(items[2]);
  });

  it("accepts only the current operation token", () => {
    const current = { ...workflow("A", "running"), revision: 4, operationId: "op-new" };
    expect(isWorkflowOperationCurrent(current, { workflowId: "A", revision: 4, operationId: "op-new" })).toBe(true);
    expect(isWorkflowOperationCurrent(current, { workflowId: "A", revision: 3, operationId: "op-new" })).toBe(false);
    expect(isWorkflowOperationCurrent(current, { workflowId: "A", revision: 4, operationId: "op-old" })).toBe(false);
  });

  it("drops reverse-order and deleted-workflow responses without changing another page", () => {
    const items = [
      { ...workflow("A", "running"), revision: 2, operationId: "A-new" },
      { ...workflow("B", "running"), revision: 1, operationId: "B-op" }
    ];
    const stale = updateWorkflowForOperation(
      items,
      { workflowId: "A", revision: 1, operationId: "A-old" },
      (item) => ({ ...item, value: "stale" })
    );
    const deleted = updateWorkflowForOperation(
      items,
      { workflowId: "missing", revision: 1, operationId: "missing-op" },
      (item) => ({ ...item, value: "resurrected" })
    );
    expect(stale).toBe(items);
    expect(deleted).toBe(items);
    expect(items.map((item) => item.value)).toEqual(["A", "B"]);
  });

  it("builds a stable capacity error payload without user content", () => {
    expect(workspaceCapacityDetails("image_edit", 5, 3)).toEqual({
      code: WORKSPACE_CAPACITY_REACHED,
      workspace: "image_edit",
      limit: 5,
      occupied: 5,
      rejectedCount: 3
    });
  });

  it("reuses one visual marker for the same lineage across workspaces", () => {
    const markers = createWorkflowLineageMarkerMap([
      "history:A",
      "history:B",
      "history:A",
      "history:B",
      "history:A"
    ]);

    expect(markers.size).toBe(2);
    expect(workflowLineageMarkerForKey(markers, "history:A")).toBe(1);
    expect(workflowLineageMarkerForKey(markers, "history:B")).toBe(2);
  });

  it("uses the fixed five markers in order and cycles only after the fifth lineage", () => {
    const markers = createWorkflowLineageMarkerMap([
      "lineage:A",
      "lineage:B",
      "lineage:C",
      "lineage:D",
      "lineage:E",
      "lineage:F"
    ]);

    expect(Array.from(markers.values())).toEqual([1, 2, 3, 4, 5, 1]);
  });

  it("ignores empty lineage keys and falls back to the first marker", () => {
    const markers = createWorkflowLineageMarkerMap(["", "  ", "history:A"]);

    expect(Array.from(markers.entries())).toEqual([["history:A", 1]]);
    expect(workflowLineageMarkerForKey(markers, "missing")).toBe(1);
  });

  it("keeps existing markers stable when earlier workflows disappear", () => {
    const first = createWorkflowLineageMarkerMap(["history:A", "history:B", "history:C"]);
    const next = createWorkflowLineageMarkerMap(["history:B", "history:C", "history:D"], first);

    expect(workflowLineageMarkerForKey(next, "history:B")).toBe(2);
    expect(workflowLineageMarkerForKey(next, "history:C")).toBe(3);
    expect(workflowLineageMarkerForKey(next, "history:D")).toBe(1);
  });

  it("reuses the marker freed by a closed non-first workflow before creating a collision", () => {
    const first = createWorkflowLineageMarkerMap(["A", "B", "C", "D", "E"]);
    const next = createWorkflowLineageMarkerMap(["A", "C", "D", "E", "F"], first);

    expect(Array.from(next.entries())).toEqual([
      ["A", 1],
      ["C", 3],
      ["D", 4],
      ["E", 5],
      ["F", 2]
    ]);
  });

  it("removes stale marker collisions after the visible set returns to five lineages", () => {
    const overflow = createWorkflowLineageMarkerMap(["A", "B", "C", "D", "E", "F"]);
    const next = createWorkflowLineageMarkerMap(["A", "C", "D", "E", "F"], overflow);

    expect(new Set(next.values()).size).toBe(5);
    expect(Array.from(next.entries())).toEqual([
      ["A", 1],
      ["C", 3],
      ["D", 4],
      ["E", 5],
      ["F", 2]
    ]);
  });
});
