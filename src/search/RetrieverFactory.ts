import { logInfo } from "@/logger";
import { App } from "obsidian";
import { getSettings } from "@/settings/model";
import { getLocalEmbeddingService } from "./embeddings/localEmbeddingService";
import { HybridRetriever } from "./v3/HybridRetriever";
import { TieredLexicalRetriever } from "./v3/TieredLexicalRetriever";

export interface RetrieverOptions {
  minSimilarityScore?: number;
  maxK: number;
  salientTerms?: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll?: boolean;
  useRerankerThreshold?: number;
  tagTerms?: string[];
}

interface NormalizedRetrieverOptions {
  minSimilarityScore: number;
  maxK: number;
  salientTerms: string[];
  timeRange?: { startTime: number; endTime: number };
  textWeight?: number;
  returnAll: boolean;
  useRerankerThreshold?: number;
  tagTerms: string[];
}

export interface RetrieverSelectionResult {
  retriever: DocumentRetriever;
  type: "lexical" | "hybrid";
  reason: string;
}

function normalizeOptions(options: RetrieverOptions): NormalizedRetrieverOptions {
  return {
    minSimilarityScore: options.minSimilarityScore ?? 0.1,
    maxK: options.maxK,
    salientTerms: options.salientTerms ?? [],
    timeRange: options.timeRange,
    textWeight: options.textWeight,
    returnAll: options.returnAll ?? false,
    useRerankerThreshold: options.useRerankerThreshold,
    tagTerms: options.tagTerms ?? [],
  };
}

export interface DocumentRetriever {
  getRelevantDocuments(query: string): Promise<import("@langchain/core/documents").Document[]>;
}

export class RetrieverFactory {
  static async createRetriever(
    app: App,
    options: RetrieverOptions
  ): Promise<RetrieverSelectionResult> {
    const normalizedOptions = normalizeOptions(options);

    if (getSettings().useLocalEmbeddings) {
      const service = getLocalEmbeddingService();
      if (service) {
        const retriever = new HybridRetriever(
          new TieredLexicalRetriever(app, normalizedOptions),
          service.index,
          service.client,
          app,
          normalizedOptions.maxK
        );
        logInfo("RetrieverFactory: Using HybridRetriever (lexical + local semantic)");
        return {
          retriever,
          type: "hybrid",
          reason: "Local embeddings enabled",
        };
      }
    }

    // A legacy semantic-search flag may remain in data.json until its settings
    // migration, but it must not resurrect the removed cloud semantic backend.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/281
    const retriever = new TieredLexicalRetriever(app, normalizedOptions);
    logInfo("RetrieverFactory: Using TieredLexicalRetriever (lexical search)");
    return {
      retriever,
      type: "lexical",
      reason: "Default lexical search",
    };
  }

  static createLexicalRetriever(app: App, options: RetrieverOptions): TieredLexicalRetriever {
    return new TieredLexicalRetriever(app, normalizeOptions(options));
  }

  static getRetrieverType(): "lexical" | "hybrid" {
    return getSettings().useLocalEmbeddings && getLocalEmbeddingService() ? "hybrid" : "lexical";
  }
}
