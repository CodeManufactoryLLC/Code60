import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/renderer/style.css";
import "../../src/renderer/carbon/application.scss";
import { Button } from "../../src/renderer/carbon/button.js";
import { Combobox } from "../../src/renderer/carbon/combobox.js";
import { DropdownMenu } from "../../src/renderer/carbon/dropdown-menu.js";
import { DataTable, type RetainedTableQuery } from "../../src/renderer/data-table.js";
import { defaultTextStyles } from "../../src/renderer/typography.js";

const rows = Array.from({ length: 61 }, (_, n) => ({
  id: `id-${n}`,
  name: `Job ${String(n).padStart(2, "0")}`,
  count: n,
}));
const columns = [
  { key: "name", title: "Name", width: 240 },
  { key: "count", title: "Count", width: 120, filter: "number" },
] as const;
function Fixture() {
  const [selected, choose] = useState<string>();
  const [workspace, setWorkspace] = useState("alpha");
  const [retained, setRetained] = useState(false);
  const [query, setQuery] = useState<RetainedTableQuery>();
  const [tab, setTab] = useState("files");
  const [action, setAction] = useState("");
  return (
    <>
      <Button
        onClick={() => {
          const root = document.documentElement;
          root.dataset.colorScheme = root.dataset.colorScheme === "dark" ? "light" : "dark";
        }}
      >
        Theme
      </Button>
      <Button onClick={() => setWorkspace((value) => (value === "alpha" ? "beta" : "alpha"))}>
        Change workspace
      </Button>
      <Button onClick={() => setRetained((value) => !value)}>Retained query</Button>
      <output aria-label="Selected identity">{selected}</output>
      <output aria-label="Retained request">{JSON.stringify(query)}</output>
      <output aria-label="Chosen action">{action}</output>
      <div style={{ width: 320 }}>
        <Combobox
          label="Files view"
          value={tab}
          options={[
            { id: "files", label: "Files" },
            { id: "changes", label: "Changes" },
            { id: "new", label: "+ New Tab" },
          ]}
          onSelect={setTab}
        />
      </div>
      <DropdownMenu
        label="Fixture actions"
        active
        disabled={false}
        items={[
          {
            id: "unavailable",
            label: "Unavailable",
            disabled: true,
            reason: "Busy",
            run: () => setAction("invalid"),
          },
          { id: "edit", label: "Edit", run: () => setAction("edit") },
          { id: "delete", label: "Delete", run: () => setAction("delete") },
        ]}
      />
      <section className="page-panel" style={{ height: "70vh", minHeight: 400 }}>
        <DataTable
          rows={rows}
          columns={[...columns]}
          tableId="configurations"
          workspace={workspace}
          initialSort="count"
          initialDescending
          display={(row, key) => String(row[key])}
          selected={selected}
          onSelect={choose}
          lines={{ horizontal: true, vertical: false, heading: false }}
          density="high"
          fit
          textStyles={defaultTextStyles}
          {...(retained ? { onRetainedQuery: setQuery } : {})}
          onAdd={() => setAction("new")}
          addLabel="New configuration"
        />
      </section>
    </>
  );
}
document.documentElement.classList.add("carbon-app");
createRoot(document.getElementById("root")!).render(<Fixture />);
