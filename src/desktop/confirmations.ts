import type { MessageBoxOptions, MessageBoxReturnValue } from "electron";

/** One window-owned warning at a time; dismissal never authorizes another request. */
export class Confirmations<Owner> {
  private pending = false;
  private generation = 0;

  constructor(
    private readonly owner: () => Owner | undefined,
    private readonly show: (
      owner: Owner,
      options: MessageBoxOptions,
    ) => Promise<MessageBoxReturnValue>,
  ) {}

  invalidate(): void {
    this.generation++;
  }

  confirm(title: string, detail: string, label = "Confirm"): Promise<boolean> {
    return this.perform(title, detail, async () => {}, label);
  }

  async perform(
    title: string,
    detail: string,
    action: () => Promise<void>,
    label = "Confirm",
  ): Promise<boolean> {
    const owner = this.owner();
    if (owner === undefined || this.pending) return false;
    const generation = this.generation;
    this.pending = true;
    try {
      const result = await this.show(owner, {
        type: "warning",
        title,
        message: title,
        detail,
        buttons: ["Cancel", label],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      if (result.response !== 1 || generation !== this.generation || owner !== this.owner())
        return false;
      await action();
      return true;
    } finally {
      this.pending = false;
    }
  }
}
