import { Button } from "./carbon/button.js";
import { Icon } from "./icons.js";
import type { NavigationIconName } from "./navigation-icons.js";

interface NavigationCard {
  id: string;
  label: string;
  task?: string | undefined;
  icon?: NavigationIconName | undefined;
  available: boolean;
  reason?: string;
  title?: string | undefined;
}

export interface NavigationCardAction {
  label: string;
  ariaLabel?: string;
  title?: string | undefined;
  disabled?: boolean;
  onClick(): void;
}

/** Destination rows keep open/actions as siblings, never nested interactive tiles. */
export function NavigationCards<Card extends NavigationCard>({
  cards,
  create,
  onOpen,
  renderActions,
  renderArtwork,
  intro,
  children,
  pending = false,
}: {
  cards: readonly Card[];
  create?: NavigationCardAction | undefined;
  onOpen(card: Card): void;
  renderActions?(card: Card): import("react").ReactNode;
  renderArtwork?(card: Card): import("react").ReactNode;
  intro?: import("react").ReactNode;
  children?: import("react").ReactNode;
  pending?: boolean;
}) {
  return (
    <div className="home-content">
      {intro}
      {create && (
        <div className="navigation-create">
          <Button
            variant="primary"
            aria-label={create.ariaLabel ?? create.label}
            disabled={pending || create.disabled}
            title={pending ? "Wait for the current action to finish" : create.title}
            onClick={create.onClick}
          >
            {create.label}
            <Icon name="add" />
          </Button>
        </div>
      )}
      <ul className="navigation-list">
        {cards.map((card) => (
          <li key={card.id} className="navigation-list-row">
            <Button
              variant="quiet"
              className="navigation-destination"
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
              {renderArtwork && (
                <span className="navigation-destination-icon" aria-hidden="true">
                  {renderArtwork(card)}
                </span>
              )}
              {card.task ? (
                <span className="task-index-label">
                  <span>{card.label}</span>
                  <small>{card.task}</small>
                </span>
              ) : (
                <span>{card.label}</span>
              )}
              <Icon name="arrow--right" />
            </Button>
            {renderActions && <div className="navigation-row-actions">{renderActions(card)}</div>}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}
