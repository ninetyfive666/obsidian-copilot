import { App, TFile } from "obsidian";
import { logInfo, logWarn } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSharedChunkManager } from "@/search/v3/chunks";
import {
  FORMAT_VERSION,
  type EmbeddingIndexStorageApi,
  type StoredManifest,
  type StoredNoteEntry,
} from "./EmbeddingIndexStorage";
import { LocalEmbeddingClient } from "./LocalEmbeddingClient";
import {
  addIndexingError,
  type IndexingCompletionStatus,
  resetIndexingProgressState,
  setIndexingProgressState,
  updateIndexedCountThrottled,
  updateIndexingProgressState,
} from "./indexingProgress";

export type LocalEmbeddingIndexStatus = "idle" | "building" | "ready" | "error";

export interface EmbeddingIndexProgress {
  total: number;
  done: number;
}

export interface EmbeddingSearchHit {
  chunkId: string;
  notePath: string;
  score: number;
}

type IndexedNote = StoredNoteEntry;

interface IndexedChunk {
  notePath: string;
  vector: Float32Array;
}

const YIELD_EVERY_NOTES = 25;

export class LocalEmbeddingIndex {
  private notes = new Map<string, IndexedNote>();
  private chunks = new Map<string, IndexedChunk>();
  private dimension = 0;
  private status: LocalEmbeddingIndexStatus = "idle";
  private progress: EmbeddingIndexProgress = { total: 0, done: 0 };
  private syncPromise: Promise<void> | null = null;
  private terminalWaiters: Array<() => void> = [];
  private disposed = false;
  private pauseRequested = false;
  private cancelRequested = false;

  constructor(
    private app: App,
    private client: LocalEmbeddingClient,
    private storage: EmbeddingIndexStorageApi,
    private modelSignature: string
  ) {}

  getStatus(): LocalEmbeddingIndexStatus {
    return this.disposed ? "idle" : this.status;
  }

  getProgress(): EmbeddingIndexProgress {
    return { ...this.progress };
  }

  getChunkCount(): number {
    return this.chunks.size;
  }

  listIndexedNotes(): string[] {
    return Array.from(this.notes.keys()).sort();
  }

  pause(): void {
    this.pauseRequested = true;
    updateIndexingProgressState({ isPaused: true });
  }

  resume(): void {
    this.pauseRequested = false;
    updateIndexingProgressState({ isPaused: false });
  }

  stop(): void {
    this.pauseRequested = false;
    this.cancelRequested = true;
    updateIndexingProgressState({ isPaused: false });
  }

  async clear(): Promise<void> {
    if (this.disposed) return;
    if (this.syncPromise) {
      this.cancelRequested = true;
      await this.syncPromise;
    }
    this.pauseRequested = false;
    this.cancelRequested = false;
    await this.storage.clearAll();
    this.notes.clear();
    this.chunks.clear();
    this.dimension = 0;
    this.progress = { total: 0, done: 0 };
    await this.persistManifest();
    this.status = "ready";
    this.notifyTerminal();
  }

  async forceRebuild(): Promise<number> {
    if (this.disposed) return 0;
    if (this.syncPromise) {
      this.cancelRequested = true;
      await this.syncPromise;
    }
    this.pauseRequested = false;
    this.cancelRequested = false;
    await this.storage.clearAll();
    this.notes.clear();
    this.chunks.clear();
    this.dimension = 0;
    await this.persistManifest();
    await this.sync();
    return this.notes.size;
  }

  async sync(): Promise<void> {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.runSync().finally(() => {
      this.syncPromise = null;
    });
    return this.syncPromise;
  }

  async refreshNote(file: TFile): Promise<void> {
    if (this.disposed || this.status !== "ready") return;
    const current = this.app.vault.getAbstractFileByPath(file.path);
    if (!current || !(current instanceof TFile)) {
      await this.removeNote(file.path);
      return;
    }
    await this.indexNote(current);
    await this.persistManifest();
  }

  async removeNote(notePath: string): Promise<void> {
    const entry = this.notes.get(notePath);
    if (!entry) return;
    for (const chunkId of entry.chunkIds) {
      this.chunks.delete(chunkId);
    }
    this.notes.delete(notePath);
    await this.storage.removeNoteFile(entry.file);
  }

  search(queryVector: Float32Array, k: number): EmbeddingSearchHit[] {
    if (this.chunks.size === 0 || k <= 0) return [];
    const queryNorm = this.norm(queryVector);
    if (queryNorm === 0) return [];

    const hits: EmbeddingSearchHit[] = [];
    for (const [chunkId, chunk] of this.chunks.entries()) {
      if (chunk.vector.length !== queryVector.length) continue;
      const vectorNorm = this.norm(chunk.vector);
      if (vectorNorm === 0) continue;
      let dot = 0;
      for (let i = 0; i < queryVector.length; i++) {
        dot += queryVector[i] * chunk.vector[i];
      }
      hits.push({
        chunkId,
        notePath: chunk.notePath,
        score: dot / (queryNorm * vectorNorm),
      });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, k);
  }

  async waitForReady(timeoutMs: number): Promise<boolean> {
    if (this.status === "ready") return true;
    if (this.status === "error") return false;
    if (this.status === "idle") {
      void this.sync();
    }
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        const index = this.terminalWaiters.indexOf(onTerminal);
        if (index >= 0) this.terminalWaiters.splice(index, 1);
        resolve(value);
      };
      const onTerminal = () => {
        finish(this.status === "ready");
      };
      this.terminalWaiters.push(onTerminal);
      const timer = window.setTimeout(() => finish(this.status === "ready"), timeoutMs);
    });
  }

  dispose(): void {
    this.disposed = true;
    this.status = "idle";
    this.cancelRequested = true;
    this.notes.clear();
    this.chunks.clear();
    this.dimension = 0;
    this.progress = { total: 0, done: 0 };
    for (const waiter of this.terminalWaiters.splice(0)) {
      waiter();
    }
    resetIndexingProgressState();
  }

  private async runSync(): Promise<void> {
    this.pauseRequested = false;
    this.cancelRequested = false;
    await this.restoreFromStorage();

    const { inclusions, exclusions } = getMatchingPatterns();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => shouldIndexFile(this.app, file, inclusions, exclusions));
    const currentPaths = new Set(files.map((file) => file.path));

    this.status = "building";
    this.progress = { total: files.length, done: 0 };
    setIndexingProgressState({
      isActive: true,
      isPaused: false,
      indexedCount: 0,
      totalFiles: files.length,
      errors: [],
      completionStatus: "none",
    });

    let failures = 0;
    for (const file of files) {
      if (this.disposed) {
        resetIndexingProgressState();
        return;
      }
      if (this.cancelRequested) break;
      await this.waitWhilePaused();
      if (this.cancelRequested || this.disposed) break;
      if (!this.isUpToDate(file)) {
        try {
          await this.indexNote(file);
        } catch (error) {
          failures += 1;
          const message = error instanceof Error ? error.message : String(error);
          addIndexingError(`${file.path}: ${message}`);
          logWarn(`LocalEmbeddingIndex: failed to index ${file.path}`, error);
        }
      }
      this.progress.done += 1;
      updateIndexedCountThrottled(this.progress.done);
      if (this.progress.done % YIELD_EVERY_NOTES === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    for (const notePath of Array.from(this.notes.keys())) {
      if (this.disposed) break;
      if (currentPaths.has(notePath)) continue;
      await this.removeNote(notePath);
    }

    if (this.disposed) {
      resetIndexingProgressState();
      return;
    }
    await this.persistManifest();
    const indexed = this.chunks.size > 0 || files.length === 0;
    this.status = indexed ? "ready" : "error";
    const completionStatus: IndexingCompletionStatus = this.cancelRequested
      ? "cancelled"
      : failures > 0 || !indexed
        ? "error"
        : "success";
    logInfo(
      `LocalEmbeddingIndex: sync finished (${this.notes.size} notes, ${this.chunks.size} chunks, ${failures} failures, ${completionStatus})`
    );
    this.notifyTerminal();
    updateIndexingProgressState({
      isActive: false,
      isPaused: false,
      indexedCount: this.progress.done,
      completionStatus,
    });
  }

  private async waitWhilePaused(): Promise<void> {
    while (this.pauseRequested && !this.cancelRequested && !this.disposed) {
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
  }

  private async restoreFromStorage(): Promise<void> {
    const manifest = await this.storage.load();
    if (!manifest) return;
    if (manifest.modelSignature !== this.modelSignature) {
      logInfo("LocalEmbeddingIndex: embedding model changed, rebuilding the persisted index.");
      await this.storage.clearAll();
      return;
    }
    this.dimension = manifest.dimension;
    for (const [notePath, entry] of Object.entries(manifest.notes)) {
      const vectors = await this.storage.readNote(notePath, entry, manifest.dimension);
      if (!vectors) continue;
      vectors.forEach((vector, chunkId) => {
        this.chunks.set(chunkId, { notePath, vector });
      });
      this.notes.set(notePath, entry);
    }
    if (this.notes.size > 0) {
      logInfo(
        `LocalEmbeddingIndex: restored ${this.notes.size} notes (${this.chunks.size} chunks) from the persisted index.`
      );
    }
  }

  private isUpToDate(file: TFile): boolean {
    const entry = this.notes.get(file.path);
    if (!entry || entry.mtime !== file.stat.mtime || entry.chunkIds.length === 0) {
      return false;
    }
    return entry.chunkIds.every((chunkId) => this.chunks.has(chunkId));
  }

  private async indexNote(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const chunkManager = getSharedChunkManager(this.app);
    const chunks = await chunkManager.getChunks([file.path]);

    this.forgetNote(file.path);
    if (!content || chunks.length === 0) return;

    const vectors = await this.client.embed(chunks.map((chunk) => chunk.content));
    const dim = vectors[0]?.length ?? 0;
    if (dim === 0) return;
    if (this.dimension !== 0 && this.dimension !== dim) {
      throw new Error(
        `Embedding dimension changed from ${this.dimension} to ${dim}; rebuilding the index.`
      );
    }
    this.dimension = dim;

    for (let i = 0; i < chunks.length; i++) {
      this.chunks.set(chunks[i].id, {
        notePath: file.path,
        vector: vectors[i],
      });
    }
    const entry = await this.storage.writeNote(
      file.path,
      file.stat.mtime,
      chunks.map((chunk, i) => ({ id: chunk.id, vector: vectors[i] }))
    );
    this.notes.set(file.path, entry);
  }

  private forgetNote(notePath: string): void {
    const entry = this.notes.get(notePath);
    if (entry) {
      for (const chunkId of entry.chunkIds) {
        this.chunks.delete(chunkId);
      }
      this.notes.delete(notePath);
    }
    for (const chunkId of Array.from(this.chunks.keys())) {
      if (chunkId.startsWith(`${notePath}#`)) {
        this.chunks.delete(chunkId);
      }
    }
  }

  private async persistManifest(): Promise<void> {
    const manifest: StoredManifest = {
      format: FORMAT_VERSION,
      modelSignature: this.modelSignature,
      dimension: this.dimension,
      savedAt: Date.now(),
      notes: Object.fromEntries(this.notes),
    };
    await this.storage.saveManifest(manifest);
  }

  private norm(vector: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < vector.length; i++) {
      sum += vector[i] * vector[i];
    }
    return Math.sqrt(sum);
  }

  private notifyTerminal(): void {
    for (const waiter of this.terminalWaiters.splice(0)) {
      waiter();
    }
  }
}
