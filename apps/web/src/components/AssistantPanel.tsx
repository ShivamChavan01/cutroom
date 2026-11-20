import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronRight, FileText, X } from "lucide-react";
import { useShallow } from "zustand/shallow";
import { lint, type Op } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useUiStore } from "../uiStore";
import { useVcsStore } from "../vcsStore";
import { assistantConfiguration, requestProposal } from "../lib/assistant/request";
import type { previewPlan } from "../lib/assistant/proposal";
import { Button } from "./ui/button";
import { useProductionStore } from "../productionStore";
import { ProductionContextPanel } from "./ProductionContextPanel";
import { assistantScopeIsCurrent, captureAssistantScope } from "../lib/assistant/scope";
import { type ConversationMessage } from "../lib/assistant/conversation";
import type { DiffOverlay } from "../vcsStore";
import { indexedClipCount } from "../lib/clipIndex";

type Proposal = ReturnType<typeof previewPlan>;
type State = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; proposal: Proposal; scope: ReturnType<typeof captureAssistantScope> } | { kind: "error"; message: string } | { kind: "applied"; count: number };

export function AssistantAvailability({ configuration, error, empty, findings, needsCode }: {
  configuration: Awaited<ReturnType<typeof assistantConfiguration>> | null;
  error: string | null; empty: boolean; findings: number; needsCode: boolean;
}) {
  return <div aria-live="polite" className="assistant-availability">
    {error !== null ? <p role="status" className="assistant-error">Assistant unavailable. {error}</p> : configuration === null ? <p role="status">Checking assistant availability…</p> : !configuration.configured ? <p role="status">Assistant unavailable: server configuration is required. Contact the project owner.</p> : <>
      <p role="status">{configuration.provider} assistant available · {configuration.model}</p>
      {needsCode && <p>Reviewer access code required before requesting an explanation.</p>}
    </>}
    {empty ? <p>Add clips or open the sample project before requesting verification advice.</p> : findings === 0 && <p>No structural findings to explain. You can ask about the sequence; this does not verify its visual or audio quality.</p>}
  </div>;
}

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
    {proposal.production !== null && <div className="assistant-verification" aria-label="Production requirement preview">
      <h3>Production requirements after this proposal</h3>
      {proposal.production.after.map(check => <p key={check.id}>{check.label}: {check.status === "pass" ? "placement check passed" : check.status === "fail" ? "requirement violated" : "human review needed"}. {check.message}</p>)}
      {proposal.production.regression !== null && <p role="alert" className="assistant-error">{proposal.production.regression}</p>}
    </div>}
  </div>;
}

export function AssistantPanel({ active = true }: { readonly active?: boolean }) {
  const timeline = useEditorStore(state => state.timeline);
  const pendingMerge = useVcsStore(state => state.pending);
  const repo = useVcsStore(state => state.repo);
  const diffOverlay = useVcsStore(state => state.diffOverlay);
  const production = useProductionStore(state => state.document);
  const productionRevision = useProductionStore(state => state.revision);
  const projectEpoch = useProductionStore(state => state.projectEpoch);
  const locks = useUiStore(state => state.lockedTrackIds);
  const editorScope = useEditorStore(useShallow(state => ({ history: state.history, sessionId: state.sessionId, selectionRevision: state.selectionRevision })));
  const isPlaying = useEditorStore(state => state.isPlaying);
  const issues = useMemo(() => lint(timeline), [timeline]);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<readonly ConversationMessage[]>([]);
  const [accessCode, setAccessCode] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [productionDraftDirty, setProductionDraftDirty] = useState(false);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [configuration, setConfiguration] = useState<Awaited<ReturnType<typeof assistantConfiguration>> | null>(null);
  const [configurationError, setConfigurationError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const ownedPreview = useRef<DiffOverlay | null>(null);
  const conversation = useRef<HTMLDivElement | null>(null);
  const latestMessage = useRef<HTMLElement | null>(null);
  const promptInput = useRef<HTMLTextAreaElement | null>(null);
  const contextToggle = useRef<HTMLButtonElement | null>(null);
  const closeContextButton = useRef<HTMLButtonElement | null>(null);
  const closeContext = () => {
    setContextOpen(false);
    contextToggle.current?.focus();
  };
  const clearPreview = () => {
    if (ownedPreview.current !== null && useVcsStore.getState().diffOverlay === ownedPreview.current) {
      useVcsStore.getState().clearDiff();
      if (useUiStore.getState().editorTab === "diff") useUiStore.getState().openTab("timeline");
    }
    ownedPreview.current = null;
  };
  useEffect(() => {
    controller.current?.abort(); clearPreview();
    setState({ kind: "idle" }); setMessages([]); setPrompt(""); setContextOpen(false); setProductionDraftDirty(false);
  }, [projectEpoch]);
  useEffect(() => () => { controller.current?.abort(); clearPreview(); }, []);
  useEffect(() => {
    const log = conversation.current;
    if (active && !contextOpen && log !== null) {
      log.scrollTop = state.kind === "ready" ? latestMessage.current?.offsetTop ?? log.scrollHeight : log.scrollHeight;
    }
  }, [active, contextOpen, messages, state.kind]);
  useEffect(() => { if (contextOpen) closeContextButton.current?.focus(); }, [contextOpen]);
  useEffect(() => {
    if (!active || configuration !== null || configurationError !== null) return;
    const load = new AbortController();
    void assistantConfiguration(load.signal).then(config => {
      if (!load.signal.aborted) setConfiguration(config);
    }).catch((cause: unknown) => {
      if (!load.signal.aborted) setConfigurationError(cause instanceof Error ? cause.message : "Could not read the AI provider configuration.");
    });
    return () => load.abort();
  }, [active, configuration, configurationError]);
  const request = async () => {
    controller.current?.abort(); clearPreview();
    const active = new AbortController();
    controller.current = active;
    const question = prompt.trim();
    setMessages(previous => previous.concat({ role: "user", content: question }).slice(-100));
    setPrompt(""); setState({ kind: "loading" });
    const scope = captureAssistantScope();
    try {
      const proposal = await requestProposal({ prompt: question, before: scope.timeline, selectedClipId: scope.selectedClipId, playheadMs: scope.playheadMs, lockedTrackIds: scope.lockedTrackIds, accessCode, production: scope.production, conversation: messages }, active.signal);
      if (!active.signal.aborted) {
        setMessages(previous => previous.concat({ role: "assistant", content: `${proposal.summary}\n${proposal.ops.length} ${proposal.ops.length === 1 ? "edit" : "edits"} proposed. Changes require explicit Apply.` }).slice(-100));
        setState({ kind: "ready", proposal, scope });
      }
    } catch (cause) {
      if (!active.signal.aborted) { setPrompt(question); setState({ kind: "error", message: cause instanceof Error ? cause.message : "Could not generate a proposal." }); }
    }
  };
  const apply = () => {
    if (state.kind !== "ready" || useEditorStore.getState().isPlaying || productionDraftDirty) return;
    try {
      if (useVcsStore.getState().pending !== null) throw new Error("Finish or cancel the merge before applying an AI proposal.");
      if (!assistantScopeIsCurrent(state.scope)) throw new Error("The editing or production context changed. Request a new proposal.");
      useEditorStore.getState().applyProposal(state.proposal.before, state.proposal.ops);
      clearPreview();
      setMessages(previous => previous.concat({ role: "assistant", content: `Applied ${state.proposal.ops.length} ${state.proposal.ops.length === 1 ? "edit" : "edits"}. Undo reverses one edit at a time.` }).slice(-100));
      setState({ kind: "applied", count: state.proposal.ops.length });
    } catch (cause) { setState({ kind: "error", message: cause instanceof Error ? cause.message : "Could not apply the proposal." }); }
  };
  const stale = useMemo(() => state.kind === "ready" && !assistantScopeIsCurrent(state.scope), [state, timeline, editorScope, repo, pendingMerge, productionRevision, locks]);
  useEffect(() => { if (stale) clearPreview(); }, [stale]);
  const empty = indexedClipCount(timeline) === 0;
  const changed = state.kind === "ready" && state.proposal.diff.changes.length > 0;
  const previewShown = diffOverlay !== null && diffOverlay === ownedPreview.current;
  const proposalStatus = stale ? "Context changed. Request a new proposal."
    : state.kind === "ready" && state.proposal.production?.regression != null ? "Blocked by production requirements"
    : isPlaying && changed ? "Pause playback to apply."
    : previewShown ? "Viewer plays the current cut." : null;
  const sendDisabled = productionDraftDirty || empty || !prompt.trim() || state.kind === "loading" || pendingMerge !== null || configuration === null || !configuration.configured || (configuration.accessRequired && !accessCode.trim());
  const ask = (question: string) => { setPrompt(question); promptInput.current?.focus(); };
  const sendLabel = production === null ? "Explain & propose fixes" : "Review production & propose edits";
  return <section className="assistant-panel" aria-label="AI verification assistant">
    <button ref={contextToggle} type="button" className="agent-context-summary" aria-label="Edit brief and references" aria-expanded={contextOpen} aria-controls="agent-context-editor" onClick={() => contextOpen ? closeContext() : setContextOpen(true)}>
      <FileText size={15} aria-hidden /><span><strong>Brief &amp; references</strong>{productionDraftDirty && <span>Unsaved changes</span>}</span>
      <ChevronRight size={14} aria-hidden />
    </button>
    <div id="agent-context-editor" className="agent-context-editor" hidden={!contextOpen}>
      <button ref={closeContextButton} type="button" className="agent-context-close" onClick={closeContext} aria-label="Close context editor"><X size={14} aria-hidden /> Back to chat</button>
      <ProductionContextPanel key={projectEpoch} onDraftChange={setProductionDraftDirty} onSaved={closeContext} query={prompt} />
    </div>
    <div ref={conversation} className="agent-conversation" hidden={contextOpen} aria-label="Assistant conversation" role="log" aria-live="polite">
      {messages.length === 0 && <div className="agent-welcome"><h3>Ask about this cut</h3>
        <div className="agent-starters"><button type="button" onClick={() => ask("Explain the current verification issues and propose the smallest safe fixes. Preserve my footage.")}>Check this cut <ChevronRight size={13} /></button>{production !== null && <button type="button" onClick={() => ask("Review this cut against the saved production brief, reference directions and continuity requirements. Cite source evidence and identify uncertainty.")}>Review against the brief <ChevronRight size={13} /></button>}</div>
      </div>}
      {messages.map((message, index) => <article ref={index === messages.length - 1 ? latestMessage : undefined} className={`agent-message is-${message.role}`} key={index}><span>{message.role === "user" ? "You" : "Assistant"}</span><p>{message.content}</p></article>)}
      {state.kind === "loading" && <p role="status" className="agent-working">Reviewing your sequence…</p>}
      {state.kind === "ready" && <details className="agent-proposal-details"><summary>Review changes and checks</summary><ProposalReview proposal={state.proposal} /></details>}
      {state.kind === "error" && <p role="alert" className="assistant-error">{state.message}</p>}
      {state.kind === "applied" && <p role="status">Applied {state.count} {state.count === 1 ? "edit" : "edits"}. Review them in Versions; use Undo to reverse one edit at a time.</p>}
    </div>
    <footer className="agent-chat-footer" hidden={contextOpen}>
      {state.kind === "ready" && <div className="agent-proposal-bar" aria-label="Proposal actions">
        <div>
          <strong>{state.proposal.ops.length === 0 ? "Review complete" : `${state.proposal.ops.length} proposed ${state.proposal.ops.length === 1 ? "edit" : "edits"}`}</strong>
          {proposalStatus !== null && <span role="status">{proposalStatus}</span>}
        </div>
        <div className="assistant-actions">
          {changed && <Button size="sm" variant="outline" aria-label="Show changes on timeline" aria-pressed={previewShown} disabled={stale || productionDraftDirty || pendingMerge !== null} onClick={() => {
            if (state.kind !== "ready" || !assistantScopeIsCurrent(state.scope)) return;
            if (previewShown) { clearPreview(); return; }
            useVcsStore.getState().setDiff(state.proposal.before, "Current cut", state.proposal.after, "Assistant proposal");
            ownedPreview.current = useVcsStore.getState().diffOverlay;
            useUiStore.getState().openTab("timeline");
          }}>Show changes</Button>}
          {state.proposal.ops.length > 0 && <Button size="sm" aria-label={`Apply ${state.proposal.ops.length} proposed ${state.proposal.ops.length === 1 ? "edit" : "edits"}`} onClick={apply} disabled={productionDraftDirty || stale || isPlaying || !changed || pendingMerge !== null || state.proposal.production?.regression != null}>Apply</Button>}
          <Button size="sm" variant="ghost" onClick={() => { clearPreview(); setState({ kind: "idle" }); setMessages(previous => previous.concat({ role: "assistant", content: "Proposal dismissed. No edits applied." }).slice(-100)); }}>Dismiss</Button>
        </div>
      </div>}
      {productionDraftDirty && <p role="status" className="agent-inline-status">Save production changes before requesting or applying edits.</p>}
      {pendingMerge !== null && <p role="status" className="agent-inline-status">Finish or cancel the merge to use the assistant.</p>}
      {(configurationError !== null || configuration?.configured === false || empty) && <AssistantAvailability configuration={configuration} error={configurationError} empty={empty} findings={issues.length} needsCode={false} />}
      {configuration?.accessRequired && <div className="agent-access-control"><AssistantAccessCode value={accessCode} onChange={setAccessCode} /></div>}
      <form onSubmit={event => { event.preventDefault(); if (!sendDisabled) void request(); }}>
        <label className="sr-only" htmlFor="assistant-prompt">What needs attention?</label>
        <div className="agent-composer"><textarea ref={promptInput} id="assistant-prompt" value={prompt} maxLength={2000} rows={1} placeholder="Ask about the cut…" disabled={state.kind === "loading"} onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!sendDisabled) void request(); } }} />
          {state.kind === "loading" ? <Button type="button" size="sm" variant="outline" onClick={() => { controller.current?.abort(); setState({ kind: "idle" }); setMessages(previous => previous.concat({ role: "assistant", content: "Request canceled. No edits applied." }).slice(-100)); }}>Cancel</Button> : <Button type="submit" size="sm" aria-label={sendLabel} disabled={sendDisabled}>Send <ArrowUp size={14} /></Button>}
        </div>
      </form>
      <details className="agent-request-details"><summary>{issues.length} {issues.length === 1 ? "finding" : "findings"} · Request details</summary>
        <AssistantAvailability configuration={configuration} error={configurationError} empty={empty} findings={issues.length} needsCode={configuration?.accessRequired === true && !accessCode.trim()} />
        <p className="assistant-disclosure">Sends your prompt, recent conversation, clip and asset names, timing and verification findings{production !== null ? ", production brief, reference directions, requirements and retrieved user-provided source notes" : ""} to {configuration?.provider ?? "the configured AI provider"}. Media files stay on this computer. The assistant cannot watch or listen to footage. Only recent conversation is sent; save lasting instructions in Context.</p>
      </details>
    </footer>
  </section>;
}
