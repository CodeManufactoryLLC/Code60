import {
  BusEventType,
  ChatCustomElement,
  type ChatInstance,
  getRawText,
  type MessageRequest,
  type RenderUserDefinedState,
  textToDoc,
} from "@carbon/ai-chat";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CarbonTranscript } from "./carbon-transcript.js";
import { commandSuggestions } from "./command-composer.js";
import { chatEntries, type EmbeddedChatProps } from "./embedded-chat.js";

const Viewport = createContext<EmbeddedChatProps["onViewport"]>(undefined);
function bindTurnHost(
  element: HTMLElement | null,
  isUser: boolean,
  onViewport: EmbeddedChatProps["onViewport"],
): boolean {
  let node: HTMLElement | null = element;
  let messageMarked = false;
  let viewportBound = !onViewport;
  while (node && (!messageMarked || !viewportBound)) {
    if (!messageMarked && node.classList.contains("cds-aichat--message")) {
      if (isUser) node.setAttribute("data-code60-user-turn", "");
      else node.removeAttribute("data-code60-user-turn");
      const root = node.getRootNode();
      if (root instanceof ShadowRoot) suppressShadowFocus(root);
      messageMarked = true;
    }
    if (
      !viewportBound &&
      node instanceof HTMLDivElement &&
      getComputedStyle(node).overflowY === "auto"
    ) {
      onViewport?.(node);
      viewportBound = true;
    }
    const root = node.getRootNode();
    node =
      node.assignedSlot ??
      node.parentElement ??
      (root instanceof ShadowRoot && root.host instanceof HTMLElement ? root.host : null);
  }
  return messageMarked;
}
const Entries = createContext<{
  turns: ReturnType<typeof chatEntries>;
  transcript: CarbonTranscript;
} | null>(null);
function Entry({ id, slot }: { id: string; slot: unknown }) {
  const onViewport = useContext(Viewport);
  const entries = useContext(Entries);
  const turn = entries?.turns.get(id);
  const isUserProp = turn?.from === "user";
  const current = entries?.transcript.isCurrent(id, slot) ?? false;
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!current || !ref.current) return;
    const isUser =
      isUserProp || Boolean(ref.current.querySelector("article.event.prompt:not(.automatic)"));
    if (bindTurnHost(ref.current, isUser, onViewport)) return;
    const frame = requestAnimationFrame(() => {
      if (ref.current) bindTurnHost(ref.current, isUser, onViewport);
    });
    return () => cancelAnimationFrame(frame);
  }, [current, isUserProp, onViewport]);
  return current ? <div ref={ref}>{turn?.children}</div> : null;
}
function renderEntry(state: RenderUserDefinedState) {
  const key = state.fullMessage?.id;
  return key ? <Entry id={key} slot={state.messageItem?.user_defined?.slot} /> : null;
}
// Code60 supplies each snapshot. Carbon only needs session state in memory.
const memorySession = { onStateChange() {} };
const frame = { showFrame: false };
const off = { isOn: false };
const history = { isOn: false, showMobileMenu: false };

const CODE60_SHADOW_SHEET = Symbol.for("code60.shadow-focus-sheet");
const styledShadowRoots = new WeakSet<ShadowRoot>();
let shadowFocusSheet: CSSStyleSheet | null | undefined;
function getShadowFocusSheet(): CSSStyleSheet | null {
  if (shadowFocusSheet !== undefined) return shadowFocusSheet;
  if (typeof CSSStyleSheet !== "function" || !("replaceSync" in CSSStyleSheet.prototype)) {
    shadowFocusSheet = null;
    return null;
  }
  const sheet = new CSSStyleSheet();
  (sheet as unknown as Record<symbol, boolean>)[CODE60_SHADOW_SHEET] = true;
  sheet.replaceSync(
    "*,::before,::after{outline-color:transparent !important;}" +
      ":focus,:focus-visible,:active{outline:none !important;outline-width:0 !important;outline-color:transparent !important;}" +
      ":host .cds--btn:is(:focus,:focus-visible,:active)," +
      ".cds--btn:is(:focus,:focus-visible,:active)," +
      ":host .cds-custom--btn:is(:focus,:focus-visible,:active)," +
      ".cds-aichat--input-container:focus-within," +
      ".cds-aichat--chain-of-thought-accordion-item button.cds-aichat--chain-of-thought-accordion-item-header:is(:focus,:focus-visible,:active)" +
      "{outline:none !important;outline-width:0 !important;outline-color:transparent !important;box-shadow:none !important;}" +
      ":host .cds--btn:not(.cds--btn--tertiary,.cds--btn--danger--tertiary):is(:focus,:focus-visible,:active)," +
      ".cds--btn:not(.cds--btn--tertiary,.cds--btn--danger--tertiary):is(:focus,:focus-visible,:active)" +
      "{border-color:transparent !important;}" +
      ":host .cds-aichat--message--request .cds-aichat--message__avatar-line," +
      ":host .cds-aichat--message[data-code60-user-turn] .cds-aichat--message__avatar-line" +
      "{display:none !important;}" +
      ":host .cds-aichat--message--request," +
      ":host .cds-aichat--message[data-code60-user-turn]" +
      "{padding-block-start:1.75rem;}" +
      ":host .cds-aichat--input-container--expanded," +
      ".cds-aichat--input-container--expanded" +
      "{align-content:flex-start !important;padding-block-start:0 !important;}" +
      ":host .cds-aichat--input-container--expanded .cds-aichat--input-text-area," +
      ".cds-aichat--input-container--expanded .cds-aichat--input-text-area" +
      "{align-items:flex-start !important;margin-block-start:0 !important;padding-block-start:10px !important;min-block-size:clamp(3rem,9dvh,4.75rem) !important;}" +
      ":host([content-max-width]:not([show-workspace])) .input-and-messages:not(.at-max-width)>.input-after," +
      ".input-and-messages>.input-after" +
      "{margin-block-end:0.5rem !important;}",
  );
  shadowFocusSheet = sheet;
  return sheet;
}

function suppressShadowFocus(root: ShadowRoot) {
  const sheet = getShadowFocusSheet();
  if (!sheet || !("adoptedStyleSheets" in root)) return;
  const current = root.adoptedStyleSheets;
  if (styledShadowRoots.has(root) && current[current.length - 1] === sheet) return;
  styledShadowRoots.add(root);
  root.adoptedStyleSheets = [
    ...current.filter((item) => item !== sheet && !(CODE60_SHADOW_SHEET in item)),
    sheet,
  ];
}

function suppressNestedShadowFocus(node: ParentNode) {
  if (node instanceof ShadowRoot) suppressShadowFocus(node);
  for (const element of node.querySelectorAll("*")) {
    if (element.shadowRoot) suppressNestedShadowFocus(element.shadowRoot);
  }
}

export default function CarbonConversation(props: EmbeddedChatProps) {
  const latest = useRef(props);
  latest.current = props;
  const namespace = useId();
  const [chat, setChat] = useState<ChatInstance>();
  const [error, setError] = useState("");
  const entries = chatEntries(props.children);
  // UI content (including streamed chunks) flows through the React portal. Only
  // changes to stable IDs or author/timestamp metadata touch the SDK transcript.
  const order = JSON.stringify([...entries].map(([id, turn]) => [id, turn.from, turn.at]));
  const queue = useRef(Promise.resolve());
  const [transcript] = useState(() => new CarbonTranscript());
  const [, refreshSlots] = useState(0);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!chat) return;
    let current = true;
    queue.current = queue.current
      .then(async () => {
        if (!current) return;
        await transcript.reconcile(chat.messaging, JSON.parse(order), () => current);
        if (current) refreshSlots((version) => version + 1);
      })
      .catch(() => {
        if (current) setError("Could not display the conversation.");
      });
    return () => {
      current = false;
    };
  }, [chat, order, transcript]);

  // The native editor clears its local field on submit. Only user edits change the
  // durable draft. The owning send handler clears it after an authenticated ack.
  const clearingForSend = useRef(false);
  const onInput = useCallback((event: Event) => {
    const { content, rawValue } = (
      event as CustomEvent<{ rawValue: string; content?: Parameters<typeof getRawText>[0] }>
    ).detail;
    const value = content ? getRawText(content) : rawValue;
    if (clearingForSend.current && value === "") return;
    if (typeof value === "string" && value !== latest.current.draft) latest.current.onEdit(value);
  }, []);
  const container = useRef<HTMLDivElement>(null);
  const workspace = props.footer !== undefined;
  useLayoutEffect(() => {
    const host = container.current;
    const column = host?.closest(".chat-conversations");
    const body = host?.closest(".orchestration-chat-body");
    if (!workspace || !props.active || !host || !column || !body) return;
    // The shared title, worker status and notices stay in normal flow. Extend
    // the canvas behind them and reserve their actual height above the scrollport.
    const align = () => {
      const inset = body.getBoundingClientRect().top - column.getBoundingClientRect().top;
      host.style.setProperty("--chat-heading-height", `${Math.max(0, inset)}px`);
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(column);
    observer.observe(body);
    return () => observer.disconnect();
  }, [workspace, props.active]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const submitting = () => {
      clearingForSend.current = true;
      queueMicrotask(() => {
        clearingForSend.current = false;
      });
    };
    const intents = ["cds-aichat-input-send", "cds-aichat-prompt-send-intent"];
    for (const type of intents) element.addEventListener(type, submitting, true);
    element.addEventListener("cds-aichat-prompt-change", onInput);
    const onShadowInteraction = (event: Event) => {
      for (const target of event.composedPath()) {
        if (target instanceof ShadowRoot) suppressShadowFocus(target);
      }
    };
    element.addEventListener("pointerdown", onShadowInteraction, true);
    element.addEventListener("focusin", onShadowInteraction, true);
    suppressNestedShadowFocus(element);
    return () => {
      for (const type of intents) element.removeEventListener(type, submitting, true);
      element.removeEventListener("cds-aichat-prompt-change", onInput);
      element.removeEventListener("pointerdown", onShadowInteraction, true);
      element.removeEventListener("focusin", onShadowInteraction, true);
    };
  }, [onInput]);
  useEffect(() => {
    if (chat && container.current) suppressNestedShadowFocus(container.current);
  }, [chat]);

  const messaging = useMemo(
    () => ({
      skipWelcome: true,
      messageTimeoutSecs: 0,
      messageLoadingIndicatorTimeoutSecs: 0,
      customSendMessage: async (
        request: MessageRequest,
        _options: unknown,
        instance: ChatInstance,
      ) => {
        const owner = latest.current;
        // Carbon has already created a local echo. Only the backend snapshot can
        // acknowledge a prompt (also after reconnect, Undo or a failed send).
        const text = request.input.display_content
          ? getRawText(request.input.display_content)
          : request.input.text;
        if (!mounted.current) return;
        const sent = owner.canSend && text?.trim() ? owner.onSend(text) : Promise.resolve(false);
        if (request.id) await instance.messaging.removeMessages([request.id]);
        if (
          !(await sent) &&
          mounted.current &&
          latest.current.draft &&
          !instance.state.get().input.rawValue
        )
          await instance.input.updateContent(() => textToDoc(latest.current.draft));
      },
    }),
    [],
  );
  const stop = useCallback(async () => {
    await latest.current.stop?.();
  }, []);
  useEffect(() => {
    if (!chat) return;
    const handler = { type: BusEventType.STOP_STREAMING, handler: stop };
    chat.on(handler);
    return () => {
      chat.off(handler);
    };
  }, [chat, stop]);
  useEffect(() => {
    if (chat && props.draft !== getRawText(chat.state.get().input.content))
      void chat.input
        .updateContent(() => textToDoc(props.draft))
        .catch(() => setError("Could not restore the draft."));
  }, [chat, props.draft]);
  const reportFocus = props.onInputFocusChange;
  useEffect(() => {
    if (!reportFocus || !chat || !props.active || props.disabled) return;
    reportFocus(chat.state.get().input.focused);
    const unsubscribe = chat.state.select((state) => state.input.focused, reportFocus);
    return () => {
      unsubscribe();
      reportFocus(false);
    };
  }, [chat, props.active, props.disabled, reportFocus]);

  const focused = useRef<number | boolean>(false);
  useEffect(() => {
    const intent = props.focus;
    if (!chat || !intent || !props.active || focused.current === intent) return;
    let current = true;
    void chat.input
      .getEditor()
      .then((editor) => {
        if (current) {
          editor.commands.focus();
          focused.current = intent;
        }
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [chat, props.focus, props.active]);

  const command = useMemo(
    () =>
      props.commands && {
        trigger: "/",
        triggerPosition: "start" as const,
        items: commandSuggestions(props.commands),
      },
    [props.commands],
  );
  return (
    <Viewport.Provider value={props.onViewport}>
      <Entries.Provider value={{ turns: entries, transcript }}>
        {error && <p role="alert">{error}</p>}
        <div ref={container} className="embedded-chat">
          <ChatCustomElement
            className="embedded-chat-element"
            namespace={namespace}
            openChatByDefault
            disableCustomElementMobileEnhancements
            shouldTakeFocusIfOpensAutomatically={false}
            layout={frame}
            history={history}
            persistedState={memorySession}
            header={off}
            renderWriteableElements={
              workspace
                ? {
                    headerBottomElement: <div className="chat-heading-space" aria-hidden="true" />,
                    promptLineSendButtonStart: props.promptControls,
                    afterInputElement: props.footer,
                  }
                : {}
            }
            launcher={off}
            assistantName="Code60"
            hideAvatar
            strings={{
              window_ariaChatRegionNamespace: props.label,
              input_ariaLabel: props.label,
              input_placeholder: props.commands ? "Message… (type / for commands)" : props.label,
              input_buttonLabel: "Send",
              input_stopResponse: "Stop",
            }}
            input={{
              expanded: true,
              isVisible: !props.hideInput,
              isDisabled: props.disabled,
              isSendDisabled: !props.canSend,
              showStopStreamingButton: !!props.stop,
              maxInputCharacters: props.limit ?? 1_000_000,
              ...(command ? { command, mention: { ...command, trigger: "$" } } : {}),
            }}
            messaging={messaging}
            onAfterRender={setChat}
            renderUserDefinedResponse={renderEntry}
          />
        </div>
      </Entries.Provider>
    </Viewport.Provider>
  );
}
