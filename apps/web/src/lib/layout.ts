/**
 * Panel layout persistence. Sizes are stored per group id in localStorage
 * so a reload restores the workspace the user left.
 *
 * Pure helpers (read/write/parse) so the behaviour is testable without a
 * DOM; the component only supplies window.localStorage.
 */

export const LAYOUT_STORAGE_KEY = "cutroom.layout";

export type PanelLayout = Readonly<Record<string, number>>;

export function parseLayout(raw: string | null): PanelLayout | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        out[key] = value;
      }
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export function readLayout(
  storage: Pick<Storage, "getItem">,
  groupId: string,
): PanelLayout | null {
  return parseLayout(storage.getItem(`${LAYOUT_STORAGE_KEY}.${groupId}`));
}

export function writeLayout(
  storage: Pick<Storage, "setItem">,
  groupId: string,
  layout: PanelLayout,
): void {
  try {
    storage.setItem(`${LAYOUT_STORAGE_KEY}.${groupId}`, JSON.stringify(layout));
  } catch {
    // Private mode / quota: layout persistence is a nicety, never a
    // failure mode for the app.
  }
}
