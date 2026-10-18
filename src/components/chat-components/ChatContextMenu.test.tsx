import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { TFile } from "obsidian";

jest.mock("obsidian", () => ({
  TFile: class {},
  TFolder: class {},
  Platform: { isDesktopApp: true },
}));

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/context", () => ({
  useApp: () => ({}),
}));

jest.mock("@/aiParams", () => ({
  useChainType: () => ["llm_chain"],
}));

/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: () => true,
}));

jest.mock("@/utils", () => ({
  isPlusChain: () => false,
  openFileInWorkspace: jest.fn(),
}));

jest.mock("./AtMentionTypeahead", () => ({
  AtMentionTypeahead: () => null,
}));

import { ChatContextMenu } from "./ChatContextMenu";

const baseProps = {
  includeActiveNote: false,
  currentActiveFile: null,
  includeActiveWebTab: false,
  activeWebTab: null,
  contextNotes: [] as TFile[],
  contextUrls: [] as string[],
  contextFolders: [] as string[],
  contextWebTabs: [],
  onRemoveContext: jest.fn(),
  showProgressCard: jest.fn(),
  onTypeaheadSelect: jest.fn(),
};

describe("ChatContextMenu", () => {
  describe("ChatContextMenu()", () => {
    it("shows the context note badge next to the entry", () => {
      const note = Object.assign(new TFile(), {
        path: "Note.md",
        basename: "Note",
        extension: "md",
      });
      render(<ChatContextMenu {...baseProps} contextNotes={[note]} />);
      expect(screen.getByText("Note")).toBeTruthy();
    });

    it("keeps the empty row in legacy Chat — the '@ Add context' entry lives here", () => {
      render(<ChatContextMenu {...baseProps} />);
      expect(screen.getByText("Add context")).toBeTruthy();
    });
    it.each([
      { label: "only the active note", includeActiveNote: true, includeSelection: false },
      { label: "only the selection", includeActiveNote: false, includeSelection: true },
    ])(
      "renders $label independently - https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      ({ includeActiveNote, includeSelection }) => {
        const note = Object.assign(new TFile(), {
          path: "Note.md",
          basename: "Note",
          extension: "md",
        });
        render(
          <ChatContextMenu
            {...baseProps}
            currentActiveFile={note}
            includeActiveNote={includeActiveNote}
            selectedTextContexts={
              includeSelection
                ? [
                    {
                      id: "excerpt",
                      sourceType: "note",
                      content: "Selected passage",
                      notePath: note.path,
                      noteTitle: note.basename,
                      startLine: 2,
                      endLine: 3,
                    },
                  ]
                : []
            }
          />
        );
        expect(Boolean(screen.queryByText("Current"))).toBe(includeActiveNote);
        expect(Boolean(screen.queryByText("L2-3"))).toBe(includeSelection);
      }
    );
    it.each(["Note.md", "Other note.md"])(
      "keeps the active note beside a selection from %s - https://github.com/Brevilabs/obsidian-copilot-private/issues/465",
      (notePath) => {
        const note = Object.assign(new TFile(), {
          path: "Note.md",
          basename: "Note",
          extension: "md",
        });
        const selection = {
          id: "excerpt",
          sourceType: "note" as const,
          content: "Selected passage",
          notePath,
          noteTitle: "Selected note",
          startLine: 2,
          endLine: 3,
        };
        const onRemoveContext = jest.fn();
        const props = {
          ...baseProps,
          currentActiveFile: note,
          includeActiveNote: true,
          selectedTextContexts: [selection],
          onRemoveContext,
        };
        const { rerender } = render(<ChatContextMenu {...props} />);
        expect(screen.getByText("Current")).toBeTruthy();
        expect(screen.getByText("L2-3")).toBeTruthy();

        fireEvent.keyDown(screen.getByText("Current").parentElement!, { key: "Enter" });
        expect(onRemoveContext).toHaveBeenLastCalledWith("activeNote", "");
        rerender(<ChatContextMenu {...props} includeActiveNote={false} />);
        expect(screen.queryByText("Current")).toBeNull();
        expect(screen.getByText("L2-3")).toBeTruthy();

        rerender(<ChatContextMenu {...props} />);
        fireEvent.keyDown(screen.getByText("L2-3").parentElement!, { key: "Enter" });
        expect(onRemoveContext).toHaveBeenLastCalledWith("selectedText", "excerpt");
        rerender(<ChatContextMenu {...props} selectedTextContexts={[]} />);
        expect(screen.getByText("Current")).toBeTruthy();
        expect(screen.queryByText("L2-3")).toBeNull();
      }
    );
  });
});
