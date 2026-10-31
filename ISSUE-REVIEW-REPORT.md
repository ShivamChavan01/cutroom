# Clip attribution fix and issue reviews

2026-10-31. Started from clean `main` at
`31661cb633c5a7b38e39d42c782007496dd4bf5e`.
The user authorized fixing #10, reviewing/closing resolved issues, and committing
and pushing once checks pass. No existing personal project or paid AI provider
was used in verification.

## Issue #10

[Reported problem](https://github.com/ShivamChavan01/cutroom/issues/10): known
clip authors become Unknown after committed checkout, fast-forward and reload.
The commit graph still contains named authors.

The inspector and timeline previously called `authorsByClip` using only the
working operation log. Checkout replaces that history with an empty log over a
snapshot, so attribution disappears. The engine also retained the first touch
instead of the latest active working operation for ordinary clip edits.

The fix derives committed provenance from existing snapshots and parent links:

- If a clip matches a parent, follow that matching parent's attribution.
- If both parents match, prefer the first parent deterministically.
- If no parent matches, credit the commit that introduced or changed that clip.
  A merge that combines parent fields into a new clip credits its merge author.
- Ignore metadata-only and empty commits when clips are unchanged.
- Use detached HEAD when inspecting a historical commit.
- Working differences use the latest active clip operation. Undo/Redo can return
  to committed or history-base provenance without retaining a stale author.
- A deleted and recreated ID receives its new creator. Root/unchanged sample
  clips recover their known Demo/Editor A/Editor B attribution.
- Keep Unknown when neither graph nor history establishes an author. Do not
  default all clips to HEAD's author or the current editor.

This is **clip snapshot provenance**, not Git-compatible per-field blame or
recovery of unavailable historical operation logs. A committed snapshot is
credited according to commit authorship, even if a prior working operation log
contains another author. That distinction is explicit and regression-tested.

The traversal is iterative and tested with 12,000 commits. A WeakMap keyed by
immutable repository objects reuses committed attribution during working edits
without persisting another source of truth. `sameClip` uses the engine's existing
editable-field/default-transform semantics and ignores derived outPoint.

## Files

- `packages/engine/src/diff.ts`: semantic `sameClip` comparison.
- `packages/engine/src/history.ts`: latest active clip-operation authors.
- `apps/web/src/lib/clipAuthors.ts`: committed/working provenance derivation.
- `apps/web/src/components/Inspector.tsx`, `Timeline.tsx`: shared attribution.
- Engine equality/history tests, `lib/clipAuthors.test.ts`, inspector regression.
- `scripts/verify-clip-authorship.mjs`: isolated real-browser verification,
  defaulting to a local production preview; the named hosted origin is also
  explicitly allowed.
- README/context document the final semantics. No timeline or project schema,
  export format, media storage, creative timing or visual design changed.

## Reproduction and checks

Before the fix, two targeted tests failed: latest working operation incorrectly
credited Alice instead of Bob, and the exact main → feature edit → fast-forward
→ restored inspector workflow displayed Unknown instead of Feature editor.
The baseline browser probe also exposed missing attribution for a root sample
clip. No assertion was weakened to preserve incorrect output.

Final local checks:

| Check | Actual outcome |
| --- | --- |
| Engine/web/adversarial/performance-script tests | **2,839 passed / 93 files; 0 failed or skipped** |
| Focused attribution/equality/history/inspector tests | 37 passed |
| Engine/web TypeScript | Passed |
| Production build | Passed; existing mixed static/dynamic demo import warning remains |
| Authorship production-build Chrome journeys | **8 passed; no page exceptions** |
| Existing production-build readiness suite | Four desktop sizes, partial/full merge recovery, verification, isolation, storage/decode failures and AI fixtures passed |
| Script syntax / diff whitespace | Passed |
| Lint | No configured lint command; no new packages installed |

The 15 additional cases cover snapshot equality, latest active working authors,
committed reload/checkout/fast-forward, root/sample authors, metadata/empty
commits, historical inspection, Undo/Redo, two-parent inheritance, new merge
combinations, deterministic first-parent ties, recreation/splits, serialization,
unknown evidence, deep traversal and input immutability.

The eight browser journeys use named synthetic actors in a fresh profile:
initial sample; checkout; fast-forward; reload; detached inspection; working
Undo/Redo; real conflict resolution/two-parent commit; metadata-only commit.
They assert the inspector and timeline dot agree and compare actual stored
parent references and snapshots. No private media or credentials are involved.

Local artifacts, intentionally ignored by Git:

- `.gstack/issue-review/attribution-before.log`
- `.gstack/issue-review/attribution-targeted.log`
- `.gstack/issue-review/full-tests.json`
- `.gstack/issue-review/types.log`, `build.log`
- `.gstack/issue-review/authorship-local/results.json`
- `.gstack/issue-review/authorship-local/committed-authors-restored.png`
- `.gstack/issue-review/readiness-local/results.json`

The first typecheck required explicit variable annotations in iterative traversal
because TypeScript detected self-referential inference. These were typed as the
actual domain types; no assertions, suppression or compiler relaxations were used.

## Reviews and closure

Issues #1–#5 were freshly retested on the hosted editor through the real branch,
tag, invalid-input, dirty-merge, fast-forward and repeat-merge journeys. Issues
#6–#9 were freshly retested there with actual OPFS bytes, decoded playback,
quota controls, blocked native writes, context replacement and delayed native
IDB transactions. Each passed and received an individual resolution review
before being closed.

| Issues | Fix commit | Live review evidence |
| --- | --- | --- |
| #1–#5 | `254fb521c8ff57fda8a1b2da5122e469e63b54d5` | `.gstack/issue-review/versions-live/results.json` |
| #6–#9 | `31661cb633c5a7b38e39d42c782007496dd4bf5e` | `.gstack/issue-review/reliability-live/results.json` |
| #10 | Commit containing this attribution change | Final shipping/live outcome and commit link are recorded in its GitHub resolution review |

The issue comments explain root cause, implementation, exact tested behavior,
regression entrypoints and remaining limits. Closing is not a claim of full Git
compatibility, cloud media backup or power-loss durability. Deployment identity
was not assumed from pushing: production behavior was tested independently in
isolated profiles. No existing project was touched.

## Rerun

```sh
TMPDIR=$PWD/.gstack/tmp ./node_modules/.bin/vitest run packages/engine apps/web qa/adversarial scripts/measure-editor-performance.test.mjs --maxWorkers=3
pnpm typecheck
pnpm --dir apps/web build
# Separate terminal:
pnpm --dir apps/web preview --host 127.0.0.1 --port 5187 --strictPort
export PLAYWRIGHT_MODULE=/absolute/path/to/installed/playwright/index.mjs
node scripts/verify-clip-authorship.mjs
node scripts/verify-readiness.mjs
# Live attribution check, always in a fresh owned browser profile:
EDITOR_URL=https://cutroom-editor.vercel.app/ QA_OUTPUT_DIR=$PWD/.gstack/issue-review/authorship-live node scripts/verify-clip-authorship.mjs
```
