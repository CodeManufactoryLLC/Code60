import { Icon } from "./icons.js";
import { groups, type PageId, pageAvailable, pageDefinitions, pagesInGroup } from "./navigation.js";
import { NavigationIcon } from "./navigation-icons.js";

export function AppsPage({
  database,
  onOpen,
}: {
  database: string | null;
  onOpen(id: PageId): void;
}) {
  const cards = [
    ...pagesInGroup("apps").map((id) => ({
      destination: id,
      ...pageDefinitions[id],
      available: pageAvailable(id, database),
    })),
    {
      id: "tables",
      destination: "logs" as const,
      ...groups.tables,
      available: true,
    },
  ].sort((a, b) => a.label.localeCompare(b.label));
  return (
    <main className="home-page" aria-labelledby="apps-title">
      <div className="table-controls">
        <h1 className="table-title" id="apps-title">
          Apps
        </h1>
      </div>
      <div className="home-content">
        <div className="home-cards">
          {cards.map((page) => {
            const { id, available } = page;
            return (
              <button
                key={id}
                type="button"
                className="home-card"
                data-feature={id}
                aria-label={`Open ${page.label}`}
                disabled={!available}
                title={!available ? "Connect to a database first" : undefined}
                onClick={() => onOpen(page.destination)}
              >
                <span className="home-card-art" aria-hidden="true">
                  {page.icon && <NavigationIcon name={page.icon} />}
                </span>
                <span className="home-card-copy">
                  <span className="home-card-name">{page.label}</span>
                </span>
                <Icon name="arrow--left" className="carbon-icon home-card-arrow" />
              </button>
            );
          })}
        </div>
      </div>
    </main>
  );
}
