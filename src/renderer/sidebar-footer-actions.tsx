import { Icon } from "./icons.js";

export function SidebarFooterActions({
  returnDisabled,
  databaseDisabled,
  onReturn,
  onDatabase,
}: {
  returnDisabled: boolean;
  databaseDisabled: boolean;
  onReturn(): void;
  onDatabase(): void;
}) {
  return (
    <>
      <button
        type="button"
        className="icon-button footer-splash"
        aria-label="return to splash page"
        title="return to splash page"
        disabled={returnDisabled}
        onClick={onReturn}
      >
        <Icon name="arrow--left" />
      </button>
      <button
        type="button"
        className="icon-button footer-database"
        aria-label="Select or create database"
        title="Select or create database"
        aria-haspopup="dialog"
        disabled={databaseDisabled}
        onClick={onDatabase}
      >
        <Icon name="database" />
      </button>
    </>
  );
}
