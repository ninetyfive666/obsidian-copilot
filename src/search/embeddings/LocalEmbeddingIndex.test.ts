import { App, TFile } from "obsidian";
import { shouldIndexFile } from "@/search/searchUtils";
import { getSharedChunkManager } from "@/search/v3/chunks";
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

function makeTFile(path: string): TFile {
  const file = new TFileConstructor(path);
  (file as unknown as { stat: { mtime: number; ctime: number } }).stat = {
    mtime: 1000,
    ctime: 900,
  };
  return file;
}

interface FakeNote {
  path: string;
  content: string;
}

function makeApp(notes: FakeNote[]): App {
  return {
    vault: {
      getMarkdownFiles: () => notes.map((note) => makeTFile(note.path)),
      getAbstractFileByPath: (path: string) =>
        notes.some((note) => note.path === path) ? makeTFile(path) : null,
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

describe("LocalEmbeddingIndex", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(shouldIndexFile).mockReturnValue(true);
  });

  it("builds the index and reaches ready status", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const app = makeApp(notes);
    jest.mocked(getSharedChunkManager).mockReturnValue(chunkFactoryFor(notes) as never);
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );

    const index = new LocalEmbeddingIndex(app, client);
    await index.buildAll();

    expect(index.getStatus()).toBe("ready");
    expect(index.getChunkCount()).toBe(2);
    expect(index.getProgress()).toEqual({ total: 2, done: 2 });
  });

  it("ranks chunks by cosine similarity", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const app = makeApp(notes);
    jest.mocked(getSharedChunkManager).mockReturnValue(chunkFactoryFor(notes) as never);
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );

    const index = new LocalEmbeddingIndex(app, client);
    await index.buildAll();

    const hits = index.search(new Float32Array([1, 0.2]), 2);

    expect(hits[0].chunkId).toBe("a.md#0");
    expect(hits[1].chunkId).toBe("b.md#0");
    expect(hits[0].score).toBeGreaterThan(hits[1].score);
  });

  it("removes chunks when a note is deleted", async () => {
    const notes: FakeNote[] = [
      { path: "a.md", content: "alpha" },
      { path: "b.md", content: "beta" },
    ];
    const app = makeApp(notes);
    jest.mocked(getSharedChunkManager).mockReturnValue(chunkFactoryFor(notes) as never);
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["chunk from b.md", [0, 1]],
      ])
    );

    const index = new LocalEmbeddingIndex(app, client);
    await index.buildAll();
    index.removeNote("a.md");

    expect(index.getChunkCount()).toBe(1);
    expect(index.search(new Float32Array([1, 0]), 5).map((hit) => hit.chunkId)).toEqual(["b.md#0"]);
  });

  it("replaces vectors when a note is refreshed", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const app = makeApp(notes);
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
    const client = vectorClient(
      new Map([
        ["chunk from a.md", [1, 0]],
        ["new content", [0, 1]],
      ])
    );

    const index = new LocalEmbeddingIndex(app, client);
    await index.buildAll();
    await index.refreshNote(makeTFile("a.md"));

    expect(index.getChunkCount()).toBe(1);
    const hits = index.search(new Float32Array([0, 1]), 5);
    expect(hits[0].score).toBeCloseTo(1, 5);
  });

  it("resolves waitForReady after the build finishes", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const app = makeApp(notes);
    jest.mocked(getSharedChunkManager).mockReturnValue(chunkFactoryFor(notes) as never);
    const client = vectorClient(new Map([["chunk from a.md", [1, 0]]]));

    const index = new LocalEmbeddingIndex(app, client);
    const ready = index.waitForReady(1000);
    await index.buildAll();

    await expect(ready).resolves.toBe(true);
  });

  it("resolves waitForReady with false when the build does not finish in time", async () => {
    const notes: FakeNote[] = [{ path: "a.md", content: "alpha" }];
    const app = makeApp(notes);
    jest.mocked(getSharedChunkManager).mockReturnValue(chunkFactoryFor(notes) as never);
    const hanging = {
      embed: jest.fn(() => new Promise(() => {})),
    } as unknown as LocalEmbeddingClient;

    const index = new LocalEmbeddingIndex(app, hanging);

    await expect(index.waitForReady(20)).resolves.toBe(false);
  });
});
