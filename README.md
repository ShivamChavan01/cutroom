# Cutroom

Cutroom is a browser video editor for trying different cuts of the same footage. Save a version before shortening an interview, make an alternate edit, then compare the two timelines clip by clip. When you bring edits together, Cutroom shows which changes conflict and lets you choose what goes into the final cut.

[Open Cutroom](https://cutroom-editor.vercel.app/) · [Try the guided sample](https://cutroom-editor.vercel.app/?demo=1)

## Try the sample project

The sample contains an eight-second motion study and two versions. It opens in its own workspace and works without an upload or an Assistant access code.

1. Play the cut, then open the project menu and choose **Sample guide → See two versions**.
2. Choose **Compare edits**. One version moves the middle shot, and the other moves the ending. Each version plays cleanly on its own.
3. Choose **Merge versions**. The two shots now compete for the same second on V1. Choose **Keep middle** or **Keep ending**, play your decision, and save it with **Commit merge**.
4. Choose **Inspect findings** to jump to the resulting gap. You decide whether the pause belongs in the cut.

## What shipped in November

### A workspace for editing and review

The preview and timeline share the center of the editor. Open **Media**, **Versions**, **Issues**, **Properties**, or **Settings** from the left rail. Open **Assistant** from the top right for a full-height, resizable conversation beside the cut. You can scrub through a proposed edit, close the panel to get more room, and reopen it with your draft intact for the session.

### Review a cut against a production brief

Suppose you need a 30-second cut that keeps an interviewee’s closing line. Open **Assistant → Brief & references**, enter the brief, set the limit under **Add direction or requirements**, and choose **Save production brief**. Then select the clip and choose **Protect selected audio**. The saved brief follows the project across versions and reloads.

**Review against the brief** uses timeline structure and relevant source notes. **Inspect request context** shows which notes and source times were selected and which were omitted. You supply transcripts, shot notes and reference direction. Visual style and continuity still need an editor’s eye. The hosted Assistant requires a reviewer access code. [Production context guide](docs/production-context.md) · [Sample evidence file](examples/production-context.demo.json)

Use **Show changes** to see a proposal on the timeline. **Apply** checks it against the current cut and protected ranges. If you switch versions or change the brief, the proposal becomes stale. Accepted edits go into the ordinary undo history.

### Match gain across clips from one recording

Set the same gain on three distinct clips from one audio source on the same track. Select a fourth eligible clip and Cutroom offers a gain match in **Properties → Audio**. You can inspect the supporting decisions, preview the value, apply it, or dismiss it. This rule runs locally from manual edits in the current session. Gain matching is the only next-action suggestion in this release. [Gain suggestion behavior](docs/editor-guide.md#context-aware-gain-suggestions)

### Working with 4K and 8K footage

Cutroom previews the imported source by default. For slow 4K seeks in desktop Chrome, open **Media → File details → Prepare editing copy…**. Cutroom saves a full-resolution H.264 MP4 with frequent keyframes and previews it for the session. **Use original** switches back. The project and timeline exports keep referencing the original footage.

On a Radeon Vega 8 laptop, the median wait to see the selected frame fell from **1.74 s to 0.36 s** across six matched clicks on an upscaled 4K edit. The 12-second clip took **58 s** to prepare and used **30 MiB** of extra disk space. Preparation supports a single opaque SDR video track and requires a browser encoder and local save picker.

A lone video now sets the pace when its decoder stalls. Across three short 8K trials, the editor issued zero catch-up seeks or automatic pauses. Software decoding on the same laptop advanced **4.44 s in 9.03 s**. A separate **240-clip, four-track** test verified coordinated recovery and audio sync within 250 ms across cuts. [Benchmark method and limits](PERF.md#source-resolution-playback-and-editing-copies)

### Recover work across sessions

Wait for **saved** before refreshing. Cutroom restores the timeline, undo history, versions and pending merge choices from browser storage. If two tabs edit the same project, a stale tab reports a save failure so it can’t silently overwrite the newer work. Imported media stays local to this browser and device. [Storage and recovery details](docs/editor-guide.md#data-isolation-and-refresh)

## Editing and export

Import video, audio and graphics. Trim or split clips, detach audio, adjust transforms and gain, inspect waveforms, and hide, mute or lock tracks. **Issues** takes you to timeline findings such as gaps, overlaps and trims beyond the source. **Versions** holds saved cuts, their history, comparisons and merge decisions.

**Export timeline** downloads OpenTimelineIO, Final Cut Pro XML, CMX3600 EDL or native Cutroom JSON for finishing elsewhere. The MP4 editing-copy command prepares an individual source for preview. [Format details](docs/editor-guide.md#what-works)

## Run it locally

Use Node.js 24 and the repository’s pinned pnpm version. Run these commands from the repository root.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm dev
```

Open the local URL printed by Vite. The editor and guided sample work without provider credentials. For live Assistant requests, follow the [server-side provider setup](docs/editor-guide.md#ai-verification-assistant).

## Release verification

The November release passed **746 web tests** and **220 engine and measurement-script tests**. GitHub CI passed typechecking, tests and the production build. The Vercel smoke check verified the public editor, JavaScript bundle, sample footage and Assistant configuration endpoint. [Release checks](https://github.com/ShivamChavan01/cutroom/actions/runs/44811133890) · [Project progress](PROGRESS.md) · [Demo limitations](DEMO-LIMITATIONS.md)
