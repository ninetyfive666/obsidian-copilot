import type { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import type { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { createTestRegistries } from "@/modelManagement/testRegistries";
import type { CatalogProvider } from "@/modelManagement/types/catalog";

import { ByokSetupApi, BYOK_DEFAULT_AUTO_ENROLL } from "./ByokSetupApi";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const OLLAMA_CATALOG: CatalogProvider = {
  id: "ollama",
  displayName: "Ollama",
  defaultBaseUrl: "http://localhost:11434/v1",
  providerType: "openai-compatible",
  models: {
    "llama3.1:8b": { id: "llama3.1:8b", displayName: "Llama 3.1 8B" },
    "qwen2.5:7b": { id: "qwen2.5:7b", displayName: "Qwen 2.5 7B" },
  },
};

describe("ByokSetupApi", () => {
  let api: ByokSetupApi;
  let providers: ProviderRegistry;
  let models: ConfiguredModelRegistry;
  let backends: BackendConfigRegistry;

  beforeEach(() => {
    ({ providers, models, backends } = createTestRegistries());
    api = new ByokSetupApi(providers, models, backends);
  });

  describe("setupProvider()", () => {
    it("creates a catalog-linked BYOK provider with its key and models and enrolls the models into the default backends", async () => {
      const result = await api.setupProvider({
        catalogProviderId: "ollama",
        providerType: "openai-compatible",
        displayName: "My Ollama",
        baseUrl: "http://localhost:11434/v1",
        apiKey: "key-123",
        models: [
          OLLAMA_CATALOG.models["llama3.1:8b"],
          OLLAMA_CATALOG.models["qwen2.5:7b"],
        ],
      });

      const provider = providers.get(result.providerId)!;
      expect(provider.origin).toEqual({ kind: "byok", catalogProviderId: "ollama" });
      expect(provider.providerType).toBe("openai-compatible");
      expect(provider.baseUrl).toBe("http://localhost:11434/v1");
      expect(await providers.getApiKey(result.providerId)).toBe("key-123");

      expect(
        models
          .listByProvider(result.providerId)
          .map((m) => m.info.id)
          .sort()
      ).toEqual(["llama3.1:8b", "qwen2.5:7b"]);

      for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
        expect(backends.get(backend).enabledModels.sort()).toEqual(
          [...result.configuredModelIds].sort()
        );
      }
    });

    it("creates a provider without a catalog id for a template or custom endpoint", async () => {
      const result = await api.setupProvider({
        providerType: "openai-compatible",
        displayName: "My Ollama",
        baseUrl: "http://localhost:11434/v1",
        models: [
          { id: "llama3.2", displayName: "llama3.2" },
          { id: "qwen2.5-coder:7b", displayName: "qwen2.5-coder:7b" },
        ],
      });
      const provider = providers.get(result.providerId)!;
      expect(provider.origin).toEqual({ kind: "byok" });
      expect(provider.baseUrl).toBe("http://localhost:11434/v1");
      expect(provider.apiKeyKeychainId).toBeNull();
    });

    it("persists the provider's Quick Chat CORS choice (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", async () => {
      const result = await api.setupProvider({
        providerType: "openai-compatible",
        displayName: "Work endpoint",
        baseUrl: "https://work.example.com/v1",
        enableCors: true,
        models: [{ id: "work-model", displayName: "Work model" }],
      });

      expect(providers.get(result.providerId)?.enableCors).toBe(true);
    });

    it("does not enroll a model the caller flags as isEmbedding", async () => {
      const result = await api.setupProvider({
        providerType: "openai-compatible",
        displayName: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        models: [
          { id: "llama3.2", displayName: "llama3.2" },
          { id: "nomic-embed-text", displayName: "nomic-embed-text", isEmbedding: true },
        ],
      });
      const [chatId, embedId] = result.configuredModelIds;
      for (const backend of BYOK_DEFAULT_AUTO_ENROLL) {
        const enabled = backends.get(backend).enabledModels;
        expect(enabled).toContain(chatId);
        expect(enabled).not.toContain(embedId);
      }
    });

    it("removes the new provider again when storing its API key fails", async () => {
      const setApiKeySpy = jest
        .spyOn(providers, "setApiKey")
        .mockRejectedValueOnce(new Error("keychain unavailable"));

      await expect(
        api.setupProvider({
          catalogProviderId: "ollama",
          providerType: "openai-compatible",
          displayName: "My Ollama",
          apiKey: "key-123",
          models: [OLLAMA_CATALOG.models["llama3.1:8b"]],
        })
      ).rejects.toThrow("keychain unavailable");

      expect(setApiKeySpy).toHaveBeenCalledTimes(1);
      expect(providers.list()).toHaveLength(0);
    });

    it("enrolls models only into the backends listed in autoEnrollIn", async () => {
      const result = await api.setupProvider({
        providerType: "openai-compatible",
        displayName: "Ollama",
        baseUrl: "http://localhost:11434/v1",
        models: [{ id: "llama3.2", displayName: "llama3.2" }],
        autoEnrollIn: ["chat"],
      });
      expect(backends.get("chat").enabledModels).toEqual([...result.configuredModelIds]);
    });
  });
});
