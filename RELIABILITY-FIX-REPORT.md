# Reliability fixes for issues 6–9

2026-10-30. Started on `main` at `254fb521c8ff57fda8a1b2da5122e469e63b54d5`.
Initial tracked tree was clean. `CUTROOM-ADVERSARIAL-QA.md` and `qa/` were already
untracked; they were preserved. No commit, push, deployment, PR, issue closure or
GitHub comment was made in this round. The fixes are local.

## Changes and evidence

| Issue | Original reproduction | Fix | Successful verification |
| --- | --- | --- | --- |
| [#9](https://github.com/ShivamChavan01/cutroom/issues/9) | Hold an older IDB transaction, create a newer commit, release the older write. Saved appeared although reload lost the newer commit. | Save completion compares the captured history, repo and pending references with current state, and checks effect disposal. Stale successes and failures are ignored. Current serialization/write exceptions produce an error. | Seven deterministic autosave tests; production-build Chrome holds a real transaction and verifies that saved and refreshed data contain the second commit. |
| [#6](https://github.com/ShivamChavan01/cutroom/issues/6) | Import without committing, Delete, Undo, commit, refresh: timeline survives but the OPFS file is gone. | Timeline deletion no longer physically evicts media. Current/commit reference counts are documented as usage information, not file-deletion authorization. | Original isolated failing regression now passes; four action tests cover committed/uncommitted clips, split descendants, locked/empty selection and Undo/Redo. Chrome checks exact OPFS byte length before/after deletion and refresh, then decodes and plays the restored source. |
| [#7](https://github.com/ShivamChavan01/cutroom/issues/7) | Inject an OPFS/quota failure. Picker warns; timeline drop silently ignores the report. | Both entrypoints use `importMedia`, which publishes storage failures and skipped files through the existing warning UI. Low-level `uploadFiles` retains its structured report API. | Unit tests cover quota, corrupt/zero-duration, mixed selection and empty input. Chrome verifies picker/drop warnings and temporary playback at 1024px, plus corrupt-drop rejection with exact unchanged project data. |
| [#8](https://github.com/ShivamChavan01/cutroom/issues/8) | Pause native writable creation on main, checkout alternate, resume: the import lands on alternate. | Capture runtime editor session and branch/detached ownership once per batch. Check before probing, after metadata/hash, and after storage. Session replacement invalidates the import, even when branch names and commit IDs return to the original values. Imports also reject active pending merges. | Unit matrix covers checkout, away/back, detached inspection, reset, history restoration, fork, pending merge and fast-forward; native-write delay; ordinary edits/commits; concurrent imports and partial batches. Chrome verifies cancellation messages and exact unchanged destination data across checkout, away/back and reset. |

## Why these policies

Saved remains a statement about a specific completed write. The fix does not
pretend that an older write includes newer changes. A newer scheduled write must
complete before its revision can be shown as saved. Existing native IDB
transactions still store each complete project atomically. The change adds no
second persisted revision model or alternate timeline source of truth.

A clip deletion is an edit, not a request to destroy its source. Undo/Redo and the
media bin retain ownership beyond current/committed clip counts. Deferring source
collection is the smallest safe policy. No garbage collector or cache-clear UI
was added. Retaining unused files can consume quota; browser eviction or manual
storage clearing can still remove them.

The import session counter is transient editor lifecycle state, not timeline
content. It advances on `loadTimeline` and `restoreHistory`. Ordinary edits,
Undo/Redo, registration, commits and concurrent imports do not replace a session.
Branch checks also catch forks that retain the working timeline. The counter is
not serialized; the project stays schema 2 and timeline exports are unchanged.

Cancellation does not redirect an import to another cut, silently commit it, or
mutate the new working timeline. A storage write already underway may finish and
leave an unregistered cached source. Its new session URL is revoked. We do not
delete cached bytes that another saved state may need. The user is told to import
again in the desired version.

## Before/after tests

Recorded under `.gstack/reliability-fixes/`:

- `autosave-before.log`: 5 failures, 2 passes, plus one unhandled rejected write.
  `autosave-after.log`: all 22 targeted autosave/pending/reset cases passed.
- `media-before.log`: 1 failure, 3 passes. `media-after.log`: all 11 action,
  reference-count and original adversarial retention cases passed.
- `import-owner-before.log`: 9 failures, 17 passes. After ownership guards, all
  targeted upload/store/VCS cases passed; two additional batch/pending tests
  also pass in the full run.
- No assertion was weakened to accommodate broken behavior. The historical
  audit report remains a report of `254fb52`, not a claim about this local fix.

## Final checks

| Check | Actual result |
| --- | --- |
| Engine + web + performance-script + adversarial Vitest | **2,824 passed / 91 files; 0 failed, 0 skipped** |
| Engine/web TypeScript | Passed |
| Production build | Passed; existing static/dynamic demo import warning remains |
| `verify-reliability.mjs` on production build | **8 journeys passed**, no page errors |
| Existing `verify-readiness.mjs` on production build | Four desktop sizes and recovery/isolation/failure/AI fixtures passed |
| Existing VCS persistence browser script | Passed real IDB/OPFS/history/branch checks |
| Existing merge-consistency browser script | Passed |
| Existing commit-graph browser script | Passed |
| Script syntax and diff whitespace | Passed |
| Lint | No configured lint command; no new tooling installed |

Of the 2,824 cases, **794 are engine/web/performance-script cases** and **2,030
are the isolated adversarial cases**. The latter include the previously failing
media-retention test, now passing. There are 28 additional application cases
relative to the 766-case baseline: autosave 7, actions 4, upload 17.

The new production-build browser suite runs on `http://127.0.0.1:5187/` with
fresh Chrome profiles. Existing source-inspecting browser scripts used a separate
Vite instance at `http://127.0.0.1:5189/`, avoiding an existing developer session.
The temporary 5189 QA server was stopped after verification. Existing servers
were left available. No production deployment or personal browser project was altered. No paid AI
calls were made; readiness AI states are HTTP fixtures.

Build/browser evidence is local and ignored by Git:

- [Full results](.gstack/reliability-fixes/full-tests.json)
- [New browser results](.gstack/reliability-fixes/browser/results.json)
- [Newest commit after refresh](.gstack/reliability-fixes/browser/latest-save-restored.png)
- [Retained source playback](.gstack/reliability-fixes/browser/retained-source-playback.png)
- [Drop quota warning at 1024px](.gstack/reliability-fixes/browser/quota-drop-1024.png)
- [Canceled import after reset](.gstack/reliability-fixes/browser/import-canceled-reset.png)
- [Readiness results](.gstack/reliability-fixes/readiness/results.json)

## Files

- Autosave: `apps/web/src/lib/persistence/usePersistence.ts:125`, new
  `lib/persistence/autosave.test.ts`.
- Source retention: `apps/web/src/lib/actions.ts:24`, new `lib/actions.test.ts`,
  usage documentation in `lib/media/references.ts`.
- Shared import reporting and ownership: `apps/web/src/lib/upload.ts:105`,
  `lib/upload.test.ts`, `components/UploadButton.tsx`, `components/Timeline.tsx`.
- Runtime session ownership: `apps/web/src/store.ts:27`.
- Browser regression: new `scripts/verify-reliability.mjs`.
- Current behavior/documentation: `README.md`, `CONTEXT.md`, this report.

## Rerun

```sh
TMPDIR=$PWD/.gstack/tmp ./node_modules/.bin/vitest run packages/engine apps/web qa/adversarial scripts/measure-editor-performance.test.mjs --maxWorkers=3
pnpm typecheck
pnpm --dir apps/web build

# Separate terminal: serve the actual production build.
pnpm --dir apps/web preview --host 127.0.0.1 --port 5187 --strictPort

export PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs
node scripts/verify-reliability.mjs
node scripts/verify-readiness.mjs
```

The new browser suite defaults to the existing original CC0 sample file at
`apps/web/public/demo/motion.mp4`. It renames the input to `qa-source.mp4` and
checks actual stored bytes and decoded blob playback. No extra media download or
large new asset is required. Optional `TEST_VIDEO_A`, `EDITOR_URL` and
`QA_OUTPUT_DIR` override fixture, local origin and owned output directory.

Historical standalone `qa/adversarial/*.regression.mjs` scripts default to the
hosted site, which has not been updated by this work. Some diagnostic scripts
also wait for the original bad state before asserting. Use the current
`verify-reliability.mjs` for positive local verification; it preserves the
correct-behavior assertions and adds cancellation/recovery checks. Do not mistake
an unchanged deployed failure for a local fix failing.

## Remaining limitations and shipping

The original audit's broad limits still apply: power-loss/process-kill durability,
other browser engines, same-workspace concurrent tabs, cloud/portable media backup,
large-history UI latency and long-form codec performance remain unproven or
unsupported. Automatic source reclamation is deliberately deferred. A commit made
before the 700ms save completes remains unsaved until its own write is acknowledged.

No schema migration, provider configuration, merge algorithm, export format,
editor visual design or unrelated feature changed. The local fixes are verified;
GitHub issues #6–#9 remain open until a shipped version is checked. Production
must not be described as fixed before an authorized push/deployment and live QA.
