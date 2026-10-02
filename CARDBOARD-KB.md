# Cardboard — Knowledge Base

Research notes on Cardboard (cardboard.ai / usecardboard.com), the company
this prototype is built for. Sources are linked; quotes are verbatim.
Last updated: 2026-10-02.

## Company

- **What:** Agentic video editor in the browser. "Cursor for video editing"
  / "vibe editing" — you describe the edit, the agent executes it. Raw
  footage in, first cut in minutes.
- **Who it's for:** Growth/marketing teams and serious creators shipping
  video consistently (launches, ads, recaps, testimonials, weekly content).
  Real footage (talking heads, screen recordings, B-roll) — not AI-generated
  clips. Users named: PostHog, Airtable, Google people.
- **Stage:** YC W26, 1–10 employees, founded 2025, San Francisco. ~$2.1M
  funding (per third-party tracker, unverified). Live product with pricing.
- **Founders:** Saksham Aggarwal (CEO, ex co-founder/CTO of Iterate AI,
  EF-backed; ACL-published; first engineer at PYOR) and Ishan Sharma (CTO,
  ~4.5 yrs at HackerRank on high-performance browser apps; built a 5.7M+
  download Windows app in school). Best friends 15 years, BITS Pilani /
  Chitkara. Both technical, both builders, no prior video-editor background
  — relevant precedent for our own framing.
- **Hiring:** Small team, roles in SF + Bangalore (engineers, designers,
  growth). Hard-problems page ends with *"These are the problems we hire
  against. Pick the one you can't stop thinking about."*
- **CEO framing (Fondo interview, Aug 2026):** "There's no good VS Code for
  video, so they're building one." Agent likened to code review + fixer.
  Different footage types (screen recordings vs talking heads vs sports)
  need different ML pipelines with a routing model. Stopped selling launch
  videos to focus on product.

## Product / tech (public)

- Browser-based NLE: cuts, captions, reframing, compositing, voiceover,
  cleanup, in-browser export. Exports to DaVinci Resolve / Premiere XML.
- Runs client-side on **WebCodecs + WebGL2/WebGPU** — no heavy server
  processing. Only small byte-chunks uploaded for ingestion; full footage
  upload only for collab/cloud sync (per CEO on Product Hunt).
- Live collaboration, footage search by content ("find footage by what's
  in it"), plain-language edit commands, style-reference ingestion
  (upload a video you like, get closer to it).
- Competitors named in coverage: Descript, Runway, CapCut.

## The ten hard problems (verbatim from usecardboard.com/hard-problems)

1. **High Performance NLE in the Browser** — real-time timeline rendering,
   frame-accurate seeking, multi-track compositing, codec handling, inside
   browser memory limits, on still-maturing WebGPU/WebCodecs. Browser anyway:
   no installs, agent-native, collab infra from day one.
2. **Collaboration** — video state isn't a document graph (timeline,
   playback, in-progress renders, media missing on some clients). CRDTs/OT
   get partway; the hard part is syncing large assets without lag or loss:
   smart pre-processing, compression, selective sync.
3. **Multimodal Understanding** — "no grep for video." Embeddings too slow
   or too inaccurate for real-time clip search over 100s of gigs.
4. **Better Context** — agent must reason across assets, timeline,
   playback, presets, history, collaborator activity, plus external
   generative/stock sources, simultaneously. No existing framework does this.
5. **Predicting Next Actions** — autocomplete for editing: suggest *and
   execute* the next action without breaking flow. Needs user telemetry →
   action embeddings → model iteration loop.
6. **Style References** — decompose a reference video into discrete
   attributes (type, grade, pacing, transitions), let user pick which to
   apply, reproduce reliably; handle missing fonts/effects via
   sourcing/generation/fallback.
7. **Motion Graphics** — tens of hours for seconds of animation. Open:
   diffusion vs programmatic vs hybrid, frame-level controllability,
   interop with AE/Lottie or a replacement representation, avoiding
   generic AI sameness.
8. **Memory** — learn creator/brand style (explicit guidelines + implicit
   habits), team-shared vs private preferences, recency weighting, when to
   apply vs not.
9. **Verification** — *"After the agent makes edits, how does it know if
   the output is good? There's no linter for video. We have to build one,
   something that can check technical basics (no glitches, audio in sync),
   but also whether the edit looks good, matches the brand, holds a story
   arc, has the right pacing. The bigger idea is closing the loop. If we
   tie this verifier to actual engagement data from social platforms, we
   can build an RL environment where the agent evolves automatically over
   time. The agent will then develop taste."*
10. **Version Control** — *"Code has git. Video has nothing, just
    'final_v3_actual (1).mp4'... What does a diff even look like for a
    timeline? How do you present a conflict in a way an editor can resolve
    without friction? The abstractions need to be powerful enough to handle
    real parallel workflows but intuitive enough that no one needs to
    understand git to use them."*

## How Cutroom maps (honest)

- Problems **10 + 09-layer-1** are what we're building: merge/diff core
  (done) + structural linter (done). Both are the deterministic,
  model-free halves.
- Problems **01, 02** are architecture constraints we respect (browser,
  proxy-first, Yjs boundary) but haven't proven with numbers yet.
- Problems **03–08 + 09-layer-2** (taste, RL from engagement) need models,
  data, and scale we don't have. Never claim these.

## Sources

- https://www.usecardboard.com/hard-problems (full text captured 2026-10-02)
- https://www.ycombinator.com/companies/cardboard and /launches/PM3-cardboard-agentic-video-editor
- Fondo START interview (YouTube, Aug 2026): Saksham on routing models,
  Cursor analogy, code-review framing
- Product Hunt launch: "Cursor for video editing", collab, content search,
  byte-chunk ingestion quote
- Third-party: yctierlist W26, altss, extruct (funding figure unverified)
