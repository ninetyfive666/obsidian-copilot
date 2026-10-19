import { ChatModelProviders } from "@/constants";
import { safeFetchNoThrow } from "@/utils";

export interface EmbeddingConnection {
  provider: ChatModelProviders;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
  enableCors?: boolean;
}

export class LocalEmbeddingClientError extends Error {}

const BATCH_SIZE = 16;
const REQUEST_TIMEOUT_MS = 120_000;

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export class LocalEmbeddingClient {
  constructor(private connection: EmbeddingConnection) {}

  private get endpoint(): string {
    const base = trimTrailingSlash(
      this.connection.baseUrl ||
        (this.connection.provider === ChatModelProviders.OLLAMA ? "http://localhost:11434" : "")
    );
    if (!base) {
      throw new LocalEmbeddingClientError("No base URL is configured for the embedding provider.");
    }
    return this.connection.provider === ChatModelProviders.OLLAMA
      ? `${base}/api/embed`
      : `${base}/embeddings`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (let start = 0; start < texts.length; start += BATCH_SIZE) {
      const batch = texts.slice(start, start + BATCH_SIZE);
      vectors.push(...(await this.embedBatch(batch)));
    }
    return vectors;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vector] = await this.embed([text]);
    return vector;
  }

  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await safeFetchNoThrow(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(this.connection.apiKey ? { Authorization: `Bearer ${this.connection.apiKey}` } : {}),
        },
        body: JSON.stringify({ model: this.connection.model, input: texts }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new LocalEmbeddingClientError(
          `Embedding request failed with HTTP ${response.status}.`
        );
      }
      const payload = (await response.json()) as unknown;
      return this.parseEmbeddings(payload, texts.length);
    } catch (error) {
      if (error instanceof LocalEmbeddingClientError) throw error;
      throw new LocalEmbeddingClientError(
        `Embedding request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  private parseEmbeddings(payload: unknown, expected: number): Float32Array[] {
    const record = payload as {
      embeddings?: number[][];
      data?: Array<{ embedding?: number[] }>;
      message?: string;
    };
    const raw: number[][] = [];
    if (Array.isArray(record?.embeddings)) {
      raw.push(...record.embeddings);
    }
    if (Array.isArray(record?.data)) {
      for (const item of record.data) {
        if (Array.isArray(item?.embedding)) raw.push(item.embedding);
      }
    }
    if (raw.length !== expected) {
      const detail =
        typeof record?.message === "string"
          ? record.message
          : `expected ${expected} embedding vectors`;
      throw new LocalEmbeddingClientError(
        `Embedding server returned an unexpected response (${detail}).`
      );
    }
    return raw.map((values) => new Float32Array(values));
  }
}
