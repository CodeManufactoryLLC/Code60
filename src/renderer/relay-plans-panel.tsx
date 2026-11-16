import { useEffect, useRef, useState } from "react";
import type { DesktopApi, PlanSummary, Snapshot } from "../bridge/index.js";
import { FilePanel } from "./file-panel.js";
import { emptyFileTabs, type FileTabAction, updateFileTabs } from "./file-tabs.js";
import type { RecallSource } from "./memory-recall.js";
import { RelayChanges } from "./relay-changes.js";
import { useRelayFiles } from "./relay-files.js";
import type { ReviewPreview } from "./review-actions.js";

/** Application-owned files and plans never borrow a project's file context or database. */
export function RelayPlansPanel({
  api,
  plans,
  conversationId,
  generation,
  active,
  open,
  onOpen,
  snapshot,
  recallSource,
  revisionPreview,
}: {
  api: DesktopApi;
  plans: PlanSummary[];
  conversationId: string | undefined;
  generation?: number | undefined;
  active: boolean;
  open: boolean;
  onOpen(value: boolean): void;
  snapshot: Snapshot | undefined;
  recallSource?: RecallSource | undefined;
  revisionPreview?: { id: number; preview: ReviewPreview } | undefined;
}) {
  const [tabs, setTabs] = useState(() => emptyFileTabs("relay"));
  const proposals = useRef(new Map<string, number>());
  const discoveredPlans = useRef(false);
  const [root, setRoot] = useState("workspace");
  useEffect(() => {
    if (!revisionPreview) return;
    const { preview } = revisionPreview;
    if (
      preview.scope.kind !== "relay" ||
      preview.scope.conversationId !== conversationId ||
      preview.scope.generation !== generation
    )
      return;
    setTabs((tabs) =>
      updateFileTabs(
        tabs,
        preview.application
          ? { type: "application", preview }
          : {
              type: "revision",
              reviewId: preview.scope.reviewId,
              revisionId: preview.revisionId,
              title: preview.title,
              scope: preview.scope,
              ...(preview.related ? { related: preview.related } : {}),
            },
      ),
    );
  }, [revisionPreview, conversationId, generation]);
  useEffect(() => {
    if (plans.length && !discoveredPlans.current) {
      discoveredPlans.current = true;
      onOpen(true);
    }
    for (const plan of plans) {
      if (plan.state !== "draft" || proposals.current.get(plan.id) === plan.proposalRevision)
        continue;
      proposals.current.set(plan.id, plan.proposalRevision);
      setTabs((tabs) => updateFileTabs(tabs, { type: "plan", planId: plan.id, title: plan.title }));
      onOpen(true);
    }
  }, [plans, onOpen]);
  const act = (action: FileTabAction) => {
    const next = updateFileTabs(tabs, action);
    setTabs(next);
    return next.active;
  };
  const selected = tabs.entries.find((tab) => tab.id === tabs.active);
  const browser = useRelayFiles(
    api,
    snapshot,
    root,
    tabs.entries.some((tab) => tab.kind === "explorer" || tab.kind === "file"),
    active && open && (selected?.kind === "explorer" || selected?.kind === "file"),
    selected?.kind === "file" ? selected.path : null,
    (root) => {
      setRoot(root);
      setTabs((tabs) =>
        updateFileTabs(
          {
            ...tabs,
            entries: tabs.entries.filter(
              (tab) =>
                tab.kind === "plan" ||
                tab.kind === "changes" ||
                tab.kind === "recall" ||
                tab.kind === "revision" ||
                tab.kind === "application",
            ),
            active: null,
          },
          { type: "browse" },
        ),
      );
    },
  );
  return (
    <section className="project-file-panel-scope" hidden={!active}>
      <FilePanel
        panelId={
          snapshot?.chat.customAgentId ? `relay-plan-panel-${conversationId}` : "relay-plan-panel"
        }
        tabs={tabs}
        onAction={act}
        browser={browser}
        open={open}
        active={active}
        onToggle={() => onOpen(!open)}
        onOpenProject={() => {}}
        api={api}
        recallSource={recallSource}
        plans={plans}
        currentChat={conversationId}
        knowledgeOwner={
          conversationId && generation !== undefined
            ? { kind: "relay", conversationId, generation }
            : undefined
        }
        changesContent={
          <RelayChanges
            api={api}
            snapshot={snapshot}
            active={active && open && selected?.kind === "changes"}
          />
        }
        emptyContent={
          <>
            <button
              type="button"
              className="file-open-link"
              onClick={() => act({ type: "changes" })}
            >
              Open Changes
            </button>
            {plans.length > 0 && (
              <nav className="file-panel-saved-plans" aria-label="Saved Relay plans">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => act({ type: "plan", planId: plan.id, title: plan.title })}
                  >
                    {plan.title}
                  </button>
                ))}
              </nav>
            )}
          </>
        }
      />
    </section>
  );
}
