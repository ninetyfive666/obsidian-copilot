import type { RelevantNotesSearchStatus } from "@/search/findRelevantNotes";
import { Loader2 } from "lucide-react";
import React from "react";

type RelevantNotesPaneStatus = RelevantNotesSearchStatus | "idle" | "loading";

export interface RelevantNotesPaneProps {
  status: RelevantNotesPaneStatus;
  noteRows: readonly React.ReactNode[];
}

interface GuidancePanelProps {
  id: string;
  title: string;
  description: string;
}

function GuidancePanel({ id, title, description }: GuidancePanelProps): React.ReactElement {
  return (
    <div className="tw-flex tw-w-full tw-justify-center">
      <div
        data-relevant-notes-guidance={id}
        className="tw-flex tw-w-full tw-max-w-xs tw-flex-col tw-items-start tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-secondary tw-p-5 tw-text-left"
      >
        <div className="tw-flex tw-flex-col tw-gap-1">
          <span className="tw-text-sm tw-font-semibold tw-text-normal">{title}</span>
          <span className="tw-text-xs tw-leading-normal tw-text-muted">{description}</span>
        </div>
      </div>
    </div>
  );
}

export function RelevantNotesPane({
  status,
  noteRows,
}: RelevantNotesPaneProps): React.ReactElement {
  if (status === "loading") {
    return (
      <div className="tw-flex tw-h-full tw-items-center tw-justify-center tw-gap-2 tw-text-sm tw-text-normal">
        <Loader2 className="tw-size-4 tw-animate-spin" />
        Finding relevant notes…
      </div>
    );
  }

  // Only a successful match renders rows, even if a stale caller supplies them.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/280
  const guidancePanel: React.ReactNode =
    status === "no-usable-context" ? (
      <GuidancePanel
        id="no-usable-context"
        title="No usable chat context"
        description="Write a message or add a note to find related notes."
      />
    ) : null;

  return (
    <div className="tw-flex tw-h-full tw-flex-col tw-gap-0.5">
      {status !== "matches" || noteRows.length === 0 ? (
        <div
          data-relevant-notes-empty-state
          className="tw-flex tw-flex-1 tw-items-center tw-justify-center tw-px-4"
        >
          {guidancePanel ?? (
            <span className="tw-text-sm tw-text-muted">No relevant notes found</span>
          )}
        </div>
      ) : (
        noteRows
      )}
    </div>
  );
}
