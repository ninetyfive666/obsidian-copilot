import type { App } from "obsidian";

import { DEFAULT_SETTINGS } from "@/constants";
import { KeychainService } from "@/services/keychainService";
import {
  loadSettingsWithKeychain,
  persistSettings,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import type { CustomModel } from "@/aiParams";
import type { Provider } from "@/modelManagement";
import type { CopilotSettings } from "@/settings/model";
import { getSettings, resetSettings, settingsAtom, settingsStore } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

const noLegacyBackup = async () => ({ status: "not-needed" }) as const;

const VAULT_ID = "a1b2c3d4";
const BYOK_POINTER = `copilot-v${VAULT_ID}-provider-byok_ollama`;

let secrets: Map<string, string>;
let app: App;

function makeApp(): App {
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: { adapter: {} },
  } as unknown as App;
}

function makeProvider(overrides: Partial<Provider>): Provider {
  return {
    providerId: "byok_ollama",
    providerType: "openai-compatible",
    displayName: "Ollama",
    origin: { kind: "byok" },
    addedAt: 0,
    requiresApiKey: false,
    ...overrides,
  };
}

describe("model", () => {
  describe("resetSettings()", () => {
    beforeEach(() => {
      secrets = new Map();
      app = makeApp();
      resetPersistenceState();
      KeychainService.resetInstance();
      KeychainService.getInstance(app).setVaultId(VAULT_ID);
    });

    it("keeps custom model and BYOK provider credentials reachable through reset, persistence, and a fresh hydration cycle (https://github.com/logancyang/obsidian-copilot-preview/issues/259)", async () => {
      const customRow: CustomModel = {
        name: "llama3.1:8b",
        provider: "3rd party (openai-format)",
        apiKey: "sk-model-key",
        baseUrl: "http://localhost:9999/v1",
        enabled: true,
      };
      secrets.set(BYOK_POINTER, "sk-provider-key");

      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        _keychainVaultId: VAULT_ID,
        autoAcceptEdits: true,
        activeModels: [customRow],
        providers: {
          byok_ollama: makeProvider({ apiKeyKeychainId: BYOK_POINTER }),
        },
        configuredModels: [
          {
            configuredModelId: "cm-1",
            providerId: "byok_ollama",
            info: { id: "llama3.1:8b", displayName: "Llama 3.1 8B" },
            configuredAt: 0,
          },
        ],
      });

      await persistSettings(getSettings(), async () => {});

      resetSettings();

      let savedToDisk: CopilotSettings | undefined;
      await persistSettings(getSettings(), async (data) => {
        savedToDisk = structuredClone(data);
      });

      expect(savedToDisk?.activeModels.find((m) => m.name === "llama3.1:8b")?.apiKey).toBe("");
      expect(savedToDisk?._keychainVaultId).toBe(VAULT_ID);
      expect(savedToDisk?.providers.byok_ollama?.apiKeyKeychainId).toBe(BYOK_POINTER);

      KeychainService.resetInstance();
      KeychainService.getInstance(app);
      const reloaded = await loadSettingsWithKeychain(savedToDisk, async () => {}, noLegacyBackup);

      expect(KeychainService.getInstance(app).getVaultId()).toBe(VAULT_ID);
      expect(reloaded.autoAcceptEdits).toBe(DEFAULT_SETTINGS.autoAcceptEdits);

      const reloadedCustom = reloaded.activeModels.find((m) => m.name === "llama3.1:8b");
      expect(reloadedCustom?.apiKey).toBe("sk-model-key");
      expect(reloadedCustom?.baseUrl).toBe("http://localhost:9999/v1");

      expect(reloaded.providers.byok_ollama?.apiKeyKeychainId).toBe(BYOK_POINTER);
      expect(secrets.get(BYOK_POINTER)).toBe("sk-provider-key");
      expect(reloaded.configuredModels.map((m) => m.configuredModelId)).toEqual(["cm-1"]);
    });
  });
});
