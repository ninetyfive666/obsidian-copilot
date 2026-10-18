import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import {
  buildModelEnableGroups,
  partitionChatCandidates,
  rowMatches,
  toRow,
  type Candidate,
} from "./configuredModelGrouping";

function makeProvider(overrides: Partial<Provider> & { providerId: string }): Provider {
  return {
    providerType: "openai-compatible",
    displayName: overrides.providerId,
    origin: { kind: "byok" },
    addedAt: 0,
    ...overrides,
  };
}

function makeConfiguredModel(
  overrides: Partial<ConfiguredModel> & { configuredModelId: string; providerId: string }
): ConfiguredModel {
  const info: ModelInfo = {
    id: overrides.configuredModelId,
    displayName: overrides.configuredModelId,
  };
  return {
    info,
    configuredAt: 0,
    ...overrides,
  };
}

describe("configuredModelGrouping", () => {
  describe("partitionChatCandidates()", () => {
    it("returns a candidate for every chat model whose provider exists and is not an embedding model", () => {
      const providers = {
        ollama: makeProvider({ providerId: "ollama", displayName: "Ollama" }),
      };
      const models = [
        makeConfiguredModel({
          configuredModelId: "m1",
          providerId: "ollama",
          info: { id: "llama3", displayName: "Llama 3" },
        }),
        makeConfiguredModel({
          configuredModelId: "m2",
          providerId: "ollama",
          info: { id: "embed", displayName: "Embedding", isEmbedding: true },
        }),
        makeConfiguredModel({
          configuredModelId: "m3",
          providerId: "missing",
          info: { id: "orphan", displayName: "Orphan" },
        }),
      ];

      const candidates = partitionChatCandidates(models, providers, new Set(["m1"]));

      expect(candidates.map((c) => c.configuredModel.configuredModelId)).toEqual(["m1"]);
      expect(candidates[0].enabled).toBe(true);
      expect(candidates[0].provider.providerId).toBe("ollama");
    });

    it("marks candidates not in the enabled set as disabled", () => {
      const providers = { ollama: makeProvider({ providerId: "ollama" }) };
      const models = [
        makeConfiguredModel({ configuredModelId: "m1", providerId: "ollama" }),
        makeConfiguredModel({ configuredModelId: "m2", providerId: "ollama" }),
      ];

      const candidates = partitionChatCandidates(models, providers, new Set(["m1"]));

      expect(candidates.map((c) => c.enabled)).toEqual([true, false]);
    });
  });

  describe("toRow()", () => {
    it("maps a candidate onto an enable-list row with capabilities from the model info", () => {
      const candidate: Candidate = {
        configuredModel: makeConfiguredModel({
          configuredModelId: "m1",
          providerId: "ollama",
          info: {
            id: "llama3",
            displayName: "Llama 3",
            description: "Local llama",
            modalities: { input: ["text", "image"], output: ["text"] },
            reasoning: true,
          },
        }),
        provider: makeProvider({ providerId: "ollama" }),
        enabled: true,
      };

      const row = toRow(candidate);

      expect(row).toEqual({
        id: "m1",
        label: "Llama 3",
        description: "Local llama",
        wireId: "llama3",
        enabled: true,
        capabilities: ["reasoning", "vision"],
      });
    });

    it("leaves capabilities undefined when the model info has no modalities", () => {
      const candidate: Candidate = {
        configuredModel: makeConfiguredModel({
          configuredModelId: "m1",
          providerId: "ollama",
        }),
        provider: makeProvider({ providerId: "ollama" }),
        enabled: false,
      };

      expect(toRow(candidate).capabilities).toBeUndefined();
    });
  });

  describe("rowMatches()", () => {
    const row = {
      id: "m1",
      label: "Llama 3",
      description: "Local model",
      wireId: "llama3.1",
      enabled: true,
    };

    it("matches an empty query against every row", () => {
      expect(rowMatches(row, "")).toBe(true);
    });

    it("matches label, id, wire id, and description case-insensitively", () => {
      expect(rowMatches(row, "llama")).toBe(true);
      expect(rowMatches(row, "M1")).toBe(true);
      expect(rowMatches(row, "LLAMA3.1")).toBe(true);
      expect(rowMatches(row, "local model")).toBe(true);
    });

    it("rejects a query that appears in no row field", () => {
      expect(rowMatches(row, "mistral")).toBe(false);
    });
  });

  describe("buildModelEnableGroups()", () => {
    const ollama = makeProvider({ providerId: "ollama", displayName: "Ollama" });
    const lmstudio = makeProvider({ providerId: "lmstudio", displayName: "LM Studio" });
    const candidates: Candidate[] = [
      {
        configuredModel: makeConfiguredModel({
          configuredModelId: "m1",
          providerId: "ollama",
          info: { id: "llama3", displayName: "Llama 3" },
        }),
        provider: ollama,
        enabled: true,
      },
      {
        configuredModel: makeConfiguredModel({
          configuredModelId: "m2",
          providerId: "lmstudio",
          info: { id: "mistral", displayName: "Mistral 7B" },
        }),
        provider: lmstudio,
        enabled: false,
      },
      {
        configuredModel: makeConfiguredModel({
          configuredModelId: "m3",
          providerId: "ollama",
          info: { id: "qwen", displayName: "Qwen 2.5" },
        }),
        provider: ollama,
        enabled: true,
      },
    ];

    it("groups rows by provider with a byok-prefixed group key", () => {
      const groups = buildModelEnableGroups(candidates, "");

      expect(groups).toEqual([
        {
          key: "byok:ollama",
          label: "Ollama",
          rows: [
            expect.objectContaining({ id: "m1", label: "Llama 3" }),
            expect.objectContaining({ id: "m3", label: "Qwen 2.5" }),
          ],
        },
        {
          key: "byok:lmstudio",
          label: "LM Studio",
          rows: [expect.objectContaining({ id: "m2", label: "Mistral 7B" })],
        },
      ]);
    });

    it("filters rows by the search query and drops empty groups", () => {
      const groups = buildModelEnableGroups(candidates, "llama");

      expect(groups.map((g) => g.key)).toEqual(["byok:ollama"]);
      expect(groups[0].rows.map((r) => r.id)).toEqual(["m1"]);
    });

    it("returns no groups when nothing matches", () => {
      expect(buildModelEnableGroups(candidates, "mistral-nope")).toEqual([]);
    });
  });
});
