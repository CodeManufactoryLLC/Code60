import { Button as AppButton } from "./carbon/button.js";

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
      <AppButton
        type="button"
        className="footer-splash"
        aria-label="Workspace setup"
        title="Workspace setup"
        disabled={returnDisabled}
        onClick={onReturn}
      >
        Workspace setup
      </AppButton>
      <AppButton
        type="button"
        className="footer-database"
        aria-label="Select or create database"
        title="Select or create database"
        aria-haspopup="dialog"
        disabled={databaseDisabled}
        onClick={onDatabase}
      >
        Select or create database
      </AppButton>
    </>
  );
}
