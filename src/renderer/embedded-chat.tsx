import {
  Children,
  Fragment,
  isValidElement,
  lazy,
  type ReactElement,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from "react";
import type { Command } from "../bridge/index.js";

import { ScrollArea } from "./carbon/scroll-area.js";

const CarbonConversation = lazy(() => import("./carbon-conversation.js"));

export interface EmbeddedChatProps {
  active: boolean;
  label: string;
  draft: string;
  disabled: boolean;
  canSend: boolean;
  hideInput?: boolean;
  stop?: (() => unknown) | undefined;
  onInputFocusChange?: ((focused: boolean) => void) | undefined;
  onEdit(text: string): void;
  onSend(text: string): Promise<boolean>;
  commands?: readonly Command[] | undefined;
  limit?: number;
  focus?: number | boolean | undefined;
  onViewport?: (node: HTMLDivElement) => void;
  promptControls?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

interface TurnProps {
  children: ReactNode;
  from?: "user" | "assistant";
  at?: string | undefined;
}

/** Metadata belongs to the original Code60 event, including when replayed after a reload. */
export function ChatTurn({ children }: TurnProps) {
  return children;
}
ChatTurn.displayName = "ChatTurn";

function isChatTurn(child: ReactNode): child is ReactElement<TurnProps> {
  if (!isValidElement<TurnProps>(child)) return false;
  if (child.type === ChatTurn) return true;
  if (typeof child.type === "function") {
    const fn = child.type as { name?: string; displayName?: string };
    if (fn.displayName === "ChatTurn" || fn.name === "ChatTurn") return true;
  }
  return child.props.from === "user" || child.props.from === "assistant";
}

export function chatEntries(children: ReactNode) {
  const entries = new Map<string, TurnProps>();
  function collect(nodes: ReactNode, prefix: string) {
    for (const [index, child] of Children.toArray(nodes).entries()) {
      const key = prefix + (isValidElement(child) ? String(child.key) : String(index));
      if (isValidElement<TurnProps>(child) && child.type === Fragment) {
        collect(child.props.children, `${key}/`);
      } else {
        entries.set(key, isChatTurn(child) ? child.props : { children: child });
      }
    }
  }
  collect(children, "");
  return entries;
}

export function EmbeddedChat(props: EmbeddedChatProps) {
  const [visited, setVisited] = useState(false);
  useEffect(() => {
    if (props.active) setVisited(true);
  }, [props.active]);
  // Keep the selected snapshot readable while the browser loads the native editor.
  const snapshot = (
    <>
      <ScrollArea className="transcript" aria-busy="true">
        {props.children}
      </ScrollArea>
      {props.promptControls}
      {props.footer}
    </>
  );
  return visited ? (
    <Suspense fallback={snapshot}>
      <CarbonConversation {...props} />
    </Suspense>
  ) : (
    snapshot
  );
}
