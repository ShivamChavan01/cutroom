# Production context

The context layer supplies the assistant with a production brief, reference
directions, requirements and authored source evidence. The selected proving
workflow is reviewing a cut against its brief, reference style and continuity
requirements.

## Current behavior

The Assistant panel creates and revises a brief, reference directions,
continuity instructions and maximum duration. Selected audio or picture can be
protected by source range. Import accepts a document with timestamped source
notes and explicit continuity sequences. Export downloads the saved document.

**Inspect request context** shows retrieved source notes, source times and
omissions before a model request. The assistant receives that bounded task
context. Its proposal is previewed using
the existing engine and checked against the saved production requirements.
The shared store application boundary rejects newly introduced or worsened
required violations. Ordinary manual editing remains available; current
production checks update to show violations.

No automatic footage analysis or general next-action model is implemented.
Reference directions and editorial continuity requirements explicitly need
human review. A placement pass never establishes visual quality or fidelity
to a reference video.

## Usage and ownership

```ts
useProductionStore.getState().install(importedDocument);

const context = buildProductionContext({
  document,
  timeline,
  query: "Review this scene against the production brief",
  selectedClipId,
  playheadMs,
  lockedTrackIds,
});

const preview = previewPlan(timeline, plan, lockedTrackIds, document);
```

- `lib/production/document.ts` owns boundary parsing and the domain contract.
- `lib/production/review.ts` owns source-to-timeline placement checks and
  requirement regression detection.
- `lib/production/context.ts` owns lexical/source-range retrieval and bounded
  assembly. It does not call a model or inspect media bytes.
- `productionStore.ts` owns the current project-wide document and its revision.
- `lib/assistant/request.ts` selects production context when a document exists
  and restricts returned operations to clips included in that context.
- `lib/assistant/scope.ts` binds a result to editor history, session, selection,
  version state, locks and the production revision. The playhead guides request
  retrieval and can move while reviewing a proposal.
- `store.ts` applies validated operations and enforces the current production
  constraints for assistant and gain proposals.
- Existing project persistence saves the document with the timeline history
  and graph. A brief revision participates in autosave acknowledgement checks.

The production document is project-wide input. Checkout changes the cut being
reviewed, while retaining its brief. Timeline Undo does not rewind a brief.
Replacing a brief invalidates outstanding assistant results. Successful reset
and demo installation clear the document; failed reset preserves it.

## Document format

`examples/production-context.demo.json` is an executable sample of the contract.
Each document has version 1, a brief, style references, requirements and evidence.
IDs are unique within each collection. Evidence references must resolve.

A source range identifies `assetId`, `channel`, `inMs` and `outMs`. The channel
is `video` or `audio`. Times are positive-duration half-open source intervals
in integer milliseconds. A range is not a timeline time or clip ID.

Evidence identifies a range, text, an ID and a kind: `transcript`, `shot-note`
or `continuity-note`. Provenance must be `user-provided`. Import does not certify
the accuracy of those notes. Instructions embedded in source notes are treated
as source material by the provider prompt, not as system instructions.

Requirements are `required` or `preferred`:

- `duration` checks the entire timeline against `minMs` and `maxMs`.
- `preserve` checks that a complete source range retains a continuous timeline
  placement. Audio requires nonzero clip gain and an unmuted timeline track.
  Adjacent split children retain the same placement offset and can pass.
- `sequence` requires at least two source ranges, each with one unambiguous
  placement, in order, separated by no more than `maxGapMs`.
- `editorial` holds an instruction and evidence IDs. Its status is always
  `needs-review`; it does not become an automatic style or continuity pass.

Known placement failures are `fail`. Missing/incompatible source metadata,
out-of-bounds source ranges and ambiguous repeated takes remain unverified.
Rendered media availability, video occlusion, subjective meaning, actual
loudness, preview hiding/muting and visual continuity require additional checks.

## Retrieval and budget

Every brief, requirement and reference direction is retained. The selected clip
and supporting requirement clips get space before optional notes. Explicitly
referenced evidence is pinned; other notes rank by query terms, brief terms,
selected source range and requirement ranges. Relevant clips follow. No full
video, waveform, URL, API key or decoded frame is serialized by this builder.

The default budget is 60,000 serialized characters, below the existing endpoint
limit. This is a character budget, not a measured token budget. The packet
includes at most 60 clip records. A source note includes up to four placement
examples with its total placement count. Coverage reports excluded notes and
clips. It does not claim semantic completeness.

If the mandatory document, selected clip or pinned evidence cannot fit, assembly
fails explicitly. Import accepts at most two million document characters,
20,000 evidence notes, 100 requirements and 30 reference directions. Individual
source notes are bounded to 4,000 characters. These are implementation bounds,
not validated production capacity or accuracy claims.

## Persistence compatibility

Context-free projects continue to save as project schema 2. Projects containing
production context save as schema 3. This build reads schemas 1, 2 and 3.
Older builds reject schema 3 instead of silently dropping requirements. A
rollback client needs schema-3 support to open those projects. Do not delete
browser data to work around that incompatibility. The IndexedDB version and
stores remain unchanged.

Malformed saved production context causes a recoverable project-load error with
the original saved text available for export. Requirements are never silently
removed to recover an apparently usable cut. Context edits use the existing
workspace keys, write ordering and cross-tab stale-write protection.

## Design choice

Two shapes were considered. Extending the whole-timeline JSON dump with more
fields keeps the caller simple but ties semantic evidence and project size to
each request. The chosen shape keeps a validated project document and derives
a task packet. This gives persistence, retrieval and proposal validation clear
owners while leaving the engine's timeline and history authoritative.

The gain predictor remains an independent baseline. It receives the shared
production guard when applying a proposal, but does not yet predict edits from
the brief. Automatic analysis, semantic retrieval, incremental indexing and
reference-video interpretation are future work.

## Verification scope

Unit tests exercise import errors, requirement checks, split/trim/move/mute
behavior, ambiguity, request scope, omitted-clip rejection and persistence.
The large retrieval fixture contains 12,000 synthetic timeline clips and
1,002 authored notes. It checks that distant required evidence and explicit
reference notes survive bounded assembly. It is not a real production video
test or a prediction-quality benchmark.

`scripts/verify-production-context.mjs` drives real Chrome against the local
Vite app in a disposable sample context. Controlled HTTP model responses cover
brief authoring, saved reload, import/export, protected source ranges, blocked
unsafe application, stale scope, valid Apply/Undo and laptop panel bounds.
This verifies the application path, not live-model performance or style taste.
Evidence lives under `.gstack/production-context/`.

## Assistant in the editor

Choose **Assistant** at the top right to open the resizable sidebar. Choose
**Properties** to edit the selected clip. Close the sidebar to widen the
preview. Chat and brief drafts survive switching tools and closing the sidebar.
The sidebar spans the editor height. The preview and timeline share the column to its left.

Context starts collapsed. Its form scrolls independently under a persistent
Save action. Brief changes preserve the typed question and mark old proposals
stale. The simple form replaces its own duration/style/continuity settings,
including legacy duplicate duration settings. Independent imported constraints,
source evidence and evidence links remain intact. Clearing an optional form
setting removes that setting. Drafts survive navigation but are not autosaved.

The chat retains up to 100 local messages for display. Each request adds at
most the latest 12 messages and 12,000 characters to current timeline/production
context. Recent conversation is supporting context; the saved brief and all
required constraints remain authoritative. Reload and project reset clear the
local conversation. Access credentials never enter conversation context.

Proposal actions stay outside the scrolling reply. **Show changes** marks the
proposal on the timeline while the viewer plays the current cut. Apply becomes
available again after pausing if the proposal is still current. Dismiss, Apply
or a stale proposal clear only its own comparison.

`scripts/verify-agent-workspace.mjs` covers the 1440, 1280 and 1024px layouts,
persistent drafts/questions, replacement settings, blocked Apply, recent-turn
context, long replies, timeline marks, playback and scrubbing before Apply,
stale scope, Apply/Undo, and shared player and timeline identity. It uses controlled HTTP responses in a local,
disposable Chrome profile. Evidence is in `.gstack/assistant-dock/`.
