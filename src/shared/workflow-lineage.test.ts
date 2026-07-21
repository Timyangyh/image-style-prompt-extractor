import { describe, expect, it } from "vitest";
import {
  extractionGenerationHandoffKey,
  generationOutputHandoffKey,
  generationPromptSourceHandoffKey,
  generationPromptSourceLineageKey,
  imageEditSourceHandoffKey,
  resolveWorkflowLineageKeys,
  type WorkflowLineageInputs
} from "./workflow-lineage";

const emptyInputs = (): WorkflowLineageInputs => ({
  extractionWorkflows: [],
  generationWorkflows: [],
  generationTasks: [],
  imageEditWorkflows: [],
  imageEditTasks: []
});

describe("workflow lineage resolution", () => {
  it("keeps one history lineage across extraction, generation and image edit", () => {
    const keys = resolveWorkflowLineageKeys({
      ...emptyInputs(),
      extractionWorkflows: [{ id: "extract-b", historyItemId: "history-b" }],
      generationTasks: [
        { id: "generation-task-b", clientWorkflowId: "generation-b", promptSource: { historyItemId: "history-b" } }
      ],
      generationWorkflows: [
        {
          id: "generation-b",
          taskId: "generation-task-b",
          promptSource: { historyItemId: "history-b" }
        }
      ],
      imageEditWorkflows: [
        {
          id: "image-edit-b",
          source: { sourcePointer: { generationTaskId: "generation-task-b" } },
          regenerationContext: { generationTaskId: "generation-task-b" }
        }
      ]
    });

    expect(keys.extraction.get("extract-b")).toBe("history:history-b");
    expect(keys.generation.get("generation-b")).toBe("history:history-b");
    expect(keys.imageEdit.get("image-edit-b")).toBe("history:history-b");
  });

  it("keeps the origin after its generation task is deleted", () => {
    const keys = resolveWorkflowLineageKeys({
      ...emptyInputs(),
      extractionWorkflows: [{ id: "extract-b", historyItemId: "history-b" }],
      imageEditWorkflows: [
        {
          id: "image-edit-b",
          source: {
            sourcePointer: {
              historyItemId: "history-b",
              generationTaskId: "deleted-generation-task"
            }
          },
          regenerationContext: { generationTaskId: "deleted-generation-task" }
        }
      ]
    });

    expect(keys.imageEdit.get("image-edit-b")).toBe("history:history-b");
  });

  it("keeps an extraction lineage before a history item exists", () => {
    const keys = resolveWorkflowLineageKeys({
      ...emptyInputs(),
      extractionWorkflows: [{ id: "extract-local" }],
      generationWorkflows: [
        {
          id: "generation-local",
          promptSource: { sourceExtractionWorkflowId: "extract-local" }
        }
      ]
    });

    expect(generationPromptSourceLineageKey({ sourceExtractionWorkflowId: "extract-local" })).toBe(
      "extraction:extract-local"
    );
    expect(keys.extraction.get("extract-local")).toBe("extraction:extract-local");
    expect(keys.generation.get("generation-local")).toBe("extraction:extract-local");
  });

  it("keeps direct and fused generation handoffs distinct within one lineage", () => {
    const workflow = { id: "extract", historyItemId: "history" };
    const directSource = { kind: "text_to_image", historyItemId: "history" };
    const fusedSource = { kind: "fused_prompt", historyItemId: "history" };

    expect(generationPromptSourceLineageKey(directSource)).toBe(
      generationPromptSourceLineageKey(fusedSource)
    );

    expect(
      generationPromptSourceHandoffKey({ kind: "text_to_image", historyItemId: "history" })
    ).toBe(extractionGenerationHandoffKey(workflow, "text_to_image"));
    expect(
      generationPromptSourceHandoffKey({ kind: "fused_prompt", historyItemId: "history" })
    ).toBe(extractionGenerationHandoffKey(workflow, "fused"));
    expect(
      generationPromptSourceHandoffKey({ kind: "fused_copy_ready", historyItemId: "history" })
    ).toBe(extractionGenerationHandoffKey(workflow, "fused"));
    expect(generationPromptSourceHandoffKey({ kind: "universal", historyItemId: "history" })).toBe("");
  });

  it("identifies one generated output already imported into image edit", () => {
    const source = {
      sourcePointer: {
        generationTaskId: "generation-task",
        generationOutputId: "generation-output"
      }
    };

    expect(imageEditSourceHandoffKey(source)).toBe(
      generationOutputHandoffKey("generation-task", "generation-output")
    );
    expect(imageEditSourceHandoffKey({ sourcePointer: { generationTaskId: "generation-task" } })).toBe("");
  });

  it("follows continued and retried image-edit tasks back to the original history", () => {
    const keys = resolveWorkflowLineageKeys({
      ...emptyInputs(),
      imageEditTasks: [
        {
          id: "first-edit",
          clientWorkflowId: "first-edit-workflow",
          sourceImage: { sourcePointer: { historyItemId: "history-b" } }
        },
        {
          id: "continued-edit",
          clientWorkflowId: "continued-edit-workflow",
          sourceImage: { sourcePointer: { imageEditTaskId: "first-edit" } }
        },
        {
          id: "retried-edit",
          clientWorkflowId: "retried-edit-workflow",
          sourceImage: {
            sourcePointer: { historyItemId: "history-b", imageEditTaskId: "continued-edit" }
          }
        }
      ],
      imageEditWorkflows: [
        {
          id: "continued-edit-workflow",
          taskId: "continued-edit",
          source: { sourcePointer: { imageEditTaskId: "first-edit" } },
          regenerationContext: null
        },
        {
          id: "retried-edit-workflow",
          taskId: "retried-edit",
          source: {
            sourcePointer: { historyItemId: "history-b", imageEditTaskId: "continued-edit" }
          },
          regenerationContext: null
        }
      ]
    });

    expect(keys.imageEdit.get("continued-edit-workflow")).toBe("history:history-b");
    expect(keys.imageEdit.get("retried-edit-workflow")).toBe("history:history-b");
  });

  it("stops cyclic legacy edit pointers without recursing forever", () => {
    const keys = resolveWorkflowLineageKeys({
      ...emptyInputs(),
      imageEditTasks: [
        {
          id: "edit-a",
          sourceImage: { sourcePointer: { imageEditTaskId: "edit-b" } }
        },
        {
          id: "edit-b",
          sourceImage: { sourcePointer: { imageEditTaskId: "edit-a" } }
        }
      ],
      imageEditWorkflows: [
        {
          id: "legacy-cycle",
          taskId: "edit-a",
          source: { sourcePointer: { imageEditTaskId: "edit-b" } },
          regenerationContext: null
        }
      ]
    });

    expect(keys.imageEdit.get("legacy-cycle")).toMatch(/^image-edit-task:/);
  });
});
