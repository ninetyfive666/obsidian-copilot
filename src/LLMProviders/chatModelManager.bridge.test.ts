import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { safeFetchNoThrow } from "@/utils";

import ChatModelManager from "./chatModelManager";

jest.mock("@langchain/openai", () => {
  class ChatOpenAI {
    static configs: Array<Record<string, unknown>> = [];
    clientConfig: Record<string, unknown>;
    constructor(config: Record<string, unknown>) {
      this.clientConfig = config;
      ChatOpenAI.configs.push(config);
    }
  }
  return { ChatOpenAI };
});

function capturedConfig(): Record<string, unknown> {
  const OpenAIMock = jest.requireMock("@langchain/openai").ChatOpenAI as {
    configs: Array<Record<string, unknown>>;
  };
  return OpenAIMock.configs.at(-1) ?? {};
}

function capturedConfiguration(): Record<string, unknown> {
  return (capturedConfig().configuration ?? {}) as Record<string, unknown>;
}

function bridgedModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "llama3.1:8b",
    provider: ChatModelProviders.OPENAI_FORMAT,
    enabled: true,
    ...overrides,
  };
}

interface AuthCase {
  enableCors: boolean;
  stream: boolean;
  requiresApiKey: boolean;
  apiKey?: string;
}

describe("chatModelManager", () => {
  describe("ChatModelManager", () => {
    describe("createModelInstanceFromBridged()", () => {
      it("rejects a model without credentials and without an explicit key opt-out", async () => {
        await expect(
          ChatModelManager.getInstance().createModelInstanceFromBridged(
            bridgedModel({ baseUrl: "http://localhost:11434/v1" })
          )
        ).rejects.toBeInstanceOf(MissingApiKeyError);
      });

      it("does not surface the browser-only flag as an OpenAI-compatible request header", async () => {
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            apiKey: "default-key",
            baseUrl: "http://localhost:11434/v1",
          })
        );

        const configuration = capturedConfiguration();
        const headers = (configuration.defaultHeaders ?? {}) as Record<string, string>;
        expect(headers["dangerously-allow-browser"]).toBeUndefined();
      });

      it.each([false, true])(
        "rejects a required missing OpenAI-compatible key with CORS=%s (https://github.com/logancyang/obsidian-copilot/issues/2946)",
        async (enableCors) => {
          await expect(
            ChatModelManager.getInstance().createModelInstanceFromBridged(
              bridgedModel({
                requiresApiKey: true,
                enableCors,
              })
            )
          ).rejects.toBeInstanceOf(MissingApiKeyError);
        }
      );

      it.each<AuthCase>(
        [false, true].flatMap((enableCors) =>
          [false, true].flatMap((stream) =>
            [
              { requiresApiKey: false, apiKey: undefined },
              { requiresApiKey: false, apiKey: "provided-key" },
              { requiresApiKey: true, apiKey: "provided-key" },
            ].map((auth) => ({ enableCors, stream, ...auth }))
          )
        )
      )(
        "wires auth and transport for CORS=$enableCors stream=$stream requiresApiKey=$requiresApiKey key=$apiKey (https://github.com/logancyang/obsidian-copilot/issues/2946)",
        async ({ enableCors, stream, requiresApiKey, apiKey }) => {
          const keyless = requiresApiKey === false && !apiKey;

          await ChatModelManager.getInstance().createModelInstanceFromBridged(
            bridgedModel({
              name: "local-model",
              baseUrl: "http://127.0.0.1:1234/v1",
              enableCors,
              stream,
              requiresApiKey,
              apiKey,
            })
          );

          const config = capturedConfig();
          const configuration = capturedConfiguration();
          expect(config.modelName).toBe("local-model");
          expect(config.streaming).toBe(stream);
          expect(configuration.baseURL).toBe("http://127.0.0.1:1234/v1");
          expect(config.apiKey).toBe(keyless ? "keyless-endpoint" : apiKey);

          const fetchOption = configuration.fetch;
          if (keyless) {
            expect(typeof fetchOption).toBe("function");
          } else if (enableCors) {
            expect(fetchOption).toBe(safeFetchNoThrow);
          } else {
            expect(fetchOption).toBeUndefined();
          }
        }
      );

      it("sends no output cap for a model that carries no limit of its own (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            name: "llama3.1:8b",
            apiKey: "local-key",
          })
        );

        expect("maxTokens" in capturedConfig()).toBe(false);
      });

      it("honors an explicit per-model output limit when one is set (https://github.com/logancyang/obsidian-copilot-preview/issues/312)", async () => {
        await ChatModelManager.getInstance().createModelInstanceFromBridged(
          bridgedModel({
            name: "llama3.1:8b",
            apiKey: "local-key",
            maxTokens: 8192,
          })
        );

        expect(capturedConfig().maxTokens).toBe(8192);
      });
    });

    describe("findModelByName()", () => {
      it("falls back to the active bridged model so its capabilities resolve", async () => {
        const manager = ChatModelManager.getInstance();
        const model = bridgedModel({
          name: "mistral-7b-instruct",
          apiKey: "bridge-key",
          capabilities: [ModelCapability.VISION],
        });

        expect(manager.findModelByName("mistral-7b-instruct")).toBeUndefined();

        await manager.setChatModelFromBridged(model);

        const found = manager.findModelByName("mistral-7b-instruct");
        expect(found).toBe(model);
        expect(found?.capabilities).toContain(ModelCapability.VISION);

        expect(manager.findModelByName("some-other-model")).toBeUndefined();
      });

      it("prefers the active bridged model over a legacy duplicate of the same id", async () => {
        const manager = ChatModelManager.getInstance();
        const legacyFlash = {
          name: "mistral-7b-instruct",
          provider: ChatModelProviders.OPENAI_FORMAT,
          enabled: true,
          capabilities: [ModelCapability.VISION],
        };
        const { setSettings } = await import("@/settings/model");
        setSettings({ activeModels: [legacyFlash] });

        const bridged = bridgedModel({
          name: "mistral-7b-instruct",
          apiKey: "bridge-key",
          capabilities: [ModelCapability.VISION, ModelCapability.REASONING],
        });
        await manager.setChatModelFromBridged(bridged);

        const found = manager.findModelByName("mistral-7b-instruct");
        expect(found).toBe(bridged);
        expect(found?.capabilities).toEqual(
          expect.arrayContaining([ModelCapability.VISION, ModelCapability.REASONING])
        );

        setSettings({ activeModels: [] });
      });
    });

    describe("setChatModelFromBridged()", () => {
      it("retains the bridged model as the active one", async () => {
        const manager = ChatModelManager.getInstance();
        const model = bridgedModel({ apiKey: "bridge-key" });

        await manager.setChatModelFromBridged(model);

        expect(manager.getActiveModel()).toBe(model);
      });
    });
  });
});
