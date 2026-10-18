import { Button } from "@/components/ui/button";
import {
  RelevantNotesPane,
  type RelevantNotesPaneProps,
} from "@/components/chat-components/ui/RelevantNotesPane";
import type { Meta, StoryObj } from "@/lib/story";
import { FileInput, FileOutput } from "lucide-react";
import React, { useState } from "react";

function NoteRows(): React.ReactNode[] {
  return [
    { title: "Design principles", score: 0.8, outgoing: true, backlink: true },
    { title: "Product research", score: 0.5, outgoing: false, backlink: true },
  ].map((note) => (
    <div
      key={note.title}
      className="tw-flex tw-min-h-8 tw-items-center tw-gap-2 tw-rounded-md tw-px-2.5 tw-py-1.5"
    >
      <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium tw-text-normal">
        {note.title}
      </span>
      {note.outgoing && <FileOutput className="tw-size-3 tw-text-faint" />}
      {note.backlink && <FileInput className="tw-size-3 tw-text-faint" />}
      <span className="tw-text-xs tw-font-medium tw-tabular-nums tw-text-muted">
        {Math.round(note.score * 100)}%
      </span>
    </div>
  ));
}

const baseArgs: RelevantNotesPaneProps = {
  status: "matches",
  noteRows: NoteRows(),
};

const meta = {
  title: "Chat/Relevant Notes Pane",
  component: RelevantNotesPane,
  args: baseArgs,
  parameters: { gallery: { host: "leaf", layout: "fullscreen" } },
} satisfies Meta<RelevantNotesPaneProps>;

export default meta;

export const LinkedNotes: StoryObj<RelevantNotesPaneProps> = {};

export const NoUsableChatContext: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "no-usable-context", noteRows: [] },
};

export const MatchedFilesUnavailable: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "matches", noteRows: [] },
};

export const NoActiveNote: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "idle", noteRows: [] },
};

export const Loading: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "loading", noteRows: [] },
};

export const NoLinkedNotes: StoryObj<RelevantNotesPaneProps> = {
  args: { status: "no-matches", noteRows: [] },
};

export const StateTransitions: StoryObj<RelevantNotesPaneProps> = {
  render: function StateTransitionsStory() {
    const states = ["loading", "no-matches", "matches"] as const;
    const [index, setIndex] = useState(0);
    const status = states[index];
    return (
      <div className="tw-flex tw-h-full tw-min-h-0 tw-flex-col tw-gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="tw-self-start"
          onClick={() => setIndex((value) => (value + 1) % states.length)}
        >
          Next state
        </Button>
        <div className="tw-min-h-0 tw-flex-1">
          <RelevantNotesPane
            status={status}
            noteRows={status === "matches" ? baseArgs.noteRows : []}
          />
        </div>
      </div>
    );
  },
};
