# Cutroom test results

Review date: 2026-10-30. Repository starts clean on `main`, HEAD `2481442`.
HEAD is unchanged. Results describe the local working revision, not a deployment.
Existing pnpm, Vitest and Playwright/Chrome installations were reused.

## Baseline before implementation

| Command | Outcome | Evidence |
| --- | --- | --- |
| `git status --short`, branch and log inspection | Clean main, `2481442` | Recorded in `.gstack/readiness/BASELINE.md` |
| Full engine/web/harness Vitest command below | 718 tests / 77 files passed | `baseline-tests.log` |
| `pnpm typecheck` | Both workspaces passed | `baseline-types.log` |
| `pnpm --dir apps/web run build` | Passed | `baseline-build.log` |
| Existing `scripts/measure-demo.mjs` against baseline production preview | Actual playback/merge/refresh smoke and three local observations passed | `baseline-browser.log`, `baseline-browser/` |

No pre-existing unit, TypeScript or build failure was found. The serializer's
omission of pending merges was documented behavior, reproduced by a new failing
test. Failure injection also reproduced the pre-existing decode-warning bug.

## Final commands and actual outcomes

Run from the repository root unless noted.

```sh
TMPDIR=$PWD/.gstack/tmp ./node_modules/.bin/vitest run packages/engine apps/web \
  scripts/measure-editor-performance.test.mjs --maxWorkers=4
pnpm typecheck
pnpm --dir apps/web run build
git diff --check
node --check scripts/verify-readiness.mjs
node --check scripts/verify-demo.mjs
node --check scripts/measure-demo.mjs
```

| Check | Actual result |
| --- | --- |
| Full Vitest command | **744 passed / 82 files**, none failed or skipped |
| Engine tests | 181 passed, engine source unchanged |
| Web/server tests | 547 passed |
| Existing measurement harness | 16 passed; this is harness correctness, not proof of new playback performance |
| Workspace TypeScript | Engine and web passed |
| Production build | TypeScript + Vite passed |
| Diff whitespace check | Passed |
| Changed script syntax checks | Passed |
| Lint | Not run: no lint script/configuration in root, engine or web |
| Lizard | Unavailable on this machine; not installed for this task |

Evidence: `.gstack/readiness/final-tests.log`, `final-types.log`, `final-build.log`.
The final client entry is 189.02 KB, 59.55 KB gzip as reported by Vite. Original
media files remain unchanged at 365,760 bytes combined. No comparative speedup
or frame-accuracy claim follows from these sizes.

## Focused regression coverage

The suite adds 26 tests across five new test files and one existing presentation
file. Existing tests are retained and updated where the required UI/API changed.

- `lib/persistence/pendingMerge.test.ts`: real pending serialization, reconstructed
  unresolved conflicts, partial and complete resolution, two-parent commit,
  legacy saves, cancellation, stale working state, invalid refs/choices/keys,
  repeated decisions and recovery without discarded history.
- `lib/demo/guide.test.ts`: actual UI/diff state, manual branch/detached views,
  edits/cancel/reset, missing sample branch, metadata changes, non-overlap conflict
  wording, completed merge plus later commits, and additional commits on both
  branches before the merge.
- `lib/mergeSession.test.ts`: real field, delete/modify, project, asset and track
  resolution paths; invalid decision shapes/keys and inappropriate choices.
- `lib/diagnosticExplanation.test.ts`: exact gap bounds/duration/track from actual
  rules, changed clip timing, missing references and honest fallback wording.
- `lib/playbackErrors.test.ts`: independent source failures and selective clearing.
- Existing presentation test adds bounded structural-error wording. Guide, merge,
  timeline and VCS tests use the real engine and current store APIs.

The original pending test fails before its fix in `pending-before.log`. The
additional-branch-commits guide regression fails before its fix in
`guide-descendants-before.log`. The decode bug is recorded as actual failed
video with no alert in `decode-before.json` and `decode-before.png`.

## Real Chrome browser checks

The new `verify-readiness.mjs` uses the **production build via Vite preview**,
not dev source imports or a fake editor state. It reads actual IndexedDB data
for assertions. Normal actions, conflicts, decisions and commits go through UI
controls and the actual engine. Isolated contexts protect personal browser data.

```sh
# In apps/web, after building:
./node_modules/.bin/vite preview --host 127.0.0.1 --port 5187 --strictPort
# From repository root, using this machine's existing Playwright:
PLAYWRIGHT_MODULE=/home/shivam/.gstack/repos/gstack/node_modules/playwright/index.mjs \
  node scripts/verify-readiness.mjs
```

All of these passed at **1440×900, 1366×768, 1280×800 and 1024×768**:

1. Fresh sample workspace, real decoded frames and advancing timecode.
2. Main/alternate switching, actual comparison and graph.
3. Real overlap at 4.00–5.00 seconds and disabled unresolved merge commit.
4. Refresh before resolution, then resolve, save and refresh again.
5. Commit with parents `c2`, `c3`, refresh and restore media/graph.
6. Actual 1200ms gap at 1.80–3.00 seconds on V1; click seeks to frame 01:24 at 30fps.
7. Skip/reopen/reset guide, keyboard activation, explicit cancellation and no
   desktop horizontal overflow.

Additional passed journeys:

- Project-title conflict plus timing overlap, with a partially resolved save and
  refresh, another resolution and refresh, then parents `c4`, `c5`. The guide
  recognizes this joined history after extra commits.
- Personal upload/name saved byte-for-byte, then demo merge/reset, personal
  refresh and decoded media with no changed personal project data.
- Invalid pending reference recovers the valid project with a notice.
- Corrupt JSON remains unchanged until explicit rescue/reset.
- Denied IndexedDB shows memory-only status; bundled sample still decodes.
- Missing source and invalid MP4 bytes stay visible after delayed valid audio loads.
- AI access-required, unauthorized, rate-error and unavailable states. HTTP
  responses are fixtures; no private key or paid provider call is involved.

Evidence: `final-browser.log`, `browser/results.json`, and screenshots in
`.gstack/readiness/browser/`. There are **no uncaught JavaScript errors**.
Recorded HTTP/console errors are the intentionally injected missing-media 404s
and AI 401/429 responses. The incidental favicon 404 was fixed.

Existing browser commands also passed:

| Script | Evidence under `.gstack/readiness/` |
| --- | --- |
| `verify-vcs-persistence.mjs` | `final-vcs-persistence.log`, `final-vcs-persistence/` |
| `verify-merge-consistency.mjs` | `final-merge-consistency.log`, corresponding folder |
| `verify-commit-graph.mjs` | `final-commit-graph.log`, corresponding folder |
| `verify-editorial.mjs` | `final-editorial.log`, corresponding folder |
| `verify-detach-audio.mjs` | `final-detach-audio.log`, corresponding folder |
| `verify-waveforms.mjs` | `final-waveforms.log`, corresponding folder |
| `verify-assistant.mjs` | `final-assistant.log`; eight deterministic checkpoints |
| `verify-demo.mjs` | `final-demo.log`; desktop flows, AI fixtures and narrow mobile notice |
| `measure-demo.mjs` against built preview | `production-smoke.log`, `production-smoke/`; three playback/merge/refresh runs |

Source-import scripts use a fresh Vite dev server on 5186. They receive their
required TEST_VIDEO_A/B, TEST_AUDIO, TEST_GRAPHIC and QA_OUTPUT_DIR variables.
Fixtures are the unchanged sample, a local 20s loop, a generated PNG and a 2s
silence/tone WAV under ignored `.gstack/`. No personal footage was distributed.
The older general `verify-editor.mjs` remains unrun because it requires its own
legacy `public/test-a.mp4`/clip-hash setup. Current focused suites above are run.

Useful screenshots:

- `browser/intro-1024.png`: first-use explanation and actual timeline.
- `browser/conflict-1024.png`: editorial consequence and precise overlap.
- `browser/verification-1440.png`: exact finding and uncertainty.
- `browser/partial-merge-restored.png`: merge after separate saved decisions.
- `browser/invalid-merge-recovery.png`, `corrupt-project-rescue.png`.
- `browser/failure-decode.png`, `failure-missing.png`, `failure-storage.png`.
- `browser/personal-preserved.png`, `assistant-unavailable.png`.

## Failed commands and how they were handled

| Command/scenario | Failure and root cause | Baseline or introduced? | Resolution |
| --- | --- | --- | --- |
| First baseline type/build redirection | Output folder had not yet been created by the parallel baseline job | Invocation issue | Created folder and reran before source edits |
| First baseline browser invocation | Preview port was not listening | Environment setup | Started preview, reran successfully |
| Pending regression before fix | Serialized project had no pending state | Confirmed original behavior | Added input/choice persistence with validated replay |
| Initial new guide SSR checks | Only VCS selector used live restored state; editor selector read server initial state | Test harness mismatch | Select actual store state consistently; engine remains real |
| First production readiness run | `header` matched three unrelated elements | Test locator ambiguity | Scoped personal project assertion to `.studio-topbar` |
| Final cleanup test/type/build run | Used `head` import was mistakenly removed; four tests and compilation failed | Introduced cleanup error | Restored import; final 744 tests, types and build pass |
| Additional-branch guide regression | A valid joined history was classified as a custom edit | Reproduced during review | Detect both original lineages in current ancestry, not only direct parent IDs |
| Invalid video plus delayed audio | Video warning disappeared after healthy audio readiness | Pre-existing runtime issue | Track/source error handling plus actual browser regression |

No failed assertion was weakened to accept incorrect engine behavior. No test was
removed or skipped to turn the suite green. Remaining coverage limits are explicit
in DEMO-LIMITATIONS; unit tests are not presented as proof of browser durability,
audible sync or human comprehension.
