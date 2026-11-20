import { create } from "zustand";
import { useAssetUrls } from "../assets";

interface EditingCopy {
  original: string;
  url: string;
}

export const useEditingCopies = create<ReadonlyMap<string, EditingCopy>>(() => new Map());

export function restoreOriginalMedia(id: string): void {
  const copies = useEditingCopies.getState();
  const copy = copies.get(id);
  if (!copy) return;
  const next = new Map(copies);
  next.delete(id);
  useEditingCopies.setState(next, true);
  URL.revokeObjectURL(copy.url);
}

export function previewEditingCopy(id: string, original: string, file: File): void {
  if (useAssetUrls.getState().get(id) !== original) return;
  restoreOriginalMedia(id);
  const copies = new Map(useEditingCopies.getState());
  copies.set(id, {original, url: URL.createObjectURL(file)});
  useEditingCopies.setState(copies, true);
}

interface EditingJob {
  id: string;
  original: string;
  controller: AbortController;
  percent: number;
}

export const useEditingJob = create<{job: EditingJob | null; error: {id: string; message: string} | null}>(() => ({job: null, error: null}));

export async function prepareEditingCopy(id: string, original: string, pick: () => Promise<FileSystemFileHandle>): Promise<void> {
  if (useEditingJob.getState().job) return;
  const controller = new AbortController();
  const job = {id, original, controller, percent: 0};
  useEditingJob.setState({job, error: null});
  try {
    const destination = await pick();
    controller.signal.throwIfAborted();
    const {encodeEditingCopy} = await import("./encodeEditingCopy");
    const file = await encodeEditingCopy(original, destination, controller.signal, percent => {
      if (useEditingJob.getState().job?.percent !== percent) useEditingJob.setState({job: {...job, percent}});
    });
    if (!controller.signal.aborted) previewEditingCopy(id, original, file);
  } catch (cause) {
    if (!controller.signal.aborted && !(cause instanceof DOMException && cause.name === "AbortError")) {
      useEditingJob.setState({error: {id, message: cause instanceof Error ? cause.message : "Could not prepare the editing copy."}});
    }
  } finally {
    useEditingJob.setState({job: null});
  }
}

useAssetUrls.subscribe(urls => {
  const job = useEditingJob.getState().job;
  if (job && urls.get(job.id) !== job.original) job.controller.abort();
  for (const [id, copy] of useEditingCopies.getState()) {
    if (urls.get(id) !== copy.original) restoreOriginalMedia(id);
  }
});
