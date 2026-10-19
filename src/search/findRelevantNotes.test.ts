import { logError } from "@/logger";
import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import {
  findRelevantNotes,
  isSameRelevantNotesResult,
  type RelevantNoteEntry,
  type RelevantNotesResult,
} from "@/search/findRelevantNotes";
import { App, TFile } from "obsidian";

jest.mock("@/noteUtils", () => ({
  getLinkedNotes: jest.fn(),
  getBacklinkedNotes: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function createMarkdownFile(path: string): TFile {
  const TFileConstructor = TFile as unknown as new (filePath: string) => TFile;
  return new TFileConstructor(path);
}

function createVault(files: TFile[]): App {
  return {
    vault: {
      getAbstractFileByPath: (path: string) => files.find((file) => file.path === path) ?? null,
    },
  } as unknown as App;
}

const mockedGetLinkedNotes = getLinkedNotes as jest.MockedFunction<typeof getLinkedNotes>;
const mockedGetBacklinkedNotes = getBacklinkedNotes as jest.MockedFunction<
  typeof getBacklinkedNotes
>;
const mockedLogError = logError as jest.MockedFunction<typeof logError>;

describe("findRelevantNotes", () => {
  let app: App;
  let source: TFile;
  let linked: TFile;
  let backlinked: TFile;
  let mutual: TFile;
  let nonMarkdown: TFile;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetLinkedNotes.mockReset();
    mockedGetBacklinkedNotes.mockReset();
    source = createMarkdownFile("Research.md");
    linked = createMarkdownFile("Linked.md");
    backlinked = createMarkdownFile("Backlinked.md");
    mutual = createMarkdownFile("Mutual.md");
    nonMarkdown = createMarkdownFile("Board.canvas");
    app = createVault([source, linked, backlinked, mutual, nonMarkdown]);
    mockedGetLinkedNotes.mockReturnValue([linked, mutual, nonMarkdown]);
    mockedGetBacklinkedNotes.mockReturnValue([backlinked, mutual, source]);
  });

  describe("findRelevantNotes()", () => {
    it("returns no matches for a source that is not a Markdown note", async () => {
      const canvasSource = createVault([]);
      mockedGetLinkedNotes.mockReturnValue([]);
      mockedGetBacklinkedNotes.mockReturnValue([]);

      const result = await findRelevantNotes({ app: canvasSource, filePath: "Board.canvas" });

      expect(result).toEqual({ notes: [], status: "no-matches" });
      expect(mockedLogError).not.toHaveBeenCalled();
    });

    it("returns no matches when the note has no links and no backlinks", async () => {
      mockedGetLinkedNotes.mockReturnValue([]);
      mockedGetBacklinkedNotes.mockReturnValue([]);

      const result = await findRelevantNotes({ app, filePath: "Research.md" });

      expect(result).toEqual({ notes: [], status: "no-matches" });
    });

    it("ranks direct links and backlinks with outgoing links scoring highest", async () => {
      const result = await findRelevantNotes({ app, filePath: "Research.md" });

      expect(result.status).toBe("matches");
      expect(result.notes.map((note) => note.note.path)).toEqual([
        "Mutual.md",
        "Linked.md",
        "Backlinked.md",
      ]);
      expect(result.notes[0].metadata.score).toBe(1);
      expect(result.notes[0].metadata.hasOutgoingLinks).toBe(true);
      expect(result.notes[0].metadata.hasBacklinks).toBe(true);
      expect(result.notes[1].metadata.score).toBe(0.8);
      expect(result.notes[1].metadata.hasOutgoingLinks).toBe(true);
      expect(result.notes[1].metadata.hasBacklinks).toBe(false);
      expect(result.notes[2].metadata.score).toBe(0.5);
      expect(result.notes[2].metadata.hasOutgoingLinks).toBe(false);
      expect(result.notes[2].metadata.hasBacklinks).toBe(true);
    });

    it("skips non-Markdown link targets and the source note itself", async () => {
      const result = await findRelevantNotes({ app, filePath: "Research.md" });

      const paths = result.notes.map((note) => note.note.path);
      expect(paths).not.toContain("Board.canvas");
      expect(paths).not.toContain("Research.md");
    });

    it("caps the result list at twenty entries", async () => {
      const many = Array.from({ length: 25 }, (_, i) => createMarkdownFile(`Note-${i}.md`));
      const bigApp = createVault([source, ...many]);
      mockedGetLinkedNotes.mockReturnValue(many);
      mockedGetBacklinkedNotes.mockReturnValue([]);

      const result = await findRelevantNotes({ app: bigApp, filePath: "Research.md" });

      expect(result.status).toBe("matches");
      expect(result.notes).toHaveLength(20);
    });
  });

  describe("isSameRelevantNotesResult()", () => {
    const base: RelevantNotesResult = {
      status: "matches",
      notes: [
        {
          note: { path: "A.md", title: "A" },
          metadata: { score: 0.8, hasOutgoingLinks: true, hasBacklinks: false },
        } satisfies RelevantNoteEntry,
      ],
    };

    it("returns true for the same reference", () => {
      expect(isSameRelevantNotesResult(base, base)).toBe(true);
    });

    it("returns false when the status differs", () => {
      expect(isSameRelevantNotesResult(base, { status: "no-matches", notes: [] })).toBe(false);
    });

    it("returns false when a note differs", () => {
      const other: RelevantNotesResult = {
        status: "matches",
        notes: [
          {
            note: { path: "B.md", title: "B" },
            metadata: { score: 0.5, hasOutgoingLinks: false, hasBacklinks: true },
          },
        ],
      };
      expect(isSameRelevantNotesResult(base, other)).toBe(false);
    });

    it("returns false when a score changes", () => {
      const other: RelevantNotesResult = {
        status: "matches",
        notes: [
          {
            note: { path: "A.md", title: "A" },
            metadata: { score: 0.7, hasOutgoingLinks: true, hasBacklinks: false },
          },
        ],
      };
      expect(isSameRelevantNotesResult(base, other)).toBe(false);
    });

    it("returns false when the row count differs", () => {
      const extra = [
        ...base.notes,
        {
          note: { path: "C.md", title: "C" },
          metadata: { score: 0.5, hasOutgoingLinks: false, hasBacklinks: true },
        },
      ];
      expect(isSameRelevantNotesResult(base, { status: "matches", notes: extra })).toBe(false);
    });
  });
});
