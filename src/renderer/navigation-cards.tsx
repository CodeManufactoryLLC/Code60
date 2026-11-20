import { Icon } from "./icons.js";
import { NavigationIcon, type NavigationIconName } from "./navigation-icons.js";
import {
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
  Card as NeoCard,
} from "./neobrutalism/card.js";

interface NavigationCard {
  id: string;
  label: string;
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

export function NavigationCards<Card extends NavigationCard>({
  cards,
  create,
  onOpen,
  renderActions,
  renderArtwork,
  renderStatus,
  intro,
  children,
  pending = false,
}: {
  cards: readonly Card[];
  create?: NavigationCardAction | undefined;
  onOpen(card: Card): void;
  renderActions?(card: Card): import("react").ReactNode;
  renderArtwork?(card: Card): import("react").ReactNode;
  renderStatus?(card: Card): import("react").ReactNode;
  intro?: import("react").ReactNode;
  children?: import("react").ReactNode;
  pending?: boolean;
}) {
  return (
    <div className="home-content">
      {intro}
      <div className="home-cards">
        {create && (
          <NeoCard size="sm" className="navigation-card">
            <button
              type="button"
              className="home-card home-card-create"
              aria-label={create.ariaLabel ?? create.label}
              disabled={pending || create.disabled}
              title={pending ? "Wait for the current action to finish" : create.title}
              onClick={create.onClick}
            >
              <CardTitle as="span" className="home-card-name">
                <Icon name="add" />
                {create.label}
              </CardTitle>
            </button>
          </NeoCard>
        )}
        {cards.map((card) => {
          return (
            <NeoCard key={card.id} size="sm" className="navigation-card">
              <button
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
                <CardHeader as="span" className="home-card-art" aria-hidden="true">
                  {renderArtwork
                    ? renderArtwork(card)
                    : card.icon && <NavigationIcon name={card.icon} />}
                </CardHeader>
                <CardContent as="span" className="home-card-copy">
                  <CardTitle as="span" className="home-card-name">
                    {card.label}
                  </CardTitle>
                </CardContent>
                <Icon name="arrow--left" className="carbon-icon home-card-arrow" />
              </button>
              {renderStatus?.(card)}
              {renderActions && (
                <CardAction className="home-card-action">{renderActions(card)}</CardAction>
              )}
            </NeoCard>
          );
        })}
      </div>
      {children}
    </div>
  );
}
