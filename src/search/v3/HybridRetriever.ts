import { Document } from "@langchain/core/documents";
import { App, TFile } from "obsidian";
import { logWarn } from "@/logger";
import { getSharedChunkManager } from "./chunks";
import type { DocumentRetriever } from "@/search/RetrieverFactory";
import { LocalEmbeddingClient } from "@/search/embeddings/LocalEmbeddingClient";
import { LocalEmbeddingIndex } from "@/search/embeddings/LocalEmbeddingIndex";

const INDEX_READY_TIMEOUT_MS = 2000;
const RRF_K = 60;
const MIN_SEMANTIC_SCORE = 0.1;

export class HybridRetriever implements DocumentRetriever {
  constructor(
    private lexical: DocumentRetriever,
    private index: LocalEmbeddingIndex,
    private client: LocalEmbeddingClient,
    private app: App,
    private maxK: number
  ) {}

  async getRelevantDocuments(query: string): Promise<Document[]> {
    const lexicalPromise = this.lexical.getRelevantDocuments(query);
    const semanticReady = await this.index.waitForReady(INDEX_READY_TIMEOUT_MS);
    const lexicalDocs = await lexicalPromise;
    const semanticDocs = semanticReady ? await this.searchSemantic(query) : [];
    return rrfMerge(lexicalDocs, semanticDocs);
  }

  private async searchSemantic(query: string): Promise<Document[]> {
    try {
      const queryVector = await this.client.embedQuery(query);
      const hits = this.index.search(queryVector, Math.max(this.maxK, 10));
      const documents: Document[] = [];
      const chunkManager = getSharedChunkManager(this.app);

      for (const hit of hits) {
        if (hit.score < MIN_SEMANTIC_SCORE) continue;
        const [notePath] = hit.chunkId.split("#");
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (!file || !(file instanceof TFile)) continue;

        const content = await chunkManager.getChunkText(hit.chunkId);
        if (!content) continue;

        const cache = this.app.metadataCache.getFileCache(file);
        documents.push(
          new Document({
            pageContent: content,
            metadata: {
              path: notePath,
              chunkId: hit.chunkId,
              title: file.basename,
              mtime: file.stat.mtime,
              ctime: file.stat.ctime,
              tags: cache?.tags?.map((tag) => tag.tag) || [],
              score: hit.score,
              rerank_score: hit.score,
              engine: "local-semantic",
              includeInContext: true,
              isChunk: true,
            },
          })
        );
      }
      return documents;
    } catch (error) {
      logWarn("HybridRetriever: semantic leg failed, falling back to lexical", error);
      return [];
    }
  }
}

function rrfMerge(primary: Document[], secondary: Document[]): Document[] {
  if (secondary.length === 0) return primary;

  const entries = new Map<string, { score: number; doc: Document }>();
  const bump = (docs: Document[]): void => {
    docs.forEach((doc, rank) => {
      const id = String(doc.metadata.chunkId ?? doc.metadata.path);
      const contribution = 1 / (RRF_K + rank + 1);
      const existing = entries.get(id);
      if (existing) {
        existing.score += contribution;
      } else {
        entries.set(id, { score: contribution, doc });
      }
    });
  };

  bump(primary);
  bump(secondary);

  return Array.from(entries.values())
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.doc);
}
