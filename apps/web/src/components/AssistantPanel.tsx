import { useEffect, useMemo, useRef, useState } from "react";
import { lint, type Op } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { useVcsStore } from "../vcsStore";
import { assistantConfiguration, requestProposal } from "../lib/assistant/request";
import type { previewPlan } from "../lib/assistant/proposal";
import { Button } from "./ui/button";

type Proposal = ReturnType<typeof previewPlan>;
type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; proposal: Proposal } | { kind: "error"; message: string } | { kind: "applied"; count: number };

export function AssistantAccessCode({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div>
    <label htmlFor="assistant-access-code">Assistant access code</label>
    <input id="assistant-access-code" className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground" type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} />
    <p className="assistant-disclosure">Ask the project owner for the demo access code. It stays in this panel until you reload.</p>
  </div>;
}

function describeEdit(op: Op) {
  switch (op.type) {
    case "moveClip": return `Move ${op.clipId} to ${(op.start / 1000).toFixed(2)}s${op.trackId === undefined ? "" : ` on ${op.trackId}`}`;
    case "trimClip": return `Trim ${op.clipId}${op.inPoint === undefined ? "" : ` · source in ${(op.inPoint / 1000).toFixed(2)}s`}${op.duration === undefined ? "" : ` · duration ${(op.duration / 1000).toFixed(2)}s`}`;
    case "splitClip": return `Split ${op.clipId} at ${(op.at / 1000).toFixed(2)}s into the clip`;
    case "deleteClip": return `Delete ${op.clipId}`;
    case "setVolume": return `Set ${op.clipId} volume to ${Math.round(op.volume * 100)}%`;
    case "setTransform": return `Transform ${op.clipId}: ${Object.entries(op).filter(([key]) => key !== "type" && key !== "clipId").map(([key, value]) => `${key} ${value}`).join(", ")}`;
    default: return op.type;
  }
}

export function ProposalReview({ proposal }: { proposal: Proposal }) {
  const { verification, diff } = proposal;
  return <div className="assistant-review">
    <h3>Proposed fix</h3>
    <p className="assistant-explanation">{proposal.summary}</p>
    {proposal.ops.length === 0 ? <p>Explanation only. No edits proposed.</p> : <>
      <ol className="assistant-edits">{proposal.ops.map((op, index) => <li key={index}>{describeEdit(op)}</li>)}</ol>
      <p>{diff.changed} clips changed · {diff.removed} removed · {diff.added} added</p>
    </>}
    <div className="assistant-verification" aria-label="Proposal verification">
      <h3>Verification preview</h3>
      <p>{verification.resolved.length} resolved · {verification.introduced.length} introduced · {verification.unchanged} unchanged</p>
      {verification.introduced.length > 0 && <p className="text-destructive">This proposal introduces issues. Review them before applying.</p>}
      {verification.resolved.slice(0, 10).map((issue) => <p key={`resolved-${issue.key}`}>Resolved: {issue.message}</p>)}
      {verification.introduced.slice(0, 10).map((issue) => <p key={`new-${issue.key}`}>New {issue.severity}: {issue.message}</p>)}
      {(verification.resolved.length > 10 || verification.introduced.length > 10) && <p>Showing the first 10 findings in each group. Check Issues after applying for the full result.</p>}
    </div>
  </div>;
}

export function AssistantPanel() {
  const timeline = useEditorStore((state) => state.timeline);
  const pendingMerge = useVcsStore((state) => state.pending);
  const issues = useMemo(() => lint(timeline), [timeline]);
  const [prompt, setPrompt] = useState("Explain the current verification issues and propose the smallest safe fixes. Preserve my footage.");
  const [accessCode, setAccessCode] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof assistantConfiguration>> | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); }, []);
  useEffect(() => {
    const active = new AbortController();
    void assistantConfiguration(active.signal).then((config) => {
      if (!active.signal.aborted) setConfiguration(config);
    }).catch((cause: unknown) => {
      if (!active.signal.aborted) setConfigurationError(cause instanceof Error ? cause.message : "Could not read the AI provider configuration.");
    });
    return () => active.abort();
  }, []);
  const request = async () => {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setState({ kind: "loading" });
    const store = useEditorStore.getState();
    try {
      const proposal = await requestProposal({ prompt, before: store.timeline, selectedClipId: store.selectedClipId, playheadMs: store.playheadMs, lockedTrackIds: useUiStore.getState().lockedTrackIds, accessCode }, active.signal);
      if (!active.signal.aborted) setState({ kind: "ready", proposal });
    } catch (cause) {
      if (!active.signal.aborted) setState({ kind: "error", message: cause instanceof Error ? cause.message : "Could not generate a proposal." });
    }
  };
  const apply = () => {
    if (state.kind !== "ready") return;
    try {
      if (useVcsStore.getState().pending !== null) throw new Error("Finish or cancel the merge before applying an AI proposal.");
      useEditorStore.getState().applyProposal(state.proposal.before, state.proposal.ops);
      setState({ kind: "applied", count: state.proposal.ops.length });
    } catch (cause) { setState({ kind: "error", message: cause instanceof Error ? cause.message : "Could not apply the proposal." }); }
  };
  const stale = state.kind === "ready" && state.proposal.before !== timeline;
  const changed = state.kind === "ready" && state.proposal.diff.changes.length > 0;
  return <section className="assistant-panel" aria-label="AI verification assistant">
    <div className="panel-heading"><h2>Assistant</h2><span title={configuration?.model}>{configuration?.provider ?? "AI provider"}</span></div>
    <h3>Explain verification issues</h3>
    <p>Explain verification findings and review suggested edits before changing your timeline.</p>
    <div className="assistant-issue-count">{issues.length} current {issues.length === 1 ? "finding" : "findings"}</div>
    <form onSubmit={(event) => { event.preventDefault(); void request(); }}>
      {configuration?.accessRequired && <AssistantAccessCode value={accessCode} onChange={setAccessCode} />}
      <label htmlFor="assistant-prompt">What needs attention?</label>
      <textarea id="assistant-prompt" value={prompt} maxLength={2000} rows={5} disabled={state.kind === "loading"} onChange={(event) => setPrompt(event.target.value)} />
      <p className="assistant-disclosure">Sends your prompt, clip and asset names, timing and verification findings to {configuration?.provider ?? "the configured AI provider"}. Media files stay on this computer. The assistant cannot watch or listen to footage.</p>
      {configurationError !== null && <p role="status" className="assistant-error">{configurationError}</p>}
      {configuration !== null && !configuration.configured && <p role="status" className="assistant-error">The assistant needs server configuration. Contact the project owner.</p>}
      <div className="assistant-actions"><Button type="submit" disabled={!prompt.trim() || state.kind === "loading" || pendingMerge !== null || configuration === null || !configuration.configured || (configuration.accessRequired && !accessCode.trim())}>{state.kind === "loading" ? "Reviewing issues…" : "Explain & propose fixes"}</Button>
        {state.kind === "loading" && <Button type="button" variant="outline" onClick={() => { controller.current?.abort(); setState({ kind: "idle" }); }}>Cancel</Button>}
      </div>
    </form>
    {pendingMerge !== null && <p role="status">Finish or cancel the merge to use the assistant.</p>}
    <div aria-live="polite">
      {state.kind === "error" && <p role="alert" className="assistant-error">{state.message}</p>}
      {state.kind === "applied" && <p role="status">Applied {state.count} {state.count === 1 ? "edit" : "edits"}. Review them in Versions; use Undo to reverse one edit at a time.</p>}
      {state.kind === "ready" && <>
        <ProposalReview proposal={state.proposal} />
        {stale && <p role="status">The timeline changed. Generate a new proposal before applying.</p>}
        {state.proposal.ops.length > 0 && <Button onClick={apply} disabled={stale || !changed || pendingMerge !== null}>Apply {state.proposal.ops.length} proposed {state.proposal.ops.length === 1 ? "edit" : "edits"}</Button>}
        {changed && <p className="assistant-disclosure">Recorded as normal edits on your current version. Undo reverses one edit at a time.</p>}
      </>}
    </div>
  </section>;
}
