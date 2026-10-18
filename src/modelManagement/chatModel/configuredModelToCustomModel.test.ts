import { ChatModelProviders, ModelCapability } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./configuredModelToCustomModel";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "P",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

function configuredModel(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return {
    configuredModelId: "cm1",
    providerId: "p1",
    info: { id: "llama3.1:8b", displayName: "Llama 3.1 8B" },
    configuredAt: 0,
    ...overrides,
  };
}

describe("configuredModelToCustomModel", () => {
  describe("mapProviderTypeToChatModelProvider()", () => {
    it("maps the Ollama and LM Studio presets to their dedicated chat providers", () => {
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ origin: { kind: "byok", catalogProviderId: "ollama" } })
        )
      ).toBe(ChatModelProviders.OLLAMA);
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ origin: { kind: "byok", catalogProviderId: "lmstudio" } })
        )
      ).toBe(ChatModelProviders.LM_STUDIO);
    });

    it("maps an openai-compatible provider with an unknown or missing catalog id to OPENAI_FORMAT", () => {
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ origin: { kind: "byok", catalogProviderId: "custom" } })
        )
      ).toBe(ChatModelProviders.OPENAI_FORMAT);
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ baseUrl: "http://localhost:8080/v1", origin: { kind: "byok" } })
        )
      ).toBe(ChatModelProviders.OPENAI_FORMAT);
    });
  });

  describe("configuredModelToCustomModel()", () => {
    it("uses the wire id as the model name and the stored display name", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({
          origin: { kind: "byok", catalogProviderId: "ollama" },
          baseUrl: "http://localhost:11434",
        }),
        configuredModel: configuredModel({
          info: { id: "llama3.1:8b", displayName: "Llama 3.1 8B" },
        }),
        apiKey: null,
      });
      expect(custom.name).toBe("llama3.1:8b");
      expect(custom.displayName).toBe("Llama 3.1 8B");
      expect(custom.provider).toBe(ChatModelProviders.OLLAMA);
      expect(custom.enabled).toBe(true);
      expect(custom.configuredModelId).toBe("cm1");
    });

    it("carries an explicit output limit from provider extras (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ extras: { maxTokens: 8192 } }),
        configuredModel: configuredModel(),
        apiKey: null,
      });

      expect(custom.maxTokens).toBe(8192);
    });

    it("sends no output limit when the provider extras carry none (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ origin: { kind: "byok" } }),
        configuredModel: configuredModel({
          info: { id: "llama3.1:8b", displayName: "Llama 3.1 8B", limits: { context: 400000, output: 128000 } },
        }),
        apiKey: null,
      });

      expect(custom.maxTokens).toBeUndefined();
    });

    it("carries the provider base URL onto the custom model", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ baseUrl: "http://localhost:8080/v1" }),
        configuredModel: configuredModel(),
        apiKey: "key-123",
      });
      expect(custom.apiKey).toBe("key-123");
      expect(custom.baseUrl).toBe("http://localhost:8080/v1");
    });

    it("preserves the provider's explicit Quick Chat CORS choice (https://github.com/logancyang/obsidian-copilot-preview/issues/313)", () => {
      const corsEnabled = configuredModelToCustomModel({
        provider: provider({ baseUrl: "http://localhost:8080/v1", enableCors: true }),
        configuredModel: configuredModel(),
        apiKey: "key-123",
      });
      const streaming = configuredModelToCustomModel({
        provider: provider({
          baseUrl: "http://localhost:8080/v1",
          enableCors: false,
        }),
        configuredModel: configuredModel(),
        apiKey: "key-123",
      });
      expect(corsEnabled.enableCors).toBe(true);
      expect(streaming.enableCors).toBe(false);
    });

    it("carries the runtime auth contract without synthesizing a key (https://github.com/logancyang/obsidian-copilot/issues/2895)", () => {
      const keyless = configuredModelToCustomModel({
        provider: provider({ requiresApiKey: false, baseUrl: "http://localhost:11434" }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(keyless.apiKey).toBeUndefined();
      expect(keyless.requiresApiKey).toBe(false);

      const requiresKey = configuredModelToCustomModel({
        provider: provider({ requiresApiKey: true }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(requiresKey.apiKey).toBeUndefined();
      expect(requiresKey.requiresApiKey).toBe(true);

      const missingStoredKey = configuredModelToCustomModel({
        provider: provider({ requiresApiKey: false, apiKeyKeychainId: "keychain-p1" }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(missingStoredKey.requiresApiKey).toBe(true);
    });

    it("lists reasoning and vision capabilities from the stored model info", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({
          origin: { kind: "byok", catalogProviderId: "lmstudio" },
        }),
        configuredModel: configuredModel({
          info: {
            id: "mistral-7b-instruct",
            displayName: "Mistral 7B Instruct",
            reasoning: true,
            modalities: { input: ["text", "image"] },
          },
        }),
        apiKey: null,
      });
      expect(custom.capabilities).toEqual([ModelCapability.REASONING, ModelCapability.VISION]);
    });

    it("copies the OpenAI organization id from provider extras", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({
          origin: { kind: "byok" },
          extras: { openAIOrgId: "org-1" },
        }),
        configuredModel: configuredModel(),
        apiKey: "sk",
      });
      expect(custom.openAIOrgId).toBe("org-1");
    });

    it("copies the context window from provider extras", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ extras: { numCtx: 32768 } }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(custom.numCtx).toBe(32768);
    });
  });
});
