import { useState } from "react";
import { lint } from "@cutroom/engine";
import { registerAssetUrl } from "../lib/assets";
import { buildScenarios, lintRulesFor } from "../lib/scenarios";
import { useEditorStore } from "../store";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";

/** Dev-only scenario loader. Not part of the product UI, not linked from it. */
export function ScenariosPage() {
  const [loaded, setLoaded] = useState<string | null>(null);
  const scenarios = buildScenarios();

  const load = (id: string) => {
    const scenario = scenarios.find((s) => s.id === id);
    if (scenario === undefined) return;
    const store = useEditorStore.getState();
    store.loadTimeline(scenario.timeline);
    // Test media lives in public/ and is gitignored; register the URLs so
    // the player can actually decode them.
    for (const assetId of scenario.assetIds) {
      registerAssetUrl(assetId, `/${assetId === "asset-a" ? "test-a" : "test-b"}.mp4`);
    }
    setLoaded(scenario.id);
  };

  return (
    <main className="mx-auto max-w-3xl p-6 font-mono text-[13px]">
      <h1 className="mb-1 text-lg font-bold">Scenario harness</h1>
      <p className="mb-5 text-muted">
        Dev-only. Loads a known timeline so the app can be exercised without
        hunting for files. Media: <code>public/test-a.mp4</code>,{" "}
        <code>public/test-b.mp4</code> (gitignored).
      </p>
      <ul className="m-0 list-none p-0">
        {scenarios.map((s) => {
          const rules = lintRulesFor(s);
          return (
            <li
              key={s.id}
              className="mb-2 rounded-md border border-border bg-card p-3"
            >
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => load(s.id)}>
                  Load {s.label}
                </Button>
                <span className="text-muted">{s.id}</span>
                {rules.map((rule) => (
                  <Badge key={rule} variant={rule === "overlap" ? "destructive" : "warn"}>
                    {rule}
                  </Badge>
                ))}
                {loaded === s.id && <Badge variant="success">loaded</Badge>}
              </div>
              <p className="mt-1.5 text-muted">{s.expect}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-5 text-muted">
        After loading, switch to the editor tab and exercise it. The linter
        panel reports {lint(useEditorStore.getState().timeline).length}{" "}
        issue(s) for the current timeline.
      </p>
    </main>
  );
}
