import { FileSystemAdapter, TFile, TFolder, type App } from "obsidian";
import type { ContextCacheFs } from "./contextCacheFs";

let mockFs: ContextCacheFs & { files: Map<string, string> };

jest.mock("./contextCacheFs", () => ({
  createNodeContextCacheFs: () => mockFs,
}));

jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: jest.fn(),
}));
jest.mock(
  "@/search/searchUtils",
  (): Record<string, unknown> => ({
    ...jest.requireActual("@/search/searchUtils"),
    shouldIndexFile: jest.fn(() => true),
  })
);
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

import { getCachedProjectRecordById } from "@/projects/state";
import { shouldIndexFile } from "@/search/searchUtils";
import {
  ensureProjectContextMaterialized,
  materializeProjectContextSource,
  type ContextMaterializeProgress,
} from "./projectContextMaterializer";

const getRecord = getCachedProjectRecordById as jest.Mock;
const indexFile = shouldIndexFile as jest.Mock;

const CWD = "/vault/Proj";

function memFs(): ContextCacheFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    exists: async (p) => files.has(p),
    mkdirRecursive: async () => undefined,
    list: async (dir) => {
      const prefix = dir.endsWith("/") ? dir : `${dir}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .filter((n) => !n.includes("/"));
    },
    readText: async (p) => {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      return files.get(p)!;
    },
    writeText: async (p, c) => void files.set(p, c),
    remove: async (p) => void files.delete(p),
  };
}

function record(contextSource: Record<string, string | undefined>, id = "p1") {
  return { project: { id, contextSource }, filePath: "Proj/AGENTS.md", folderName: "Proj" };
}

const flushMicrotasks = () => new Promise((resolve) => window.setTimeout(resolve, 0));

function textBytes(value: string): ArrayBuffer {
  return new TextEncoder().encode(value).buffer as ArrayBuffer;
}

function fakeApp(
  files: Array<{ path: string; ext: string }> = [],
  folders: string[] = [],
  readBinary: () => Promise<ArrayBuffer> = async () => new ArrayBuffer(4)
): App {
  const tfiles = files.map((f) => {
    const file = new TFile();
    file.path = f.path;
    file.name = f.path.split("/").pop()!;
    file.basename = f.path
      .split("/")
      .pop()!
      .replace(/\.[^.]+$/, "");
    file.extension = f.ext;
    file.stat = { ctime: 1000, mtime: 1000, size: 10 };
    return file;
  });
  const folderSet = new Set(folders);
  const fileMap = new Map(tfiles.map((f) => [f.path, f]));
  const FsAdapter = FileSystemAdapter as unknown as new (basePath: string) => FileSystemAdapter;
  const Folder = TFolder as unknown as new (path: string) => TFolder;
  return {
    vault: {
      adapter: new FsAdapter("/vault"),
      getFiles: () => tfiles,
      getMarkdownFiles: () => tfiles.filter((f) => f.extension === "md"),
      getAbstractFileByPath: (p: string) =>
        fileMap.get(p) ?? (folderSet.has(p) ? new Folder(p) : null),
      readBinary: jest.fn(readBinary),
    },
  } as unknown as App;
}

beforeEach(() => {
  mockFs = memFs();
  jest.clearAllMocks();
  indexFile.mockReturnValue(true);
});

describe("projectContextMaterializer", () => {
  describe("ensureProjectContextMaterialized()", () => {
    it("returns the unavailable-context block with no additional directories when the project is unknown", async () => {
      getRecord.mockReturnValue(undefined);
      const result = await ensureProjectContextMaterialized(fakeApp(), "missing", CWD);
      expect(result.additionalDirectories).toEqual([]);
      expect(result.projectContextBlock).toContain("project workspace");
      expect(result.contextSignature).toBeUndefined();
    });

    it("still emits a minimal project block when the project has no context sources", async () => {
      getRecord.mockReturnValue(record({}));
      const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
      expect(result.additionalDirectories).toEqual([]);
      expect(result.projectContextBlock).toContain("<project_context>");
      expect(result.projectContextBlock).toContain("No context sources are configured");
      expect(mockFs.files.size).toBe(0);
    });

    it("declares web URLs in the block without writing snapshots when remote fetching is unavailable", async () => {
      getRecord.mockReturnValue(record({ webUrls: "https://example.com" }));
      const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);

      expect(result.projectContextBlock).toContain("<project_context>");
      expect(result.projectContextBlock).toContain("https://example.com");
      expect([...mockFs.files.keys()].some((k) => k.startsWith("remotes/web-"))).toBe(false);
      expect([...mockFs.files.keys()].some((k) => k.endsWith("CONTEXT.md"))).toBe(false);
    });

    it("reports only out-of-cwd folder inclusions as additional directories", async () => {
      getRecord.mockReturnValue(record({ inclusions: "External,Proj/Sub" }));
      const app = fakeApp([], ["External", "Proj/Sub"]);

      const result = await ensureProjectContextMaterialized(app, "p1", CWD);

      expect(result.additionalDirectories).toEqual(["/vault/External"]);
      expect(result.projectContextBlock).toContain("`/vault/External`");
      expect(result.projectContextBlock).toContain("`/vault/Proj/Sub`");
    });

    it("lists included notes by absolute path in the context block", async () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([{ path: "Notes/Spec.md", ext: "md" }]);

      const result = await ensureProjectContextMaterialized(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("## Included notes");
      expect(result.projectContextBlock).toContain("`/vault/Notes/Spec.md`");
    });

    it("lists every note that shares an inclusion title (basename collision)", async () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Spec]]" }));
      const app = fakeApp([
        { path: "A/Spec.md", ext: "md" },
        { path: "B/Spec.md", ext: "md" },
      ]);

      const result = await ensureProjectContextMaterialized(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("`/vault/A/Spec.md`");
      expect(result.projectContextBlock).toContain("`/vault/B/Spec.md`");
    });

    it("counts a property-only inclusion as a source and enumerates matching notes by absolute path", async () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      const app = fakeApp([
        { path: "Notes/Relativity.md", ext: "md" },
        { path: "Notes/Cooking.md", ext: "md" },
      ]);
      indexFile.mockImplementation((_app: unknown, file: { path: string }) => file.path === "Notes/Relativity.md"); // prettier-ignore

      const result = await ensureProjectContextMaterialized(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("<project_context>");
      expect(result.projectContextBlock).toContain("## Notes matching an included property");
      expect(result.projectContextBlock).toContain("`/vault/Notes/Relativity.md`");
      expect(result.projectContextBlock).not.toContain("Cooking");
    });

    it("lists a note reached by both a title and a property once, as a declaration", async () => {
      getRecord.mockReturnValue(record({ inclusions: "[[Relativity]],[Topics:Physics]" }));
      const app = fakeApp([{ path: "Notes/Relativity.md", ext: "md" }]);
      indexFile.mockReturnValue(true);

      const result = await ensureProjectContextMaterialized(app, "p1", CWD);

      const block = result.projectContextBlock ?? "";
      expect(block.match(/\/vault\/Notes\/Relativity\.md/g)).toHaveLength(1);
      expect(block).toContain("## Included notes");
      expect(block).not.toContain("## Notes matching an included property");
    });

    it("still emits <project_context> for a property-only project when no note currently matches", async () => {
      getRecord.mockReturnValue(record({ inclusions: "[Topics:Physics]" }));
      const app = fakeApp([{ path: "Notes/Cooking.md", ext: "md" }]);
      indexFile.mockReturnValue(false);

      const result = await ensureProjectContextMaterialized(app, "p1", CWD);

      expect(result.projectContextBlock).toContain("<project_context>");
      expect(result.projectContextBlock).not.toContain("## Included notes");
    });

    it("materializes in-vault files as local text but ignores markdown files", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp(
        [
          { path: "Proj/a.pdf", ext: "pdf" },
          { path: "Proj/note.md", ext: "md" },
        ],
        [],
        async () => textBytes("pdf text")
      );

      await ensureProjectContextMaterialized(app, "p1", CWD);

      const snapshots = [...mockFs.files.keys()].filter((k) => k.includes("/file-"));
      expect(snapshots).toHaveLength(1);
      expect(mockFs.files.get(snapshots[0])).toContain("pdf text");
    });

    it("reports binary in-vault files as unsupported offline instead of snapshotting them", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () => new ArrayBuffer(4));

      const progress: ContextMaterializeProgress[] = [];
      await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

      expect([...mockFs.files.keys()].some((k) => k.includes("/file-"))).toBe(false);
      const failures = progress.find((p) => p.phase === "failures");
      if (failures?.phase !== "failures") throw new Error("expected failures progress");
      expect(failures.failures).toHaveLength(1);
      expect(failures.failures[0].error).toContain("Unsupported");
    });

    it("reports resolve + per-loop progress through onProgress", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj", webUrls: "https://example.com" }));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () =>
        textBytes("pdf text")
      );

      const progress: ContextMaterializeProgress[] = [];
      await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

      expect(progress[0]).toEqual({ phase: "resolve", resolved: 1 });
      expect(progress).toContainEqual({ phase: "prefetch", done: 1, total: 1 });
      expect(progress).toContainEqual({ phase: "parse", done: 1, total: 1 });
    });

    it("returns the unavailable-context block when a cache filesystem write throws", async () => {
      getRecord.mockReturnValue(record({ webUrls: "https://example.com" }));
      mockFs.mkdirRecursive = jest.fn(async () => {
        throw new Error("EACCES");
      });

      const result = await ensureProjectContextMaterialized(fakeApp(), "p1", CWD);
      expect(result.additionalDirectories).toEqual([]);
      expect(result.projectContextBlock).toContain("project workspace");
      expect(result.projectContextBlock).toContain("could not be loaded");
      expect(result.contextSignature).toBeUndefined();
    });

    it("dedupes concurrent calls for the same project to one run", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const readBinary = jest.fn(async () => textBytes("content"));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], readBinary);

      const [r1, r2] = await Promise.all([
        ensureProjectContextMaterialized(app, "p1", CWD),
        ensureProjectContextMaterialized(app, "p1", CWD),
      ]);

      expect(readBinary).toHaveBeenCalledTimes(1);
      expect(r1).toBe(r2);
    });

    it("does not serialize different projects with DIFFERENT sources", async () => {
      getRecord.mockImplementation((id: string) => record({ inclusions: "Proj" }, id));
      const readBinaryP1 = jest.fn(async () => textBytes("p1 text"));
      const readBinaryP2 = jest.fn(async () => textBytes("p2 text"));

      await Promise.all([
        ensureProjectContextMaterialized(
          fakeApp([{ path: "P1/a.pdf", ext: "pdf" }], [], readBinaryP1),
          "p1",
          "/vault/P1"
        ),
        ensureProjectContextMaterialized(
          fakeApp([{ path: "P2/b.pdf", ext: "pdf" }], [], readBinaryP2),
          "p2",
          "/vault/P2"
        ),
      ]);

      expect(readBinaryP1).toHaveBeenCalledTimes(1);
      expect(readBinaryP2).toHaveBeenCalledTimes(1);
    });

    it("dedupes two projects converting the SAME file to a single parse (global per-artifact lock)", async () => {
      getRecord.mockImplementation((id: string) => record({ inclusions: "Proj" }, id));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let calls = 0;
      const readBinary = jest.fn(async () => {
        calls += 1;
        await gate;
        return textBytes(`content #${calls}`);
      });

      const a = ensureProjectContextMaterialized(
        fakeApp([{ path: "Proj/shared.pdf", ext: "pdf" }], [], readBinary),
        "pA",
        "/vault/PA"
      );
      await flushMicrotasks();
      const b = ensureProjectContextMaterialized(
        fakeApp([{ path: "Proj/shared.pdf", ext: "pdf" }], [], readBinary),
        "pB",
        "/vault/PB"
      );
      await flushMicrotasks();
      release();
      await Promise.all([a, b]);

      expect(readBinary).toHaveBeenCalledTimes(1);
      const snapshots = [...mockFs.files.keys()].filter((k) => k.includes("/file-"));
      expect(snapshots).toHaveLength(1);
      expect(mockFs.files.get(snapshots[0])).toContain("content #1");
    });

    it("clears the in-flight entry so a later call re-evaluates fresh state", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const appA = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () => textBytes("A"));
      await ensureProjectContextMaterialized(appA, "p1", CWD);

      const appB = fakeApp([{ path: "Proj/b.pdf", ext: "pdf" }], [], async () => textBytes("B"));
      await ensureProjectContextMaterialized(appB, "p1", CWD);

      expect(appA.vault.readBinary).toHaveBeenCalledTimes(1);
      expect(appB.vault.readBinary).toHaveBeenCalledTimes(1);
    });

    it("supersedes an in-flight run whose source set was edited (a later caller must not join the stale run)", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const readBinary = jest.fn(async () => {
        await gate;
        return textBytes("A text");
      });
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], readBinary);

      const a = ensureProjectContextMaterialized(app, "p1", CWD);
      await flushMicrotasks();

      getRecord.mockReturnValue(record({ inclusions: "Proj, Other" }));
      const appB = fakeApp([{ path: "Proj/b.pdf", ext: "pdf" }], [], async () =>
        textBytes("B text")
      );
      const b = ensureProjectContextMaterialized(appB, "p1", CWD);

      release();
      const [aRes, bRes] = await Promise.all([a, b]);

      expect(bRes).not.toBe(aRes);
    });

    it("supersedes an in-flight run when a caller passes a NEWER revisionKey (same config signature)", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const readBinary = jest.fn(async () => {
        await gate;
        return textBytes("A text");
      });
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], readBinary);

      const a = ensureProjectContextMaterialized(app, "p1", CWD, undefined, undefined, "sig#0");
      await flushMicrotasks();
      const b = ensureProjectContextMaterialized(app, "p1", CWD, undefined, undefined, "sig#1");

      release();
      const [aRes, bRes] = await Promise.all([a, b]);

      expect(bRes).not.toBe(aRes);
    });

    it("cheap-skips a known-bad source on the next automatic run (no re-parse)", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () => new ArrayBuffer(4));
      const readBinary = app.vault.readBinary as jest.Mock;

      await ensureProjectContextMaterialized(app, "p1", CWD);
      expect([...mockFs.files.keys()].some((k) => k.includes("failed-file-"))).toBe(true);

      const progress: ContextMaterializeProgress[] = [];
      await ensureProjectContextMaterialized(app, "p1", CWD, (p) => progress.push(p));

      expect(readBinary).toHaveBeenCalledTimes(1);
      const failures = progress.find((p) => p.phase === "failures");
      expect(failures?.phase === "failures" && failures.failures).toHaveLength(1);
    });

    it("a forced retry supersedes an in-flight non-forced run and later callers join the forced run", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () => new ArrayBuffer(4));
      await ensureProjectContextMaterialized(app, "p1", CWD);
      expect([...mockFs.files.keys()].some((k) => k.includes("failed-file-"))).toBe(true);

      app.vault.readBinary = jest.fn(async () => textBytes("A recovered"));

      const warm = ensureProjectContextMaterialized(app, "p1", CWD);
      const forced = ensureProjectContextMaterialized(app, "p1", CWD, undefined, true);
      const joiner = ensureProjectContextMaterialized(app, "p1", CWD);

      const [warmRes, forcedRes, joinerRes] = await Promise.all([warm, forced, joiner]);
      expect(joinerRes).toBe(forcedRes);
      expect(joinerRes).not.toBe(warmRes);

      const snapshotA = [...mockFs.files.keys()].find(
        (k) => k.includes("/file-") && mockFs.files.get(k)!.includes("A recovered")
      );
      expect(snapshotA).toBeDefined();
      expect([...mockFs.files.keys()].some((k) => k.includes("failed-file-"))).toBe(false);
    });
  });

  describe("materializeProjectContextSource()", () => {
    it("retries a source past its failure marker and clears the marker once it succeeds", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () => new ArrayBuffer(4));
      await ensureProjectContextMaterialized(app, "p1", CWD);

      app.vault.readBinary = jest.fn(async () => textBytes("recovered"));
      const failures = await materializeProjectContextSource(app, "p1", {
        kind: "file",
        source: "Proj/a.pdf",
      });

      expect(failures).toHaveLength(0);
      const snapshot = [...mockFs.files.keys()].find((k) => k.includes("/file-"));
      expect(mockFs.files.get(snapshot!)).toContain("recovered");
      expect([...mockFs.files.keys()].some((k) => k.includes("failed-file-"))).toBe(false);
    });

    it("a concurrent full run neither re-parses nor overwrites a single-source retry of the same file", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));
      const app = fakeApp([{ path: "Proj/a.pdf", ext: "pdf" }], [], async () => new ArrayBuffer(4));
      await ensureProjectContextMaterialized(app, "p1", CWD);
      expect([...mockFs.files.keys()].some((k) => k.includes("failed-file-"))).toBe(true);

      let releaseParse!: () => void;
      const gate = new Promise<void>((resolve) => {
        releaseParse = resolve;
      });
      const readBinary = jest.fn(async () => {
        await gate;
        return textBytes("recovered");
      });
      app.vault.readBinary = readBinary;

      const retry = materializeProjectContextSource(app, "p1", {
        kind: "file",
        source: "Proj/a.pdf",
      });
      await flushMicrotasks();

      const full = ensureProjectContextMaterialized(app, "p1", CWD);
      await flushMicrotasks();

      releaseParse();
      await Promise.all([retry, full]);

      const snapshot = [...mockFs.files.keys()].find((k) => k.includes("/file-"));
      expect(snapshot).toBeDefined();
      expect(mockFs.files.get(snapshot!)).toContain("recovered");
      expect([...mockFs.files.keys()].some((k) => k.includes("failed-file-"))).toBe(false);
      expect(readBinary).toHaveBeenCalledTimes(1);
    });

    it("reports a remote source as unsupported instead of fetching it", async () => {
      getRecord.mockReturnValue(record({ webUrls: "https://a.com" }));

      const failures = await materializeProjectContextSource(fakeApp(), "p1", {
        kind: "web",
        source: "https://a.com",
      });

      expect(failures).toEqual([
        {
          source: "https://a.com",
          kind: "web",
          error: expect.stringMatching(/network access/i) as string,
          usedStaleSnapshot: false,
        },
      ]);
    });

    it("returns a Project not found failure for an unknown project", async () => {
      getRecord.mockReturnValue(undefined);

      const failures = await materializeProjectContextSource(fakeApp(), "missing", {
        kind: "web",
        source: "https://a.com",
      });

      expect(failures).toEqual([
        {
          source: "https://a.com",
          kind: "web",
          error: "Project not found",
          usedStaleSnapshot: false,
        },
      ]);
    });

    it("returns a File not found in vault failure for a file source that is not in the vault", async () => {
      getRecord.mockReturnValue(record({ inclusions: "Proj" }));

      const failures = await materializeProjectContextSource(fakeApp(), "p1", {
        kind: "file",
        source: "Proj/gone.pdf",
      });

      expect(failures).toEqual([
        {
          source: "Proj/gone.pdf",
          kind: "file",
          error: "File not found in vault",
          usedStaleSnapshot: false,
        },
      ]);
    });
  });
});
