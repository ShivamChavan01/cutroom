import { useEditorStore } from "../../store";
import { useVcsStore } from "../../vcsStore";
import { useUiStore } from "../../uiStore";
import { useProductionStore } from "../../productionStore";

export function captureAssistantScope() {
  const editor = useEditorStore.getState(), vcs = useVcsStore.getState(), production = useProductionStore.getState();
  return { timeline: editor.timeline, history: editor.history, sessionId: editor.sessionId, selectionRevision: editor.selectionRevision,
    selectedClipId: editor.selectedClipId, playheadMs: editor.playheadMs, repo: vcs.repo, pending: vcs.pending,
    production: production.document, productionRevision: production.revision, lockedTrackIds: useUiStore.getState().lockedTrackIds };
}

export function assistantScopeIsCurrent(scope: ReturnType<typeof captureAssistantScope>): boolean {
  const current = captureAssistantScope();
  // The playhead guides retrieval when sending, but seeking does not change
  // the cut or the clip IDs targeted by an already generated proposal.
  const keys = ["timeline", "history", "sessionId", "selectionRevision", "selectedClipId", "repo", "pending", "production", "productionRevision", "lockedTrackIds"] as const;
  return current.pending === null && keys.every(key => current[key] === scope[key]);
}
