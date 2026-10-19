import { resetSettings, setSettings, settingsStore } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import { chatBackendPickerAtom, byokProvidersAtom, visibleByokProvidersAtom } from "./atoms";

function provider(id: string, baseUrl?: string): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName: id,
    baseUrl,
    origin: { kind: "byok" },
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: configuredModelId, displayName: configuredModelId },
    configuredAt: 0,
  };
}

const OLLAMA = provider("ollama", "http://localhost:11434/v1");
const LMSTUDIO = provider("lmstudio", "http://localhost:1234/v1");

beforeEach(() => {
  resetSettings();
  setSettings({
    providers: { ollama: OLLAMA, lmstudio: LMSTUDIO },
    configuredModels: [model("ollama-m", "ollama"), model("lmstudio-m", "lmstudio")],
    backends: { chat: { enabledModels: ["ollama-m", "lmstudio-m", "missing"] } },
  });
});

function pickerIds(): string[] {
  return settingsStore.get(chatBackendPickerAtom).map((e) => e.configuredModelId);
}

describe("atoms", () => {
  describe("chatBackendPickerAtom", () => {
    it("keeps every enabled entry in order with ok and broken states", () => {
      const entries = settingsStore.get(chatBackendPickerAtom);
      expect(pickerIds()).toEqual(["ollama-m", "lmstudio-m", "missing"]);
      expect(entries.map((e) => e.state)).toEqual(["ok", "ok", "broken"]);
      if (entries[0].state === "ok") {
        expect(entries[0].provider.providerId).toBe("ollama");
        expect(entries[0].configuredModel.configuredModelId).toBe("ollama-m");
      }
    });

    it("returns the same empty list on every read when no models are enabled", () => {
      setSettings({ backends: { chat: { enabledModels: [] } } });
      const a = settingsStore.get(chatBackendPickerAtom);
      const b = settingsStore.get(chatBackendPickerAtom);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });

  describe("visibleByokProvidersAtom", () => {
    it("lists every BYOK provider", () => {
      const ids = settingsStore.get(visibleByokProvidersAtom).map((p) => p.providerId);
      expect(ids.sort()).toEqual(["lmstudio", "ollama"]);
    });

    it("does not touch the underlying byokProvidersAtom", () => {
      expect(
        settingsStore
          .get(byokProvidersAtom)
          .map((p) => p.providerId)
          .sort()
      ).toEqual(["lmstudio", "ollama"]);
    });

    it("returns the same empty list on every read when no BYOK providers exist", () => {
      setSettings({ providers: {}, configuredModels: [] });
      const a = settingsStore.get(visibleByokProvidersAtom);
      const b = settingsStore.get(visibleByokProvidersAtom);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });
});
