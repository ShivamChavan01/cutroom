import { useMemo, useState } from "react";
import { type Commit } from "../lib/vcs";
import { buildCommitGraph } from "../lib/commitGraph";
import { useVcsStore } from "../vcsStore";
import { useEditorStore } from "../store";

const ROW_HEIGHT = 88;
const LANE_WIDTH = 22;
const NODE_RADIUS = 5;

const LANE_COLORS = ["#7fa2ff", "#b194f4", "#edb271", "#6bc8ad", "#ee9cbe", "#73c5da"];

/**
 * Commit graph.
 *
 * Drawn so that someone who has never used git can read it: the leftmost
 * vertical line is main, side branches fork off to the right
 * in their own colour, each dot is a saved version, and where two lines
 * meet is where two people's work came together. Clicking a dot checks
 * that version out, exactly like the commit list.
 */
export function CommitGraph() {
  const repo = useVcsStore((state) => state.repo);
  const [error, setError] = useState<string | null>(null);


  const graph = useMemo(() => (repo === null ? null : buildCommitGraph(repo)), [repo]);

  if (repo === null || graph === null) {
    return (
      <p className="text-[12px] text-muted">Version control not initialized.</p>
    );
  }

  const graphWidth = graph.laneCount * LANE_WIDTH + 10;
  const height = graph.nodes.length * ROW_HEIGHT;
  const laneX = (lane: number): number => 14 + lane * LANE_WIDTH;
  const rowY = (row: number): number => row * ROW_HEIGHT + ROW_HEIGHT / 2;

  const nodeById = new Map(graph.nodes.map((node) => [node.commit.id, node]));
  const laneColor = (lane: number): string => LANE_COLORS[lane % LANE_COLORS.length] ?? "#7fa2ff";
  const branchColor = (branch: string): string => laneColor(
    graph.branchLane[branch] ?? nodeById.get(repo.branches[branch] ?? "")?.lane ?? 0,
  );

  /** Branch names shown next to the commit they point at. */
  const tipsByCommit = new Map<string, string[]>();
  for (const tip of graph.branchTips) {
    const list = tipsByCommit.get(tip.commitId) ?? [];
    list.push(tip.branch);
    tipsByCommit.set(tip.commitId, list);
  }

  const time = (commit: Commit): string =>
    new Date(commit.at).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="commit-graph" aria-label="Commit graph">
      <header className="commit-graph-heading">
        <strong>All branches</strong>
        <span>{graph.branchTips.length} branches · {graph.nodes.length} commits</span>
      </header>
      <p className="commit-graph-help">
        Main stays on the left. Follow each line to its shared ancestor; two parent lines mark a merge.
      </p>
      <div className="commit-graph-branches" aria-label="Branch tips">
        {graph.branchTips.map(({ branch, commitId }) => (
          <span key={branch} className="commit-graph-ref" style={{ color: branchColor(branch) }}>
            {branch}<code>{commitId}</code>
          </span>
        ))}
      </div>
      {error !== null && <p role="alert" className="text-destructive text-[12px]">{error}</p>}
      <div className="relative" style={{ height }}>
        <svg
          width={graphWidth}
          height={height}
          className="pointer-events-none absolute left-0 top-0 z-10 overflow-visible"
          aria-hidden
        >
          {graph.edges.map((edge) => {
            const from = nodeById.get(edge.from);
            const to = nodeById.get(edge.to);
            if (from === undefined || to === undefined) return null;
            const x1 = laneX(from.lane);
            const y1 = rowY(from.row);
            const x2 = laneX(to.lane);
            const y2 = rowY(to.row);
            const stroke = edge.branch === undefined
              ? laneColor(x1 === x2 ? from.lane : Math.max(from.lane, to.lane))
              : branchColor(edge.branch);
            if (x1 === x2) {
              return (
                <line
                  key={`${edge.from}-${edge.to}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={stroke}
                  strokeWidth={2}
                />
              );
            }
            // Bend next to the real endpoint, so a long merge edge cannot
            // appear to join an unrelated commit halfway down the main lane.
            const isMergeParent = from.commit.parents[0] !== edge.to;
            const bend = ROW_HEIGHT / 2;
            const path = isMergeParent
              ? `M ${x1} ${y1} C ${x1} ${y1 + bend / 2} ${x2} ${y1 + bend / 2} ${x2} ${y1 + bend} V ${y2}`
              : `M ${x1} ${y1} V ${y2 - bend} C ${x1} ${y2 - bend / 2} ${x2} ${y2 - bend / 2} ${x2} ${y2}`;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={path}
                data-edge-kind={isMergeParent ? "merge" : "fork"}
                data-from={edge.from}
                data-to={edge.to}
                fill="none"
                stroke={stroke}
                strokeWidth={2}
              />
            );
          })}
          {graph.nodes.map((node) => (
            <circle
              key={node.commit.id}
              cx={laneX(node.lane)}
              cy={rowY(node.row)}
              r={NODE_RADIUS}
              data-commit-id={node.commit.id}
              data-lane={node.lane}
              fill={laneColor(node.lane)}
              stroke={repo.detachedAt === node.commit.id || (repo.detachedAt === null && repo.branches[repo.currentBranch] === node.commit.id) ? "var(--color-foreground)" : "var(--color-card)"}
              strokeWidth={2}
            />
          ))}
        </svg>

        {graph.nodes.map((node) => (
          <button
            key={node.commit.id}
            onClick={() => {
              try {
                const store = useVcsStore.getState();
                const editor = useEditorStore.getState();
                const latest = store.repo;
                if (latest === null) return;
                store.viewCommit(node.commit.id);
                editor.setPlayhead(0);
                setError(null);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "Could not view this commit.");
              }
            }}
            title={`${node.commit.message} · ${node.commit.author} · ${time(node.commit)}. Check out ${node.commit.id} and view its timeline`}
            aria-current={repo.detachedAt === node.commit.id || (repo.detachedAt === null && repo.branches[repo.currentBranch] === node.commit.id) ? "true" : undefined}
            className="commit-graph-row absolute"
            style={{
              left: 0,
              paddingLeft: graphWidth + 8,
              right: 0,
              top: node.row * ROW_HEIGHT,
              height: ROW_HEIGHT,
            }}
          >
            <span className="commit-graph-message">{node.commit.message}</span>
            <span className="commit-graph-meta">
              <code>{node.commit.id}</code><span>{node.commit.author}</span>
              {node.commit.parents.length > 1 && <span className="commit-graph-merge" title={`Parents: ${node.commit.parents.join(" + ")}`}>Merge</span>}
              {repo.detachedAt === node.commit.id && <span className="commit-graph-head">Viewing · HEAD</span>}
            </span>
            <span className="commit-graph-refs">
              {(tipsByCommit.get(node.commit.id) ?? []).slice(0, 2).map((branch) => (
                <span key={branch} className="commit-graph-ref" title={branch}
                  style={{ color: branchColor(branch) }}>
                  <span>{branch}</span>{repo.currentBranch === branch && repo.detachedAt === null ? " · HEAD" : ""}
                </span>
              ))}
              {(tipsByCommit.get(node.commit.id)?.length ?? 0) > 2 && <span className="text-faint text-[10px]" title={tipsByCommit.get(node.commit.id)?.join(", ")}>+{(tipsByCommit.get(node.commit.id)?.length ?? 0) - 2} branches</span>}
              {(tipsByCommit.get(node.commit.id)?.length ?? 0) > 1 && <span className="text-faint text-[10px]">Shared tip</span>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
