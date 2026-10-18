import { getSettings } from "@/settings/model";
import type { App } from "obsidian";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
}));
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));
jest.mock("@/search/v3/TieredLexicalRetriever", () => ({
  TieredLexicalRetriever: jest.fn(),
}));

import { RetrieverFactory } from "@/search/RetrieverFactory";
import { TieredLexicalRetriever } from "@/search/v3/TieredLexicalRetriever";

const app = {} as App;
const options = { maxK: 8 };

describe("RetrieverFactory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getSettings).mockReturnValue({} as ReturnType<typeof getSettings>);
  });

  describe("RetrieverFactory", () => {
    describe("createRetriever()", () => {
      it("always returns the tiered lexical retriever", async () => {
        const result = await RetrieverFactory.createRetriever(app, options);

        expect(result.type).toBe("lexical");
        expect(result.reason).toBe("Default lexical search");
        expect(result.retriever).toBeInstanceOf(TieredLexicalRetriever);
      });

      it("does not resurrect a removed semantic backend from a legacy settings flag (https://github.com/Brevilabs/obsidian-copilot-private/issues/281)", async () => {
        jest
          .mocked(getSettings)
          .mockReturnValue({ enableMiyo: true } as unknown as ReturnType<typeof getSettings>);

        const result = await RetrieverFactory.createRetriever(app, options);

        expect(result.type).toBe("lexical");
        expect(result.retriever).toBeInstanceOf(TieredLexicalRetriever);
      });
    });

    describe("getRetrieverType()", () => {
      it("reports lexical", () => {
        expect(RetrieverFactory.getRetrieverType()).toBe("lexical");
      });
    });

    describe("createLexicalRetriever()", () => {
      it("fills option defaults before constructing the tiered lexical retriever", () => {
        RetrieverFactory.createLexicalRetriever(app, { maxK: 8, salientTerms: ["alpha"] });

        expect(TieredLexicalRetriever).toHaveBeenCalledWith(
          app,
          expect.objectContaining({
            maxK: 8,
            minSimilarityScore: 0.1,
            salientTerms: ["alpha"],
            returnAll: false,
            tagTerms: [],
          })
        );
      });
    });
  });
});
