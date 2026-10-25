import { useMemo } from "react";
import { type Commit } from "../lib/vcs";
import { buildCommitGraph } from "../lib/commitGraph";
import { useVcsStore } from "../vcsStore";
import { useEditorStore } from "../store";

const ROW_HEIGHT = 46;
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
  const store = useVcsStore.getState();
  const setPlayhead = useEditorStore((state) => state.setPlayhead);

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
      <p className="mb-3 text-[11px] text-faint">
        Main stays on the left. Branches fork to the right and join at merge
        commits. Labels mark branch tips; branches sharing a commit share a dot.
      </p>
      <div className="relative" style={{ height }}>
        <svg
          width={graphWidth}
          height={height}
          className="absolute left-0 top-0 overflow-visible"
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
            // Different lanes: leave the node, bend, and arrive.
            const midY = y1 + (y2 - y1) / 2;
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={`M ${x1} ${y1} V ${midY} L ${x2} ${midY} V ${y2}`}
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
              stroke="var(--color-card)"
              strokeWidth={2}
            />
          ))}
        </svg>

        {graph.nodes.map((node) => (
          <button
            key={node.commit.id}
            onClick={() => {
              store.viewCommit(node.commit.id);
              setPlayhead(0);
            }}
            title={`${node.commit.message} · ${node.commit.author} · ${time(node.commit)}. Check out ${node.commit.id} and view its timeline`}
            aria-current={repo.detachedAt === node.commit.id || (repo.detachedAt === null && repo.branches[repo.currentBranch] === node.commit.id) ? "true" : undefined}
            className="absolute flex min-w-0 items-center gap-2 rounded-md px-2 text-left hover:bg-raised"
            style={{
              left: graphWidth,
              right: 0,
              top: node.row * ROW_HEIGHT,
              height: ROW_HEIGHT,
            }}
          >
            <span
              className="ml-1 shrink-0 font-mono text-[10px] text-faint"
              style={{ width: 22 }}
            >
              {node.commit.id}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
              {node.commit.message}
            </span>
            {tipsByCommit.get(node.commit.id)?.map((branch) => (
              <span
                key={branch}
                className="shrink-0 rounded-full px-1.5 font-mono text-[10px]"
                style={{
                  color: branchColor(branch),
                  border: `1px solid ${branchColor(branch)}`,
                  background: repo.currentBranch === branch && repo.detachedAt === null ? "var(--color-selection)" : undefined,
                }}
              >
                {branch}{repo.currentBranch === branch && repo.detachedAt === null ? " · HEAD" : ""}
              </span>
            ))}
          </button>
        ))}
      </div>
    </div>
  );
}
