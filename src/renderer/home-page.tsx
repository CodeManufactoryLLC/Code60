import { useRef, useState } from "react";
import { Icon } from "./icons.js";
import { NavigationIcon } from "./navigation-icons.js";
import { RelayNavigationIcon } from "./relay-navigation-icon.js";

export function HomePage({
  database,
  relayAvailable,
  onOpenRelay,
  onOpenTool,
}: {
  database: boolean;
  relayAvailable: boolean;
  onOpenRelay(): Promise<void>;
  onOpenTool(id: "commands" | "prompts"): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const openRelay = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      await onOpenRelay();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  };
  const cards = [
    {
      id: "relay",
      name: "Relay",
      description: "Your Always-On Assistant",
      icon: <RelayNavigationIcon working={false} />,
      disabled: !relayAvailable || pending,
      action: () => void openRelay(),
    },
    {
      id: "commands",
      name: "Commands",
      description: "Create Custom Commands",
      icon: <NavigationIcon name="megaphone" />,
      disabled: !database || pending,
      action: () => onOpenTool("commands"),
    },
    {
      id: "prompts",
      name: "Prompt Builder",
      description: "Adjust Code60's built-in Prompts",
      icon: <NavigationIcon name="pencil-line" />,
      disabled: !database || pending,
      action: () => onOpenTool("prompts"),
    },
  ];
  return (
    <main className="home-page" aria-labelledby="home-title">
      <div className="table-controls">
        <h1 className="table-title" id="home-title">
          Home
        </h1>
      </div>
      <div className="home-content">
        <div className="home-cards">
          {cards.map((card) => (
            <button
              key={card.id}
              type="button"
              className="home-card"
              data-feature={card.id}
              aria-label={`Open ${card.name}`}
              aria-describedby={`home-${card.id}-description`}
              disabled={card.disabled}
              title={!database && card.id !== "relay" ? "Connect to a database first" : undefined}
              onClick={card.action}
            >
              <span className="home-card-art" aria-hidden="true">
                {card.icon}
              </span>
              <span className="home-card-copy">
                <span className="home-card-name">{card.name}</span>
                <span className="home-card-description" id={`home-${card.id}-description`}>
                  {card.description}
                </span>
              </span>
              <Icon name="arrow--left" className="carbon-icon home-card-arrow" />
            </button>
          ))}
        </div>
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
