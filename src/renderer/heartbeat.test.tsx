import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEARTBEAT_POLICY,
  HEARTBEAT_ACTIONS,
  type HeartbeatSnapshot,
} from "../bridge/index.js";
import { HeartbeatPage } from "./heartbeat.js";

const emptySnapshot: HeartbeatSnapshot = {
  revision: 0,
  policy: { ...DEFAULT_HEARTBEAT_POLICY },
  nextRunAt: "2026-11-27T12:15:00.000Z",
  running: false,
  lowDiskPausedByHeartbeat: false,
  currentRun: null,
  lastCompletedRun: null,
  recentRuns: [],
  storageWarning: null,
};

describe("HeartbeatPage", () => {
  it("renders daily verdict, timing fields, manual controls, orthogonal audit columns, and tabs without requiring a database", () => {
    const html = renderToStaticMarkup(
      <HeartbeatPage
        api={{
          heartbeat: async () => emptySnapshot,
          onHeartbeatChanged: () => () => {},
        }}
        active={false}
      />,
    );

    expect(html).toContain('<span class="page-title-text">Heartbeat</span>');
    expect(html).toContain("Not yet run");
    expect(html).toContain("Initiated");
    expect(html).toContain("Terminated");
    expect(html).toContain("Duration");
    expect(html).toContain("Next scheduled");
    expect(html).toContain("Run heartbeat");
    expect(html).toContain("Dry run");
    expect(html).toContain("What ran");
    expect(html).toContain("History");
    expect(html).toContain("Policy");
    expect(html).toContain("Area");
    expect(html).toContain("Behavior");
    expect(html).toContain("Outcome");
    for (const action of HEARTBEAT_ACTIONS) {
      expect(html).toContain(action.title);
    }
  });
});
