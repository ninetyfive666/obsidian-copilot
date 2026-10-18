import { listProviderModels } from "./listProviderModels";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function respondWithJson(json: unknown): void {
  mockSafeFetch.mockResolvedValue({
    status: 200,
    json: async () => json,
    text: async () => "",
  } as unknown as Response);
}

describe("listProviderModels", () => {
  describe("listProviderModels()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("lists openai-compatible models from <baseUrl>/models with the key and organization from extras", async () => {
      respondWithJson({ data: [{ id: "gpt-5" }] });

      const result = await listProviderModels("openai-compatible", "https://api.openai.com/v1", {
        apiKey: "sk",
        extras: { openAIOrgId: "org-9" },
      });

      expect(result).toEqual({ ok: true, modelIds: ["gpt-5"] });
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk", "OpenAI-Organization": "org-9" },
      });
    });

    it("sends no organization header when extras.openAIOrgId is not a string", async () => {
      respondWithJson({ data: [] });

      await listProviderModels("openai-compatible", "https://api.openai.com/v1", {
        extras: { openAIOrgId: 7 },
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: {},
      });
    });

    it("reports a timeout when the request hangs past timeoutMs", async () => {
      mockSafeFetch.mockImplementation(() => new Promise(() => {}));

      const result = await listProviderModels("openai-compatible", "https://example.test", {
        timeoutMs: 5,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/timed out/i);
    });
  });
});
