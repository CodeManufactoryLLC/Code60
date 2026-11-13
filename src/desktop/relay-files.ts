import type {
  PollSettingsPatch,
  PollVisibility,
  RelayFileContext,
  RelayFileDetails,
  RelayFileSnapshot,
} from "../bridge/index.js";
import { readFiles } from "./files.js";
import { Poller } from "./poller.js";

export interface RelayFileRoot {
  cwd: string;
  check(): Promise<void>;
}
interface View {
  context: RelayFileContext;
  root: RelayFileRoot;
  valid(): void;
  files: RelayFileSnapshot | null;
  revision: number;
}
interface Root {
  views: Map<string, View>;
  poller: Poller;
  reading: boolean;
}

/** File presentation is subscription-owned, not task authority or project selection. */
export class RelayFiles {
  private readonly views = new Map<string, View>();
  private readonly roots = new Map<string, Root>();
  private settings: PollSettingsPatch = {};
  private paused = false;
  private visible = false;

  constructor(
    private readonly changed: () => void,
    private readonly read = readFiles,
  ) {}

  set(context: RelayFileContext, root: RelayFileRoot, valid: () => void): void {
    valid();
    const previous = this.views.get(context.subscriptionId);
    if (previous && context.sequence <= previous.context.sequence) {
      if (JSON.stringify(context) === JSON.stringify(previous.context)) return;
      throw new Error("This Relay file view has a newer context");
    }
    if (!previous && this.views.size >= 16)
      throw new Error("Too many Relay file views. Close an unused view and retry.");
    if (previous && previous.root.cwd !== root.cwd)
      throw new Error("A Relay file subscription cannot change its root");
    let entry = this.roots.get(root.cwd);
    if (!entry) {
      const views = new Map<string, View>();
      const poller = new Poller(
        async (_key, current) => {
          if (!entry) return;
          entry.reading = true;
          try {
            await this.readRoot(views, current);
          } finally {
            entry.reading = false;
          }
        },
        (key) => key === "files" && [...views.values()].some((view) => this.active(view)),
        () => {
          for (const view of views.values()) view.revision++;
          this.changed();
        },
      );
      entry = { views, poller, reading: false };
      this.roots.set(root.cwd, entry);
      poller.configure(this.settings);
      poller.pause(this.paused);
    }
    const view: View = {
      context: structuredClone(context),
      root,
      valid,
      files: previous?.files ?? null,
      revision: (previous?.revision ?? 0) + 1,
    };
    this.views.set(context.subscriptionId, view);
    entry.views.set(context.subscriptionId, view);
    this.schedule(entry);
    const polling =
      entry.poller.snapshot().sources.find((s) => s.key === "files")?.status === "polling";
    if (this.visible && !this.paused && context.active && (!polling || entry.reading))
      void entry.poller.poll("files", "change").catch(() => {});
    this.changed();
  }

  snapshot(id: string): RelayFileDetails {
    const view = this.views.get(id);
    if (!view) return { files: null, filePolling: null };
    view.valid();
    return {
      files: view.files,
      filePolling:
        this.roots
          .get(view.root.cwd)
          ?.poller.snapshot()
          .sources.find((s) => s.key === "files") ?? null,
    };
  }
  version(id: string): number {
    return this.views.get(id)?.revision ?? 0;
  }

  remove(id: string): void {
    const view = this.views.get(id);
    if (!view) return;
    this.views.delete(id);
    const entry = this.roots.get(view.root.cwd);
    if (!entry) return;
    entry.views.delete(id);
    if (!entry.views.size) {
      entry.poller.stop();
      this.roots.delete(view.root.cwd);
    } else this.schedule(entry);
  }

  configure(patch: PollSettingsPatch): void {
    this.settings = { ...this.settings, ...patch };
    for (const entry of this.roots.values()) entry.poller.configure(patch);
  }

  pause(paused: boolean): void {
    this.paused = paused;
    for (const entry of this.roots.values()) entry.poller.pause(paused);
  }

  visibility(visibility: PollVisibility): void {
    this.visible = visibility.visible;
    for (const entry of this.roots.values()) this.schedule(entry);
  }

  private active(view: View): boolean {
    try {
      view.valid();
      return view.context.active;
    } catch {
      return false;
    }
  }

  private schedule(entry: Root): void {
    entry.poller.context(false, {
      visible: this.visible,
      files: [...entry.views.values()].some((view) => this.active(view)),
      worktrees: false,
    });
  }

  private async readRoot(views: Map<string, View>, current: () => boolean): Promise<void> {
    const shared = new Map<string, Promise<Awaited<ReturnType<typeof readFiles>>>>();
    const results = await Promise.allSettled(
      [...views.values()]
        .filter((view) => this.active(view))
        .map(async (view) => {
          const { context, root } = view;
          const valid = () =>
            current() &&
            this.visible &&
            !this.paused &&
            this.views.get(context.subscriptionId) === view &&
            this.active(view);
          try {
            await root.check();
            if (!valid()) return;
            const key = JSON.stringify([context.directories, context.preview]);
            let read = shared.get(key);
            if (!read) {
              // Only this trusted adapter supplies an absolute root. No project or
              // root path is accepted by the Relay renderer request.
              read = this.read(
                {
                  project: root.cwd,
                  root: root.cwd,
                  directories: context.directories,
                  preview: context.preview,
                },
                () =>
                  current() &&
                  this.visible &&
                  !this.paused &&
                  [...views.values()].some(
                    (candidate) =>
                      this.active(candidate) &&
                      JSON.stringify([candidate.context.directories, candidate.context.preview]) ===
                        key,
                  ),
              );
              shared.set(key, read);
            }
            const files = await read;
            await root.check();
            if (!valid()) return;
            view.files = { context, directories: files.directories, preview: files.preview };
            view.revision++;
          } catch (cause) {
            if (valid()) throw cause;
          }
        }),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
