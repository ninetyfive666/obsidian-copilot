import { App } from "obsidian";
import { logWarn } from "@/logger";

const STORAGE_DIR = "copilot-embeddings";
const MANIFEST_FILE = "manifest.json";
export const FORMAT_VERSION = 1;
const MAGIC = new Uint8Array([0x43, 0x45, 0x49, 0x56]);

export interface StoredNoteEntry {
  mtime: number;
  chunkIds: string[];
  file: string;
}

export interface StoredManifest {
  format: number;
  modelSignature: string;
  dimension: number;
  savedAt: number;
  notes: Record<string, StoredNoteEntry>;
}

export interface EmbeddingIndexStorageApi {
  load(): Promise<StoredManifest | null>;
  readNote(
    notePath: string,
    entry: StoredNoteEntry,
    dimension: number
  ): Promise<Map<string, Float32Array> | null>;
  writeNote(
    notePath: string,
    mtime: number,
    entries: Array<{ id: string; vector: Float32Array }>
  ): Promise<StoredNoteEntry>;
  saveManifest(manifest: StoredManifest): Promise<void>;
  removeNoteFile(file: string): Promise<void>;
  clearAll(): Promise<void>;
}

export class EmbeddingIndexStorage implements EmbeddingIndexStorageApi {
  constructor(private app: App) {}

  get directory(): string {
    return `${this.app.vault.configDir}/${STORAGE_DIR}`;
  }

  async load(): Promise<StoredManifest | null> {
    const manifestPath = `${this.directory}/${MANIFEST_FILE}`;
    try {
      if (!(await this.app.vault.adapter.exists(manifestPath))) return null;
      const raw = await this.app.vault.adapter.read(manifestPath);
      const parsed = JSON.parse(raw) as StoredManifest;
      if (
        parsed.format !== FORMAT_VERSION ||
        typeof parsed.modelSignature !== "string" ||
        typeof parsed.notes !== "object" ||
        parsed.notes === null
      ) {
        return null;
      }
      return parsed;
    } catch (error) {
      logWarn("EmbeddingIndexStorage: could not read the index manifest, starting fresh", error);
      return null;
    }
  }

  async readNote(
    notePath: string,
    entry: StoredNoteEntry,
    dimension: number
  ): Promise<Map<string, Float32Array> | null> {
    const path = `${this.directory}/${entry.file}`;
    try {
      const buffer = await this.app.vault.adapter.readBinary(path);
      const view = new DataView(buffer);
      if (buffer.byteLength < 16) return null;
      for (let i = 0; i < 4; i++) {
        if (view.getUint8(i) !== MAGIC[i]) return null;
      }
      if (view.getUint32(4, true) !== FORMAT_VERSION) return null;
      const dim = view.getUint32(8, true);
      if (dim !== dimension) return null;
      const count = view.getUint32(12, true);

      const vectors = new Map<string, Float32Array>();
      let offset = 16;
      const encoder = new TextDecoder();
      for (let i = 0; i < count; i++) {
        const idLength = view.getUint32(offset, true);
        offset += 4;
        const id = encoder.decode(new Uint8Array(buffer, offset, idLength));
        offset += idLength;
        const vectorBytes = new ArrayBuffer(dim * 4);
        new Uint8Array(vectorBytes).set(new Uint8Array(buffer, offset, dim * 4));
        vectors.set(id, new Float32Array(vectorBytes));
        offset += dim * 4;
      }
      return vectors;
    } catch (error) {
      logWarn(`EmbeddingIndexStorage: could not read index data for ${notePath}`, error);
      return null;
    }
  }

  async writeNote(
    notePath: string,
    mtime: number,
    entries: Array<{ id: string; vector: Float32Array }>
  ): Promise<StoredNoteEntry> {
    const file = noteFileName(notePath);
    const dimension = entries[0]?.vector.length ?? 0;
    const idBytes = entries.map((entry) => new TextEncoder().encode(entry.id));
    const total =
      16 + entries.reduce((sum, entry, i) => sum + 4 + idBytes[i].byteLength + dimension * 4, 0);

    const buffer = new ArrayBuffer(total);
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    bytes.set(MAGIC, 0);
    view.setUint32(4, FORMAT_VERSION, true);
    view.setUint32(8, dimension, true);
    view.setUint32(12, entries.length, true);
    let offset = 16;
    for (let i = 0; i < entries.length; i++) {
      view.setUint32(offset, idBytes[i].byteLength, true);
      offset += 4;
      bytes.set(idBytes[i], offset);
      offset += idBytes[i].byteLength;
      bytes.set(new Uint8Array(entries[i].vector.buffer), offset);
      offset += dimension * 4;
    }

    await this.ensureDirectory();
    await this.app.vault.adapter.writeBinary(`${this.directory}/${file}`, buffer);
    return { mtime, chunkIds: entries.map((entry) => entry.id), file };
  }

  async saveManifest(manifest: StoredManifest): Promise<void> {
    await this.ensureDirectory();
    await this.app.vault.adapter.write(
      `${this.directory}/${MANIFEST_FILE}`,
      JSON.stringify(manifest)
    );
  }

  async removeNoteFile(file: string): Promise<void> {
    const path = `${this.directory}/${file}`;
    try {
      if (await this.app.vault.adapter.exists(path)) {
        await this.app.vault.adapter.remove(path);
      }
    } catch (error) {
      logWarn("EmbeddingIndexStorage: could not remove an index file", error);
    }
  }

  async clearAll(): Promise<void> {
    try {
      if (!(await this.app.vault.adapter.exists(this.directory))) return;
      const listing = await this.app.vault.adapter.list(this.directory);
      for (const item of listing.files) {
        await this.app.vault.adapter.remove(item);
      }
    } catch (error) {
      logWarn("EmbeddingIndexStorage: could not clear the index directory", error);
    }
  }

  private async ensureDirectory(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.directory))) {
      await this.app.vault.adapter.mkdir(this.directory);
    }
  }
}

function noteFileName(notePath: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < notePath.length; i++) {
    const c = notePath.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}.bin`;
}
