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

export interface NavigationCardAction {
  label: string;
  ariaLabel?: string;
  title?: string;
  onClick(): void;
}

export function NavigationCards<Card extends NavigationCard>({
  cards,
  create,
  onOpen,
  intro,
  children,
  pending = false,
}: {
  cards: readonly Card[];
  create?: NavigationCardAction | undefined;
  onOpen(card: Card): void;
  intro?: import("react").ReactNode;
  children?: import("react").ReactNode;
  pending?: boolean;
}) {
  return (
    <div className="home-content">
      {intro}
      <div className="home-cards">
        {create && (
          <button
            type="button"
            className="home-card home-card-create"
            aria-label={create.ariaLabel ?? create.label}
            disabled={pending}
            title={pending ? "Wait for the current action to finish" : create.title}
            onClick={create.onClick}
          >
            <span className="home-card-name">
              <Icon name="add" />
              {create.label}
            </span>
          </button>
        )}
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
