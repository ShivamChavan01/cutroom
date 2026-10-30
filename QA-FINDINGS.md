# Cutroom QA findings

Audit starts at clean `main`, commit `2481442`. Findings distinguish reproduced
behavior from unverified limitations. Changes are local and unshipped.

| Severity | Finding | Evidence and outcome |
| --- | --- | --- |
| P0 | None observed in the tested founder flow | All requested desktop viewports complete the actual workflow |
| P1, fixed | Refresh dropped pending merge decisions | Original serializer omitted pending data. `pending-before.log` contains the failing regression. Inputs/choices now save and reconstruct through the engine; unresolved, partially resolved and resolved reloads are tested |
| P1, fixed | Healthy audio hid a failed video warning | Real Chrome received invalid MP4 bytes and delayed valid WAV. Decoder failed but alerts became empty. `decode-before.json/png` records it. Track/source-scoped errors now remain visible; browser failure cases and reducer tests pass |
| P2, fixed | Guide lost completed operations after further branch commits | It inspected only the current commit for two parents and used a transient step counter. Actual editor state and joined ancestry now drive it. A descendants regression failed before the final fix; `guide-descendants-before.log` records it |
| P2, fixed | Guide called non-overlap disagreements a timing collision | Guide now distinguishes actual overlap conflicts from content/settings disagreements, covered with a real project-setting merge |
| P2, fixed | Keep buttons did not explain removed content | Actual overlap interval and track are shown; each keep choice states which other clip is removed. Semantics remain the original explicit deletion |
| P2, fixed | Verification could imply stronger validity than established | Gap context includes exact bounds and track; pauses may be deliberate. No-findings text asks for playback review; error counts no longer claim all operations are blocked |
| P2, fixed | README/report status was stale | Sample availability and new local recovery instructions are updated. The earlier implementation report is explicitly historical |
| P3, fixed | Incidental favicon 404 | Confirmed in Chrome console. Empty data favicon prevents the request; successful journeys now have no incidental HTTP errors |

## Reproduce the important fixed cases

Pending recovery:

1. Open a fresh local production-build `?demo=1`.
2. See two versions → Compare edits → Merge versions.
3. Wait for saved, then refresh. The unresolved overlap is restored.
4. Keep middle, wait for saved, refresh. The removal choice is retained.
5. Commit and refresh. The stored head has parents `c2` and `c3`.
6. Restart, begin another merge, Cancel, refresh. The original saved graph remains.

Partial recovery:

1. Rename/commit the project differently on main and alternate using the actual UI.
2. Return to main and merge alternate. Both a project-name conflict and overlap exist.
3. Keep ours for the title, save and refresh. The timing conflict remains.
4. Keep middle, save and refresh. Both decisions remain; commit records `c4`, `c5`.
5. The guide recognizes the combined histories after the added commits.

Decode visibility:

1. In an isolated browser context, return unreadable MP4 bytes for the sample source.
2. Delay the valid audio response until after the video error.
3. Let audio become ready. The video warning must remain visible.

Storage recovery:

- Invalid pending reference: preserve valid history/working edits, show a recovery
  notice, and do not resume or commit the bad session.
- Invalid full project JSON: keep the original raw text for export; reset requires
  confirmation and only affects the active namespace.
- Denied IndexedDB: memory-only status remains visible; bundled media still plays.

## Remaining severity assessment

- **P0: none observed. P1: none remaining in the tested sample path.**
- **P2:** multiple tabs writing the same namespace lack synchronization. Sample
  and personal namespaces are isolated, but this is not multi-user collaboration.
- **P2, unverified coverage:** arbitrary uploaded media referenced only by another
  branch/older commit is outside the proven restoration path. Bundled sample
  sources and active personal-upload OPFS restoration pass.
- **P2, verification limits:** real quota/eviction, private mode, Safari/Firefox,
  long sessions and frame/audio sync are not proven by these checks.
- **P3:** the motion-study sample is abstract. Its clock and pauses demonstrate
  timing, but it does not convey the texture of distinct filmed shots. Keep the
  small reproducible assets for this interview scope.
- **P3:** commit-message draft text is not restored; decisions and committed
  history are. Human usability/accessibility observation is still recommended.

These limits are not falsely described as reproduced corruption bugs. See
TEST-RESULTS for evidence and DEMO-LIMITATIONS for the supported boundary.
