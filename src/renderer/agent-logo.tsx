import { Icon } from "./icons.js";

const logos = import.meta.glob<string>("./agent-logos/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
});

export function AgentLogo({ id, size = 28 }: { id: string; size?: number }) {
  const key = id.toLowerCase();
  const src = logos[`./agent-logos/${key}.svg`];
  return src ? (
    <img className={`agent-logo agent-logo-${key}`} src={src} alt="" width={size} height={size} />
  ) : (
    <Icon name="terminal" />
  );
}
