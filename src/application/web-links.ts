import { parseWebLink } from "../bridge/index.js";

/** Chat links never navigate Electron or open without a fresh native confirmation. */
export class WebLinks {
  private pending = false;

  constructor(
    private readonly io: {
      confirm(url: string): Promise<boolean>;
      open(url: string): Promise<void>;
    },
  ) {}

  async open(value: unknown): Promise<boolean> {
    const { url } = parseWebLink(value);
    if (this.pending) return false;
    this.pending = true;
    try {
      if (!(await this.io.confirm(url))) return false;
      await this.io.open(url);
      return true;
    } catch {
      throw new Error("Could not open link. Try again.");
    } finally {
      this.pending = false;
    }
  }
}
