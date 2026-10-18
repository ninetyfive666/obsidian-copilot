import { RelevantNotesPane, type RelevantNotesPaneProps } from "./RelevantNotesPane";
import { render, screen } from "@testing-library/react";
import React from "react";

const BASE_PROPS: RelevantNotesPaneProps = {
  status: "matches",
  noteRows: [<div key="related">Related note</div>],
};

describe("RelevantNotesPane", () => {
  describe("RelevantNotesPane()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("renders local matches without setup guidance", () => {
      render(<RelevantNotesPane {...BASE_PROPS} />);

      expect(screen.getByText("Related note")).toBeTruthy();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });

    it("shows a centered no-matches card instead of stale note rows", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="no-matches" />);

      expect(screen.getByText("No relevant notes found")).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
    });

    it("explains a chat with no usable context instead of note rows", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="no-usable-context" noteRows={[]} />);

      expect(screen.getByText("No usable chat context")).toBeTruthy();
      expect(screen.getByText("Write a message or add a note to find related notes.")).toBeTruthy();
      expect(screen.queryByText("Related note")).toBeNull();
    });

    it("shows neutral loading feedback while the local search is pending", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="loading" noteRows={[]} />);

      expect(screen.getByText("Finding relevant notes…")).toBeTruthy();
      expect(screen.queryByText("No relevant notes found")).toBeNull();
    });

    it("renders the neutral empty state when no source note is active", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="idle" noteRows={[]} />);

      expect(screen.getByText("No relevant notes found")).toBeTruthy();
    });

    it("hides rows while a matched search still has nothing to show", () => {
      render(<RelevantNotesPane {...BASE_PROPS} status="matches" noteRows={[]} />);

      expect(screen.queryByText("Related note")).toBeNull();
      expect(screen.getByText("No relevant notes found")).toBeTruthy();
    });
  });
});
