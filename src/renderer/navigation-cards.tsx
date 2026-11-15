import { Icon } from "./icons.js";
import { NavigationIcon, type NavigationIconName } from "./navigation-icons.js";

interface NavigationCard {
  id: string;
  label: string;
  icon?: NavigationIconName | undefined;
  available: boolean;
  reason?: string;
  title?: string;
}

export function NavigationCards<Card extends NavigationCard>({
  cards,
  onOpen,
  children,
  pending = false,
}: {
  cards: readonly Card[];
  onOpen(card: Card): void;
  children?: import("react").ReactNode;
  pending?: boolean;
}) {
  return (
    <div className="home-content">
      <div className="home-cards">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="home-card"
            data-feature={card.id}
            aria-label={`Open ${card.label}`}
            disabled={!card.available || pending}
            title={
              pending
                ? "Wait for the current action to finish"
                : !card.available
                  ? (card.reason ?? "Connect to a database first")
                  : card.title
            }
            onClick={() => onOpen(card)}
          >
            <span className="home-card-art" aria-hidden="true">
              {card.icon && <NavigationIcon name={card.icon} />}
            </span>
            <span className="home-card-copy">
              <span className="home-card-name">{card.label}</span>
            </span>
            <Icon name="arrow--left" className="carbon-icon home-card-arrow" />
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}
