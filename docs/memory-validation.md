# Scoped agent memory

## Ownership and defaults

The production desktop host enables the optional memory integration. Core and
the headless CLI do not create memory databases or provider calls.

The private store is `$XDG_STATE_HOME/code60/memory/memory.sqlite`, falling back
to `~/.local/state/code60/memory/memory.sqlite`. It has its own schema version,
settings, durable project IDs, conversation IDs, sources, checkpoints, generated
records, revisions, suppression, call counters, lexical index and derived vectors.
Project database schemas and existing transcripts are unchanged.

Memory starts on for Relay, project chats and workers, with capture, generation,
recall and between-turn continuity enabled. The initial settings are:

| Setting | Initial value |
| --- | --- |
| Rollover threshold | 70% |
| Unknown model capacity | 128,000 estimated tokens |
| Checkpoint context cap | 2,000 estimated tokens |
| Retrieved memory cap | 4,000 estimated tokens |
| Coalescing delay | 30 seconds after a completed turn |
| Generation calls | 50 per UTC day |
| Types | Generate and recall all four types |
| Retention | No automatic expiry |

Provider-reported usage takes priority as a capacity source. The fallback
estimate is not the embedding-model tokenizer: it counts one token per three
ASCII characters and two per other code point, above typical provider averages.
Dense encoded data such as base64 can exceed it; lower the capacity if needed. Trusted operating context
and the current request are reserved first, with at least 512 tokens or 15% of
capacity for output. Numeric defaults are tuning values, not performance promises.

## Scope and provenance

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

Required handoff failure pauses dispatch, with the unsent request retained in a
transcript note. Unavailable recall alone is nonblocking while context fits.
Oversized requests are rejected rather than truncated. Missing or overflowed
capture cannot silently become a complete checkpoint.

Cancellation remains effective during replacement startup and installation.
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

The store warns near its 512 MiB quota and limits memories to 100,000 records.
Capture bounds each assistant reply to 256,000 characters and pending source
text to 1 MiB per runtime. Sidecar RPC has at most 64 requests, with 256,000-byte
payloads and 30-second deadlines. Generation has at most 64 queued conversations.
Settings and browser lists are bounded; browsing uses 25-record pages.

## Privacy and forgetting

Capture, generation and recall can be paused independently. Type-specific
generation and recall switches are separate. Per-conversation Do not remember
excludes that conversation from capture and recall. Filtering is best effort,
not a guarantee that all sensitive text is recognized.

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
contradictions/corrections, pinning, revision checks, suppression, daily call limits,
privacy switches, secret filtering, provider failure/cancellation and repeated
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
records; edits preserve cursor ordering. Numeric controls permit intermediate
typing, and non-settings actions preserve unsaved settings drafts.
Duplicate detection distinguishes types, applicability conditions and subjects;
episodic/history records also preserve distinct source dates. Equivalent semantic
claims do not become contradictions merely because they recur.

### Measurements

`npm run test:memory:performance` builds the app and runs
`scripts/benchmark-memory.mjs` offline (network access throws). It seeds 50
conversations in one project (982 memories embedded with the bundled Jina INT8
model), a distractor in a second project, and pads the project to 10,000 records
with synthetic vectors to measure scan cost. One run on an Apple Silicon Mac
(14 CPUs, Node.js 24.22):

| Measurement | Result |
|---|---|
| Cold model load | 303 ms |
| Index lag, 982 records (123 batches) | 8.0 s; worst batch 80 ms |
| Cold / warm query, ~1,000 records | 56 ms / 65 ms max |
| Query scan, 10,000 records | 502 ms max |
| Paraphrased recall of a 90-day-old memory | rank 2 of ~1,000; other project excluded |
| Peak RSS (model loaded) | 727 MiB |

A fresh-process disk snapshot of the maximum 2,000 conversations split between
legacy/current stores took 340 ms and two directory listings (104 MiB RSS).
The offline real-model smoke also verifies complete, token-bounded chunks for a
1,003,000-character message with a million-character whitespace suffix: 11 chunks,
7.0 s including repeated token-limit checks. That broader smoke peaked at
1,313 MiB RSS. Chunker identity version 2 invalidates older manual snapshots;
memory vectors carry the matching chunker revision and rebuild incrementally.

These are single-machine results, not guarantees. Generation call counts are
bounded by coalescing (one helper call per pending conversation range) and the
daily limit; they were verified in deterministic tests, not with a live provider.
