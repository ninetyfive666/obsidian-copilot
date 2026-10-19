import { ChatModelProviders } from "@/constants";
import { safeFetchNoThrow } from "@/utils";
import { LocalEmbeddingClient, LocalEmbeddingClientError } from "./LocalEmbeddingClient";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

const mockedFetch = jest.mocked(safeFetchNoThrow);

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

function client(
  overrides: Partial<{ baseUrl: string; apiKey: string; provider: ChatModelProviders }>
) {
  return new LocalEmbeddingClient({
    provider: ChatModelProviders.OLLAMA,
    baseUrl: "http://localhost:11434",
    apiKey: undefined,
    model: "nomic-embed-text",
    ...overrides,
  });
}

describe("LocalEmbeddingClient", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("posts to the Ollama /api/embed endpoint with the model name", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ embeddings: [[0.1, 0.2]] }));

    await client({}).embed(["hello"]);

    expect(mockedFetch).toHaveBeenCalledWith(
      "http://localhost:11434/api/embed",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "nomic-embed-text", input: ["hello"] }),
      })
    );
  });

  it("posts to /embeddings for OpenAI-format providers", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ data: [{ embedding: [0.3, 0.4] }] }));

    await client({
      provider: ChatModelProviders.OPENAI_FORMAT,
      baseUrl: "http://llm:8080/v1",
    }).embed(["hello"]);

    expect(mockedFetch).toHaveBeenCalledWith(
      "http://llm:8080/v1/embeddings",
      expect.objectContaining({
        body: JSON.stringify({ model: "nomic-embed-text", input: ["hello"] }),
      })
    );
  });

  it("sends the bearer token when an api key is configured", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ embeddings: [[1]] }));

    await client({ apiKey: "secret" }).embed(["hello"]);

    const init = mockedFetch.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer secret");
  });

  it("splits large inputs into batches", async () => {
    mockedFetch.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { input: string[] };
      return jsonResponse({ embeddings: body.input.map(() => [1, 0]) });
    });

    const texts = Array.from({ length: 33 }, (_, i) => `t${i}`);
    const vectors = await client({}).embed(texts);

    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(vectors).toHaveLength(33);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
  });

  it("accepts the OpenAI data payload shape", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ data: [{ index: 0, embedding: [0.5, 0.6] }] }));

    const vectors = await client({ provider: ChatModelProviders.LM_STUDIO }).embed(["hi"]);

    expect(vectors).toHaveLength(1);
    expect(vectors[0][0]).toBeCloseTo(0.5, 5);
    expect(vectors[0][1]).toBeCloseTo(0.6, 5);
  });

  it("throws when the server reports an HTTP error", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ error: "nope" }, false, 500));

    await expect(client({}).embed(["hello"])).rejects.toThrow(
      "Embedding request failed with HTTP 500"
    );
  });

  it("throws when the vector count does not match the request", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ embeddings: [[1, 2]] }));

    await expect(client({}).embed(["a", "b"])).rejects.toThrow(LocalEmbeddingClientError);
  });

  it("surfaces the server message for unexpected payloads", async () => {
    mockedFetch.mockResolvedValue(jsonResponse({ message: "model not found" }));

    await expect(client({}).embed(["a"])).rejects.toThrow("model not found");
  });
});
