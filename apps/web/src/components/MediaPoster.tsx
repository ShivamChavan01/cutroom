import { useEffect, useState } from "react";
import { Film } from "lucide-react";
import { useAssetUrls } from "../lib/assets";
import { createMediaPoster, registerMediaPoster, useMediaPosters } from "../lib/media/poster";

export function MediaPoster({ assetId }: { readonly assetId: string }) {
  const source = useAssetUrls((urls) => urls.get(assetId));
  const cached = useMediaPosters((posters) => posters.get(assetId));
  const [frame, setFrame] = useState<{ assetId: string; image: string } | null>(
    () => cached === undefined ? null : { assetId, image: cached },
  );
  const poster = frame?.assetId === assetId ? frame.image : cached;

  useEffect(() => {
    if (source === undefined) return;
    const ready = useMediaPosters.getState().get(assetId);
    if (ready !== undefined) {
      setFrame({ assetId, image: ready });
      return;
    }
    if (frame?.assetId === assetId) return;
    const controller = new AbortController();
    void createMediaPoster({ url: source, signal: controller.signal })
      .then((image) => {
        if (!controller.signal.aborted) {
          setFrame({ assetId, image });
          registerMediaPoster(assetId, image);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [assetId, source]);

  return poster !== undefined ? (
    <img className="media-poster-image" src={poster} alt="" />
  ) : (
    <div className="media-poster-fallback" aria-hidden="true">
      <Film className="size-6" />
    </div>
  );
}
