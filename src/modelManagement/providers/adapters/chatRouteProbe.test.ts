import { probeChatRoute } from "./chatRouteProbe";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function mockRouteStatuses(statuses: Record<string, number>): void {
  mockSafeFetch.mockImplementation(async (url: string) => {
    const status = statuses[url] ?? 404;
    return { status, text: async () => "" } as unknown as Response;
  });
}

describe("chatRouteProbe", () => {
  describe("probeChatRoute()", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("skips probing when the base URL already carries /v1", async () => {
      const result = await probeChatRoute("http://llm.home/v1", {});
      expect(result).toEqual({ needsV1: false });
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("skips probing for a blank base URL", async () => {
      const result = await probeChatRoute("", {});
      expect(result).toEqual({ needsV1: false });
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it("keeps the base when the chat route answers directly", async () => {
      mockRouteStatuses({ "http://llm.home/chat/completions": 200 });
      const result = await probeChatRoute("http://llm.home", {});
      expect(result).toEqual({ needsV1: false });
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("treats a 405 from the chat route as the route being present", async () => {
      mockRouteStatuses({ "http://llm.home/chat/completions": 405 });
      const result = await probeChatRoute("http://llm.home", {});
      expect(result).toEqual({ needsV1: false });
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("suggests the /v1 base when chat is only served under /v1", async () => {
      mockRouteStatuses({
        "http://llm.home/chat/completions": 404,
        "http://llm.home/v1/chat/completions": 405,
      });
      const result = await probeChatRoute("http://llm.home", { Authorization: "Bearer k" });
      expect(result).toEqual({ needsV1: true, suggestedBaseUrl: "http://llm.home/v1" });
      expect(mockSafeFetch).toHaveBeenNthCalledWith(1, "http://llm.home/chat/completions", {
        method: "GET",
        headers: { Authorization: "Bearer k" },
      });
      expect(mockSafeFetch).toHaveBeenNthCalledWith(2, "http://llm.home/v1/chat/completions", {
        method: "GET",
        headers: { Authorization: "Bearer k" },
      });
    });

    it("keeps the base when neither chat route exists", async () => {
      mockRouteStatuses({
        "http://llm.home/chat/completions": 404,
        "http://llm.home/v1/chat/completions": 404,
      });
      const result = await probeChatRoute("http://llm.home", {});
      expect(result).toEqual({ needsV1: false });
      expect(mockSafeFetch).toHaveBeenCalledTimes(2);
    });

    it("keeps the base when the /v1 probe is inconclusive", async () => {
      mockRouteStatuses({
        "http://llm.home/chat/completions": 404,
        "http://llm.home/v1/chat/completions": 401,
      });
      const result = await probeChatRoute("http://llm.home", {});
      expect(result).toEqual({ needsV1: false });
    });

    it("does not probe /v1 when the direct probe is inconclusive", async () => {
      mockRouteStatuses({ "http://llm.home/chat/completions": 500 });
      const result = await probeChatRoute("http://llm.home", {});
      expect(result).toEqual({ needsV1: false });
      expect(mockSafeFetch).toHaveBeenCalledTimes(1);
    });

    it("keeps the base when the probe request fails", async () => {
      mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await probeChatRoute("http://llm.home", {});
      expect(result).toEqual({ needsV1: false });
    });
  });
});
