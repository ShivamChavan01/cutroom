import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { AssistantAccessCode, AssistantPanel, ProposalReview } from "./AssistantPanel";
import { parsePlan, previewPlan } from "../lib/assistant/proposal";

const before = { ...putAsset(emptyTimeline(), { id: "a", kind: "video", duration: 10_000 }), clips: { c: makeClip({ id: "c", assetId: "a", trackId: "v1", start: 1000, duration: 1000, inPoint: 0, volume: 1 }) } };
describe("assistant presentation", () => {
  it("renders a labeled password field for reviewer access without saving credentials", () => {
    const html = renderToStaticMarkup(<AssistantAccessCode value="" onChange={() => {}} />);
    expect(html).toContain('for="assistant-access-code"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="off"');
    expect(html).toContain("until you reload");
    expect(html).not.toContain("API key");
  });
  it("shows the issue workflow and disclosure without assuming a provider before configuration loads", () => {
    const html = renderToStaticMarkup(<AssistantPanel />);
    expect(html).toContain('aria-label="AI verification assistant"');
    expect(html).toContain("Explain &amp; propose fixes");
    expect(html).toContain('for="assistant-prompt"');
    expect(html).toContain("Media files stay on this computer");
    expect(html).toContain("cannot watch or listen");
    expect(html).not.toContain("API key");
    expect(html).toContain("the configured AI provider");
    expect(html).not.toContain(">OpenAI</span>");
  });
  it("renders the explanation safely, with no edits for explanation-only responses", () => {
    const proposal = previewPlan(before, parsePlan({ summary: "<script>bad()</script>", ops: [] }), []);
    const html = renderToStaticMarkup(<ProposalReview proposal={proposal} />);
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("No edits proposed");
    expect(html).toContain("Verification preview");
  });
  it("describes every supported operation using real values and shows introduced findings", () => {
    const ops = [
      { type: "moveClip", clipId: "c", start: 0 },
      { type: "trimClip", clipId: "c", inPoint: 100, duration: 200 },
      { type: "setVolume", clipId: "c", volume: 0.25 },
      { type: "setTransform", clipId: "c", rotation: 90 },
      { type: "splitClip", clipId: "c", at: 50 },
    ];
    const html = renderToStaticMarkup(<ProposalReview proposal={previewPlan(before, parsePlan({ summary: "Adjust clip", ops }), [])} />);
    for (const expected of ["Move c to 0.00s", "source in 0.10s", "25%", "rotation 90", "0.05s into the clip", "introduces issues"]) expect(html).toContain(expected);
    const deleted = renderToStaticMarkup(<ProposalReview proposal={previewPlan(before, parsePlan({ summary: "Delete requested clip", ops: [{ type: "deleteClip", clipId: "c" }] }), [])} />);
    expect(deleted).toContain("Delete c");
    expect(deleted).toContain("1 removed");
  });
});
