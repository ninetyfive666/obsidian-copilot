import { logInfo } from "@/logger";
import { Notice, TFile, Vault } from "obsidian";
import { CanvasLoader } from "./CanvasLoader";

interface FileParser {
  supportedExtensions: string[];
  parseFile: (file: TFile, vault: Vault) => Promise<string>;
}

class MarkdownParser implements FileParser {
  supportedExtensions = ["md", "base"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    return await vault.read(file);
  }
}

class PlainTextParser implements FileParser {
  supportedExtensions = ["txt", "csv", "tsv", "json", "html", "htm"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    return await vault.read(file);
  }
}

class CanvasParser implements FileParser {
  supportedExtensions = ["canvas"];

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    try {
      logInfo("Parsing Canvas file:", file.path);
      const canvasLoader = new CanvasLoader(vault);
      const canvasData = await canvasLoader.load(file);

      return canvasLoader.buildPrompt(canvasData);
    } catch {
      return `[Error: Could not parse Canvas file ${file.basename}]`;
    }
  }
}

class UnsupportedBinaryParser implements FileParser {
  supportedExtensions = ["pdf", "docx", "pptx", "xlsx", "epub"];

  async parseFile(file: TFile): Promise<string> {
    return `[Unsupported: ${file.name} cannot be converted offline. This plugin only reads plain-text notes.]`;
  }
}

export class FileParserManager {
  private parsers: Map<string, FileParser> = new Map();

  constructor(_vault: Vault) {
    this.registerParser(new MarkdownParser());
    this.registerParser(new PlainTextParser());
    this.registerParser(new CanvasParser());
    this.registerParser(new UnsupportedBinaryParser());
  }

  registerParser(parser: FileParser) {
    for (const ext of parser.supportedExtensions) {
      this.parsers.set(ext, parser);
    }
  }

  async parseFile(file: TFile, vault: Vault): Promise<string> {
    const parser = this.parsers.get(file.extension);
    if (!parser) {
      throw new Error(`No parser found for file type: ${file.extension}`);
    }
    return await parser.parseFile(file, vault);
  }

  supportsExtension(extension: string): boolean {
    return this.parsers.has(extension);
  }

  clearPDFCache(_vault: Vault): void {
    new Notice("The PDF cache no longer exists in the local-only plugin.", 4000);
  }
}
