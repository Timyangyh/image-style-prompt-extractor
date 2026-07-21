interface LineagePromptSource {
  historyItemId?: string;
  sourceExtractionWorkflowId?: string;
}

interface LineageSourcePointer {
  historyItemId?: string;
  generationTaskId?: string;
  generationOutputId?: string;
  imageEditTaskId?: string;
}

interface LineageRegenerationContext {
  generationTaskId?: string;
}

export interface LineageExtractionWorkflow {
  id: string;
  historyItemId?: string;
}

export interface LineageGenerationWorkflow {
  id: string;
  taskId?: string;
  promptSource: LineagePromptSource | null;
}

export interface LineageGenerationTask {
  id: string;
  clientWorkflowId?: string;
  promptSource: LineagePromptSource;
}

export interface LineageImageEditWorkflow {
  id: string;
  taskId?: string;
  source: { sourcePointer: LineageSourcePointer } | null;
  regenerationContext: LineageRegenerationContext | null;
}

export interface LineageImageEditTask {
  id: string;
  clientWorkflowId?: string;
  sourceImage: { sourcePointer: LineageSourcePointer };
  regenerationContext?: LineageRegenerationContext;
}

export interface WorkflowLineageInputs {
  extractionWorkflows: readonly LineageExtractionWorkflow[];
  generationWorkflows: readonly LineageGenerationWorkflow[];
  generationTasks: readonly LineageGenerationTask[];
  imageEditWorkflows: readonly LineageImageEditWorkflow[];
  imageEditTasks: readonly LineageImageEditTask[];
}

export interface WorkflowLineageKeys {
  extraction: Map<string, string>;
  generation: Map<string, string>;
  generationTasks: Map<string, string>;
  imageEdit: Map<string, string>;
  imageEditTasks: Map<string, string>;
}

const historyLineageKey = (historyItemId?: string): string =>
  historyItemId ? `history:${historyItemId}` : "";

export const extractionWorkflowLineageKey = (workflow: LineageExtractionWorkflow): string =>
  historyLineageKey(workflow.historyItemId) || `extraction:${workflow.id}`;

export const generationPromptSourceLineageKey = (
  promptSource: LineagePromptSource | null | undefined
): string =>
  historyLineageKey(promptSource?.historyItemId) ||
  (promptSource?.sourceExtractionWorkflowId
    ? `extraction:${promptSource.sourceExtractionWorkflowId}`
    : "");

export const generationPromptSourceHandoffKey = (
  promptSource:
    | (LineagePromptSource & { kind?: string })
    | null
    | undefined
): string => {
  const lineageKey = generationPromptSourceLineageKey(promptSource);
  const variant =
    promptSource?.kind === "text_to_image"
      ? "text_to_image"
      : promptSource?.kind === "fused_prompt" || promptSource?.kind === "fused_copy_ready"
        ? "fused"
        : "";
  return lineageKey && variant ? `${lineageKey}:generation-handoff:${variant}` : "";
};

export const extractionGenerationHandoffKey = (
  workflow: LineageExtractionWorkflow,
  variant: "text_to_image" | "fused"
): string => `${extractionWorkflowLineageKey(workflow)}:generation-handoff:${variant}`;

export const generationOutputHandoffKey = (
  generationTaskId?: string,
  generationOutputId?: string
): string =>
  generationTaskId && generationOutputId
    ? `generation-output:${generationTaskId}:${generationOutputId}`
    : "";

export const imageEditSourceHandoffKey = (
  source: { sourcePointer: LineageSourcePointer } | null | undefined
): string =>
  generationOutputHandoffKey(
    source?.sourcePointer.generationTaskId,
    source?.sourcePointer.generationOutputId
  );

const generationTaskLineageKey = (task: LineageGenerationTask): string =>
  generationPromptSourceLineageKey(task.promptSource) ||
  (task.clientWorkflowId ? `generation:${task.clientWorkflowId}` : `generation-task:${task.id}`);

export const resolveWorkflowLineageKeys = ({
  extractionWorkflows,
  generationTasks,
  generationWorkflows,
  imageEditTasks,
  imageEditWorkflows
}: WorkflowLineageInputs): WorkflowLineageKeys => {
  const generationTaskById = new Map(generationTasks.map((task) => [task.id, task]));
  const generationKeyByWorkflowId = new Map<string, string>(
    generationWorkflows.map((workflow) => {
      const task = workflow.taskId ? generationTaskById.get(workflow.taskId) : undefined;
      const key =
        generationPromptSourceLineageKey(workflow.promptSource) ||
        (task ? generationTaskLineageKey(task) : `generation:${workflow.id}`);
      return [workflow.id, key];
    })
  );
  const generationKeyByTaskId = new Map(
    generationTasks.map((task) => [task.id, generationTaskLineageKey(task)])
  );
  for (const workflow of generationWorkflows) {
    if (workflow.taskId) {
      generationKeyByTaskId.set(
        workflow.taskId,
        generationKeyByWorkflowId.get(workflow.id) || `generation-task:${workflow.taskId}`
      );
    }
  }

  const imageEditTaskById = new Map(imageEditTasks.map((task) => [task.id, task]));
  const imageEditTaskKeyCache = new Map<string, string>();
  const imageEditTaskLineageKey = (taskId: string, visited = new Set<string>()): string => {
    const cached = imageEditTaskKeyCache.get(taskId);
    if (cached) return cached;
    if (visited.has(taskId)) return `image-edit-task:${taskId}`;

    const task = imageEditTaskById.get(taskId);
    if (!task) return `image-edit-task:${taskId}`;
    const pointer = task.sourceImage.sourcePointer;
    const linkedGenerationTaskId =
      task.regenerationContext?.generationTaskId || pointer.generationTaskId;
    const key =
      historyLineageKey(pointer.historyItemId) ||
      (linkedGenerationTaskId
        ? generationKeyByTaskId.get(linkedGenerationTaskId) ||
          `generation-task:${linkedGenerationTaskId}`
        : "") ||
      (pointer.imageEditTaskId
        ? imageEditTaskLineageKey(pointer.imageEditTaskId, new Set(visited).add(taskId))
        : "") ||
      (task.clientWorkflowId
        ? `image-edit:${task.clientWorkflowId}`
        : `image-edit-task:${task.id}`);
    imageEditTaskKeyCache.set(taskId, key);
    return key;
  };

  const imageEditKeyByWorkflowId = new Map<string, string>(
    imageEditWorkflows.map((workflow) => {
      const pointer = workflow.source?.sourcePointer;
      const linkedGenerationTaskId =
        workflow.regenerationContext?.generationTaskId || pointer?.generationTaskId;
      const key =
        historyLineageKey(pointer?.historyItemId) ||
        (linkedGenerationTaskId
          ? generationKeyByTaskId.get(linkedGenerationTaskId) ||
            `generation-task:${linkedGenerationTaskId}`
          : "") ||
        (pointer?.imageEditTaskId
          ? imageEditTaskLineageKey(pointer.imageEditTaskId)
          : "") ||
        (workflow.taskId ? imageEditTaskLineageKey(workflow.taskId) : "") ||
        `image-edit:${workflow.id}`;
      return [workflow.id, key];
    })
  );
  const extractionKeyByWorkflowId = new Map<string, string>(
    extractionWorkflows.map((workflow) => [workflow.id, extractionWorkflowLineageKey(workflow)])
  );
  const imageEditKeyByTaskId = new Map(
    imageEditTasks.map((task) => [task.id, imageEditTaskLineageKey(task.id)])
  );

  return {
    extraction: extractionKeyByWorkflowId,
    generation: generationKeyByWorkflowId,
    generationTasks: generationKeyByTaskId,
    imageEdit: imageEditKeyByWorkflowId,
    imageEditTasks: imageEditKeyByTaskId
  };
};
