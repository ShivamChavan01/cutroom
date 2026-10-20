import { Player } from "./Player";
import { Transport } from "./Transport";

/**
 * Preview region: the player fills the space, the transport sits directly
 * beneath it. The Player's double-buffer logic is untouched — only where
 * it renders changed.
 */
export function Preview() {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Player />
      </div>
      <div className="flex shrink-0 items-center justify-between gap-3">
        <Transport />
      </div>
    </div>
  );
}
