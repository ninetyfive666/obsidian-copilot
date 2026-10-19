import { App } from "obsidian";
import {
  EmbeddingIndexStorage,
  FORMAT_VERSION,
  type StoredManifest,
} from "./EmbeddingIndexStorage";

interface FakeApp {
  app: App;
  files: Map<string, string | ArrayBuffer>;
}

function makeFakeApp(): FakeApp {
  const files = new Map<string, string | ArrayBuffer>();
  const adapter = {
    exists: async (path: string) =>
      files.has(path) || Array.from(files.keys()).some((p) => p.startsWith(`${path}/`)),
    read: async (path: string) => files.get(path) as string,
    readBinary: async (path: string) => files.get(path) as ArrayBuffer,
    write: async (path: string, data: string) => {
      files.set(path, data);
    },
    writeBinary: async (path: string, data: ArrayBuffer) => {
      files.set(path, data);
    },
    mkdir: async (path: string) => {
      files.set(`${path}/`, "");
    },
    remove: async (path: string) => {
      files.delete(path);
      files.delete(`${path}/`);
    },
    list: async (dir: string) => ({
      files: Array.from(files.keys()).filter((p) => p.startsWith(`${dir}/`) && !p.endsWith("/")),
      folders: [],
    }),
  };
  const app = { vault: { configDir: "config", adapter } } as unknown as App;
  return { app, files };
}

function manifest(overrides: Partial<StoredManifest> = {}): StoredManifest {
  return {
    format: FORMAT_VERSION,
    modelSignature: "ollama|http://localhost:11434|nomic-embed-text",
    dimension: 2,
    savedAt: 123,
    notes: {},
    ...overrides,
  };
}

describe("EmbeddingIndexStorage", () => {
  it("round-trips chunk ids and vectors through the binary note file", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    const entries = [
      { id: "note.md#0", vector: new Float32Array([0.25, -0.5]) },
      { id: "note.md#1", vector: new Float32Array([1, 0]) },
    ];

    const entry = await storage.writeNote("note.md", 1000, entries);
    const loaded = await storage.readNote("note.md", entry, 2);

    expect(loaded).not.toBeNull();
    expect([...loaded!.keys()]).toEqual(["note.md#0", "note.md#1"]);
    expect([...loaded!.get("note.md#0")!]).toEqual([0.25, -0.5]);
    expect([...loaded!.get("note.md#1")!]).toEqual([1, 0]);
    expect(entry.chunkIds).toEqual(["note.md#0", "note.md#1"]);
  });

  it("supports non-ascii chunk ids", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    const entry = await storage.writeNote("notiz.md", 1000, [
      { id: "notiz.md#0", vector: new Float32Array([0.125, 0.375]) },
    ]);

    const loaded = await storage.readNote("notiz.md", entry, 2);

    expect(loaded?.get("notiz.md#0")).toBeDefined();
  });

  it("returns null when reading with the wrong dimension", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    const entry = await storage.writeNote("note.md", 1000, [
      { id: "note.md#0", vector: new Float32Array([1, 2, 3]) },
    ]);

    const loaded = await storage.readNote("note.md", entry, 2);

    expect(loaded).toBeNull();
  });

  it("returns null for a corrupt note file", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    const entry = await storage.writeNote("note.md", 1000, [
      { id: "note.md#0", vector: new Float32Array([1, 2]) },
    ]);
    const path = `${storage.directory}/${entry.file}`;
    await app.vault.adapter.writeBinary(path, new ArrayBuffer(32));

    const loaded = await storage.readNote("note.md", entry, 2);

    expect(loaded).toBeNull();
  });

  it("returns null from load() when no manifest exists", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);

    expect(await storage.load()).toBeNull();
  });

  it("round-trips the manifest", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    const manifestData = manifest({
      notes: { "note.md": { mtime: 42, chunkIds: ["note.md#0"], file: "abc.bin" } },
    });

    await storage.saveManifest(manifestData);
    const loaded = await storage.load();

    expect(loaded).toEqual(manifestData);
  });

  it("rejects a manifest with an unknown format", async () => {
    const { app, files } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    await app.vault.adapter.mkdir(storage.directory);
    files.set(`${storage.directory}/manifest.json`, JSON.stringify({ ...manifest(), format: 99 }));

    expect(await storage.load()).toBeNull();
  });

  it("removes only the requested note file", async () => {
    const { app } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    const one = await storage.writeNote("one.md", 1, [
      { id: "one.md#0", vector: new Float32Array([1, 0]) },
    ]);
    const two = await storage.writeNote("two.md", 1, [
      { id: "two.md#0", vector: new Float32Array([0, 1]) },
    ]);

    await storage.removeNoteFile(one.file);

    expect(await storage.readNote("one.md", one, 2)).toBeNull();
    expect(await storage.readNote("two.md", two, 2)).not.toBeNull();
  });

  it("clearAll removes manifest and note files", async () => {
    const { app, files } = makeFakeApp();
    const storage = new EmbeddingIndexStorage(app);
    await storage.writeNote("note.md", 1, [{ id: "note.md#0", vector: new Float32Array([1, 0]) }]);
    await storage.saveManifest(manifest());

    await storage.clearAll();

    expect(await storage.load()).toBeNull();
    const remaining = Array.from(files.keys()).filter(
      (p) => p.startsWith(`${storage.directory}/`) && !p.endsWith("/")
    );
    expect(remaining).toEqual([]);
  });
});
