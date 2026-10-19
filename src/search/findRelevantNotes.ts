import { getBacklinkedNotes, getLinkedNotes } from "@/noteUtils";
import { App, TFile } from "obsidian";

const MAX_RESULTS = 20;

export type RelevantNotesSearchStatus = "no-usable-context" | "matches" | "no-matches";

function getNoteLinks(app: App, file: TFile) {
  const resultMap = new Map<string, { links: boolean; backlinks: boolean }>();
  const linkedNotes = getLinkedNotes(app, file);
  const linkedNotePaths = linkedNotes.map((note) => note.path);
  for (const notePath of linkedNotePaths) {
    resultMap.set(notePath, { links: true, backlinks: false });
  }

  const backlinkedNotes = getBacklinkedNotes(app, file);
  const backlinkedNotePaths = backlinkedNotes.map((note) => note.path);
  for (const notePath of backlinkedNotePaths) {
    if (resultMap.has(notePath)) {
      resultMap.set(notePath, { links: true, backlinks: true });
    } else {
      resultMap.set(notePath, { links: false, backlinks: true });
    }
  }

  return resultMap;
}

function localNoteScoreByPath(app: App, filePath: string, file: TFile): Map<string, number> {
  const scoreByPath = new Map<string, number>();
  for (const [path, { links, backlinks }] of getNoteLinks(app, file).entries()) {
    if (path === filePath) continue;
    const note = app.vault.getAbstractFileByPath(path);
    if (!(note instanceof TFile) || note.extension !== "md") continue;
    scoreByPath.set(path, links && backlinks ? 1 : links ? 0.8 : 0.5);
  }
  return scoreByPath;
}

export interface RelevantNoteEntry {
  note: {
    path: string;
    title: string;
  };
  metadata: {
    score: number;
    hasOutgoingLinks: boolean;
    hasBacklinks: boolean;
  };
}

export interface RelevantNotesResult {
  notes: readonly RelevantNoteEntry[];
  status: RelevantNotesSearchStatus;
}

const EMPTY_RELEVANT_NOTES: readonly RelevantNoteEntry[] = Object.freeze([]);

// Live re-queries mostly reproduce the previous ranking; callers skip re-rendering
// (and replaying animations) when results render identically.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/362
export function isSameRelevantNotesResult(a: RelevantNotesResult, b: RelevantNotesResult): boolean {
  if (a === b) return true;
  if (a.status !== b.status) return false;
  if (a.notes.length !== b.notes.length) return false;
  return a.notes.every((note, index) => {
    const other = b.notes[index];
    return (
      note.note.path === other.note.path &&
      note.note.title === other.note.title &&
      note.metadata.score === other.metadata.score &&
      note.metadata.hasOutgoingLinks === other.metadata.hasOutgoingLinks &&
      note.metadata.hasBacklinks === other.metadata.hasBacklinks
    );
  });
}

export interface FindRelevantNotesOptions {
  app: App;
  filePath: string;
}

export async function findRelevantNotes({
  app,
  filePath,
}: FindRelevantNotesOptions): Promise<RelevantNotesResult> {
  const file = app.vault.getAbstractFileByPath(filePath);
  if (!(file instanceof TFile) || file.extension !== "md") {
    return { notes: EMPTY_RELEVANT_NOTES, status: "no-matches" };
  }

  const noteLinks = getNoteLinks(app, file);
  const scoreByPath = localNoteScoreByPath(app, filePath, file);

  const notes = [...scoreByPath.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_RESULTS)
    .map(([path, score]) => {
      const related = app.vault.getAbstractFileByPath(path);
      const title = related instanceof TFile ? related.basename : (path.split("/").pop() ?? path);
      return {
        note: { path, title },
        metadata: {
          score,
          hasOutgoingLinks: noteLinks.get(path)?.links ?? false,
          hasBacklinks: noteLinks.get(path)?.backlinks ?? false,
        },
      };
    });

  return {
    notes: notes.length === 0 ? EMPTY_RELEVANT_NOTES : notes,
    status: notes.length === 0 ? "no-matches" : "matches",
  };
}
