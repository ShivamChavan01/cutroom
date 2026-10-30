/** A demo tab never reads, writes, or deletes the personal project namespace. */
export function isDemoWorkspace(search = typeof location === "undefined" ? "" : location.search): boolean {
  return new URLSearchParams(search).get("demo") === "1";
}

export function workspaceKey(key: string, search?: string): string {
  return isDemoWorkspace(search) ? `${key}.demo-v1` : key;
}

export function demoHref(): string {
  return "?demo=1";
}
