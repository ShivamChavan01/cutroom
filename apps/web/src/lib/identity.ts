/**
 * Local identity + deterministic author colors.
 *
 * No auth in this prototype: a stable name in localStorage, created once.
 * Color is a pure function of the name, so identity and color can never
 * disagree — blame, feed, and (later) presence all derive from one value.
 */
export function getOrCreateAuthorId(): string {
  const KEY = "cutroom.authorId";
  try {
    const existing = localStorage.getItem(KEY);
    if (existing !== null && existing.length > 0) return existing;
    const fresh = `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem(KEY, fresh);
    return fresh;
  } catch {
    // Non-browser environment (tests): ephemeral identity, never persisted.
    return `Guest-${Math.floor(1000 + Math.random() * 9000)}`;
  }
}

export function authorColor(author: string): string {
  let hash = 0;
  for (let i = 0; i < author.length; i++) {
    hash = (Math.imul(hash, 31) + author.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 55%)`;
}
