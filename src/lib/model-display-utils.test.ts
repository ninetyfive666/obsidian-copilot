import { err2String, getProviderLabel } from "@/lib/model-display-utils";

describe("model-display-utils", () => {
  describe("getProviderLabel()", () => {
    it("returns the known labels for the local providers", () => {
      expect(getProviderLabel("ollama")).toBe("Ollama");
      expect(getProviderLabel("lm-studio")).toBe("LM Studio");
    });

    it("returns unknown provider ids unchanged", () => {
      expect(getProviderLabel("custom-provider")).toBe("custom-provider");
    });
  });

  describe("err2String()", () => {
    it("exposes the canonical pure error formatter through the lib surface", () => {
      expect(err2String(new Error("boom"))).toBe("boom");
    });
  });
});
