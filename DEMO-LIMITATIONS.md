# Cutroom demo limitations

This is an engineering interview prototype. The tested workflow demonstrates
structured edits, comparison, conflict-aware merging and structural review.
It does not establish general commercial editor reliability.

- The improved local revision has not been committed, pushed or deployed during
  this review. The live site still runs `2481442`. Approve shipping and verify it
  before presenting the new recovery behavior as hosted functionality.
- Desktop Chrome is verified at 1440×900, 1366×768, 1280×800 and 1024×768. Full
  mobile editing is unsupported. Safari/Firefox and assistive-technology sessions
  were not tested. Existing narrow-screen notice remains.
- Pending merges restore only after the local save completes. Ordinary edits
  keep the existing 700ms debounce; merge updates request an immediate save.
  Closing/reloading before **saved**, browser crashes or revoked storage may lose
  unacknowledged writes. The interface reports save/unavailable/error states.
- Restore checks branch names/heads, common ancestor, working snapshot and every
  recorded decision. If those are stale or invalid, it preserves valid project
  history and edits, cancels that unusable session and explains recovery. Manual
  edits during a merge may require Cancel and restart. No automatic commit occurs.
- Pending commit-message draft text is not persisted. Resolution replay is bounded
  to 10,000 recorded decisions per session. Oversized or malformed sessions are
  rejected with a notice while valid project data remains available.
- Legacy saves without pending data still load. Rolling back to the older client
  can ignore the new pending field; do not expect that older client to resume it.
- Sample and personal data use separate IndexedDB keys, OPFS directories and view
  preferences. They share the browser origin's quota. Two tabs writing the same
  workspace still lack cross-tab synchronization; use one tab per workspace.
- Sample reset affects only that namespace and requires confirmation. Uploaded
  sample files remain in its OPFS directory. Browser storage is device/origin
  local, subject to quota and eviction, and is not a cloud backup.
- The normal restoration path scans the active history base. The bundled sample
  and active personal-upload refresh are proven. Arbitrary media exclusive to old
  commits or other branches, including non-bundled candidates in a pending merge,
  may need reimporting. This broader restoration behavior is not claimed fixed.
- Lint checks timeline structure. A gap can be intentional or covered by another
  track. No findings does not prove visual quality, audio quality, semantic
  correctness or delivery readiness. The checker never closes pauses automatically.
- Keep-middle/keep-ending removes the other clip. No resolver shifts clips to hide
  a conflict. The explicit deletion is appropriate for this demonstration; it is
  not a full visual trim/retiming conflict editor.
- MP4 rendering remains unavailable. Export produces timeline interchange files;
  it does not bundle source media or export the entire commit graph.
- AI availability/error checks use explicit HTTP fixtures and the actual client
  parser/UI. No paid model requests were made. Live generation quality, latency
  and current provider quota behavior were not verified in this pass. Hosted
  reviewer access and server-side credentials remain required and unchanged.
- Original sample media stays under 400 KB with documented CC0 provenance.
  Actual decoded video, seeking and audio waveforms are exercised. Headless checks
  do not prove audible sync, frame-exact presentation, dropped-frame rates or
  long-session memory stability. The sample is a motion study, not filmed scenes.
- No human study establishes 15-second comprehension or a two-minute completion.
  The revised copy and observed workflow support that aim; rehearse with a person.
