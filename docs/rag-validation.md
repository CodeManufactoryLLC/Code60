# Offline RAG validation

Run `npm run prepare:models` once during development or release preparation.
`npm run test:rag:model` verifies pinned hashes, builds, and runs the actual model
in a fresh Node process. Remote loading and filesystem model caches are disabled;
the direct model test additionally replaces `fetch` with a throwing function.
The desktop container test exercises the real IPC, renderer and Node sidecar.

## Local measurements

Measured on 2026-11-13, Apple M4 Max, macOS arm64, Node 24.22.0, using CPU
inference with two intra-op threads, one inter-op thread and batches of at most
eight. These are fresh-process measurements, not a cold operating-system disk
cache or a device performance guarantee.

| Measurement | Result |
| --- | ---: |
| Model/module cold load | 418 ms |
| Four-document indexing fixture | 79 ms |
| Mean warm query, three fixtures | 5.9 ms |
| Eight documents, each exactly 512 tokens including specials | 1,357 ms |
| Peak process RSS, including that maximum-size batch | 1,024 MiB |
| Cold sidecar build, two message chunks | 414 ms |
| Cold sidecar retrieval, persisted two-chunk index | 415 ms |

The conversation paraphrase, TypeScript retry and TypeScript deduplication
fixtures each ranked their predetermined relevant document first (3/3).
The independent upstream model-card example reports fp32 cosine 0.7282;
the bundled INT8 model produced 0.734106, within the smoke's 0.03 quantization
tolerance. This is a regression fixture, not a general retrieval accuracy claim.
The real tokenizer also verified complete original source coverage, <=512-token
chunks and <=64-token overlap on a long code/Unicode message.

The real worker checks cover restart persistence, overlong queries, missing
bundled assets and cancellation after embedding-batch progress. Failed and
cancelled rebuilds retained the prior generation. Unit tests additionally
exercise 10,000-chunk persistence/ranking, failed atomic publication, malformed
indexes, database isolation and abandoned-generation cleanup.

After integration onto `origin/main` at `2aad8f1`, the final full coverage run
passed 1,665 tests (16 skipped), with all four
non-regression gates intact. Typecheck, unused-code checks, build and scoped
source lint passed. The root `npm run check` stops at an unrelated nested Biome
root in the existing untracked `output/` directory; that directory was preserved.
The preceding concurrent run exposed the metadata snapshot race now covered by
a deterministic serialization test, plus a transient shell-PATH test failure.
Both passed after the fix in the full suite without concurrent container work.
The rebased Linux desktop container test passed with the actual model, including
manual indexing, retrieval, navigation retention, query limits, card spacing and
cancelled/confirmed clear. Its temporary image and container were removed;
BuildKit caches and host test artifacts were retained.
New integration regressions cover archived chats in closed projects, live chats
in another project, exclusion of the database-independent Relay, cancellation
on database replacement/Stop all/shutdown, and stale database epochs after
reopening the same database.

## Asset inventory

- Pinned upstream assets: **164,466,365 bytes**, including **161,895,621 bytes**
  of INT8 weights.
- Model directory including generated provenance: **164,467,340 bytes**.
- Newly introduced installed dependency files on macOS arm64: **125,291,820 bytes**,
  excluding ONNX Web and non-target ONNX binaries.
- Combined logical file inventory: **289,759,160 bytes** (about 290 MB).

The dependency inventory compares the lockfile with the pre-feature baseline
and sums installed regular files, filtered by target OS/architecture. It is not
an installer-size measurement: package exclusions, archive compression, notices
and the small application-code delta change the final installed/download size.
Linux x64 and Windows x64 inventories and actual packaged sizes require their
native release jobs.

## Release checks

CI prepares model assets explicitly and runs offline model fixtures. Packaged
tests load the installed model through the installed application's real sidecar,
not the development asset directory, on macOS arm64, Linux x64 and Windows x64.
Native packaged/installer tests have not been run locally because of disk
pressure. Do not replace them with host Electron tests or a cross-target
inventory estimate.
