import { TASK_PREFERENCES } from "./agent-registry.js";

function defaultPerformance() {
  const tasks = {};
  for (const [taskType, providers] of Object.entries(TASK_PREFERENCES)) {
    tasks[taskType] = {};
    providers.forEach((providerId) => {
      tasks[taskType][providerId] = {
        successCount: 0,
        failureCount: 0,
        lastDurationMs: 0,
        averageDurationMs: 0,
      };
    });
  }
  return {
    tasks,
    updatedAt: "",
  };
}

let runtime = {
  loadPerformance: async () => defaultPerformance(),
  savePerformance: async () => {},
};

export function configurePerformanceRuntime(overrides = {}) {
  runtime = {
    ...runtime,
    ...overrides,
  };
}

export async function loadPerformanceSnapshot() {
  const snapshot = await runtime.loadPerformance();
  return snapshot || defaultPerformance();
}

export async function recordPerformance(taskType, providerId, status, durationMs) {
  const snapshot = await loadPerformanceSnapshot();
  const taskEntry = snapshot.tasks?.[taskType] || {};
  const providerEntry = taskEntry[providerId] || {
    successCount: 0,
    failureCount: 0,
    lastDurationMs: 0,
    averageDurationMs: 0,
  };

  if (status === "success") {
    providerEntry.successCount += 1;
  } else {
    providerEntry.failureCount += 1;
  }
  providerEntry.lastDurationMs = durationMs;
  const totalRuns = providerEntry.successCount + providerEntry.failureCount;
  providerEntry.averageDurationMs = totalRuns === 1
    ? durationMs
    : Math.round(((providerEntry.averageDurationMs * (totalRuns - 1)) + durationMs) / totalRuns);

  snapshot.tasks = snapshot.tasks || {};
  snapshot.tasks[taskType] = snapshot.tasks[taskType] || {};
  snapshot.tasks[taskType][providerId] = providerEntry;
  snapshot.updatedAt = new Date().toISOString();

  await runtime.savePerformance(snapshot);
  return snapshot;
}
