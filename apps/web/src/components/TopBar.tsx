import { ExportOitioButton, UploadButton } from "./UploadButton";
import { useEditorStore } from "../store";
import { useVcsStore } from "../vcsStore";
import { theme } from "../theme";

/** Top strip: identity, branch, primary actions. Nothing decorative. */
export function TopBar() {
  const authorId = useEditorStore((state) => state.authorId);
  const branch = useVcsStore((state) => state.repo?.currentBranch ?? "—");

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 14px",
        borderBottom: `1px solid ${theme.border}`,
        background: theme.panel,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 15 }}>
        Cutroom
      </span>
      <span
        title="Current branch"
        style={{
          fontSize: 12,
          color: theme.dim,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          padding: "1px 10px",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        ⎇ {branch}
      </span>
      <span style={{ flex: 1 }} />
      <UploadButton />
      <ExportOitioButton />
      <span
        title="Local author identity"
        style={{ fontSize: 12, color: theme.dim }}
      >
        {authorId}
      </span>
    </header>
  );
}
