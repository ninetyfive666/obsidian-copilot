import type { App } from "obsidian";

const mockGetSettings = jest.fn<Record<string, unknown>, []>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));
jest.mock("@/search/RetrieverFactory", () => ({
  RetrieverFactory: {
    createRetriever: jest.fn(),
    getRetrieverType: jest.fn(),
  },
}));

import { createLocalSearchTool } from "@/tools/SearchTools";

describe("SearchTools", () => {
  describe("createLocalSearchTool()", () => {
    const schema = createLocalSearchTool({} as App).schema;

    it("accepts a timeRange given as epoch-millisecond start and end", () => {
      const result = schema.safeParse({
        query: "meetings last week",
        salientTerms: ["meetings"],
        timeRange: {
          startTime: 1234567890000,
          endTime: 1234567900000,
        },
      });

      expect(result.success).toBe(true);
    });

    it("accepts an empty salientTerms list when no timeRange is given", () => {
      expect(schema.safeParse({ query: "what did I do last week", salientTerms: [] }).success).toBe(
        true
      );
    });

    it("accepts a timeRange with only a startTime", () => {
      expect(
        schema.safeParse({
          query: "recent notes",
          salientTerms: [],
          timeRange: { startTime: 1234567890000 },
        }).success
      ).toBe(true);
    });

    it("rejects a timeRange whose times are legacy { epoch } objects", () => {
      expect(
        schema.safeParse({
          query: "meetings last week",
          salientTerms: ["meetings"],
          timeRange: {
            startTime: { epoch: 1234567890000 },
            endTime: { epoch: 1234567900000 },
          },
        }).success
      ).toBe(false);
    });
  });
});
