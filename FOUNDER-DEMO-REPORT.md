# Cutroom founder demo implementation and QA

Historical implementation record for the first demo, later shipped as `2481442`.
Its unshipped status and pending-merge limits below describe that earlier audit.
For the current local review, see [FOUNDER-READINESS-REPORT.md](FOUNDER-READINESS-REPORT.md).

Implemented locally on 2026-10-30. Starting and final HEAD remains
`7519d389e2affb5464fc06f42fad2bfef852d1b8`. The starting checkout was clean.
No commits, pushes, PRs, deployments, dependency installs, or provider-setting
changes were made. The new experience is **not on production yet**.

The local production bundle is ready for a controlled desktop demonstration.
It exposes the existing engineering through playable sample media, actual
branches/diffs/merge conflicts, and real structural findings. This is not a claim
of production editor reliability, a measured hiring outcome, or a human usability
study proving that everyone completes the guide in two minutes.

## Inspection and baseline

Read the supplied AGENTS instructions, repository README, CONTEXT, DAY1-REPORT,
PERF, package scripts, React shell, Zustand stores, persistence/media restoration,
VCS graph/resolvers, verification, assistant configuration and browser scripts.
The working merge engine already has the Day 1 consistency and metadata work;
this task does not change engine algorithms or repeat the older audit's claims.

Baseline: **700 tests / 72 files passed**, both workspace TypeScript checks passed,
and the web production build passed. The existing real Chrome VCS persistence
regression passed before UI changes. Artifacts are under
`.gstack/founder-demo/baseline-*` and `before.png`.

Production was also opened read-only in an isolated Chrome context. Its public
configuration reported River, model `deepseek-ai/DeepSeek-V4.1-Flash-1017`,
`configured: true`, `accessRequired: true`. The access-code field is present.
No production proposal was submitted, and no secret was read or exposed.
Evidence: `production-before.png` and `production-baseline.json`.

## Before and after

| Before | This revision |
| --- | --- |
| Empty library, blank timeline and repeated import instructions | Recommended one-click sample plus a separate import path |
| Features require manually constructing an editing scenario | Playable sample, three video clips, audio bed, four commits, two branches |
| Versioning buried in a side panel | Optional guide opens actual Versions, Graph, Diff, Merge and Verification views |
| Empty timeline says verification is clean | “No clips to verify” / “nothing to verify”; lint rules are unchanged |
| Assistant can have a disabled action without an obvious reason | Provider loading/unavailable/access-required states and request/review explanations |
| Prominent “Export” is ambiguous | “Export timeline” with explicit interchange formats and no rendered MP4 |
| Timeline initially receives 37% of workspace height | 45% default, retained resize controls, separated demo/personal saved layouts |
| Editing controls mount while persistence reads | Editor waits for hydration before exposing import/edit controls |

Existing personal users receive no guided onboarding. They can opt into the
sample from the header. The professional editor layout, playback implementation,
export serializers, authentication, server quotas and merge semantics are retained.

## How the real scenario works

`apps/web/src/lib/demo/project.ts:9` constructs the sample with the existing
`applyOp`, operation history, `createRepo`, branch, checkout and commit functions.
The dates are fixed sample metadata to make reset and tests deterministic.

- `c0`: empty sequence with source assets; `c1`: assembled three-shot sequence
  and audio bed.
- Main `c2`: moves `middle` to 3–5s and trims `opening` to 1.8s.
- Alternate `c3`: moves `ending` to 4–6s.
- Neither branch has a structural overlap. The genuine three-way merge introduces
  a 4–5s overlap between different independently edited clips. This is why the
  geometric merge pass is necessary after per-field merging.
- The existing conflict resolver explicitly removes one clip when the visitor
  chooses to keep the other. It never shifts creative timing. The normal engine
  refreshes conflicts; the guide's resolution state follows `result.clean`.
- The normal merge action records `c2` and `c3` as both parents. It cannot commit
  unresolved conflicts. A 1.2-second gap remains in the standard keep-middle
  path and is reported by the actual linter. “Merged” therefore does not claim
  “verified”. Verification is structural, not visual or audio judgment.
- The normal history reducer provides replay and undo/redo. There is no separate
  fake demo model, fabricated conflict or precomputed diagnostic response.

The optional guide can be skipped, reopened, or reset. Its merge action refuses
the guided scenario if the branch snapshots or clip edits no longer match it;
normal Versions remains available for independent exploration.

## Isolation and persistence decisions

`apps/web/src/lib/workspace.ts:1` selects a namespace only for explicit `?demo=1`.
The sample opens in a new tab with `noopener noreferrer`, preserving the original
tab and its working state without a destructive project switch.

| Storage | Personal | Sample |
| --- | --- | --- |
| IndexedDB project key in existing `cutroom/projects` | `current` | `current.demo-v1` |
| OPFS upload directory | `media` | `media.demo-v1` |
| Track preference key | `cutroom.view-preferences` | `cutroom.view-preferences.demo-v1` |
| Panel layout prefix | `cutroom.layout` | `cutroom.layout.demo-v1` |

No global store or OPFS clear occurs. Reset requires explicit confirmation and
only clears the active project slot, then reconstructs the sample. Existing
sample upload files are retained in their separate directory. Reset failures
leave the working timeline intact and display storage status; the guide does
not report a successful reset when it failed.

`usePersistence.ts:28` waits for restoration, initializes a new sample only when
its slot is empty, restores the ordinary serialized history/repo, and subscribes
to saves after hydration. Corrupt stored data retains the existing rescue flow;
a failed read is not treated as permission to overwrite stored data. Bundled
sample URLs restore independently of OPFS; extra uploads use ordinary OPFS reads.

Refresh of saved sample edits/commits and personal uploads is tested in actual
IndexedDB/OPFS. Pending merge resolutions remain memory-only, with a visible
warning. Refresh cancels an uncommitted merge and retains the saved project.
Saves remain debounced by 700ms: wait for **saved**, not **unsaved**, before reload.

## Media provenance and size

Two self-created sources are distributed in `apps/web/public/demo`: original
procedural motion graphics and a synthesized 220 Hz pulse. They are dedicated to
CC0 in that directory's README. The generator is
`scripts/make-demo-media.sh`; there is no third-party video hotlink or personal
footage in the sample. Tests check each SHA-256 asset ID against the actual bytes.

MP4: H.264/AAC, 960×540, 30fps, eight seconds, 109,682 bytes.
WAV: mono 16kHz PCM, eight seconds, 256,078 bytes.
Total: **365,760 bytes (357.2 KiB)**. Video clips have zero gain; the separate
A1 clip supplies sound. A fresh personal workspace requests neither source.
Poster, waveform and playback readers can request a source more than once;
unique file size is not a claim about total transfer size or decoded memory.

## Files and tests

| Files | Purpose |
| --- | --- |
| `apps/web/public/.gitignore`, `public/demo/` | Allow only the original licensed sample MP4 through the existing test-media ignore rule |
| `lib/demo/project.ts:9`, `lib/demo/load.ts:7`, their project test | Actual sample graph, replayable edits, source manifest and store installation |
| `lib/workspace.ts:1`, `workspace.test.ts` | Explicit workspace selection; track/layout isolation |
| `lib/persistence/storage.ts:66`, `storage.test.ts` | Namespaced project reads/writes/deletes with personal default preserved |
| `lib/media/opfs.ts:44`, `opfs.test.ts` | Namespaced media directory, including identical uploaded IDs |
| `lib/layout.ts`, `lib/viewPreferences.ts` | Isolated view preferences using existing persistence helpers |
| `lib/persistence/restoreMedia.ts:14`, `restoreMedia.test.ts` | Known bundled sources plus honest OPFS failure reporting for other media |
| `lib/persistence/usePersistence.ts:28`, `persistenceStore.ts`, `demoReset.test.ts` | Hydration, sample initialization/restoration and safe reset/error paths |
| `components/DemoGuide.tsx:11`, `DemoGuide.test.tsx` | Optional guide driven by actual pending/result/commit state |
| `App.tsx:79`, `App.test.tsx`, `index.css` | Hydration gate, timeline space, desktop notice, focus and compact empty inspector |
| `components/SidePanel.tsx:157`, `TopBar.tsx`, `Preview.tsx`, `Timeline.tsx` | Demo entry/navigation and distinct empty-state instructions |
| `components/DiagnosticsPanel.tsx:34`, `StatusBar.tsx:113` | Empty verification presentation; no lint algorithm change |
| `components/AssistantPanel.tsx:13`, `AssistantPanel.test.tsx` | Availability, access and preview/apply state communication |
| `components/ExportMenu.tsx:59` | Timeline export label and format explanation |
| Presentation tests, `verify-editorial.mjs`, `verify-commit-graph.mjs` | Intended copy updates and current safe checkout contract |
| `scripts/verify-demo.mjs`, `scripts/measure-demo.mjs` | Actual Chrome workflow and built-bundle timing/smoke checks |
| `README.md`, `CONTEXT.md`, this report, media README | Instructions, handoff, provenance and disclosed limits |

Paths starting with `lib/`, `components/`, `App` or `index.css` are relative
to `apps/web/src/`; `public/` is relative to `apps/web/`. Other paths are relative
to the repository root. The sample MP4 is explicitly excepted from the existing public-media ignore rule;
unrelated MP4s remain ignored. No engine files, server endpoints, export formats, or dependencies
were changed.

There are **18 additional automated tests**: workspace selection/preferences (2),
actual sample graph/replay/conflict/schema/media/store reset (5), guide/engine
state (2), hydration shell (2), reset/isolation/failure (3), OPFS directory (1),
bundled restoration/abort/missing upload (1), IndexedDB slot isolation (1), and
assistant availability rendering (1). Existing assertions about a truly clean
nonempty sequence remain; empty-state assertions now match the new requirement.

## Commands and results

Run commands from the repository root unless stated otherwise.

| Check | Actual result |
| --- | --- |
| `TMPDIR=$PWD/.gstack/tmp ./node_modules/.bin/vitest run packages/engine apps/web scripts/measure-editor-performance.test.mjs --maxWorkers=4` | **718 passed / 77 files**: 181 engine, 521 web/server, 16 existing harness tests |
| `pnpm typecheck` | Both workspaces passed |
| `pnpm --dir apps/web run build` | TypeScript + Vite production build passed |
| `git diff --check` | Passed; sample MP4 ignore exception checked, unrelated test MP4 still ignored |
| Configured lint command | None in root, engine or web package scripts; no lint result invented |
| `node scripts/verify-demo.mjs` | All four desktop sizes, actual decoded frames/seeks, versions/graph/diff, engine conflict/resolve/commit, lint, refresh, reset, personal return and assistant state fixtures passed; no uncaught JS errors |
| `node scripts/verify-vcs-persistence.mjs` | Real IndexedDB/OPFS, undo/redo, checkout guard, refresh and missing-media warning passed |
| `node scripts/verify-merge-consistency.mjs` | Passed |
| `node scripts/verify-commit-graph.mjs` | Shared tips, forks, conflicts, two-parent graph, checkout guard and laptop layout passed |
| `node scripts/verify-detach-audio.mjs` | Real-video/audio regression passed |
| `node scripts/verify-waveforms.mjs` | Actual video/audio decode, trim/split and waveform regression passed |
| `node scripts/verify-editorial.mjs` | Import/search/tags/transforms/timing/graphics/versions/project/export/persistence passed |
| `node scripts/verify-assistant.mjs` | Eight existing deterministic browser checkpoints passed |
| `node scripts/measure-demo.mjs` against port 5187 | Three built-bundle runs passed; real playback, merge, refresh and two-parent persisted commit checked without Vite source imports |

Browser invocations use:

```sh
export PLAYWRIGHT_MODULE=/home/shivam/.gstack/repos/gstack/node_modules/playwright/index.mjs
# Local development server, port 5186, in apps/web:
./node_modules/.bin/vite --host 127.0.0.1 --port 5186 --strictPort
# Then, from root:
node scripts/verify-demo.mjs
# Built bundle, in apps/web:
./node_modules/.bin/vite preview --host 127.0.0.1 --port 5187 --strictPort
# Then, from root:
node scripts/measure-demo.mjs
```

The module path above reflects this machine's existing Playwright install; use
`playwright` normally or supply your own `PLAYWRIGHT_MODULE`. Existing scripts
also need their documented `TEST_VIDEO_A`, `TEST_VIDEO_B`, `TEST_AUDIO` or
`TEST_GRAPHIC` inputs. QA used the sample, a local 20s loop of it, a locally
extracted PNG, and a 2s synthetic silence/tone WAV, not bundled personal footage.
Artifacts and generated test fixtures are ignored under `.gstack/founder-demo`.
The older general `verify-editor.mjs` script was not run; it requires its own
`apps/web/public/test-a.mp4` fixture and legacy clip-hash assumptions. The focused
current regressions above cover this task.

Early test runs caught a misplaced hydration guard (corrected; typechecks and
browser checks rerun), a strict locator matching both visible and hidden
verification panels (scoped), and a timing assertion matching “unsaved” as “saved”
(corrected to a whole word). None of these failures was suppressed. Running
source-import browser tests across Vite HMR can read duplicate module instances;
restart the dev server after source edits before those checks. The old graph
script also assumed a destructive checkout confirmation and used a no-op 8s trim
with an 8s fixture. It now asserts the existing block-on-dirty policy, explicitly
undoes, and runs with a 20s fixture. The product checkout policy was not relaxed.

## Browser evidence

All four desktop sizes exercised the full workflow, not only screenshots:
1440×900, 1366×768, 1280×800 and 1024×768. A 390×844 viewport shows the explicit
mobile limitation. Separator focus, keyboard resize, pointer resize, desktop
horizontal overflow and timeline height are checked.

- `.gstack/founder-demo/browser/results.json`: per-viewport results and timings.
- `browser/fresh-1440.png`: first-run paths.
- `browser/sample-1440.png`, `browser/sample-1024.png`: decoded sample and A1 waveform.
- `browser/graph-1440.png`, `browser/comparison-1440.png`: actual graph and diff.
- `browser/conflict-1024.png`: actual blocking conflict on a laptop-sized workspace.
- `browser/verification-1440.png`: actual gap finding after merge.
- `browser/assistant-access-required.png`, `assistant-401.png`, `assistant-429.png`,
  `assistant-500.png`, `assistant-200.png`, `assistant-unconfigured.png`,
  `assistant-error.png`: UI state fixtures, explicitly not live River responses.
- `browser/mobile-limitation.png`: narrow-screen notice.
- `production-preview/sample-built.png`, `conflict-built.png`, `measurements.json`:
  built assets, actual media and persisted merge, without dev source imports.
- `regression-*/results.json` or corresponding logs/screenshots: existing suites.

The fixture proposal leaves the timeline unchanged until Apply, then passes
through the actual parser, preview, reducer and undo. These tests prove client
behavior, not current River generation quality, live quota behavior or provider
latency. Browser scripts collect uncaught JS errors; expected HTTP error fixtures
are deliberately exercised and are not represented as successful AI calls.

## Measured performance

Chrome **156.0.8078.73**, headless, Linux, local HTTP production preview, 1440×900,
three fresh browser contexts on the same machine. These are short local
observations including Playwright/event wait overhead, not Internet latency
budgets or a comparison benchmark. Other QA processes were running on this
machine. Raw values: `production-preview/measurements.json`.

| Observation | Median | Observed range |
| --- | --- | --- |
| Initial editor navigation to demo entry available | 1,126.9ms | 843.9–1,348.4ms |
| Click sample to initialized guide/project visible | 1,077.7ms | 735.1–1,088.9ms |
| Click sample to first decoded video ready | 1,298.8ms | 902.0–1,429.4ms |
| Cut-navigation click to source cursor ready (nine seeks) | 267.0ms | 198.4–401.1ms |

Individual sample HTTP resource durations were 5.2–19.7ms on loopback; there were
4–5 video/audio resource entries per run because existing readers can fetch the
same source separately. This does not measure a single aggregate download or
remote CDN performance. Playback readiness checks readyState, dimensions and
media error; playback itself additionally requires decoded frame counts to
increase. Seek checks confirm the expected source offset, readiness and completed
native seeking. They do not prove frame-exact presentation, audible sync, sustained
playback, dropped-frame rates or long-session memory use.

## Remaining limitations and deployment

- **Not deployed or committed.** No configuration change is required for the
  sample assets/query namespace; an authorized deployment must include this
  revision. Existing River server credentials, access control and limits remain
  unchanged. No new environment variable or public AI endpoint was introduced.
- Desktop Chrome is checked. Full mobile editing, Firefox/Safari/private-mode,
  storage eviction/quota in a real restricted browser, and assistive-technology
  sessions remain unverified. Narrow mobile intentionally scrolls a desktop
  workspace and displays the limitation.
- Pending merges are not persisted. Close/refresh before the debounced save can
  lose unsaved edits. Multiple tabs writing one workspace still have last-write
  behavior; the sample/personal split prevents that class of interference between
  those two namespaces, not concurrent editing of the same project.
- The existing personal restoration path still scans the active history base;
  arbitrary media referenced only by old commits/other branches is not proven
  restored. This task verifies the sample's bundled sources plus active personal
  upload restoration, not the broader unresolved restoration problem from Day 1.
- MP4 rendering, collaboration, semantic video/audio verification and model vision
  remain outside scope. No synthetic “live AI” response is shipped.
- The guide provides a path designed for a two-minute explanation. Rehearse it
  with a person before claiming that outcome. The procedural media is deliberate
  test content, not a cinematic edit or large-footage performance workload.

Next: rehearse the actual conflict explanation, obtain authorization to ship
this revision, smoke-test its hosted assets and access-code flow after deployment,
and record a short founder walkthrough. Further features are not needed for
that demonstration.
