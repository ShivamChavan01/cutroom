# Cutroom founder readiness review

Review date: 2026-10-30. Starting branch: `main`, clean at `2481442`.
This work remains local. No commit, push, deployment, PR or dependency install
was performed. The hosted editor still runs the earlier sample revision.

**Verdict: GO for a controlled desktop founder demo of this revision after an
approved deployment and hosted smoke check. Subjective score: 8/10.**

The project now explains an editing problem first, then demonstrates the
engineering underneath it. The score reflects that clearer story, recoverable
editing decisions and real browser evidence. It is not a hiring prediction or a
reward for the test count. Abstract sample imagery, limited browser coverage and
unmeasured long-session media behavior keep it below a polished production tool.

## Changes and why they matter

| Change | Practical value |
| --- | --- |
| “Explore different edits without losing your work” introduction | Explains the benefit before introducing branches or commits |
| Guide derived from editor state | Manual comparison, switching, edits, cancellation and revisits no longer depend on an unrelated step counter |
| Completed-guide detection follows both original editing histories | Additional commits on either branch do not hide a completed merge |
| Pending merge choices saved in the existing project | Refresh preserves unresolved work and recorded decisions after save completes |
| Restore validates references and replays decisions | Corrupt/stale pending state cannot pretend to be a successful merge |
| Overlap explanation includes track, time and removed content | Users can understand what each keep action actually does |
| Gap finding explains location and editorial uncertainty | A conflict-free merge does not imply a cut is ready for delivery |
| Decode errors scoped to track and source | Healthy audio no longer hides a failed video warning |
| Explicit empty favicon | Removes the pre-existing incidental favicon 404 without adding artwork |

The existing editor layout and design tokens are retained. No landing page,
new editor feature, encoder, provider endpoint or merge algorithm was added.
Original motion/audio assets are retained unchanged, with their existing CC0
provenance and content-hash tests. Their source clock, changing motion and visible
pauses are sufficient for this timing demonstration; they are not cinematic footage.

## Merge recovery design

`lib/mergeSession.ts` is a small adapter over the existing resolvers. Both the
merge panel and timeline conflict bands send the same semantic conflict key and
explicit choice. The previous arbitrary `setResult` store command is removed.

The saved project contains source/target branch names, both head IDs, common
ancestor ID, the working snapshot from merge start, and the resolution journal.
It does **not** save a result object or a trusted `clean` flag. Restore validates
the ordinary history/graph, checks the current heads and working snapshot,
recreates the merge, and replays each choice through the existing engine.

The working snapshot is the immutable input for this merge, not another editable
working tree. The reconstructed result is a runtime cache. The operation log and
commit graph remain the authorities for edits and saved versions.

A stale base, moved head, changed working cut, invalid choice or repeated stale
conflict key cancels only the unusable pending session and displays a recovery
notice. Valid committed history and working edits still restore. Fully corrupt
project JSON retains the raw-data export/reset rescue flow. A valid pending merge
can be canceled explicitly. Reload never commits it.

Merge updates schedule an immediate local save; ordinary edits retain the 700ms
debounce. Wait for **saved** before refreshing. An unfinished commit-message draft
is not persisted. Legacy project saves without a pending field remain readable.

## Verification and QA

- Baseline: **718 tests / 77 files**, both TypeScript checks and build passed.
- Final: **744 tests / 82 files**, both TypeScript checks and production build passed.
- Production-build Chrome journeys passed at 1440×900, 1366×768, 1280×800 and
  1024×768. These exercised decoded playback, meaningful version comparison,
  graph, real conflict, refresh before/after resolution, two-parent commit,
  exact 1200ms finding, cancellation, reset, and personal-project preservation.
- A second scenario adds actual conflicting title edits on both branches. A title
  choice survives reload with the timing conflict still unresolved; a later timing
  choice also survives reload before the correct merge commit is created.
- Missing/undecodable source, delayed healthy audio, denied IndexedDB, corrupt
  project JSON and invalid pending data were exercised in real Chrome.
- Existing persistence, merge, graph, editorial, detach-audio, waveform, assistant
  and demo browser regressions passed. AI availability/errors use HTTP fixtures;
  no paid model call was made.

See [TEST-RESULTS.md](TEST-RESULTS.md) for exact commands, failures and artifacts,
and [QA-FINDINGS.md](QA-FINDINGS.md) for severity and reproduction details.
No lint command is configured. Lizard is unavailable; neither is reported as passed.

## Main changed files

Paths below are relative to `apps/web/src/` unless noted.

| Files | Responsibility |
| --- | --- |
| `lib/demo/guide.ts`, `components/DemoGuide.tsx` and tests | State-derived, concise, optional walkthrough |
| `lib/mergeSession.ts` and tests | One resolution path and replayable decisions |
| `vcsStore.ts`, its tests, `components/MergePanel.tsx`, `Track.tsx`, `Timeline.tsx` | Migrate all resolution callers; preserve existing merge semantics |
| `lib/persistence/project.ts`, `usePersistence.ts`, `persistenceStore.ts`, new `pendingMerge.test.ts` | Validate/reconstruct pending state, save it, and communicate recovery |
| `lib/diagnosticExplanation.ts`, `components/DiagnosticsPanel.tsx`, tests | Accurate finding context and bounded claims |
| `lib/playbackErrors.ts`, `components/Player.tsx`, tests | Independent source failure handling |
| `components/StatusBar.tsx`, `index.css` | Pending/save/recovery visibility and existing-style explanations |
| `apps/web/index.html` | Stop the unrelated favicon request |
| `scripts/verify-readiness.mjs` | Production-build journeys, recovery, isolation and failures |
| `scripts/verify-demo.mjs`, `measure-demo.mjs` | Match the new supported recovery and guide behavior |
| Root documentation | Current instructions and explicit limits; earlier report labeled historical |

No files under `packages/engine`, provider server code or export serializers were
modified. The four requested deliverables are this report, QA-FINDINGS,
TEST-RESULTS and DEMO-LIMITATIONS.

## Remaining issues and production risks

No P0 or P1 remains in the tested sample path. Remaining limitations include
same-workspace concurrent tabs, arbitrary older/branch-only uploaded-media
restoration, cross-browser coverage, browser quota/eviction, and long-session
playback/frame accuracy. These are detailed in [DEMO-LIMITATIONS.md](DEMO-LIMITATIONS.md).
The guide is designed for a brief explanation; no human study proves 15-second
comprehension or a two-minute completion time.

Before sending the new behavior to founders: approve shipping, verify the hosted
revision, then rehearse or record the exact flow below. Further features are not
needed for that demonstration.

1. Open `?demo=1`; play the sample.
2. Choose **See two versions**; inspect alternate and main, returning to main.
3. Choose **Compare edits**, then **Merge versions**.
4. Explain the real 4.00–5.00s collision. Refresh after saved to show recovery.
5. Choose **Keep middle**. Explain that ending is removed and middle stays put.
6. Refresh after saved; enter a message and **Commit merge**.
7. Choose **Inspect findings**. Review the 1.80–3.00s pause and its 1200ms duration.
8. Open Versions → Graph to show both parents. Keep any intentional pause;
   structural verification cannot judge the editor's intent.
