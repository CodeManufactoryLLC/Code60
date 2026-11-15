import type { ReactNode } from "react";
import { NavigationCards } from "./navigation-cards.js";
import type { NavigationIconName } from "./navigation-icons.js";
import { PageTitle, type PageTitleId } from "./page-title.js";

export function NavigationHomePage<
  Card extends {
    id: string;
    label: string;
    icon?: NavigationIconName | undefined;
    available: boolean;
  },
>({
  page,
  id = page,
  label,
  cards,
  onOpen,
  actions,
  empty = "No items",
  error,
  hidden = false,
  pending = false,
}: {
  page: PageTitleId;
  id?: string;
  label?: string;
  cards: readonly Card[];
  onOpen(card: Card): void;
  actions?: ReactNode;
  empty?: string;
  error?: string | undefined;
  hidden?: boolean;
  pending?: boolean;
}) {
  return (
    <main className="home-page" aria-labelledby={`${id}-title`} hidden={hidden}>
      <div className="table-controls">
        <PageTitle page={page} className="table-title" id={`${id}-title`}>
          {label}
        </PageTitle>
        {actions}
      </div>
      <NavigationCards cards={cards} onOpen={onOpen} pending={pending}>
        {!cards.length && <p className="empty">{empty}</p>}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
      </NavigationCards>
    </main>
  );
}
