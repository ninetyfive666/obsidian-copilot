import { App, TFile } from "obsidian";
import { shouldIndexFile } from "@/search/searchUtils";
import { getSharedChunkManager } from "@/search/v3/chunks";
import {
  type EmbeddingIndexStorageApi,
  type StoredManifest,
  type StoredNoteEntry,
} from "./EmbeddingIndexStorage";
import { LocalEmbeddingClient } from "./LocalEmbeddingClient";
import { LocalEmbeddingIndex } from "./LocalEmbeddingIndex";

jest.mock("@/search/searchUtils", () => ({
  getMatchingPatterns: jest.fn(() => ({ inclusions: null, exclusions: null })),
  shouldIndexFile: jest.fn(() => true),
}));

jest.mock("@/search/v3/chunks", () => ({
  getSharedChunkManager: jest.fn(),
}));

const TFileConstructor = TFile as unknown as new (path: string) => TFile;

function makeTFile(path: string, mtime = 1000): TFile {
  const file = new TFileConstructor(path);
  (file as unknown as { stat: { mtime: number; ctime: number } }).stat = {
    mtime,
    ctime: 900,
  };
  return file;
}

interface FakeNote {
  path: string;
  content: string;
  mtime?: number;
}

function makeApp(notes: FakeNote[]): App {
  return {
    vault: {
      getMarkdownFiles: () => notes.map((note) => makeTFile(note.path, note.mtime)),
      getAbstractFileByPath: (path: string) => {
        const note = notes.find((n) => n.path === path);
        return note ? makeTFile(note.path, note.mtime) : null;
      },
      cachedRead: async (file: TFile) =>
        notes.find((note) => note.path === file.path)?.content ?? "",
    },
  } as unknown as App;
}

function chunkFactoryFor(notes: FakeNote[]) {
  return {
    getChunks: async (paths: string[]) =>
      paths.flatMap((path) =>
        notes.some((note) => note.path === path)
          ? [
              {
                id: `${path}#0`,
                notePath: path,
                chunkIndex: 0,
                content: `chunk from ${path}`,
                contentHash: "h",
                title: path,
                heading: "",
                mtime: 1000,
              },
            ]
          : []
      ),
  };
}

function vectorClient(vectorsByContent: Map<string, number[]>) {
  return {
    embed: jest.fn(async (texts: string[]) =>
      texts.map((text) => new Float32Array(vectorsByContent.get(text) ?? [0, 0]))
    ),
  } as unknown as LocalEmbeddingClient;
}

interface StoredNoteData {
  entry: StoredNoteEntry;
  vectors: Map<string, Float32Array>;
  dimension: number;
}

class FakeStorage implements EmbeddingIndexStorageApi {
  manifest: StoredManifest | null = null;
  notes = new Map<string, StoredNoteData>();
  loadCalls = 0;
  clearAllCalls = 0;
  removedFiles: string[] = [];

  async load() {
    this.loadCalls += 1;
    return this.manifest;
  }

  async readNote(notePath: string, entry: StoredNoteEntry, dimension: number) {
    const data = this.notes.get(notePath);
    if (!data || data.entry.file !== entry.file || data.dimension !== dimension) return null;
    return data.vectors;
  }

  async writeNote(
    notePath: string,
    mtime: number,
    entries: Array<{ id: string; vector: Float32Array }>
  ) {
    const dimension = entries[0]?.vector.length ?? 0;
    const entry: StoredNoteEntry = {
      mtime,
      chunkIds: entries.map((e) => e.id),
      file: `${notePath}.bin`,
    };
    this.notes.set(notePath, {
      entry,
      vectors: new Map(entries.map((e) => [e.id, e.vector])),
      dimension,
    });
    return entry;
  }

  async saveManifest(manifest: StoredManifest) {
    this.manifest = manifest;
  }

  async removeNoteFile(file: string) {
    this.removedFiles.push(file);
    for (const [path, data] of Array.from(this.notes.entries())) {
      if (data.entry.file === file) this.notes.delete(path);
    }
  }

  async clearAll() {
    this.clearAllCalls += 1;
    this.manifest = null;
    this.notes.clear();
  }
}

const SIGNATURE = "ollama|http://localhost:11434|nomic-embed-text";

function makeIndex(
  notes: FakeNote[],
  client: LocalEmbeddingClient,
  storage: EmbeddingIndexStorageApi,
  signature = SIGNATURE
): LocalEmbeddingIndex {
  jest.mocked(getSharedChunkManager).mockReturnValue(chunkFactoryFor(notes) as never);
  return new LocalEmbeddingIndex(makeApp(notes), client, storage, signature);
}

describe("LocalEmbeddingIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(shouldIndexFile).mockReturnValue(true);
  });

  it("indexes all notes on the first sync and persists a manifest", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );
    const storage = new FakeStorage();

    const index = makeIndex(notes, client, storage);
    await index.sync();

    expect(index.getStatus()).toBe("ready");
    expect(index.getChunkCount()).toBe(2);
    expect(storage.notes.size).toBe(2);
    expect(storage.manifest?.modelSignature).toBe(SIGNATURE);
    expect(Object.keys(storage.manifest?.notes ?? {})).toEqual(["a.md", "b.md"]);
  });

  it("reuses the persisted index without embedding on the second sync", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const first = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );
    const storage = new FakeStorage();

    await makeIndex(notes, first, storage).sync();

    const second = vectorClient(new Map());
    const indexTwo = makeIndex(notes, second, storage);
    await indexTwo.sync();

    expect(second.embed).not.toHaveBeenCalled();
    expect(indexTwo.getStatus()).toBe("ready");
    expect(indexTwo.getChunkCount()).toBe(2);
    expect(storage.loadCalls).toBe(2);
  });

  it("re-embeds only the notes whose mtime changed", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );
    const storage = new FakeStorage();

    await makeIndex(notes, client, storage).sync();
    jest.mocked(client.embed).mockClear();

    const edited: FakeNote[] = [
      { path: "a.md", content: "alpha", mtime: 2000 },
      { path: "b.md", content: "beta" },
    ];
    await makeIndex(edited, client, storage).sync();

    expect(client.embed).toHaveBeenCalledTimes(1);
    expect(client.embed).toHaveBeenCalledWith(["chunk from a.md"]);
  });

  it("removes stale notes that no longer exist in the vault", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );
    const storage = new FakeStorage();

    await makeIndex(notes, client, storage).sync();

    const shrunken: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const indexAfterDelete = makeIndex(shrunken, client, storage);
    await indexAfterDelete.sync();

    expect(storage.notes.has("b.md")).toBe(false);
    expect(indexAfterDelete.getChunkCount()).toBe(1);
    const hits = indexAfterDelete.search(new Float32Array([1, 0]), 5);
    expect(hits.map((hit) => hit.chunkId)).toEqual(["a.md#0"]);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it("clears the persisted index when the embedding model changed", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const first = vectorClient(new Map([["chunk from a.md", [1, 0]]]));
    const storage = new FakeStorage();

    await makeIndex(notes, first, storage).sync();

    const second = vectorClient(new Map([["chunk from a.md", [0, 1]]]));
    const otherModel = "ollama|http://localhost:11434|mxbai-embed-large";
    const indexTwo = makeIndex(notes, second, storage, otherModel);
    await indexTwo.sync();

    expect(storage.clearAllCalls).toBe(1);
    expect(storage.manifest?.modelSignature).toBe(otherModel);
    const hits = indexTwo.search(new Float32Array([0, 1]), 5);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it("replaces vectors when a note is refreshed", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["new content", [0, 1]],
      ])
    );
    const storage = new FakeStorage();
    const chunkManager = {
      getChunks: jest.fn(async (paths: string[]) =>
        paths.map((path) => ({
          id: `${path}#0`,
          notePath: path,
          chunkIndex: 0,
          content: "new content",
          contentHash: "h",
          title: path,
          heading: "",
          mtime: 1000,
        }))
      ),
    };
    jest.mocked(getSharedChunkManager).mockReturnValue(chunkManager as never);

    const index = new LocalEmbeddingIndex(makeApp(notes), client, storage, SIGNATURE);
    await index.sync();
    await index.refreshNote(makeTFile("a.md"));

    expect(index.getChunkCount()).toBe(1);
    const hits = index.search(new Float32Array([0, 1]), 5);
    expect(hits[0].score).toBeCloseTo(1, 5);
    expect(storage.manifest).not.toBeNull();
  });

  it("ranks chunks by cosine similarity", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );
    const storage = new FakeStorage();

    const index = makeIndex(notes, client, storage);
    await index.sync();

    const hits = index.search(new Float32Array([1, 0.2]), 2);

    expect(hits[0].chunkId).toBe("a.md#0");
    expect(hits[1].chunkId).toBe("b.md#0");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("resolves waitForReady after the sync finishes", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const client = vectorClient(new Map([["chunk from a.md", [1, 0]]]));
    const storage = new FakeStorage();

    const index = makeIndex(notes, client, storage);
    const ready = index.waitForReady(1000);
    await index.sync();

    await expect(ready).resolves.toBe(true);
  });

  it("resolves waitForReady with false when the sync does not finish in time", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const hanging = {
      embed: jest.fn(() => new Promise(() => {})),
    } as unknown as LocalEmbeddingClient;
    const storage = new FakeStorage();

    const index = makeIndex(notes, hanging, storage);

    await expect(index.waitForReady(20)).resolves.toBe(false);
  });
});
