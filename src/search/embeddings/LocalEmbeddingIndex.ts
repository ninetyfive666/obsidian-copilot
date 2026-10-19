import { App, TFile } from "obsidian";
import { logInfo, logWarn } from "@/logger";
import { getMatchingPatterns, shouldIndexFile } from "@/search/searchUtils";
import { getSharedChunkManager } from "@/search/v3/chunks";
import { LocalEmbeddingClient } from "./LocalEmbeddingClient";

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

interface IndexedNote {
  mtime: number;
  chunkIds: string[];
}

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
  private buildPromise: Promise<void> | null = null;
  private terminalWaiters: Array<() => void> = [];
  private disposed = false;

  constructor(
    private app: App,
    private client: LocalEmbeddingClient
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

  async buildAll(): Promise<void> {
    if (this.buildPromise) return this.buildPromise;
    this.buildPromise = this.runBuild().finally(() => {
      this.buildPromise = null;
    });
    return this.buildPromise;
  }

  async refreshNote(file: TFile): Promise<void> {
    if (this.disposed) return;
    const current = this.app.vault.getAbstractFileByPath(file.path);
    if (!current || !(current instanceof TFile)) {
      this.removeNote(file.path);
      return;
    }
    await this.indexNote(current);
  }

  removeNote(notePath: string): void {
    const entry = this.notes.get(notePath);
    if (!entry) return;
    for (const chunkId of entry.chunkIds) {
      this.chunks.delete(chunkId);
    }
    this.notes.delete(notePath);
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
      void this.buildAll();
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
    this.notes.clear();
    this.chunks.clear();
    this.dimension = 0;
    this.progress = { total: 0, done: 0 };
    for (const waiter of this.terminalWaiters.splice(0)) {
      waiter();
    }
  }

  private async runBuild(): Promise<void> {
    const { inclusions, exclusions } = getMatchingPatterns();
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((file) => shouldIndexFile(this.app, file, inclusions, exclusions));

    this.status = "building";
    this.progress = { total: files.length, done: 0 };

    let failures = 0;
    for (const file of files) {
      if (this.disposed) return;
      try {
        await this.indexNote(file);
      } catch (error) {
        failures += 1;
        logWarn(`LocalEmbeddingIndex: failed to index ${file.path}`, error);
      }
      this.progress.done += 1;
      if (this.progress.done % YIELD_EVERY_NOTES === 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    if (this.disposed) return;
    const indexed = this.chunks.size > 0 || files.length === 0;
    this.status = indexed ? "ready" : "error";
    if (failures > 0) {
      logInfo(
        `LocalEmbeddingIndex: build finished with ${failures} failed notes (${this.chunks.size} chunks indexed)`
      );
    }
    this.notifyTerminal();
  }

  private async indexNote(file: TFile): Promise<void> {
    const content = await this.app.vault.cachedRead(file);
    const chunkManager = getSharedChunkManager(this.app);
    const chunks = await chunkManager.getChunks([file.path]);

    this.removeNote(file.path);
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
    this.notes.set(file.path, {
      mtime: file.stat.mtime,
      chunkIds: chunks.map((chunk) => chunk.id),
    });
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
