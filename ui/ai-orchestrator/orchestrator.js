import { AGENT_REGISTRY, TASK_PREFERENCES, TASK_TYPES } from "./agent-registry.js";
import { configurePerformanceRuntime, loadPerformanceSnapshot, recordPerformance } from "./performance-store.js";
import { callSpecificAIProvider } from "../services/ai-provider-router.js";

let runtime = {
  appendLog: async () => {},
  saveDebug: async () => {},
  onFlow: () => {},
  saveTeamStatus: async () => {},
  loadPerformance: async () => ({ tasks: {}, updatedAt: "" }),
  savePerformance: async () => {},
};

export function configureAIOrchestratorRuntime(overrides = {}) {
  runtime = {
    ...runtime,
    ...overrides,
  };
  configurePerformanceRuntime({
    loadPerformance: runtime.loadPerformance,
    savePerformance: runtime.savePerformance,
  });
}

function providerFunctionForTask(taskType) {
  if (taskType === TASK_TYPES.promptGeneration) return "generateText";
  if (taskType === TASK_TYPES.imageGeneration) return "generateImage";
  if (taskType === TASK_TYPES.backgroundRemoval) return "removeBackground";
  if (taskType === TASK_TYPES.seasonDetection) return "detectSeason";
  if (taskType === TASK_TYPES.qualityEnhancement) return "generateText";
  throw new Error(`Unsupported task type: ${taskType}`);
}

function sortProvidersByPerformance(taskType, providers, performance) {
  const taskStats = performance.tasks?.[taskType] || {};
  return [...providers].sort((left, right) => {
    const leftStats = taskStats[left] || {};
    const rightStats = taskStats[right] || {};
    const leftScore = (leftStats.successCount || 0) - ((leftStats.failureCount || 0) * 2);
    const rightScore = (rightStats.successCount || 0) - ((rightStats.failureCount || 0) * 2);
    if (leftScore !== rightScore) return rightScore - leftScore;
    const leftDuration = leftStats.averageDurationMs || Number.MAX_SAFE_INTEGER;
    const rightDuration = rightStats.averageDurationMs || Number.MAX_SAFE_INTEGER;
    return leftDuration - rightDuration;
  });
}

function emitFlow(update) {
  runtime.onFlow(update);
}

export async function executeAgentTask(taskType, payload, options = {}) {
  const preferredProviders = TASK_PREFERENCES[taskType] || [];
  const performance = await loadPerformanceSnapshot();
  const candidates = sortProvidersByPerformance(taskType, preferredProviders, performance)
    .filter((providerId) => AGENT_REGISTRY[providerId]?.tasks.includes(taskType));

  if (!candidates.length) {
    throw new Error(`No AI agent is registered for task ${taskType}.`);
  }

  const taskLabel = options.taskLabel || taskType;
  const flow = [];
  emitFlow({ taskType, status: "running", currentFlow: flow });

  let lastError = null;
  for (const providerId of candidates) {
    const startedAt = performance.now();
    const fn = providerFunctionForTask(taskType);
    flow.push(providerId);
    emitFlow({
      taskType,
      status: "running",
      currentFlow: [...flow],
      currentAgent: providerId,
      message: `${AGENT_REGISTRY[providerId].label} accepted ${taskLabel}.`,
    });
    await runtime.appendLog(`${new Date().toISOString()} | orchestrator | task=${taskType} | provider=${providerId} | action=accepted`);

    try {
      const result = await callSpecificAIProvider(providerId, fn, payload, options.providerOptions || {});
      const durationMs = Math.round(performance.now() - startedAt);
      await recordPerformance(taskType, providerId, "success", durationMs);
      const teamStatus = {
        taskType,
        flow: [...flow, "completed"],
        currentAgent: providerId,
        status: "completed",
        updatedAt: new Date().toISOString(),
      };
      await runtime.saveTeamStatus(teamStatus);
      emitFlow({
        taskType,
        status: "completed",
        currentFlow: teamStatus.flow,
        currentAgent: providerId,
        message: `${AGENT_REGISTRY[providerId].label} completed ${taskLabel}.`,
      });
      await runtime.saveDebug({
        orchestratorTask: taskType,
        currentFlow: teamStatus.flow.join(" -> "),
        lastOrchestratorAgent: providerId,
      });
      return {
        providerId,
        result,
        flow: teamStatus.flow,
      };
    } catch (error) {
      const durationMs = Math.round(performance.now() - startedAt);
      await recordPerformance(taskType, providerId, "failure", durationMs);
      lastError = error;
      emitFlow({
        taskType,
        status: "failover",
        currentFlow: [...flow],
        currentAgent: providerId,
        message: `${AGENT_REGISTRY[providerId].label} failed ${taskLabel}. Delegating to next agent.`,
      });
      await runtime.appendLog(`${new Date().toISOString()} | orchestrator | task=${taskType} | provider=${providerId} | action=failed | error=${error.message || String(error)}`);
    }
  }

  const teamStatus = {
    taskType,
    flow: [...flow, "failed"],
    currentAgent: flow.at(-1) || "",
    status: "failed",
    updatedAt: new Date().toISOString(),
  };
  await runtime.saveTeamStatus(teamStatus);
  emitFlow({
    taskType,
    status: "failed",
    currentFlow: teamStatus.flow,
    currentAgent: teamStatus.currentAgent,
    message: `All agents failed ${taskLabel}.`,
  });
  throw new Error(lastError?.message || `All AI agents failed task ${taskType}.`);
}
