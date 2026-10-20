import { useMemo } from "react";
import { type Commit } from "../lib/vcs";
import { buildCommitGraph } from "../lib/commitGraph";
import { authorColor } from "../lib/identity";
import { useVcsStore } from "../vcsStore";
import { useEditorStore } from "../store";

const ROW_HEIGHT = 46;
const LANE_WIDTH = 22;
const NODE_RADIUS = 5;

/** Stable colour per branch name, so a branch keeps its colour everywhere. */
function branchColor(branch: string): string {
  let hash = 0;
  for (let i = 0; i < branch.length; i++) {
    hash = (Math.imul(hash, 31) + branch.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 65% 58%)`;
}

/**
 * Commit graph.
 *
 * Drawn so that someone who has never used git can read it: the leftmost
 * vertical line is the line you are on, side branches fork off to the right
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
    <div>
      <p className="mb-3 text-[11px] text-faint">
        The left line is the line you are on. Branches fork off to the right
        in their own colour. Each dot is a saved version; where two lines
        meet, two people's work came together.
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
            const stroke = edge.branch === undefined ? "#4b525c" : branchColor(edge.branch);
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
              fill={authorColor(node.commit.author)}
              stroke="#0b0c0e"
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
            title={`Check out ${node.commit.id} and view its timeline`}
            className="absolute flex w-full items-center gap-2 rounded-md px-2 text-left hover:bg-[#1a1d22]"
            style={{
              left: graphWidth,
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
            <span className="shrink-0 text-[12px] text-foreground">
              {node.commit.message}
            </span>
            {tipsByCommit.get(node.commit.id)?.map((branch) => (
              <span
                key={branch}
                className="shrink-0 rounded-full px-1.5 font-mono text-[10px]"
                style={{
                  color: branchColor(branch),
                  border: `1px solid ${branchColor(branch)}`,
                }}
              >
                {branch}
              </span>
            ))}
            <span className="flex-1" />
            <span
              className="shrink-0 text-[11px]"
              style={{ color: authorColor(node.commit.author) }}
            >
              {node.commit.author}
            </span>
            <span className="shrink-0 text-[11px] text-faint">
              {time(node.commit)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
