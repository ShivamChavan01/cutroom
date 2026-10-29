import { useEffect } from "react";
import { emptyTimeline } from "@cutroom/engine";
import { useEditorStore } from "../../store";
import { useVcsStore } from "../../vcsStore";
import { usePersistenceStore } from "./persistenceStore";
import {
  ProjectLoadError,
  deserializeProject,
  serializeProject,
  toHistory,
  toRepo,
} from "./project";
import { clearProject, readProject, storageUsage, writeProject } from "./storage";
import { restoreMedia } from "./restoreMedia";

/** How long after the last change we write. */
const SAVE_DEBOUNCE_MS = 700;

/**
 * Load the project on start, save it after changes (debounced), and report
 * what is going on in the status bar.
 *
 * The load path never throws into the app: a corrupt or unreadable store
 * produces a recoverable failure — the raw text is kept so it can be
 * exported, and a reset is offered — rather than a blank editor.
 */
export function useProjectPersistence(): void {
  const setStatus = usePersistenceStore((state) => state.setStatus);
  const setLoadFailure = usePersistenceStore((state) => state.setLoadFailure);
  const setUsage = usePersistenceStore((state) => state.setUsage);
  const setMediaWarning = usePersistenceStore((state) => state.setMediaWarning);

  // Load once, on start.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const result = await readProject();
      if (cancelled) return;
      if (!result.ok) {
        setStatus(
          result.status === "unavailable" ? "unavailable" : "error",
          result.error ?? "could not read the stored project",
        );
        return;
      }
      if (result.value === undefined) {
        // No stored project. Create a repo now so that edits are saveable
        // even if the user never opens the Versions panel.
        useVcsStore.getState().ensureRepo();
        setStatus("idle");
        return;
      }
      try {
        const project = deserializeProject(result.value);
        useEditorStore.getState().restoreHistory(toHistory(project.history));
        useVcsStore.getState().restoreRepo(toRepo(project.repo));
        // Put the media back so the restored timeline actually plays.
        const media = await restoreMedia(project.history.base, controller.signal);
        if (cancelled) return;
        if (media.warning !== null) setMediaWarning(media.warning);
        setStatus("saved");
      } catch (error) {
        if (cancelled) return;
        const raw =
          error instanceof ProjectLoadError
            ? error.raw
            : (result.value ?? "");
        setLoadFailure({
          message:
            error instanceof Error ? error.message : "the stored project is unusable",
          raw,
        });
        setStatus("error", "the stored project could not be loaded");
      } finally {
        void storageUsage().then((usage) => {
          if (!cancelled) setUsage(usage);
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [setStatus, setLoadFailure, setUsage, setMediaWarning]);

  // Save after changes, debounced.
  useEffect(() => {
    let timer: number | null = null;

    const save = async (): Promise<void> => {
      const { history } = useEditorStore.getState();
      const { repo } = useVcsStore.getState();
      if (repo === null) return;
      setStatus("saving");
      const result = await writeProject(serializeProject({ history, repo }));
      if (!result.ok) {
        setStatus(
          result.status === "unavailable" ? "unavailable" : "error",
          result.error ?? "could not save the project",
        );
        return;
      }
      setStatus("saved");
    };

    const schedule = (): void => {
      setStatus("unsaved");
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void save();
      }, SAVE_DEBOUNCE_MS);
    };

    const unsubEditor = useEditorStore.subscribe((state, previous) => {
      if (state.history === previous.history) return;
      schedule();
    });
    const unsubVcs = useVcsStore.subscribe((state, previous) => {
      if (state.repo === previous.repo) return;
      schedule();
    });

    return () => {
      unsubEditor();
      unsubVcs();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [setStatus]);
}

/** Clear the stored project and reset the editor to an empty timeline. */
export async function resetProject(): Promise<void> {
  const result = await clearProject();
  if (!result.ok) {
    usePersistenceStore.getState().setStatus(result.status === "unavailable" ? "unavailable" : "error", result.error ?? "could not reset the project");
    return;
  }
  useEditorStore.getState().loadTimeline(emptyTimeline("untitled"));
  useVcsStore.setState({ repo: null, pending: null, diffOverlay: null });
  // A fresh repo so the reset state is itself saveable.
  useVcsStore.getState().ensureRepo();
  usePersistenceStore.getState().setLoadFailure(null);
  usePersistenceStore.getState().setStatus("idle");
}

/** Download the raw stored text, so a broken project can be rescued. */
export function exportRawProject(raw: string): void {
  const blob = new Blob([raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "cutroom-broken-project.json";
  link.click();
  URL.revokeObjectURL(url);
}
