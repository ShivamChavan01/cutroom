import {beforeEach, expect, it, vi} from "vitest";
import {emptyTimeline, makeClip} from "@cutroom/engine";
import {useEditorStore} from "../store";
import {useVcsStore} from "../vcsStore";
import {useUiStore} from "../uiStore";
import {deleteSelected, splitAtPlayhead} from "./actions";
import {deleteMedia} from "./media/opfs";
vi.mock("./media/opfs", async original => ({...await original<typeof import("./media/opfs")>(), deleteMedia: vi.fn(async () => true)}));
beforeEach(() => {
  vi.clearAllMocks(); useUiStore.setState({lockedTrackIds: []});
  useEditorStore.getState().loadTimeline(emptyTimeline("Source retention"));
  useVcsStore.setState({repo: null, pending: null, diffOverlay: null});
  useVcsStore.getState().ensureRepo();
});
function addImport() {
  const e = useEditorStore.getState();
  e.addAsset({id: "source", kind: "video", duration: 2000});
  e.dispatch({type: "addClip", clip: makeClip({id: "imported", assetId: "source", trackId: "v1", start: 0, inPoint: 0, duration: 2000, volume: 1})});
  e.selectClip("imported");
  return useEditorStore.getState().timeline;
}
it.each([false, true])("deleting an import retains its source through Undo/Redo (committed: %s)", committed => {
  const imported = addImport(), e = useEditorStore.getState();
  if (committed) useVcsStore.getState().commitCurrent("Imported source");
  const repo = useVcsStore.getState().repo;
  expect(deleteSelected()).toBe(true);
  expect(useEditorStore.getState().timeline.clips.imported).toBeUndefined();
  expect(useEditorStore.getState().timeline.assets.source).toEqual(imported.assets.source);
  e.undo(); expect(useEditorStore.getState().timeline).toEqual(imported);
  e.redo(); expect(useEditorStore.getState().timeline.clips.imported).toBeUndefined();
  e.undo(); useVcsStore.getState().commitCurrent("Restored import");
  expect(useVcsStore.getState().repo?.commits[useVcsStore.getState().repo!.branches.main!]?.timeline).toEqual(imported);
  expect(repo?.commits.c0?.timeline.clips).toEqual({});
  expect(deleteMedia).not.toHaveBeenCalled();
});
it("deleting split descendants keeps their source and reverses through the same history", () => {
  const imported = addImport(), e = useEditorStore.getState();
  e.setPlayhead(1000); expect(splitAtPlayhead()).toBe(true);
  expect(deleteSelected()).toBe(true);
  expect(Object.keys(useEditorStore.getState().timeline.clips)).toHaveLength(0);
  e.undo(); expect(Object.keys(useEditorStore.getState().timeline.clips)).toHaveLength(2);
  e.undo(); expect(useEditorStore.getState().timeline).toEqual(imported);
  expect(deleteMedia).not.toHaveBeenCalled();
});
it("empty and locked selections cannot change the timeline or delete bytes", () => {
  expect(deleteSelected()).toBe(false); addImport(); useUiStore.setState({lockedTrackIds: ["v1"]});
  const before = useEditorStore.getState();
  expect(deleteSelected()).toBe(false); expect(useEditorStore.getState()).toBe(before);
  expect(deleteMedia).not.toHaveBeenCalled();
});
