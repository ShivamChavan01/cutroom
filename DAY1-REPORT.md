# Cutroom Day 1: version-control correctness

This audit strengthens the existing snapshot-and-operation architecture. It does
not add editor features. The original review described an older implementation;
several proposed fixes were already present in the starting dirty checkout.
The findings below distinguish those verified behaviors from newly reproduced bugs.

Final verification: **633 engine/web tests** plus **16 measurement-harness tests**
pass (**649 total, 70 files**), both TypeScript checks and the production build
pass, and three real Chrome regression scripts pass. There are 58 more engine/web
tests than the valid starting baseline. Browser limits remain explicit below.

## Starting state and baseline

- Starting and final HEAD: `c2209dfcf7f7a83dbdce9d4785ffd7040ad70c99`.
- No commits, PRs, dependency changes or pushes made during this audit.
- The checkout started with 84 porcelain status entries, including tracked and
  untracked merge, history, UI, playback, assistant, waveform and performance work.
  Exact list: `.gstack/day1-20261029/starting-status.txt`. Original tracked patch:
  `starting-tracked.patch` in the same directory. All starting files were copied
  to `start/<path>.snapshot` there before edits. Those artifacts are local and
  gitignored; keep them when comparing this audit with existing user work.
- Existing issue worktrees and their earlier commits were inspected, not edited.
  Further implementation happened in this checkout with disjoint file ownership
  across parallel workers. No new worktree snapshot commit was created.
- Read repository README, CONTEXT, PERF, package scripts, engine model/reducer/
  history/diff/merge/lint, VCS stores and persistence. No local `AGENTS.md` was
  found; the user-supplied instructions were followed.
- Environment: Node `v24.17.0`, existing pnpm lockfile/dependencies, Vitest `3.2.7`,
  app-local Vite `6.4.3`, installed Google Chrome through existing Playwright.
- Valid baseline: **167 engine tests / 13 files**, **408 web/server tests / 54
  files**, both TypeScript checks passed. No existing test or type failures were
  observed in those runs. Logs: `baseline-engine.log`, `baseline-web.log`,
  `baseline-engine-tsc-attempt1.log`, `baseline-web-tsc-attempt1.log`.

The initial baseline attempt accidentally discovered backup copies as tests.
Renaming backup files to `.snapshot` fixed that setup mistake; the valid baseline
above was rerun before implementation. These discovery failures were not product
defects. The root Vite shim points to an absent version; app-local Vite works, so
no packages were upgraded.

## Current representation and merge behavior

`Timeline` stores clips and assets by stable ID and tracks in layer order
(`packages/engine/src/model.ts`). `applyOp` produces a new timeline; `History`
stores a base snapshot, ordered operation envelopes and an undo cursor.
Undo/redo changes the applied prefix. A new edit after undo abandons the redo tail.

`Repo` stores immutable commit snapshots, parent IDs, named branch heads and an
optional detached commit (`apps/web/src/lib/vcs.ts:17`). Working edits remain in
the editor's operation history until committed. A commit snapshots the complete
working timeline; there is no staging area.

Merge first compares each clip field against the common base, preserving
one-sided and identical changes and surfacing divergent changes. Deletion against
modification is explicit. Metadata uses corresponding three-way rules. A separate
pass checks resulting clip geometry on each track. Project ID/frame-rate conflicts
also require explicit resolution (`packages/engine/src/merge.ts:323`).

IndexedDB stores the history and commit graph as one project document. OPFS stores
media bytes by asset ID. Restoration validates the document and replay, restores
the stores, then reloads media URLs. Transient merge-resolution state is not saved.

## Reproduced bugs and regression evidence

Evidence paths below are relative to `.gstack/day1-20261029/`.

| Confirmed scenario | Root cause and fix | Regression / original failing log |
| --- | --- | --- |
| A stale listed overlap pair could delete the surviving clip when its keeper was absent, moved away, or moved to another track. | `resolveOverlap` trusted the conflict entry. It now checks current existence, track and geometry before deleting, otherwise refreshing conflicts without changing clips. | `apps/web/src/lib/conflictCleanup.test.ts:67`; three failures in `stale-pair-before.log`, passing in `vcs-after.log`. |
| Restoring `{c0,c2}` then committing overwrote `c2`, leaving a self-parent cycle. | Commit ID allocation used the number of commits. It now searches for an unused `cN`, preserving existing snapshots and parent links. | `apps/web/src/lib/day1History.test.ts:58`; one failure in `history-regression-before.log`, passing in `history-final.log`. |
| A pending `assetId` or `trackId` choice could lose metadata required by its other candidate and later resolve to a dangling reference. | Metadata retention considered only the provisional clip. It now includes both unresolved reference alternatives and blocks deleting required candidate metadata. | `packages/engine/src/metadataReferences.test.ts:12`; two failures in `engine-reference-before.log`, subsequent engine suite passes. |
| Deleting a disputed track left a phantom order conflict although both surviving order choices had converged. | Refresh preserved all order conflicts blindly. It now removes only choices whose orders become identical after filtering deleted tracks; genuine remaining disagreements retain their identity. | `packages/engine/src/metadataResolution.test.ts:89`; one failure in `engine-order-before.log`; three new tests pass, including preserved disagreements and independent appended tracks. |
| Malformed snapshots, clip timing/IDs, track/asset metadata, commit metadata, branch references, unknown operations and malformed envelopes were accepted. | Persistence trusted object shapes and casts. Explicit boundary guards now validate snapshots, envelopes, every known operation variant, references in the commit graph, and engine replay including the redo tail. Raw rejected data remains recoverable. | `apps/web/src/lib/persistence/project.test.ts:261`; ten failures in `safety-before.log`, persistence suite passes after the fix. |
| A new strict snapshot validator rejected valid fractional frame rates from the existing OTIO adapter. | Snapshot validation incorrectly required integer FPS. It now accepts finite supported fractional snapshot FPS; the existing `setFrameRate` operation policy stays unchanged. | `apps/web/src/lib/persistence/project.test.ts:323`; one failure in `safety-fractional-before.log`, passing in `safety-fractional-after.log`. |

All production fixes were preceded by a failing regression. The fractional-FPS
case was caught during final review of this audit's own change, not attributed to
the starting checkout.

## Suspicions already addressed or not reproduced

- The original three-clip stale-conflict bug was already addressed by
  `refreshMergeConflicts` at the start. Existing and new checks confirm deleted
  clips leave no clip-field/delete-modify/overlap references, unrelated choices
  remain, and sequential overlap resolutions preserve timing. The newly found
  stale-action bug above was a separate remaining issue.
- Asset and track scalar disagreements already had explicit conflict variants
  and working UI controls in the starting checkout. No silent scalar loss was
  reproduced. Added cases verify identical edits, independent fields, tags,
  concurrent same-ID additions, referenced deletions and track ordering.
- The current best-common-ancestor implementation was already stronger than the
  old first-shared-ancestor algorithm. An independent reachability oracle checked
  all 1,024 five-node DAGs in a fixed topological order and all 25 head pairs
  (**25,600 comparisons**). Existing tests also cover merges, identical heads,
  unrelated histories, cycles and ambiguous bases.
- Existing dirty-checkout guards, detached commit errors, merge cancellation,
  changed-working-state rejection and two-parent commits passed. No further
  working-tree or undo/redo defect was established.
- `outPoint` is derived from `inPoint + duration`; excluding it as an independent
  diff field is intentional. Tests check replay, immutability, deterministic split
  IDs and abandoned redo paths, including the existing seeded stream (`73129`).

## Explicit policies and interview explanations

**Why geometry needs its own pass.** Two editors can change different clips, so
per-field merge succeeds, while the combined clips occupy the same interval on
one track. The geometric pass detects this interaction after assembling the
timeline. Adjacent boundaries do not overlap. Reporting is capped at 200 pairs by
default, but a positive cap retains a blocking conflict and refresh discovers
remaining overlaps as earlier ones are removed.

**Why clips are never shifted automatically.** Moving a clip changes creative
timing, synchronization and intent. This implementation asks for an explicit
choice or clip removal and keeps surviving clip timing. Verification reports
structural problems; it does not rewrite the edit to make checks green.

**Conflict identity and resolution.** `conflictKey` uses semantic identity:
clip ID plus field, metadata ID plus field, or track ID plus unordered overlap
pair (`packages/engine/src/merge.ts:422`). Timing and list position are not keys.
After a resolution, geometric conflicts are derived again from current clips.
Meaningful field/project/metadata choices remain; clip-specific conflicts for
deleted clips are pruned. Order conflicts are dropped only when their surviving
candidate orders converge. Repeating an already completed valid-target resolution
is a no-op. A field resolution for an absent target still raises an explicit error.
The store recomputes conflicts before allowing a merge commit, rather than
trusting a caller-supplied `clean` flag.

**Metadata.** Asset fields and track kind/name/muted use explicit three-way field
conflicts. Identical and one-sided changes merge; unrelated fields combine. Tags
merge as base-aware set membership, so additions/removals combine without treating
tag order as creative state. Delete-versus-modify or referenced deletion yields a
presence conflict. Metadata required by a surviving clip or unresolved reference
choice cannot be removed. Track order is creative state: incompatible shared
orders require a choice; independent additions are retained. UI handles asset/
track fields, presence and track-order variants (`MergePanel.tsx:25`). There are
no replacement tracks or implicit retiming.

**Working-tree safety.** Checkout of another branch or an old commit is blocked
while dirty. Forking preserves current working edits. Detached snapshots can be
viewed but cannot be committed until a branch is selected. Merge may include
working edits; it captures both heads and the working snapshot, and refuses to
commit if these change during resolution. Cancel changes only pending merge
state. A successful merge snapshots the chosen result and both parent IDs.
Commit failures propagate to the UI instead of silently appearing successful.

**Replay guarantees.** Given the same valid base and ordered operations, replay
produces the same timeline and deterministic split identities without mutating
the input. Undo/redo selects a reproducible prefix. This is not proof of arbitrary
operation commutativity, distributed convergence, decoding, frame accuracy or
storage durability.

**Multiple merge bases.** `findMergeBases` prunes common ancestors dominated by
newer common ancestors and follows every merge parent. A single best base is used;
unrelated histories are rejected. Multiple best bases produce an explicit
unsupported criss-cross error before publishing pending merge state. There is no
arbitrary base choice and no claim of Git's recursive virtual-base behavior.

## Browser verification

Google Chrome ran in fresh isolated contexts against local Vite on port 5186.
Uploaded actual MP4 media; two short fixtures were copied from existing local
videos using FFmpeg stream copy. The user's browser data was not touched.

- Existing `scripts/verify-editor.mjs`: upload, decoded playback, reload without
  interaction, playback after reload, two-clip playback across a boundary,
  split/undo/redo, branch edits, conflict resolution, committed merge, refreshed
  merge and restored media. Ten checkpoints passed. Evidence:
  `.gstack/day1-20261029/browser-editor/observations.json` and screenshots.
- Existing `scripts/verify-merge-consistency.mjs`: three overlap pairs, deleting
  one clip leaves the correct remaining pair, explicit asset/track field choices,
  successful merge commit, ambiguous-base rejection without state mutation and
  no uncaught page errors. Evidence: `.gstack/merge-consistency-qa/results.json`.
- New `scripts/verify-vcs-persistence.mjs`: dirty checkout refusal without losing
  edits, branch restoration, split/undo/redo, merge cancel preserving history,
  actual IndexedDB save awaited before refresh, exact history/timeline/repo
  restoration, redo after refresh, decoded media from OPFS, deliberate OPFS file
  removal followed by a visible missing-media warning, no uncaught page errors.
  Evidence: `.gstack/day1-20261029/browser-persistence/results.json` and screenshots.

Example reproduction with the server already running:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
TEST_VIDEO_A=/absolute/path/to/demo-a.mp4 \
TEST_VIDEO_B=/absolute/path/to/demo-b.mp4 \
node scripts/verify-editor.mjs

PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
TEST_VIDEO_A=/absolute/path/to/demo-a.mp4 \
node scripts/verify-merge-consistency.mjs

PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
TEST_VIDEO_A=/absolute/path/to/demo-a.mp4 \
node scripts/verify-vcs-persistence.mjs
```

## Files changed during this audit

These are changes relative to the saved starting files, not every change against
HEAD. Existing user modifications in other files remain untouched.

- `apps/web/src/lib/vcs.ts:91`: unused commit IDs; `:246`: stale overlap guard.
- `apps/web/src/lib/conflictCleanup.test.ts:67`: three stale-pair regressions.
- `apps/web/src/lib/day1History.test.ts:17`: independent DAG oracle, first-parent
  history, sparse restored IDs. The exhaustive oracle has a 30-second budget so
  concurrent builds do not turn CPU contention into a correctness failure.
- `packages/engine/src/merge.ts:300`: converged order-conflict cleanup; metadata
  merge receives pending clip reference choices.
- `packages/engine/src/metadataMerge.ts:43`: unresolved-reference retention and
  reference-safe presence choices.
- `packages/engine/src/metadataReferences.test.ts:12`: four reference-choice tests.
- `packages/engine/src/metadataMerge.test.ts:75`: six metadata/tag/deletion cases.
- `packages/engine/src/metadataResolution.test.ts:72`: track additions/order and
  post-deletion conflict invariants.
- `apps/web/src/lib/persistence/project.ts:87`: typed boundary validation and
  checked restoration. `project.test.ts:255`: corruption, operation shapes,
  redo-tail validation, missing media and fractional-FPS tests.
- `scripts/verify-vcs-persistence.mjs:1`: real-browser safety/restoration checks.
- `README.md`, `CONTEXT.md`, this report: current evidence and limitations.

The final diff was reviewed against saved starting files for scope, dropped
conflicts, silent catches, unsafe assertions, dead code and missing UI handling.
The final implementation changes add no unsafe casts or dependencies. No styling,
playback or export implementation was changed in this audit.

## Commands and final results

Run from repository root unless noted. Logs are in `.gstack/day1-20261029/`.

| Command | Actual result |
| --- | --- |
| `./node_modules/.bin/vitest run packages/engine` | 181 passed / 14 files; `final-engine.log`. |
| `./node_modules/.bin/vitest run apps/web` | 452 passed / 55 files; `final-web.log`. |
| `./node_modules/.bin/vitest run scripts/measure-editor-performance.test.mjs` | 16 passed / 1 file; `final-harness.log`. This checks the existing harness, not new playback performance measurements. |
| `./node_modules/.bin/tsc --noEmit -p packages/engine/tsconfig.json` | Exit 0, no errors; `final-engine-tsc.log`. |
| `./node_modules/.bin/tsc --noEmit -p apps/web/tsconfig.json` | Exit 0, no errors; `final-web-tsc.log`. |
| `./node_modules/.bin/vite build` from `apps/web` | Exit 0, built in 29 seconds; `final-build.log`. Together with web TypeScript this matches its build script. |
| Three browser scripts above | Passed; JSON and screenshots described above. |
| `git diff --check` | Passed. |
| Lint | No lint command configured in the root/engine/web packages. |

One interim web run timed out the exhaustive oracle under parallel build load;
its assertions stayed intact and the explicit time budget was increased before
the full rerun. Invoking the existing measurement test with Node's test runner
failed because it imports Vitest; rerunning with its proper Vitest runner passed.
The first version of the new browser test expected different missing-media
wording; it was corrected to assert the application's actual warning exactly.
These were test-invocation/assertion issues, not suppressed product failures.

## Remaining limits and Day 2 priorities

- Media restoration currently loads the active history base's assets. Media found
  only on another branch or older commit may need restoration after checkout.
  The browser tests prove active-project refresh; they do not prove every
  branch-exclusive-media workflow. Add that focused browser reproduction next.
- Independently merged `inPoint` and `duration` can exceed source duration even
  when each branch was individually valid. `trimPastEnd` verification is still
  required. A conflict-free merge means no unresolved merge choices, not a
  universally healthy timeline.
- Missing asset metadata remains loadable and lintable. The low-level engine can
  represent missing track references too, and currently has no built-in lint rule
  for that case. The metadata merge tests protect valid-input merge references;
  they are not a universal repair mechanism for pre-corrupted timelines.
- Pending conflict resolutions do not survive refresh. The saved working history
  and commits survive; restart the merge after reload.
- Browser coverage is headless local Chrome. No measured frame-accuracy, seeking
  latency, dropped frames, long-session memory, cross-browser/private-mode,
  physical-disk crash recovery, multi-tab races or quota exhaustion claim is made.
  Mocked storage failure tests prove error reporting paths, not every real browser
  storage failure. No collaboration, video renderer or MP4 export was added.
- Day 2: close branch-exclusive-media restoration coverage, record a short real
  branch/conflict/verification demo, and make the README lead with that proof.
  Keep broader editor features out of the interview-readiness scope.
