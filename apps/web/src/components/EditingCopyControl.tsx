import type { Asset } from "@cutroom/engine";
import { useAssetUrls } from "../lib/assets";
import { prepareEditingCopy, restoreOriginalMedia, useEditingCopies, useEditingJob } from "../lib/media/editingCopy";
import { Button } from "./ui/button";

type SavePicker = (options: {suggestedName: string; types: {description: string; accept: Record<string, string[]>}[]}) => Promise<FileSystemFileHandle>;

export function EditingCopyControl({asset}: {asset: Asset}) {
  const source = useAssetUrls(urls => urls.get(asset.id));
  const copy = useEditingCopies(copies => copies.get(asset.id));
  const busy = useEditingJob(state => state.job !== null);
  const job = useEditingJob(state => state.job?.id === asset.id ? state.job : null);
  const error = useEditingJob(state => state.error?.id === asset.id ? state.error.message : null);
  const picker = typeof window === "undefined" ? undefined : (window as Window & {showSaveFilePicker?: SavePicker}).showSaveFilePicker;
  if (!source || !picker || typeof VideoEncoder === "undefined") return null;

  const stem = (asset.name || asset.id).replace(/\.[^.]+$/, "");
  const prepare = () => prepareEditingCopy(asset.id, source, () => picker.call(window, {
    suggestedName: stem + ".edit.mp4",
    types: [{description: "MP4 video", accept: {"video/mp4": [".mp4"]}}],
  }));

  return <div>
    {copy && <><p>Previewing the full-resolution editing copy for this session.</p>
      <Button size="sm" variant="outline" onClick={() => restoreOriginalMedia(asset.id)}>Use original</Button></>}
    {!copy && !job && <Button size="sm" variant="outline" disabled={busy}
      title="Save a full-resolution editing copy for faster seeking and use it for this preview."
      onClick={() => void prepare()}>Prepare editing copy…</Button>}
    {job && <><p role="status">Preparing editing copy · {job.percent}%</p>
      <Button size="sm" variant="outline" onClick={() => job.controller.abort()}>Cancel</Button></>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
