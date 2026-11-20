import { MP4, QTFF, MATROSKA, WEBM, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, StreamTarget, UrlSource } from "mediabunny";

/** Stream into a new local file. Publish its contents only after a complete conversion. */
export async function encodeEditingCopy(source: string, destination: FileSystemFileHandle, signal: AbortSignal, onProgress: (percent: number) => void): Promise<File> {
  signal.throwIfAborted();
  if ((await destination.getFile()).size !== 0) throw new Error("Choose a new file name for the editing copy.");
  const input = new Input({formats: [MP4, QTFF, MATROSKA, WEBM], source: new UrlSource(source)});
  let writable: FileSystemWritableFileStream | undefined;
  let conversion: Conversion | undefined;
  const cancel = () => { void conversion?.cancel().catch(() => undefined); };
  try {
    const tracks = await input.getVideoTracks();
    const track = tracks[0];
    if (tracks.length !== 1 || !track || await track.hasHighDynamicRange() || await track.canBeTransparent()) {
      throw new Error("Editing copies support one opaque SDR video track.");
    }
    signal.throwIfAborted();
    const file = await destination.createWritable();
    writable = file;
    const target = new StreamTarget(new WritableStream({write: chunk => file.write(chunk)}), {chunked: true});
    conversion = await Conversion.init({
      input, output: new Output({format: new Mp4OutputFormat(), target}),
      video: {codec: "avc", keyFrameInterval: 1, quality: QUALITY_HIGH},
      trim: {start: 0}, showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.length > 0) {
      throw new Error("This browser cannot create a full-resolution MP4 with all source tracks.");
    }
    conversion.onProgress = progress => onProgress(Math.floor(progress * 100));
    signal.throwIfAborted();
    signal.addEventListener("abort", cancel, {once: true});
    await conversion.execute();
    signal.throwIfAborted();
    await file.close();
    writable = undefined;
    return await destination.getFile();
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      if (writable) await writable.abort();
    } finally {
      input.dispose();
    }
  }
}
