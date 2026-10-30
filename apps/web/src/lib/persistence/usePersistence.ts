import { isDemoWorkspace } from "../workspace";
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
  const loadFailure = usePersistenceStore((state) => state.loadFailure);
  const hydrated = usePersistenceStore((state) => state.hydrated);
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
        if (isDemoWorkspace()) {
          const { installDemoProject } = await import("../demo/load");
          if (cancelled) return;
          installDemoProject();
        }
        else useVcsStore.getState().ensureRepo();
        if (cancelled) return;
        usePersistenceStore.getState().setHydrated(true);
        setStatus(
          result.status === "unavailable" ? "unavailable" : "error",
          result.error ?? "could not read the stored project",
        );
        return;
      }
      if (result.value === undefined) {
        // No stored project. Create a repo now so that edits are saveable
        // even if the user never opens the Versions panel.
        if (isDemoWorkspace()) {
          const { installDemoProject } = await import("../demo/load");
          if (cancelled) return;
          installDemoProject();
          const { history } = useEditorStore.getState();
          const { repo } = useVcsStore.getState();
          if (repo !== null) {
            const saved = await writeProject(serializeProject({history, repo}));
            if (cancelled) return;
            setStatus(saved.ok ? "saved" : saved.status === "unavailable" ? "unavailable" : "error", saved.error);
          }
        } else {
          useVcsStore.getState().ensureRepo();
          setStatus("idle");
        }
        usePersistenceStore.getState().setHydrated(true);
        return;
      }
      try {
        const project = deserializeProject(result.value);
        useEditorStore.getState().restoreHistory(toHistory(project.history));
        useVcsStore.getState().restoreRepo(toRepo(project.repo));
        // Put the media back so the restored timeline actually plays.
        const bundled = isDemoWorkspace() ? (await import("../demo/project")).demoMediaUrls(import.meta.env.BASE_URL) : new Map<string, string>();
        const media = await restoreMedia(project.history.base, controller.signal, bundled);
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
        if (!cancelled) usePersistenceStore.getState().setHydrated(true);
        void storageUsage().then((usage) => {
          if (!cancelled) setUsage(usage);
        });
      }
    })().catch((error: unknown) => {
      if (cancelled) return;
      setStatus("error", error instanceof Error ? error.message : "Could not initialize the workspace. Reload to retry.");
      usePersistenceStore.getState().setHydrated(true);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [setStatus, setLoadFailure, setUsage, setMediaWarning]);

  // Save after changes, debounced.
  useEffect(() => {
    if (!hydrated || loadFailure !== null) return;
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
  }, [setStatus, hydrated, loadFailure]);
}

/** Clear the stored project and reset the editor to an empty timeline. */
export async function resetProject(): Promise<boolean> {
  try {
    // Load the initializer before deleting the saved sample, so a failed chunk
    // download cannot erase its persisted edits.
    const demo = isDemoWorkspace() ? await import("../demo/load") : null;
    const result = await clearProject();
    if (!result.ok) {
      usePersistenceStore.getState().setStatus(result.status === "unavailable" ? "unavailable" : "error", result.error ?? "could not reset the project");
      return false;
    }
    if (demo !== null) demo.installDemoProject();
    else {
      useEditorStore.getState().loadTimeline(emptyTimeline("untitled"));
      useVcsStore.setState({ repo: null, pending: null, diffOverlay: null });
      useVcsStore.getState().ensureRepo();
    }
    usePersistenceStore.getState().setLoadFailure(null);
    usePersistenceStore.getState().setMediaWarning(null);
    usePersistenceStore.getState().setStatus("idle");
    return true;
  } catch (error) {
    usePersistenceStore.getState().setStatus("error", error instanceof Error ? error.message : "Could not reset the project.");
    return false;
  }
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
