# MCP connector recovery and troubleshooting

## Motivation

An interrupted multi-file change must be reviewable without erasing evidence or
silently replaying publication. A failed connector must explain its next available
action while other tools remain usable, without disclosing configuration or secrets.

## Description

Application projects private store journals into metadata-only human reviews and
serializes confirmed recovery with project lifecycle operations. Contracts accept
registered captured owners, file revisions, journal identity/content revision and
a mutation UUID; platform guarded writes recheck native identity before publication.
Renderer retains drafts and requires explicit compare/reload afterward. Agents
produce fixed failure codes/stages; application supplies strict counts-only reports
and retries only retained revoked cleanup handles. Gateway owns authenticated
human routes and transports; no new dependency edge or agent tool is introduced.

## Tradeoffs

External edits and unavailable/replaced owners block recovery rather than offering
force. Reports omit even labels and IDs, making them safe but less specific; the
local UI retains scoped context. Cleanup verification may remain unresolved and
keeps ownership/capacity reserved. Configuration rollback cannot undo remote tool
side effects or restore credentials, approvals, sessions or revoked authority.
