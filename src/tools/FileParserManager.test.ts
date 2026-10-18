jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

import { FileParserManager } from "./FileParserManager";
import { CanvasLoader } from "./CanvasLoader";
import { Notice, type TFile, type Vault } from "obsidian";

jest.mock("./CanvasLoader", () => ({
  CanvasLoader: jest.fn().mockImplementation(() => ({
    load: jest.fn(async () => ({})),
    buildPrompt: jest.fn(() => "canvas prompt"),
  })),
}));

function fileFixture(name: string, extension: string): TFile {
  return {
    path: `docs/${name}.${extension}`,
    name: `${name}.${extension}`,
    basename: name,
    extension,
  } as unknown as TFile;
}

function makeVault(): Vault & { read: jest.Mock } {
  const read = jest.fn(async () => "# note body\n");
  return { read } as unknown as Vault & { read: jest.Mock };
}

describe("FileParserManager", () => {
  let manager: FileParserManager;
  let vault: Vault & { read: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    manager = new FileParserManager(vault = makeVault());
  });

  describe("registerParser()", () => {
    it("registers every local parser for its extensions", () => {
      for (const ext of ["md", "base", "txt", "csv", "tsv", "json", "html", "htm", "canvas"]) {
        expect(manager.supportsExtension(ext)).toBe(true);
      }
      for (const ext of ["pdf", "docx", "pptx", "xlsx", "epub"]) {
        expect(manager.supportsExtension(ext)).toBe(true);
      }
      expect(manager.supportsExtension("xyz")).toBe(false);
    });
  });

  describe("parseFile()", () => {
    it("reads Markdown notes from the vault", async () => {
      const note = fileFixture("Research", "md");

      await expect(manager.parseFile(note, vault)).resolves.toBe("# note body\n");
      expect(vault.read).toHaveBeenCalledWith(note);
    });

    it("reads plain-text documents from the vault", async () => {
      for (const ext of ["txt", "csv", "tsv", "json", "html"]) {
        const doc = fileFixture(`Doc-${ext}`, ext);
        await expect(manager.parseFile(doc, vault)).resolves.toBe("# note body\n");
      }
    });

    it("builds a prompt for canvas files", async () => {
      const canvas = fileFixture("Board", "canvas");

      await expect(manager.parseFile(canvas, vault)).resolves.toBe("canvas prompt");
      const loader = (CanvasLoader as unknown as jest.Mock).mock.instances[0];
      expect(loader.load).toHaveBeenCalledWith(canvas);
      expect(loader.buildPrompt).toHaveBeenCalled();
    });

    it("reports binary formats as unsupported offline instead of throwing", async () => {
      for (const ext of ["pdf", "docx", "pptx", "xlsx", "epub"]) {
        const doc = fileFixture(`Doc-${ext}`, ext);
        const result = await manager.parseFile(doc, vault);
        expect(result).toContain("Unsupported");
        expect(result).toContain(`Doc-${ext}.${ext}`);
      }
    });

    it("throws for a file type with no registered parser", async () => {
      const unknown = fileFixture("Data", "xyz");

      await expect(manager.parseFile(unknown, vault)).rejects.toThrow(
        "No parser found for file type: xyz"
      );
    });
  });

  describe("clearPDFCache()", () => {
    it("explains that no PDF cache exists in the local-only plugin", () => {
      manager.clearPDFCache(vault);

      expect(Notice).toHaveBeenCalledWith(
        "The PDF cache no longer exists in the local-only plugin.",
        4000
      );
    });
  });
});
