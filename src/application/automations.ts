import { randomUUID } from "node:crypto";
import {
  type Automation,
  type AutomationAction,
  type AutomationActionDraft,
  type AutomationRequest,
  automationClient,
  automationRoot,
  schedulerControl,
  subscribeService,
} from "../automation/index.js";
import type {
  AutomationEditor,
  ConfirmationId,
  RendererAutomationActionDraft,
} from "../bridge/index.js";
import { parseAutomationUiRequest } from "../bridge/index.js";
import { upcomingOccurrences } from "../core/index.js";

function toEditorAction(action: AutomationAction): RendererAutomationActionDraft {
  if (action.type === "workflow") {
    return {
      type: "workflow",
      provider: action.provider,
      baseBranch: action.baseBranch,
      tasks: structuredClone(action.tasks),
      repairs: action.repairs,
      retries: action.retries,
      autoApprove: action.autoApprove,
    };
  }
  return {
    type: "prompt",
    prompt: action.prompt,
    agent: action.agent,
    baseBranch: action.baseBranch,
    allow: [...action.allow],
    turnTimeout: action.turnTimeout,
  };
}

/** Renderer capabilities resolve only here; a displayed path never grants execution. */
export class DesktopAutomations {
  private readonly repositories = new Map<string, { path: string; expires: number }>();
  private unwatch: (() => void) | undefined;
  private watching = false;
  private generation = 0;
  constructor(
    private readonly env: Readonly<NodeJS.ProcessEnv>,
    private readonly dialogs: {
      pick(): Promise<string | null>;
      confirm(presentation: ConfirmationId, detail: string): Promise<boolean>;
    },
    private readonly changed: () => void,
    private readonly providers: () => string[],
    private readonly integration?: {
      request: ReturnType<typeof automationClient>;
      subscribe: (listener: () => void) => () => void;
      control: typeof schedulerControl;
    },
  ) {}
  reset() {
    this.generation++;
    this.repositories.clear();
    this.unwatch?.();
    this.unwatch = undefined;
    this.watching = false;
  }
  private async watch() {
    if (this.watching) return;
    this.watching = true;
    const generation = this.generation;
    try {
      const off = this.integration
        ? this.integration.subscribe(() => this.changed())
        : await subscribeService(automationRoot(this.env), (disconnected) => {
            if (disconnected) {
              this.unwatch = undefined;
              this.watching = false;
            }
            this.changed();
          });
      if (generation !== this.generation) off();
      else this.unwatch = off;
    } catch {
      this.watching = false;
    }
  }
  private resolveActionDraft(
    action: RendererAutomationActionDraft,
    previous: Automation | null,
  ): { resolved: AutomationActionDraft; consumedToken?: string } {
    const providerId = action.type === "prompt" ? action.agent : action.provider;
    if (!this.providers().includes(providerId))
      throw new Error("Choose an enabled, verified provider.");
    const token = action.repositoryToken;
    const choice = token ? this.repositories.get(token) : undefined;
    if (token && (!choice || choice.expires < Date.now()))
      throw new Error("Repository choice expired. Choose it again.");
    const repository = choice?.path ?? previous?.action.repository.path;
    if (!repository) throw new Error("Choose an automation repository.");
    if (action.type === "workflow") {
      const { repositoryToken: _token, ...fields } = action;
      return {
        resolved: { ...fields, repository },
        ...(token ? { consumedToken: token } : {}),
      };
    }
    const { repositoryToken: _token, ...fields } = action;
    return {
      resolved: { ...fields, repository },
      ...(token ? { consumedToken: token } : {}),
    };
  }
  async request(value: unknown): Promise<unknown> {
    const request = parseAutomationUiRequest(value);
    const generation = this.generation;
    const check = () => {
      if (generation !== this.generation)
        throw new Error("Automation view was replaced. Retry the action.");
    };
    const client = this.integration?.request ?? automationClient(this.env);
    if (request.action === "pickRepository") {
      const path = await this.dialogs.pick();
      check();
      if (!path || !(await this.dialogs.confirm("use-repository", path))) return null;
      check();
      for (const [id, choice] of this.repositories)
        if (choice.expires < Date.now()) this.repositories.delete(id);
      if (this.repositories.size >= 32)
        this.repositories.delete(this.repositories.keys().next().value ?? "");
      const token = randomUUID();
      this.repositories.set(token, { path, expires: Date.now() + 10 * 60_000 });
      return { token, label: path };
    }
    if (request.action === "preview")
      return upcomingOccurrences(request.schedule, new Date(), 5).map((value) =>
        value.toISOString(),
      );
    if (request.action === "scheduler") {
      if (
        request.control !== "status" &&
        !(await this.dialogs.confirm(
          `${request.control}-scheduler`,
          "The local service can run saved jobs while Code60 is quit. Your computer must be awake and logged in. Worktrees are not a sandbox. Stop/uninstall pauses schedules and preserves evidence.",
        ))
      )
        return null;
      check();
      const result = await (this.integration?.control ?? schedulerControl)(
        this.env,
        request.control,
        true,
      );
      if (request.control === "status") {
        if (result && "service" in result && result.service) await this.watch();
      } else this.changed();
      return result;
    }
    if (request.action === "create" || request.action === "update") {
      const previous =
        request.action === "update"
          ? ((await client({ action: "get", id: request.id })) as Automation)
          : null;
      const { resolved, consumedToken } = this.resolveActionDraft(request.draft.action, previous);
      check();
      const result = await client({
        ...request,
        draft: {
          name: request.draft.name,
          trigger: request.draft.trigger,
          enabled: request.draft.enabled,
          action: resolved,
        },
      });
      if (consumedToken) this.repositories.delete(consumedToken);
      await this.watch();
      return result ? { ok: true, id: (result as Automation).id } : null;
    }
    if (request.action === "delete") {
      if (
        !(await this.dialogs.confirm(
          "delete-automation",
          "Cancel active work first. Saved run evidence and worktrees will be kept.",
        ))
      )
        return null;
      check();
    }
    const result = await client(request as AutomationRequest);
    await this.watch();
    if (request.action === "get") {
      const automation = result as Automation;
      return {
        id: automation.id,
        revision: automation.revision,
        repositoryLabel: automation.action.repository.path,
        draft: {
          name: automation.name,
          trigger: automation.trigger,
          enabled: automation.enabled,
          action: toEditorAction(automation.action),
        },
      } satisfies AutomationEditor;
    }
    return result;
  }
}
