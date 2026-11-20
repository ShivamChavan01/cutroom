import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyTimeline, makeClip, putAsset } from "@cutroom/engine";
import { AssistantAccessCode, AssistantPanel, ProposalReview } from "./AssistantPanel";
import { parsePlan, previewPlan } from "../lib/assistant/proposal";
import { parseProductionDocument } from "../lib/production/document";

const before = { ...putAsset(emptyTimeline(), { id: "a", kind: "video", duration: 10_000 }), clips: { c: makeClip({ id: "c", assetId: "a", trackId: "v1", start: 1000, duration: 1000, inPoint: 0, volume: 1 }) } };
describe("assistant presentation", () => {
  it("shows blocked production regressions and keeps editorial judgments explicitly unverified", () => {
    const document = parseProductionDocument({ version: 1, brief: "Keep the opening image and reference style.", styleReferences: [], evidence: [], requirements: [
      { id: "image", label: "Opening image", priority: "required", kind: "preserve", range: { assetId: "a", channel: "video", inMs: 0, outMs: 1000 } },
      { id: "style", label: "Reference style", priority: "required", kind: "editorial", instruction: "Check the reference style.", evidenceIds: [] },
    ] });
    const html = renderToStaticMarkup(<ProposalReview proposal={previewPlan(before, { summary: "Remove image", ops: [{ type: "deleteClip", clipId: "c" }] }, [], document)} />);
    expect(html).toContain("Production requirement preview");
    expect(html).toContain("worsens required production constraints");
    expect(html).toContain("human review needed");
  });
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
    expect(html).toContain('aria-label="Edit brief and references"');
    expect(html).toContain('class="agent-context-editor" hidden=""');
    expect(html).toContain("Brief &amp; references");
    expect(html).toContain("Ask about this cut");
    expect(html).toContain('aria-label="Assistant conversation"');
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

it("explains provider loading, access requirements, empty timelines, and unavailable states", async () => {
  const { AssistantAvailability } = await import("./AssistantPanel");
  const render = (configuration: Parameters<typeof AssistantAvailability>[0]["configuration"], error: string | null, empty: boolean, findings: number, needsCode: boolean) => renderToStaticMarkup(<AssistantAvailability {...{configuration, error, empty, findings, needsCode}} />);
  expect(render(null, null, true, 0, false)).toContain("Checking assistant availability");
  expect(render(null, null, true, 0, false)).toContain("Add clips");
  const config = {provider: "River" as const, model: "test-model", configured: true, accessRequired: true};
  expect(render(config, null, false, 1, true)).toContain("Reviewer access code required");
  expect(render(config, null, false, 1, false)).not.toContain("code required");
  expect(render(config, null, false, 0, false)).toContain("No structural findings");
  expect(render(config, null, false, 0, false)).toContain("River assistant available");
  expect(render({...config, configured: false}, null, false, 1, false)).toContain("server configuration is required");
  expect(render(null, "Connection failed", false, 1, false)).toContain("Assistant unavailable. Connection failed");
});
