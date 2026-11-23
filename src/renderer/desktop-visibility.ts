import { useEffect } from "react";
import type { ApplicationClient } from "../bridge/index.js";
import type { PageId } from "./navigation.js";

export function useDesktopVisibility(
  api: ApplicationClient,
  page: PageId,
  splash: boolean,
  filesActive: boolean,
  fail: (message: string) => void,
) {
  useEffect(() => {
    let alive = true;
    const visibility = () => {
      void api
        .setVisibility({
          visible: !document.hidden && !splash,
          worktrees: page === "worktrees",
          files: filesActive,
        })
        .catch((cause: unknown) => {
          if (alive) fail(cause instanceof Error ? cause.message : String(cause));
        });
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [api, page, splash, filesActive, fail]);
}
