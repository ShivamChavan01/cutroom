# Agent-reported issues: local fixes

2026-10-30. Starting checkout: clean `main` at
`9d27bade34e39f1cfc430e82c2f780d82816b80d`. No commits, pushes, deployments,
issue comments, issue closures or PRs are part of this work.

## Reproductions and changes

| Issue | Established starting behavior | Local change and proof |
| --- | --- | --- |
| [#5](https://github.com/ShivamChavan01/cutroom/issues/5), P1 | Chrome: add a tag, Undo; tag remains while the opening clip's in-point changes from 0.1 to 0. The metadata update had modified history's base directly. | `setAssetTags` is a validated operation, replayed through the existing reducer/history. Undo/Redo, commit, refresh and branch snapshots preserve the intended edits. Duplicate imports retain existing metadata. |
| [#3](https://github.com/ShivamChavan01/cutroom/issues/3), P1 | Merge accepts uncommitted clip, audio and project-name changes. This was the previous policy, rather than accidental data corruption. | User-approved policy change: require the working timeline to equal its committed head before any merge, including fast-forward and no-op requests. Rejections leave both stores untouched and explain how to proceed. |
| [#4](https://github.com/ShivamChavan01/cutroom/issues/4), P2 | Merging an already integrated source creates another pending session. | Use commit ancestry to return an up-to-date result without modifying history, working state or pending state. UI reports the outcome. Repeated requests after reload are idempotent. |
| [#1](https://github.com/ShivamChavan01/cutroom/issues/1), P2 | Merging a descendant source creates a pending merge instead of advancing the branch. | Advance the current branch to the existing source commit; load its snapshot and restore its media. No synthetic commit. Chrome checks a newly introduced, branch-only source after reload, decoded playback, unchanged commit count and a second reload. |
| [#2](https://github.com/ShivamChavan01/cutroom/issues/2), P2 | Negative start is rejected by the engine, but the input keeps showing `-5`. The error appears away from the field. | Reset rejected drafts to the authoritative value; display a field-local alert linked by `aria-describedby` and `aria-invalid`. Enter and blur commit, Escape reverts. Reject time conversion outside safe integer milliseconds. Negative transform positions remain valid. |

The first six merge regression cases failed against the original implementation.
The original Chrome observations are saved under `.gstack/issues-fix/ui-before.*`;
the failing merge run is `.gstack/issues-fix/merge-before.log`.

## Design decisions

`prepareMerge` is the shared entry classification. It protects the working tree,
uses the existing best-common-ancestor implementation, and returns a discriminated
union: up to date, fast-forward, or genuine divergent merge. IDs and timestamps
do not establish ancestry. Multiple best merge bases retain the existing explicit
unsupported-history error. Divergent merges keep their existing geometric and
metadata conflict handling; clips are never automatically shifted.

Restoration invokes the same entry policy. An older saved session containing
dirty inputs or a redundant/fast-forward merge is canceled with a recovery
notice. Its committed graph and working history are retained. Reload never
silently advances a branch or commits a merge. Valid divergent resolution
journals still replay and survive refresh.

Tags now enter the same deterministic operation log as clip edits. Unknown
assets, duplicate tags, empty tags, whitespace, excessive lengths and excessive
counts are rejected. Source registration is intentionally separate: undoing an
imported clip leaves its media available in the bin. Registration cannot replace
an existing asset; importing identical content again adds a clip without
silently overwriting the source's name or tags.

The internal project schema is now **2**, because older builds cannot replay the
new tag operation. This build reads schemas 1 and 2 and writes 2. The IndexedDB
database version and timeline interchange formats are unchanged. Old builds
reject schema 2 rather than silently dropping new edits. Existing raw-data
recovery remains available. Tags saved before this fix cannot acquire a prior
undo value retroactively.

Version checkout, detached inspection, fast-forward and merge commit use the
existing media restoration function. Known URLs are reused; missing URLs are
loaded from the active workspace's OPFS namespace. Restoration errors are shown
only if that snapshot is still active. Missing or evicted files still require
reimporting. This does not establish universal decoder or browser support.

## Files and regression coverage

- Engine: `packages/engine/src/ops.ts`, `history.ts`, new `assetTags.test.ts`.
- Merge entry and media loading: `apps/web/src/lib/mergeSession.ts`,
  `apps/web/src/vcsStore.ts`, new `lib/agentMergeIssues.test.ts`.
- Tag dispatch and import: `apps/web/src/store.ts`, `components/SidePanel.tsx`,
  `lib/describeOp.ts`, `lib/describeOp.test.ts`, `lib/upload.ts`, `lib/upload.test.ts`, new
  `lib/agentTagsIssue.test.ts`.
- Persistence compatibility: `apps/web/src/lib/persistence/project.ts`.
- Numeric input: `apps/web/src/components/Inspector.tsx`, `index.css`,
  `lib/clipProperties.ts`, `lib/clipProperties.test.ts`.
- Outcome feedback: `components/VersionControl.tsx`, `components/DemoGuide.tsx`.
- Existing workflow fixtures: `vcsStore.test.ts`, `lib/vcsMergeBase.test.ts`,
  `lib/demo/project.test.ts`, `lib/persistence/demoReset.test.ts`. Fixtures now
  commit before merging or construct genuinely divergent versions. Existing
  safety assertions remain, including ambiguous-base rejection on a clean tree.
- Browser regression: `scripts/verify-agent-issues.mjs`; corrected cursor-aware
  persistence assertions in `scripts/verify-detach-audio.mjs`.
- Documentation: this report, `README.md`, `CONTEXT.md`.

New test cases cover tag validation/replay/immutability, Undo/Redo, migration and
invalid stored operations, duplicate imports, dirty merge rejection, ancestry
classification, nonsequential IDs/older timestamps, repeat merges, restoration
and obsolete-session recovery, and time conversion boundaries. Real-browser
checks cover interactive validation and saved data rather than static text alone.

## Verification

Baseline: **744 tests / 82 files passed**. No baseline test failures.
Typecheck/build results below are final-revision checks, not pre-edit baselines.

| Check | Actual result |
| --- | --- |
| Full engine/web/performance-script tests | 766 passed / 85 files; 22 added cases, no skipped tests |
| Engine and web TypeScript | Passed |
| Production build | Passed; existing mixed static/dynamic demo-module import warning remains |
| New issue Chrome journey | All five issue scenarios passed; no page errors |
| Production-build readiness script | Passed all four desktop sizes, recovery, failures and isolation |
| Existing Chrome scripts | `verify-vcs-persistence`, `verify-merge-consistency`, `verify-editorial`, `verify-commit-graph`, `verify-assistant`, `verify-waveforms`, `verify-detach-audio`, `verify-demo` passed |
| Script syntax and diff whitespace checks | Passed |
| Lint and complexity tooling | No configured lint command; Lizard unavailable |

Commands:

```sh
TMPDIR=$PWD/.gstack/tmp ./node_modules/.bin/vitest run packages/engine apps/web scripts/measure-editor-performance.test.mjs --maxWorkers=4
pnpm typecheck
pnpm --dir apps/web run build
node --check scripts/verify-agent-issues.mjs
git diff --check
```

Browser checks use installed Playwright with Chrome, isolated local contexts,
Vite on port 5186 and the production build preview on port 5187. The new issue
journey and `verify-readiness.mjs` run against the actual production build.
The latter checks 1440×900, 1366×768, 1280×800 and 1024×768, pending/resolved
merge reloads, cancellation, committed history, verification timing, storage
isolation, corruption/decode/storage failures and simulated AI error states.
Expected injected 404/401/429 responses are recorded in its report; they are not
unexpected production failures. No paid AI requests were made.

The new issue journey can be repeated with:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
QA_VIDEO=/absolute/path/to/long.mp4 \
node scripts/verify-agent-issues.mjs
```

`QA_VIDEO` must be a distinct, browser-compatible video named `long.mp4`, at
least 20 seconds long and 960 pixels wide. The local fixture was made by looping
the repository's original CC0 motion study, without downloading third-party
footage. Example regeneration:

```sh
ffmpeg -stream_loop -1 -i apps/web/public/demo/motion.mp4 -t 20 -c copy /tmp/long.mp4
```

Evidence lives in ignored `.gstack/issues-fix/`: test/build logs,
`browser/results.json`, `browser/numeric-validation-1024.png`,
`browser/fast-forward-restored-media.png`, and per-suite browser directories.
No credentials are included. These local artifacts are not part of a push.

The first new-browser attempts assumed video would decode at a new empty gap,
then assumed clip selection persisted across reload. The test now explicitly
reselects the clip and seeks into it; application behavior was not changed to
satisfy these assumptions. One existing detach-audio run was interrupted by a
navigation while source/test files were changing; its rerun is recorded below.
An initial merge-browser invocation omitted its required `TEST_VIDEO_A` variable;
the configured invocation passed. Intermediate unit failures used the previous
dirty-merge policy; their scenarios now explicitly commit before merging.
The new duplicate-import test initially sat outside its fixture's `describe`
scope; moving it under the existing setup resolved that harness failure.

The subsequent detach-audio rerun exposed an incorrect old assertion: it
required the saved cursor to equal the entire log length after restoring the
detach but leaving a later trim undone. Existing `history.test.ts` explicitly
establishes that Undo moves the cursor and preserves the redo tail. The browser
test now asserts the applied detach, retained redo trim, saved/live history
equality and exact post-reload history. That corrected run passed, including
audio/video playback. Application history semantics were not changed.

## Remaining limits and shipping

- No configured lint command; Lizard is unavailable.
- Same-workspace concurrent tabs still have no write coordination.
- Browser media eviction, unsupported codecs and other browser engines remain
  outside the guarantees of this Chrome regression run.
- These changes are local. Review and authorize shipping before production QA;
  GitHub issues remain open until the shipped behavior is verified.
