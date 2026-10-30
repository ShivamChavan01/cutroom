import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHistory, emptyTimeline } from "@cutroom/engine";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { createRepo } from "./vcs";
import { installDemoProject } from "./demo/load";
import { clearAssetUrls, resolveAssetUrl } from "./assets";
import { importMedia, uploadFiles } from "./upload";
import { usePersistenceStore } from "./persistence/persistenceStore";

let probeFails = false;
let imageFails = false;
let probeDuration = 2;
let probeHangs = false;
let probeDelayed = false;
let completeProbe: (() => void) | null = null;
const allocatedUrls: string[] = [];

class ProbeVideo {
  private url = "";
  preload = "";
  duration = probeDuration;
  videoWidth = 1280;
  videoHeight = 720;
  onloadedmetadata: (() => void) | null = null;
  onerror: (() => void) | null = null;

  get src(): string { return this.url; }

  set src(url: string) {
    this.url = url;
    if (probeHangs) return;
    const complete = () => {
      if (probeFails) this.onerror?.();
      else this.onloadedmetadata?.();
    };
    if (probeDelayed) completeProbe = complete;
    else queueMicrotask(complete);
  }

  removeAttribute(_name: string): void {}
  load(): void {}
}

class ProbeImage {
  naturalWidth = 1920;
  naturalHeight = 1080;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;

  set src(_url: string) {
    queueMicrotask(() => imageFails ? this.onerror?.() : this.onload?.());
  }

  removeAttribute(_name: string): void {}
}

describe("uploadFiles", () => {
  beforeEach(() => {
    probeFails = false;
    imageFails = false;
    probeDuration = 2;
    probeHangs = false;
    probeDelayed = false;
    completeProbe = null;
    useEditorStore.getState().loadTimeline(emptyTimeline("upload-test"));
    useVcsStore.setState({repo: null, pending: null, diffOverlay: null});
    clearAssetUrls();
    usePersistenceStore.getState().setMediaWarning(null);
    vi.stubGlobal("document", { createElement: () => new ProbeVideo() });
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("Image", ProbeImage);
    const createObjectURL = URL.createObjectURL;
    vi.spyOn(URL, "createObjectURL").mockImplementation((file) => {
      const url = createObjectURL(file);
      allocatedUrls.push(url);
      return url;
    });
  });

  afterEach(() => {
    for (const url of allocatedUrls.splice(0)) URL.revokeObjectURL(url);
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    clearAssetUrls();
  });

  it("keeps the uploaded media readable after probing its duration", async () => {
    const file = new File(["video bytes"], "demo.mp4", { type: "video/mp4" });
    const report = await uploadFiles([file]);
    expect(report.skipped).toEqual([]);
    expect(report.added).toHaveLength(1);
    const clip = Object.values(useEditorStore.getState().timeline.clips)[0];
    expect(clip?.duration).toBe(2_000);
    expect(useEditorStore.getState().timeline.assets[clip?.assetId ?? ""]).toMatchObject({ name: "demo.mp4", mimeType: "video/mp4", width: 1280, height: 720 });
    const url = clip === undefined ? undefined : resolveAssetUrl(clip.assetId);
    expect(url).toBeDefined();
    const response = await fetch(url ?? "");
    expect(await response.text()).toBe("video bytes");
  });

  it("revokes a rejected upload and reports it without adding clips", async () => {
    probeFails = true;
    const file = new File(["bad media"], "bad.mp4");
    const report = await uploadFiles([file]);
    expect(report.added).toEqual([]);
    expect(report.skipped).toEqual([
      { name: "bad.mp4", reason: expect.stringContaining("cannot read") },
    ]);
    expect(useEditorStore.getState().timeline.clips).toEqual({});
    await expect(fetch(allocatedUrls[0] ?? "")).rejects.toThrow();
  });

  it("does nothing for an empty selection and clears upload status", async () => {
    const onStatus = vi.fn();
    expect(await uploadFiles([], onStatus)).toEqual({
      added: [], skipped: [], storageWarning: null,
    });
    expect(onStatus).toHaveBeenCalledExactlyOnceWith(null);
    expect(allocatedUrls).toEqual([]);
  });

  it("appends multiple uploads and reuses the asset for duplicate media", async () => {
    const file = new File(["video bytes"], "demo.mp4");
    const report = await uploadFiles([file, file]);
    expect(report.skipped).toEqual([]);
    expect(new Set(report.added).size).toBe(2);
    const timeline = useEditorStore.getState().timeline;
    expect(Object.keys(timeline.assets)).toHaveLength(1);
    expect(Object.values(timeline.clips).map((clip) => clip.start)).toEqual([0, 2_000]);
  });

  it("keeps all selected files when the picker clears during probing", async () => {
    const file = new File(["video bytes"], "demo.mp4");
    const files = [file, file];
    const pending = uploadFiles(files);
    files.length = 0;

    const report = await pending;
    expect(report.skipped).toEqual([]);
    expect(report.added).toHaveLength(2);
    expect(Object.values(useEditorStore.getState().timeline.clips).map((clip) => clip.start))
      .toEqual([0, 2_000]);
  });

  it("imports an image graphic with its natural dimensions and a finite display duration", async () => {
    const file = new File(["png bytes"], "Map.png", { type: "image/png" });
    const report = await uploadFiles([file]);
    expect(report.skipped).toEqual([]);
    const [asset] = Object.values(useEditorStore.getState().timeline.assets);
    expect(asset).toMatchObject({ kind: "image", name: "Map.png", duration: 5_000, width: 1920, height: 1080, mimeType: "image/png" });
    const [clip] = Object.values(useEditorStore.getState().timeline.clips);
    expect(clip).toMatchObject({ trackId: "v1", duration: 5_000 });
    expect(await (await fetch(resolveAssetUrl(asset?.id ?? "") ?? "")).text()).toBe("png bytes");
  });

  it("recognizes image extensions when a picker does not supply a MIME type", async () => {
    const report = await uploadFiles([new File(["png bytes"], "map.PNG")]);
    expect(report.skipped).toEqual([]);
    expect(Object.values(useEditorStore.getState().timeline.assets)[0]?.kind).toBe("image");
  });

  it("places an audio source on the audio track", async () => {
    const report = await uploadFiles([new File(["audio bytes"], "Voice.wav", { type: "audio/wav" })]);
    expect(report.skipped).toEqual([]);
    expect(Object.values(useEditorStore.getState().timeline.assets)[0]?.kind).toBe("audio");
    expect(Object.values(useEditorStore.getState().timeline.clips)[0]?.trackId).toBe("a1");
  });

  it("reports invalid images and live streams without adding unusable clips", async () => {
    imageFails = true;
    probeDuration = Infinity;
    const report = await uploadFiles([new File(["bad"], "bad.png"), new File(["live"], "live.mp4")]);
    expect(report.added).toEqual([]);
    expect(report.skipped.map((item) => item.name)).toEqual(["bad.png", "live.mp4"]);
    expect(useEditorStore.getState().timeline.clips).toEqual({});
    for (const url of allocatedUrls) await expect(fetch(url)).rejects.toThrow();
  });

  it("finishes with a skipped file when metadata decoding never completes", async () => {
    vi.useFakeTimers();
    probeHangs = true;
    const pending = uploadFiles([new File(["stalled"], "stalled.mp4")]);
    await vi.advanceTimersByTimeAsync(10_000);
    const report = await pending;
    expect(report.added).toEqual([]);
    expect(report.skipped).toEqual([{ name: "stalled.mp4", reason: expect.stringContaining("cannot read") }]);
    expect(useEditorStore.getState().timeline.clips).toEqual({});
  });

  it("duplicate import retains existing tags and original source metadata", async () => {
    const file = new File(["video bytes"], "first.mp4");
    await uploadFiles([file]);
    const source = Object.values(useEditorStore.getState().timeline.assets)[0]!;
    useEditorStore.getState().dispatch({type: "setAssetTags", assetId: source.id, tags: ["keep"]});
    const report = await uploadFiles([new File(["video bytes"], "renamed.mp4")]);
    expect(report.skipped).toEqual([]);
    expect(useEditorStore.getState().timeline.assets[source.id]).toMatchObject({name: "first.mp4", tags: ["keep"]});
  });

  it("reports OPFS failures from the shared picker/drop entrypoint", async () => {
    vi.stubGlobal("navigator", {storage: {getDirectory: async () => {throw new DOMException("quota denied", "QuotaExceededError");}}});
    const report = await importMedia([new File(["video bytes"], "demo.mp4")]);
    expect(report.added).toHaveLength(1);
    expect(report.storageWarning).toBe("quota denied");
    expect(usePersistenceStore.getState().mediaWarning).toBe("quota denied");
  });

  it("reports corrupt and zero-duration imports without adding clips", async () => {
    probeDuration = 0;
    const report = await importMedia([new File([], "empty.mp4")]);
    expect(report.added).toEqual([]);
    expect(usePersistenceStore.getState().mediaWarning).toMatch(/skipped empty.mp4: cannot read/);
  });

  it("retains both skipped-file and session-only notices for mixed selections", async () => {
    imageFails = true;
    const report = await importMedia([new File(["bad"], "bad.png"), new File(["good"], "good.mp4")]);
    expect(report.added).toHaveLength(1);
    expect(usePersistenceStore.getState().mediaWarning).toMatch(/no private file system.*skipped bad.png/);
  });

  it("empty imports do not erase an existing restoration warning", async () => {
    usePersistenceStore.getState().setMediaWarning("older source is missing");
    expect(await importMedia([])).toEqual({added: [], skipped: [], storageWarning: null});
    expect(usePersistenceStore.getState().mediaWarning).toBe("older source is missing");
  });

  it.each(["checkout", "away-and-back", "detached", "reset", "restore", "fork", "merge", "fast-forward"])("cancels an import across %s without changing the destination timeline", async action => {
    const vcs = useVcsStore.getState(), editor = useEditorStore.getState();
    vcs.ensureRepo(); vcs.createBranch("alternate");
    if (action === "merge") {
      editor.dispatch({type: "renameProject", name: "Our cut"}); vcs.commitCurrent("Our cut"); vcs.checkoutBranch("alternate");
      editor.dispatch({type: "setFrameRate", fps: 25}); vcs.commitCurrent("Their fps"); vcs.checkoutBranch("main");
    }
    if (action === "fast-forward") {
      vcs.checkoutBranch("alternate"); editor.dispatch({type: "setFrameRate", fps: 25}); vcs.commitCurrent("Ahead"); vcs.checkoutBranch("main");
    }
    const initial = useEditorStore.getState().timeline;
    probeDelayed = true;
    const pending = importMedia([new File(["video bytes"], "main.mp4")]);
    if (action === "checkout" || action === "away-and-back") vcs.checkoutBranch("alternate");
    if (action === "away-and-back") vcs.checkoutBranch("main");
    if (action === "detached") vcs.viewCommit("c0");
    if (action === "reset") {editor.loadTimeline(initial); vcs.restoreRepo(createRepo(initial, "test"));}
    if (action === "restore") editor.restoreHistory(createHistory(initial));
    if (action === "fork") vcs.forkBranch("fork");
    if (action === "merge" || action === "fast-forward") vcs.beginMerge("alternate");
    const destination = useEditorStore.getState(), repo = useVcsStore.getState().repo, merge = useVcsStore.getState().pending;
    if (completeProbe === null) throw new Error("Expected pending metadata");
    completeProbe();
    const report = await pending;
    expect(report.added).toEqual([]);
    expect(report.skipped).toEqual([{name: "main.mp4", reason: expect.stringMatching(/canceled|finish.*merge/i)}]);
    expect(usePersistenceStore.getState().mediaWarning).toMatch(/main.mp4/);
    expect(useEditorStore.getState()).toBe(destination);
    expect(useVcsStore.getState().repo).toBe(repo); expect(useVcsStore.getState().pending).toBe(merge);
    await expect(fetch(allocatedUrls[0] ?? "")).rejects.toThrow();
  });

  it("cancels after a native storage await if checkout changed ownership", async () => {
    const vcs = useVcsStore.getState(); vcs.ensureRepo(); vcs.createBranch("alternate");
    let release: (() => void) | undefined;
    vi.stubGlobal("navigator", {storage: {getDirectory: async () => ({getDirectoryHandle: async () => ({getFileHandle: async () => ({createWritable: async () => ({write: async () => new Promise<void>(resolve => {release = resolve;}), close: async () => {}})})})})}});
    const pending = uploadFiles([new File(["video bytes"], "main.mp4")]);
    await vi.waitFor(() => expect(release).toBeDefined());
    vcs.checkoutBranch("alternate"); const destination = useEditorStore.getState();
    if (release === undefined) throw new Error("Expected native write"); release();
    expect((await pending).added).toEqual([]); expect(useEditorStore.getState()).toBe(destination);
    expect(resolveAssetUrl(Object.keys(destination.timeline.assets)[0] ?? "")).toBeUndefined();
  });

  it("keeps imports valid across ordinary edits, commits and branch creation in the same cut", async () => {
    const vcs = useVcsStore.getState(); vcs.ensureRepo(); probeDelayed = true;
    const pending = uploadFiles([new File(["video bytes"], "main.mp4")]);
    useEditorStore.getState().dispatch({type: "setFrameRate", fps: 25}); vcs.commitCurrent("While importing"); vcs.createBranch("later");
    if (completeProbe === null) throw new Error("Expected metadata"); completeProbe();
    expect((await pending).added).toHaveLength(1);
    expect(useEditorStore.getState().timeline.fps).toBe(25);
    expect(Object.keys(useVcsStore.getState().repo!.commits.c1!.timeline.assets)).toHaveLength(0);
  });

  it("allows concurrent imports without treating source registration as checkout", async () => {
    const reports = await Promise.all([uploadFiles([new File(["one"], "one.mp4")]), uploadFiles([new File(["two"], "two.mp4")])]);
    expect(reports.every(report => report.added.length === 1)).toBe(true);
    expect(Object.keys(useEditorStore.getState().timeline.assets)).toHaveLength(2);
    expect(Object.keys(useEditorStore.getState().timeline.clips)).toHaveLength(2);
  });

  it("does not allocate or probe media when a merge is already pending", async () => {
    installDemoProject(); useVcsStore.getState().beginMerge("alternate");
    const before = useEditorStore.getState();
    const report = await importMedia([new File(["video bytes"], "blocked.mp4")]);
    expect(report.added).toEqual([]);
    expect(report.skipped[0]?.reason).toMatch(/finish or cancel the merge/i);
    expect(allocatedUrls).toEqual([]); expect(useEditorStore.getState()).toBe(before);
  });

  it("retains the first file on its originating commit and cancels the rest after checkout", async () => {
    const vcs = useVcsStore.getState(); vcs.ensureRepo(); vcs.createBranch("alternate");
    const report = await uploadFiles([new File(["one"], "one.mp4"), new File(["two"], "two.mp4")], status => {
      if (status === "reading two.mp4…") {vcs.commitCurrent("First file"); vcs.checkoutBranch("alternate");}
    });
    expect(report.added).toHaveLength(1); expect(report.skipped.map(file => file.name)).toEqual(["two.mp4"]);
    expect(Object.keys(useEditorStore.getState().timeline.clips)).toHaveLength(0);
    const main = useVcsStore.getState().repo!.commits[useVcsStore.getState().repo!.branches.main!]!;
    expect(Object.values(main.timeline.assets).map(asset => asset.name)).toEqual(["one.mp4"]);
  });
});
