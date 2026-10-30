import { workspaceKey } from "./workspace";

export interface ViewPreferences {
  readonly hiddenTrackIds: readonly string[];
  readonly mutedTrackIds: readonly string[];
  readonly lockedTrackIds: readonly string[];
}
export const VIEW_PREFERENCES_KEY = "cutroom.view-preferences";

export function readViewPreferences(storage: Pick<Storage, "getItem">): ViewPreferences | null {
  try {
    const raw = storage.getItem(workspaceKey(VIEW_PREFERENCES_KEY));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const values = new Map<string, readonly string[]>();
    for (const key of ["hiddenTrackIds", "mutedTrackIds", "lockedTrackIds"]) {
      const entry: unknown = Reflect.get(parsed, key);
      if (!Array.isArray(entry) || !entry.every((id: unknown) => typeof id === "string" && /^[va][1-9]\d*$/.test(id))) return null;
      values.set(key, [...new Set<string>(entry)]);
    }
    return { hiddenTrackIds: values.get("hiddenTrackIds") ?? [], mutedTrackIds: values.get("mutedTrackIds") ?? [], lockedTrackIds: values.get("lockedTrackIds") ?? [] };
  } catch { return null; }
}

export function writeViewPreferences(storage: Pick<Storage, "setItem">, value: ViewPreferences): void {
  try { storage.setItem(workspaceKey(VIEW_PREFERENCES_KEY), JSON.stringify({ hiddenTrackIds: value.hiddenTrackIds, mutedTrackIds: value.mutedTrackIds, lockedTrackIds: value.lockedTrackIds })); }
  catch { /* Workspace preferences are optional when storage is unavailable. */ }
}
