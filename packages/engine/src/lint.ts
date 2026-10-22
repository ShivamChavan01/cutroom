import {
  type Clip,
  type Millis,
  type Timeline,
  clipsOnTrack,
  overlaps,
} from "./model";

/**
 * The linter: automated checks over timeline structure.
 *
 * A rule is a pure function from a timeline to diagnostics. It never plays
 * media, never fetches anything, never guesses at intent — it inspects the
 * data and reports patterns that are broken or suspicious. The UI renders
 * the returned list (VS Code squiggles for video); the engine only produces it.
 *
 * The harness is the point more than any single rule: a new rule is one
 * `defineRule` call plus one entry in `BUILT_IN_RULES`. Rule 8 should cost
 * ten lines. Severity is assigned by the caller, not the rule, so an
 * "error" in one workflow (block export on missing media) can be a
 * "warning" in another (proxy-first editing where not-local-yet is normal).
 */

export type Severity = "error" | "warning";

/** Three frames at 30fps. Below this a clip is invisible at full speed. */
export const FLASH_FRAME_THRESHOLD_MS = 100;

/**
 * Root of a clip id.
 *
 * Splitting a clip replaces it with children whose ids embed the parent's
 * (`parent~4000~L`). Diagnostics that mention a child must still be
 * recognised as the *same* problem the parent had, otherwise every split
 * would report a phantom "resolved" plus a phantom "introduced".
 */
export function clipRootId(clipId: string): string {
  const separator = clipId.indexOf("~");
  return separator === -1 ? clipId : clipId.slice(0, separator);
}

/**
 * A diagnostic's stable identity: the rule, the clips involved (as roots,
 * sorted and de-duplicated) and, for rules about something other than clips
 * (an unused asset), a subject.
 *
 * Deliberately NOT included: the message text and the position. A moved
 * clip keeps its id, so its diagnostics keep their identity even though
 * the message and the marker move — that is what lets a diff of two
 * timelines say "this change did not introduce a new problem" instead of
 * reporting every diagnostic as new.
 */
export function diagnosticKey(
  rule: string,
  clipIds: readonly string[],
  subject?: string,
): string {
  const roots = [...new Set(clipIds.map(clipRootId))].sort();
  return `${rule}|${roots.join(",")}|${subject ?? ""}`;
}

export interface Diagnostic {
  /** Stable rule id, e.g. "overlap". Used for suppression and overrides. */
  readonly rule: string;
  /** Stable identity of this problem across two timelines. */
  readonly key: string;
  readonly severity: Severity;
  /** Clips involved, so the UI can highlight them. Empty for global issues. */
  readonly clipIds: readonly string[];
  /** Timeline position in ms, so the UI can place a marker. */
  readonly where?: Millis;
  readonly message: string;
}

export interface Rule {
  readonly id: string;
  readonly description: string;
  check(timeline: Timeline): Diagnostic[];
}

export function defineRule(
  id: string,
  description: string,
  check: (timeline: Timeline) => Diagnostic[],
): Rule {
  return { id, description, check };
}

export interface LintOptions {
  /** Run only these rule ids. Defaults to all built-in rules. */
  readonly include?: readonly string[];
  /** Skip these rule ids (e.g. a waived warning the editor accepted). */
  readonly exclude?: readonly string[];
  /** Per-rule severity override: caller decides what blocks vs warns. */
  readonly severity?: Readonly<Record<string, Severity>>;
}

/**
 * Run the rule set and return diagnostics sorted by position, then rule id,
 * so the UI renders a stable list between keystrokes.
 */
export function lint(timeline: Timeline, options: LintOptions = {}): Diagnostic[] {
  const rules = BUILT_IN_RULES.filter(
    (rule) =>
      (options.include === undefined || options.include.includes(rule.id)) &&
      (options.exclude === undefined || !options.exclude.includes(rule.id)),
  );
  const out: Diagnostic[] = [];
  for (const rule of rules) {
    const override = options.severity?.[rule.id];
    for (const diagnostic of rule.check(timeline)) {
      out.push(override === undefined || override === diagnostic.severity
        ? diagnostic
        : { ...diagnostic, severity: override });
    }
  }
  out.sort(
    (a, b) =>
      (a.where ?? Number.MAX_SAFE_INTEGER) - (b.where ?? Number.MAX_SAFE_INTEGER) ||
      (a.rule < b.rule ? -1 : 1),
  );
  return out;
}

export function errorsOnly(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === "error");
}

// ---------------------------------------------------------------------------
// Lint delta: what changed between two timelines
// ---------------------------------------------------------------------------

export interface LintDelta {
  /** Problems present after but not before, one per identity. */
  readonly introduced: readonly Diagnostic[];
  /** Problems present before but not after, one per identity. */
  readonly resolved: readonly Diagnostic[];
  /** How many problem identities exist in both. */
  readonly unchanged: number;
}

/**
 * Compare two timelines' diagnostics by identity.
 *
 * Counts are of *identities*, not raw diagnostics. Two diagnostics can
 * share an identity — a split that leaves both children overlapping the
 * same clip produces two diagnostics with one key — and for the question
 * this answers ("does this change make the project worse?") one identity
 * is the right unit.
 *
 * Splitting can never manufacture a new identity: children tile the parent
 * exactly, so any problem a child has, the parent had too. That is why the
 * key uses root clip ids.
 */
export function lintDelta(
  before: Timeline,
  after: Timeline,
  options: LintOptions = {},
): LintDelta {
  const byKey = (timeline: Timeline): Map<string, Diagnostic> => {
    const map = new Map<string, Diagnostic>();
    for (const diagnostic of lint(timeline, options)) {
      if (!map.has(diagnostic.key)) map.set(diagnostic.key, diagnostic);
    }
    return map;
  };
  const beforeByKey = byKey(before);
  const afterByKey = byKey(after);

  const introduced: Diagnostic[] = [];
  const resolved: Diagnostic[] = [];
  let unchanged = 0;
  for (const [key, diagnostic] of afterByKey) {
    if (beforeByKey.has(key)) unchanged += 1;
    else introduced.push(diagnostic);
  }
  for (const [key, diagnostic] of beforeByKey) {
    if (!afterByKey.has(key)) resolved.push(diagnostic);
  }
  return { introduced, resolved, unchanged };
}

// ---------------------------------------------------------------------------
// Built-in rules
// ---------------------------------------------------------------------------

const overlapRule = defineRule(
  "overlap",
  "Two clips cover the same time on one track; one of them goes unseen.",
  (timeline) => {
    const out: Diagnostic[] = [];
    for (const track of timeline.tracks) {
      const onTrack = clipsOnTrack(timeline, track.id);
      // Sweep with an active window: a clip whose end is behind the current
      // start can never overlap again, so it leaves instead of being rescanned.
      let active: Clip[] = [];
      for (const clip of onTrack) {
        active = active.filter((other) => other.start + other.duration > clip.start);
        for (const other of active) {
          if (!overlaps(other, clip)) continue;
          const start = Math.max(other.start, clip.start);
          const end = Math.min(
            other.start + other.duration,
            clip.start + clip.duration,
          );
          out.push({
            rule: "overlap",
            key: diagnosticKey("overlap", [other.id, clip.id]),
            severity: "error",
            clipIds: [other.id, clip.id],
            where: start,
            message:
              `${other.id} and ${clip.id} overlap by ${end - start}ms ` +
              `on track ${track.id}`,
          });
        }
        active.push(clip);
      }
    }
    return out;
  },
);

const gapRule = defineRule(
  "gap",
  "Dead air between consecutive clips on a track renders as a black flash.",
  (timeline) => {
    const out: Diagnostic[] = [];
    for (const track of timeline.tracks) {
      const onTrack = clipsOnTrack(timeline, track.id);
      for (let i = 0; i + 1 < onTrack.length; i++) {
        const current = onTrack[i]!;
        const next = onTrack[i + 1]!;
        const gapStart = current.start + current.duration;
        // Overlapping pairs belong to the overlap rule, not this one.
        if (next.start > gapStart) {
          out.push({
            rule: "gap",
            key: diagnosticKey("gap", [current.id, next.id]),
            severity: "warning",
            clipIds: [current.id, next.id],
            where: gapStart,
            message:
              `gap of ${next.start - gapStart}ms between ${current.id} ` +
              `and ${next.id} on track ${track.id}`,
          });
        }
      }
    }
    return out;
  },
);

const missingMediaRule = defineRule(
  "missing-media",
  "A clip references an asset with no record; export renders black.",
  (timeline) => {
    const out: Diagnostic[] = [];
    for (const clip of Object.values(timeline.clips)) {
      if (timeline.assets[clip.assetId] === undefined) {
        out.push({
          rule: "missing-media",
          key: diagnosticKey("missing-media", [clip.id]),
          severity: "error",
          clipIds: [clip.id],
          where: clip.start,
          message: `${clip.id} references unknown asset ${clip.assetId}`,
        });
      }
    }
    return out;
  },
);

const flashFrameRule = defineRule(
  "flash-frame",
  "A clip under ~3 frames is invisible at full speed; usually a bad cut.",
  (timeline) => {
    const out: Diagnostic[] = [];
    for (const clip of Object.values(timeline.clips)) {
      if (clip.duration > 0 && clip.duration < FLASH_FRAME_THRESHOLD_MS) {
        out.push({
          rule: "flash-frame",
          key: diagnosticKey("flash-frame", [clip.id]),
          severity: "warning",
          clipIds: [clip.id],
          where: clip.start,
          message: `${clip.id} is ${clip.duration}ms, below the flash-frame threshold`,
        });
      }
    }
    return out;
  },
);

const trimPastSourceRule = defineRule(
  "trim-past-source",
  "A clip reads footage beyond the end of its file; the player shows nothing.",
  (timeline) => {
    const out: Diagnostic[] = [];
    for (const clip of Object.values(timeline.clips)) {
      const asset = timeline.assets[clip.assetId];
      if (asset !== undefined && clip.inPoint + clip.duration > asset.duration) {
        out.push({
          rule: "trim-past-source",
          key: diagnosticKey("trim-past-source", [clip.id]),
          severity: "error",
          clipIds: [clip.id],
          where: clip.start,
          message:
            `${clip.id} reads to ${clip.inPoint + clip.duration}ms ` +
            `but ${clip.assetId} is only ${asset.duration}ms`,
        });
      }
    }
    return out;
  },
);

const zeroLengthRule = defineRule(
  "zero-length",
  "A clip with no duration is a dead entry; the reducer never creates one.",
  (timeline) => {
    const out: Diagnostic[] = [];
    for (const clip of Object.values(timeline.clips)) {
      if (clip.duration <= 0) {
        out.push({
          rule: "zero-length",
          key: diagnosticKey("zero-length", [clip.id]),
          severity: "error",
          clipIds: [clip.id],
          where: clip.start,
          message: `${clip.id} has non-positive duration ${clip.duration}ms`,
        });
      }
    }
    return out;
  },
);

const unusedAssetRule = defineRule(
  "unused-asset",
  "An asset no clip references is synced weight doing nothing.",
  (timeline) => {
    const referenced = new Set(
      Object.values(timeline.clips).map((clip) => clip.assetId),
    );
    const out: Diagnostic[] = [];
    for (const id of Object.keys(timeline.assets)) {
      if (!referenced.has(id)) {
        out.push({
          rule: "unused-asset",
          // No clips involved, so the asset id is the subject of the identity.
          key: diagnosticKey("unused-asset", [], id),
          severity: "warning",
          clipIds: [],
          message: `asset ${id} is not referenced by any clip`,
        });
      }
    }
    return out;
  },
);

export const BUILT_IN_RULES: readonly Rule[] = [
  overlapRule,
  gapRule,
  missingMediaRule,
  flashFrameRule,
  trimPastSourceRule,
  zeroLengthRule,
  unusedAssetRule,
];
