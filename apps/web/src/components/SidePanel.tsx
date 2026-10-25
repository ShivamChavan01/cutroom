import { useEffect, useState } from "react";
import { type Asset, diffTimelines } from "@cutroom/engine";
import { useAssetUrls } from "../lib/assets";
import { useVcsStore } from "../vcsStore";
import { currentCommit } from "../lib/vcs";
import { clipForMedia, filterMediaAssets, mediaLabel, mediaTags, parseMediaTags } from "../lib/mediaLibrary";
import { VersionControl } from "./VersionControl";
import { CommitGraph } from "./CommitGraph";
import { DiagnosticsPanel } from "./DiagnosticsPanel";
import { formatBytes, mediaUsage as readMediaUsage } from "../lib/media/opfs";
import { useEditorStore } from "../store";
import { formatTime } from "../theme";
import { useUiStore } from "../uiStore";
import { Button } from "./ui/button";
import { Film, Grid2X2, History, Image as ImageIcon, GitBranch, List, Music, Search, Tag, Upload, X } from "lucide-react";
import { UploadButton } from "./UploadButton";
import { MediaPoster } from "./MediaPoster";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs";
function LibraryPoster({ asset }: { asset: Asset }) {
  const source = useAssetUrls((urls) => urls.get(asset.id));
  if (asset.kind === "image" && source !== undefined) {
    return <img className="media-poster-image" src={source} alt="" />;
  }
  if (asset.kind === "audio") return <div className="media-poster-fallback"><Music size={26} aria-hidden /></div>;
  return <MediaPoster assetId={asset.id} />;
}

function SequenceLibrary() {
  const repo = useVcsStore((state) => state.repo);
  const timeline = useEditorStore((state) => state.timeline);
  const setRail = useUiStore((state) => state.setRail);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => useVcsStore.getState().ensureRepo(), []);

  const view = (branch: string, commitId?: string) => {
    if (repo === null) return;
    const changes = diffTimelines(currentCommit(repo).timeline, timeline);
    const dirty = changes.changes.length + (changes.metadataChanges?.length ?? 0) > 0;
    if (dirty && !window.confirm("This version has uncommitted edits. Switch without saving them?")) return;
    try {
      if (commitId === undefined) useVcsStore.getState().checkoutBranch(branch);
      else useVcsStore.getState().viewCommit(commitId);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not open this version.");
    }
  };

  return (
    <div className="library-sequences">
      <div className="panel-heading"><h2>Saved versions</h2><Button size="sm" onClick={() => setRail("versions")}>Save version</Button></div>
      {error !== null && <p role="alert" className="library-error">{error}</p>}
      {repo === null ? <p className="library-empty">No saved versions yet.</p> : (
        <ul className="sequence-list">
          {Object.entries(repo.branches).map(([name, id]) => (
            <li key={name}>
              <button className="sequence-item" aria-current={repo.currentBranch === name && repo.detachedAt === null ? "true" : undefined} onClick={() => view(name)}>
                <GitBranch size={15} aria-hidden /><span>{name}<small>{repo.commits[id]?.message}</small></span><code>{id}</code>
              </button>
            </li>
          ))}
          {Object.values(repo.commits).sort((a, b) => b.at - a.at).map((commit) => (
            <li key={commit.id}>
              <button className="sequence-item sequence-snapshot" onClick={() => view(repo.currentBranch, commit.id)}>
                <History size={14} aria-hidden /><span>{commit.message}<small>{commit.author}</small></span><code>{commit.id}</code>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MediaPanel() {
  const timeline = useEditorStore((state) => state.timeline);
  const selectedClipId = useEditorStore((state) => state.selectedClipId);
  const entries = Object.values(timeline.assets);
  const [section, setSection] = useState<"footage" | "sequences" | "graphics">("footage");
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [focusedAsset, setFocusedAsset] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaUsage, setMediaUsage] = useState<{ files: number; bytes: number } | null>(null);
  const selectedAsset = (selectedClipId === null ? undefined : timeline.clips[selectedClipId]?.assetId) ?? focusedAsset;
  const visible = section === "sequences" ? [] : filterMediaAssets(entries, { section, query, tag });
  const tags = mediaTags(entries);

  useEffect(() => {
    let current = true;
    void readMediaUsage().then((usage) => { if (current) setMediaUsage(usage); });
    return () => { current = false; };
  }, [entries.length]);

  const selectMedia = (asset: Asset) => {
    setFocusedAsset(asset.id);
    const clip = Object.values(useEditorStore.getState().timeline.clips)
      .filter((item) => item.assetId === asset.id).sort((a, b) => a.start - b.start)[0];
    useEditorStore.getState().selectClip(clip?.id ?? null);
    if (clip !== undefined) useEditorStore.getState().setPlayhead(clip.start);
  };

  const addMedia = (asset: Asset) => {
    try {
      const store = useEditorStore.getState();
      const clip = clipForMedia(store.timeline, asset.id);
      store.dispatch({ type: "addClip", clip });
      store.selectClip(clip.id);
      store.setPlayhead(clip.start);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this media.");
    }
  };

  const editTags = (asset: Asset) => {
    const input = window.prompt("Tags separated by commas", asset.tags?.join(", ") ?? "");
    if (input === null) return;
    try {
      useEditorStore.getState().addAsset({ ...asset, tags: parseMediaTags(input) });
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update media tags.");
    }
  };

  return (
    <Tabs value={section} onValueChange={(value) => { if (value === "footage" || value === "sequences" || value === "graphics") { setSection(value); setTag(""); } }} className="media-panel">
      <div className="library-toolbar">
        <TabsList variant="line" aria-label="Media library">
          {(["footage", "sequences", "graphics"] as const).map((id) => (
            <TabsTrigger key={id} value={id}>
              {id === "footage" ? "Footage" : id === "sequences" ? "Sequences" : "Graphics"}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="library-view-toggle" aria-label="Media layout">
          <button aria-label="Grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 size={15} aria-hidden /></button>
          <button aria-label="List view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={15} aria-hidden /></button>
        </div>
      </div>
      <TabsContent value={section}>
      {section === "sequences" ? <SequenceLibrary /> : (
        <>
          <div className="library-search"><Search size={14} aria-hidden /><input aria-label="Search media" placeholder="Search footage…" value={query} onChange={(event) => setQuery(event.target.value)} />{query !== "" && <button aria-label="Clear search" onClick={() => setQuery("")}><X size={13} aria-hidden /></button>}</div>
          <div className="library-filter" aria-label="Media tags">
            <button aria-pressed={tag === ""} onClick={() => setTag("")}>All</button>
            {tags.map((item) => <button key={item} aria-pressed={tag === item} onClick={() => setTag(item)}>{item}</button>)}
          </div>
          <div className="panel-heading"><h2>{section === "graphics" ? "Graphics" : "Project media"}</h2><span>{visible.length}</span></div>
          {mediaUsage !== null && mediaUsage.files > 0 && <div className="media-storage">{mediaUsage.files} media file{mediaUsage.files === 1 ? "" : "s"} stored · {formatBytes(mediaUsage.bytes)}</div>}
          {error !== null && <p role="alert" className="library-error">{error}</p>}
          {visible.length === 0 ? (
            <div className="media-empty">
              {section === "graphics" ? <ImageIcon aria-hidden className="size-8" /> : <Film aria-hidden className="size-8" />}
              <h3>{query !== "" || tag !== "" ? "No matching media" : section === "graphics" ? "Import your graphics" : "Import your footage"}</h3>
              <p>{query !== "" || tag !== "" ? "Try another search or clear the selected tag." : "Add media to start editing. You can also drop files on the timeline."}</p>
              <UploadButton icon={<Upload />} label={section === "graphics" ? "Import graphics" : "Import video"} accept={section === "graphics" ? "image/*" : "video/*,audio/*"} />
            </div>
          ) : (
            <ul className={`media-list media-grid${view === "list" ? " is-list" : ""}`}>
              {visible.map((asset) => {
                const label = mediaLabel(asset, entries.findIndex((item) => item.id === asset.id));
                return (
                  <li key={asset.id} className={`media-item${selectedAsset === asset.id ? " is-selected" : ""}`}>
                    <button className="media-card-button" aria-label={`Select media ${label}`} title="Select to locate on the timeline. Double-click to add another clip." onClick={() => selectMedia(asset)} onDoubleClick={() => addMedia(asset)}>
                      <div className="media-poster"><LibraryPoster asset={asset} /><span className="media-duration">{formatTime(asset.duration)}</span></div>
                      <div className="media-item-details">
                        <div className="media-item-title" title={label}>{label}</div>
                        <div className="media-item-id" title={asset.id}>{asset.id.slice(0, 16)}</div>
                        <div className="media-item-meta">{asset.width !== undefined && asset.height !== undefined ? `${asset.width} × ${asset.height} · ` : ""}{asset.bytes === undefined ? formatTime(asset.duration) : formatBytes(asset.bytes)}</div>
                      </div>
                    </button>
                    <button className="media-tag-button" aria-label={`Tag ${label}`} title="Edit media tags" onClick={() => editTags(asset)}><Tag size={11} aria-hidden />{asset.tags?.join(", ") || "Add tag"}</button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      </TabsContent>
    </Tabs>
  );
}

function VersionsPanel() {
  return (
    <Tabs defaultValue="history" className="versions-panel">
      <div className="panel-heading"><h2>Versions</h2></div>
      <TabsList aria-label="Version views" className="mb-3">
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="graph">Graph</TabsTrigger>
      </TabsList>
      <TabsContent value="history"><VersionControl /></TabsContent>
      <TabsContent value="graph"><CommitGraph /></TabsContent>
    </Tabs>
  );
}

/**
 * The panel beside the activity rail. Its content follows the rail
 * selection: Media, Versions (source control) or Issues (lint).
 */
export function SidePanel() {
  const rail = useUiStore((state) => state.rail);
  const setBottomTab = useUiStore((state) => state.setBottomTab);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {rail === "media" && <MediaPanel />}
      {rail === "versions" && <VersionsPanel />}
      {rail === "issues" && (
        <>
          <DiagnosticsPanel />
          <div style={{ marginTop: 10 }}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBottomTab("issues")}
            >
              Open issues panel
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
