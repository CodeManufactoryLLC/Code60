import { Icon } from "./icons.js";

export function DatabaseNotice({
  busy,
  error,
  onConnect,
}: {
  busy: boolean;
  error?: string | null | undefined;
  onConnect(): void;
}) {
  return (
    <section className="database-notice" role="status" aria-label="Database connection required">
      <Icon name="warning--alt--filled" />
      <div>
        <h2>No database connected</h2>
        <p>Connect a database to enable chats, projects, and workspace controls.</p>
        {error && <p>{error}</p>}
      </div>
      <button type="button" className="primary" disabled={busy} onClick={onConnect}>
        Connect to database
      </button>
    </section>
  );
}
