import {beforeEach, expect, it} from "vitest";
import {current} from "@cutroom/engine";
import {installDemoProject} from "./demo/load";
import {DEMO_VIDEO_ID} from "./demo/project";
import {useEditorStore} from "../store";
import {useVcsStore} from "../vcsStore";
import {deserializeProject, serializeProject, toHistory} from "./persistence/project";

beforeEach(() => installDemoProject());
it("#5 undoes the last tag action without touching unrelated clip edits", () => {
  const editor = useEditorStore.getState();
  const before = editor.timeline;
  editor.dispatch({type: "setAssetTags", assetId: DEMO_VIDEO_ID, tags: ["qa-tag"]});
  editor.undo(); expect(useEditorStore.getState().timeline).toEqual(before);
  editor.redo(); const tagged = useEditorStore.getState().timeline;
  expect(tagged.clips).toEqual(before.clips);
  expect(tagged.assets[DEMO_VIDEO_ID]?.tags).toEqual(["qa-tag"]);
  useVcsStore.getState().commitCurrent("Tag sample");
  const repo = useVcsStore.getState().repo!;
  const restored = deserializeProject(serializeProject({repo, history: useEditorStore.getState().history}));
  expect(current(toHistory(restored.history))).toEqual(tagged);
  useVcsStore.getState().checkoutBranch("alternate");
  expect(useEditorStore.getState().timeline.assets[DEMO_VIDEO_ID]?.tags).toBeUndefined();
  useVcsStore.getState().checkoutBranch("main");
  expect(useEditorStore.getState().timeline).toEqual(tagged);
});
it("registration cannot bypass metadata history, while undoing an import clip keeps its source", () => {
  const editor = useEditorStore.getState();
  expect(() => editor.addAsset({...editor.timeline.assets[DEMO_VIDEO_ID]!, tags: ["bypass"]})).toThrow(/edit operation/);
  editor.addAsset({id: "imported", kind: "audio", name: "sound.wav", duration: 1000});
  editor.dispatch({type: "addClip", clip: {id: "new", assetId: "imported", trackId: "a1", start: 7000, inPoint: 0, duration: 1000, outPoint: 1000, volume: 1}});
  editor.undo();
  expect(useEditorStore.getState().timeline.clips.new).toBeUndefined();
  expect(useEditorStore.getState().timeline.assets.imported).toBeDefined();
});
it("an unchanged tag submission does not hide the previous undoable edit", () => {
  const editor = useEditorStore.getState();
  const history = editor.history;
  editor.dispatch({type: "setAssetTags", assetId: DEMO_VIDEO_ID, tags: []});
  expect(useEditorStore.getState().history).toBe(history);
});

it("migrates legacy projects and rejects malformed tag operations without dropping raw data", () => {
  const repo = useVcsStore.getState().repo!;
  const raw = JSON.parse(serializeProject({repo, history: useEditorStore.getState().history}));
  raw.version = 1;
  expect(deserializeProject(JSON.stringify(raw)).version).toBe(2);
  raw.version = 2;
  raw.history.log.push({op: {type: "setAssetTags", assetId: DEMO_VIDEO_ID, tags: [42]}, author: "test", seq: raw.history.log.length});
  raw.history.cursor++;
  expect(() => deserializeProject(JSON.stringify(raw))).toThrow(/op log/);
});
