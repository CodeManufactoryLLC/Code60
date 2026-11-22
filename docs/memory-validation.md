# Scoped agent memory

## Ownership and defaults

The production desktop host enables the optional memory integration. Core and
the scheduler do not create memory databases or provider calls.

The private store is `$XDG_STATE_HOME/code60/memory/memory.sqlite`, falling back
to `~/.local/state/code60/memory/memory.sqlite`. It has its own schema version,
settings, durable project IDs, conversation IDs, sources, checkpoints, generated
records, revisions, suppression, lexical index and derived vectors.
Project database schemas and existing transcripts are unchanged.

Memory starts On for Relay, project chats and workers. Settings has one immediately
saved On/Off switch, a Manage memories link to the shared Data Viewer and one
retention selector (Never, 30 days, 90 days or one year). There are no separate
pipeline, type, role or conversation preferences and no daily generation allowance.
These are internal resource defaults, not exposed tuning settings:

| Setting | Initial value |
| --- | --- |
| Rollover threshold | 70% |
| Unknown model capacity | 128,000 estimated tokens |
| Checkpoint context cap | 2,000 estimated tokens |
| Retrieved memory cap | 4,000 estimated tokens |
| Coalescing delay | 30 seconds after a completed turn |
| Types | Generate and recall all four types |
| Retention | Never delete automatically |

Provider-reported usage takes priority as a capacity source. The fallback
estimate is not the embedding-model tokenizer: it counts one token per three
ASCII characters and two per other code point, above typical provider averages.
Dense encoded data such as base64 can exceed it. Trusted operating context
and the current request are reserved first, with at least 512 tokens or 15% of
capacity for output. Numeric defaults are tuning values, not performance promises.

## Scope and provenance

### Inspecting recorded recalls

Every chat's right sidebar offers **Open Memory Recall** beside **Open Files**
in the empty/New tab view. Reopening selects the existing recall tab; shared
close, drag, arrow/Home/End, Delete and Alt+Left/Right behavior applies.
Relay and Relay workers require no database. The tab follows the displayed chat,
not the selected file root or project.

The renderer groups existing turn-associated `Memory used` notes, validates their
IDs and requests only those saved records through memory detail. It never calls
retrieval, a provider or memory browsing. Every available recorded recall turn
remains reachable through newest-first five-turn pages. The latest dispatched
turn is marked Current turn, with an explicit zero-hit state that removes the
previous marker. Preparing or failing to send a request does not advance that
marker. Malformed notes retain per-turn warnings. Missing prompt boundaries,
unavailable restored recall annotations and truncated history never reconstruct
earlier turns. The tab omits introductory and source-history gap copy.

Text, type, scope, conditions and expandable evidence quotes are read-only
literal text. Saved notes contain IDs, not historical text snapshots: the tab
shows current saved records, marks records updated after recall and preserves
unavailable placeholders for forgotten/missing records. Record errors offer
Retry. Editing and forgetting remain in Data Viewer → Memories.

Reads occur only for the selected, open, active tab in a visible document.
Existing chat detail updates and payload-free memory notices refresh the view,
without polling or automatic focus/opening. Four concurrent detail reads are
shared across owner replacements; a page retains at most 160 record summaries
and citation quotes, excluding full source bodies and revisions. Full owner keys
include project/database epochs or Relay generation, conversation, worker/run
and target/task identity. Navigation/replacement rejects late replies.
Self-knowledge reports only the recall tab kind/selection, never its contents.

Focused tests cover turn order, repeated recalls, zero hits, malformed/orphan
notes, current saved records, unavailable/changed records, read bounds, hidden
cleanup, late results, owner changes and tab state. `test/memory-recall.e2e.ts`
adds real fake-provider Relay/project/worker journeys, including no-database
Relay, sidebar interactions, navigation and IDs checked against recorded notes.
Its provider-boundary dispatch logs and unchanged last-used timestamps check
that opening recall does not dispatch or retrieve again. Desktop collection is
not execution; see the local QA report for the disk-pressure execution blocker.

Project IDs pin canonical paths, device, inode and creation identity. Replacing
a directory does not reuse its knowledge identity. Conversation keys preserve
logical identity across physical sessions. Worker scope comes from its assignment,
not the currently selected project. Relay continuity remains application-owned
across database switches. Relay may recall project knowledge only for targets
already owned by its current human task, with native identities rechecked.
Worker results generate project-scoped records independently for each target.
Mixed-target Relay statements remain private rather than guessing a project.

Records distinguish Episodic events, Semantic claims, conditional Lessons and
History synopses. Every generated record carries exact source quotes/offsets,
event and creation times, revision, provider/prompt identity and attribution.
Assistant claims remain agent-reported, not independently verified.
Contradictions become disputed and are excluded from recall. Explicit human
corrections can supersede unprotected claims. Automatic generation does not
replace pinned or human-edited records.

Sources are bounded, secret-filtered copies of newly observed human text and
completed assistant replies. Stream fragments are joined before filtering.
Offsets and citations address those filtered copies, not unredacted source text.
Original source history remains in its existing stores. No startup archive scan
or implicit import of legacy histories occurs.

## Continuity and failure

Only completed, committed source ranges advance extraction cursors. Checkpoints,
candidates and cursors publish atomically. Generation runs one permission-denied
helper at a time, without MCP servers, in a private temporary directory, with a
120-second deadline and 64,000-character output bound. Source pages contain at
most 64 records and approximately 24 KiB. Failed or cancelled work preserves the
previous checkpoint and cursor.

Before a new turn crosses the threshold, Code60 drains pending capture, generates
a checkpoint and replaces only the idle physical ACP session. It retains trusted
operating instructions, current in-process gateway/task ownership, bounded recent
evidence and the current request. It never interrupts and replays an active turn,
restores historical ownership or marks unfinished work complete.

Live continuity is independent of saved memory. Each runtime keeps a bounded,
session-local buffer and checkpoint, including while Memory is Off. Handoff can
summarize that buffer through the verified provider without creating long-term
records or a durable learning backlog. Completed learning checkpoints are reused
only when their evidence matches the uninterrupted On-mode live buffer.
Off-mode evidence and continuity checkpoints are never imported into learning.

Explicit restore and handoff seed this live buffer from the existing bounded
recovery evidence, even when native ACP restoration does not replay history.
This is not a startup archive import or learning backfill. Both immediate and
later context rollover retain the recovered evidence without restoring authority.

Required handoff failure pauses dispatch, with the unsent request retained in a
transcript note. Unavailable recall alone is nonblocking while context fits.
Oversized requests are rejected rather than truncated. Missing or overflowed
capture cannot silently become a complete checkpoint.

Cancellation remains effective during replacement startup and installation.
Prepared recall is revalidated after replacement startup, immediately before
dispatch. A changed setting or source keeps the request unsent; retry still
receives the live continuity checkpoint.
Automatic deliveries keep worker updates and feedback pending until the run
confirms dispatch; a preparation failure pauses delivery rather than consuming it.
Forgetting permits a fresh session without the intentionally deleted checkpoint,
with an explicit continuity-reset warning.

## Search and limits

Search filters authorized scopes and active state before lexical/vector ranking.
Recency weights apply to Episodic and History memories; deterministic IDs break
ties. Scores measure relevance, never confidence. Memory context deduplicates
shared source evidence.

The bundled offline Jina model and core exact-span chunker are reused, but vectors
are independent of manual RAG. The sidecar incrementally indexes eight records
at a time, yielding to queued operations between batches. Query ranking pages 256
records at a time and keeps a bounded 100-record semantic shortlist beside up to
100 BM25 lexical hits. Reciprocal-rank fusion combines both lists, so one weak
keyword match cannot outrank a strong semantic match; at most 32 records are
returned. Retrieval has a 15-second scan budget;
an expired scan fails visibly instead of returning a complete-looking empty result.
Incomplete semantic indexes retain lexical recall and expose a warning.

The store enforces its 512 MiB quota and limits memories to 100,000 records.
Capture bounds each assistant reply to 256,000 characters and pending source
text to 1 MiB per runtime. Sidecar RPC has at most 64 requests, with 256,000-byte
payloads and 30-second deadlines. Generation has at most 64 queued conversations.
Settings and browser lists are bounded; browsing uses 25-record pages.
Semantic indexing retries after 1, 5 and 15 seconds before exposing Repair search.
Keyword recall remains available during indexing failures.

An exclusive private writer lock protects store opening, migration and incomplete
exchange cleanup. A second live or unverifiable owner cannot open the store.
Idle sidecar replacement waits for the previous process to exit before reopening.
Queued helper cancellation settles immediately without starting another provider;
active helper cleanup still completes before the serialized queue advances.
Ordinary edit, retention and repair mutations pause generation, not capture of
otherwise eligible completed On-mode exchanges.

## Privacy and forgetting

Memory Off stops capture for learning, generation and saved recall. Pending
learning is cancelled and unprocessed learning-only sources are discarded;
evidence required by saved records is preserved. Turning On begins prospectively,
including when toggled during a turn: a partly Off-mode exchange cannot become
learning evidence. Filtering is best effort, not a guarantee that all sensitive
text is recognized. Ordinary transcripts and already-supplied provider context
are not erased by the switch.

Private schema/settings version 2 migrates restricted legacy settings, including
type/role/conversation exclusions and finite retention, to Off. Fully enabled
default configurations remain On. Migration preserves records and citations,
keeps stale records stale, and initializes the new retention policy to Never.
Old call counters and active legacy settings are removed.

Retention uses creation time, never deletes pinned records, and actually deletes
expired unpinned memories, revisions and vectors rather than marking them stale.
Evidence shared with surviving records is retained, but excluded from future
extraction. Before shortening retention, main previews the affected count and
requests native confirmation; a changed preview is rejected. Deletion runs in
batches of at most 64 records, with maintenance independent of visiting Settings.

Forgetting requires native confirmation. It invalidates pending extraction and
recall, removes derived memories/vectors/revisions and the cited captured source
copies, clears affected checkpoints
and suppresses recreation from the same source IDs. Shared-source siblings are
also excluded from recall. Scope forgetting includes not-yet-extracted sources.
Original transcripts and already-running provider context are not erased.
Global promotion is explicit and natively confirmed with a sharing preview.
Scope forgetting excludes global records. Evidence shared with those records is
retained for their provenance, but suppressed from future extraction and recent
continuity so it cannot recreate forgotten local records.

The memory bridge is available only to the checked renderer. No MCP memory tools,
cross-project worker browser or memory-write authority is added.

## Validation

Deterministic tests cover the four types, private permissions, persisted settings,
scope separation, native identity replacement, atomic failed publication,
contradictions/corrections, pinning, revision checks, suppression, generation beyond
the former 50-call limit, On/Off transitions, secret filtering, provider failure/cancellation and repeated
handoffs across small simulated contexts. The container test exercises the real
preload, SQLite sidecar, configured ACP helper, Settings and inspection/forgetting UI.

Additional tests cover incremental bounded indexing, the incomplete-index
warning, Relay multi-target filtering before ranking, native identity rechecks,
rank fusion, run-level preparation failure (the request is not sent and its text
is kept), prompt-then-`Memory used` ordering and shutdown during preparation.

Review regressions also cover cancellation during replacement startup/installation,
delivery refusal, repeated contradictions, automatic-update usage estimates,
reported capacity during storage failure, recovery after forgetting, Relay-owned
worker exclusion from manual RAG, and exact bigint identities in sidecar requests.
SQLite-dependent tests follow the existing Node.js 22.12 availability guard;
Node.js 24 and the Electron container exercise their complete behavior.
The browser keeps 25 records per page with forward/back navigation beyond 500
records; edits preserve cursor ordering. Settings save immediately and revert
on failure or cancelled confirmation. Tests cover migration, retention boundaries,
shared pinned evidence, late recall/generation, no backfill and repeated Off-mode
handoffs without persisted learning or saved recall.
Duplicate detection distinguishes types, applicability conditions and subjects;
episodic/history records also preserve distinct source dates. Equivalent semantic
claims do not become contradictions merely because they recur.

### Measurements

`npm run test:memory:performance` builds the app and runs
`scripts/benchmark-memory.mjs` offline (network access throws). It seeds 50
conversations in one project (982 memories embedded with the bundled Jina INT8
model), a distractor in a second project, and pads the project to 10,000 records
with synthetic vectors to measure scan cost. Earlier reference results on an Apple Silicon Mac
(14 CPUs, Node.js 24.22):

| Measurement | Result |
|---|---|
| Cold model load | 303 ms |
| Index lag, 982 records (123 batches) | 8.0 s; worst batch 80 ms |
| Cold / warm query, ~1,000 records | 56 ms / 65 ms max |
| Query scan, 10,000 records | 502 ms max |
| Paraphrased recall of a 90-day-old memory | rank 2 of ~1,000; other project excluded |
| Peak RSS (model loaded) | 727 MiB |

Revalidated on 2026-11-14 in a fresh Linux arm64 container using the cached,
bundled model, with container networking disabled. All assertions passed:
982 real embeddings across 123 batches, 12.2 seconds total indexing and a
125 ms worst batch; 246 ms cold model load; 70 ms cold query and 63 ms maximum
warm query; 623 ms maximum scan across 10,000 records. The paraphrased memory
ranked second and stayed project-scoped. Peak RSS was 580 MiB. These container
timings are not directly comparable to the earlier native macOS results.

A fresh-process disk snapshot of the maximum 2,000 conversations split between
legacy/current stores took 340 ms and two directory listings (104 MiB RSS).
The offline real-model smoke also verifies complete, token-bounded chunks for a
1,003,000-character message with a million-character whitespace suffix: 11 chunks,
7.0 s including repeated token-limit checks. That broader smoke peaked at
1,313 MiB RSS. Chunker identity version 2 invalidates older manual snapshots;
memory vectors carry the matching chunker revision and rebuild incrementally.

These are single-machine reference results, not guarantees. Generation coalesces
pending evidence per conversation and serializes provider calls; there is no daily
allowance. Those behaviors are verified in deterministic tests, not with a live provider.
