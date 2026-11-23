import { join } from "node:path";
import { type CoreDeps, defaultDeps, stateHome } from "../core/index.js";
import { assertSupportedPlatform } from "../platform/index.js";
import { executionEvidence } from "./evidence.js";
import { createExecutor } from "./executor.js";
import { listenService, serviceRequest } from "./protocol.js";
import { Scheduler } from "./scheduler.js";
import { AutomationStore } from "./store.js";

export const automationRoot = (env: Readonly<NodeJS.ProcessEnv>) =>
  join(stateHome(env), "code60", "automations");

export async function startSchedulerRuntime(
  env: Readonly<NodeJS.ProcessEnv>,
  deps: CoreDeps = defaultDeps(),
  listen = false,
) {
  assertSupportedPlatform();
  const root = automationRoot(env);
  const store = await AutomationStore.open(root);
  const scheduler = new Scheduler(store, createExecutor(deps, env));
  let timer: ReturnType<typeof setInterval> | undefined;
  try {
    await scheduler.initialize();
    const server = listen
      ? await listenService(
          root,
          (request) =>
            request.action === "transcript" || request.action === "diff"
              ? executionEvidence(scheduler, deps, env, request.executionId, request.action)
              : scheduler.request(request),
          (listener) => scheduler.onChange(listener),
        )
      : undefined;
    let ticking = false;
    timer = setInterval(() => {
      if (ticking) return;
      ticking = true;
      void scheduler
        .tick()
        .catch(() => {})
        .finally(() => {
          ticking = false;
        });
    }, 1000);
    let stopping: Promise<void> | undefined;
    return {
      scheduler,
      request: (request: Parameters<typeof serviceRequest>[1]) =>
        request.action === "transcript" || request.action === "diff"
          ? executionEvidence(scheduler, deps, env, request.executionId, request.action)
          : scheduler.request(request),
      subscribe: (listener: (revision: number) => void) => scheduler.onChange(listener),
      stop() {
        stopping ??= (async () => {
          clearInterval(timer);
          await server?.close();
          await scheduler.stop();
          await store.close();
        })();
        return stopping;
      },
    };
  } catch (error) {
    clearInterval(timer);
    await scheduler.stop();
    await store.close();
    throw error;
  }
}

export function automationClient(env: Readonly<NodeJS.ProcessEnv>) {
  return (request: Parameters<typeof serviceRequest>[1]) =>
    serviceRequest(automationRoot(env), request);
}

/** Legacy protocol adapter; the production gateway owns the runtime. */
export const startService = (env: Readonly<NodeJS.ProcessEnv>, deps: CoreDeps = defaultDeps()) =>
  startSchedulerRuntime(env, deps, true);
