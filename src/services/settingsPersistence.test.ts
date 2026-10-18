import type { CopilotSettings } from "@/settings/model";

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

function makeSettings(overrides: Record<string, unknown> = {}): CopilotSettings {
  return { ...overrides } as unknown as CopilotSettings;
}

const backedUp = jest.fn().mockResolvedValue({ status: "not-needed" });

async function loadModule(overrides: Record<string, unknown> = {}) {
  jest.resetModules();

  const keychain = {
    isAvailable: jest.fn().mockReturnValue(true),
    getVaultId: jest.fn().mockReturnValue("abcd1234"),
    setVaultId: jest.fn(),
    hydrateFromKeychain: jest.fn(async (settings: CopilotSettings) => ({
      settings,
      hadFailures: false,
    })),
    persistSecrets: jest.fn().mockReturnValue({
      secretEntries: [],
      keychainIdsToDelete: [],
    }),
    setSecretById: jest.fn(),
    ...overrides,
  };

  jest.doMock("@/services/keychainService", () => ({
    KeychainService: { getInstance: jest.fn(() => keychain) },
  }));
  jest.doMock("@/logger", () => ({ logWarn: jest.fn() }));
  jest.doMock("@/settings/model", () => ({
    sanitizeSettings: jest.fn((settings: CopilotSettings) => settings),
  }));

  const module = await import("@/services/settingsPersistence");
  return { module, keychain };
}

describe("settingsPersistence", () => {
  describe("resetPersistenceState()", () => {
    it("clears a pending one-shot persist suppression", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      module.suppressNextPersistOnce();

      module.resetPersistenceState();
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("refreshLastPersistedSettings()", () => {
    it("sets the Keychain diff baseline for the next write", async () => {
      const { module, keychain } = await loadModule();
      const baseline = makeSettings({
        activeModels: [{ name: "llama", provider: "ollama", apiKey: "old-key" }],
      });
      const next = makeSettings({
        activeModels: [{ name: "llama", provider: "ollama", apiKey: "new-key" }],
      });
      module.refreshLastPersistedSettings(baseline);

      await module.persistSettings(next, jest.fn().mockResolvedValue(undefined));

      expect(keychain.persistSecrets).toHaveBeenCalledWith(next, baseline);
    });
  });

  describe("suppressNextPersistOnce()", () => {
    it("skips exactly one subscriber-driven save", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);
      module.suppressNextPersistOnce();

      await module.persistSettings(makeSettings(), saveData);
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("runPersistenceTransaction()", () => {
    it("keeps the queue usable after a transaction fails", async () => {
      const { module } = await loadModule();
      const failure = new Error("failed transaction");

      await expect(
        module.runPersistenceTransaction(async () => {
          throw failure;
        })
      ).rejects.toBe(failure);

      const followup = jest.fn().mockResolvedValue(undefined);
      await module.runPersistenceTransaction(followup);
      expect(followup).toHaveBeenCalledTimes(1);
    });
  });

  describe("flushPersistence()", () => {
    it("waits for the active settings write", async () => {
      const { module } = await loadModule();
      let release!: () => void;
      const saveData = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          })
      );
      const persist = module.persistSettings(makeSettings(), saveData);
      await Promise.resolve();

      let flushed = false;
      const flush = module.flushPersistence().then(() => {
        flushed = true;
      });
      await Promise.resolve();
      expect(flushed).toBe(false);

      release();
      await Promise.all([persist, flush]);
      expect(flushed).toBe(true);
    });
  });

  describe("loadSettingsWithKeychain()", () => {
    it("discards disk credentials and exposes only Keychain-hydrated values", async () => {
      const { module, keychain } = await loadModule();
      keychain.hydrateFromKeychain.mockImplementation(async (settings: CopilotSettings) => {
        const updated = {
          ...settings,
          activeModels: [
            { name: "custom", provider: "ollama", apiKey: "keychain-key", enabled: true },
          ],
        } as CopilotSettings;
        return { settings: updated, hadFailures: false };
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      const loaded = await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        saveData,
        backedUp
      );

      const hydrateInput = keychain.hydrateFromKeychain.mock.calls[0][0];
      expect(hydrateInput.activeModels[0].apiKey).toBe("");
      expect(loaded.activeModels[0].apiKey).toBe("keychain-key");
      expect(saveData).toHaveBeenCalledWith(
        expect.objectContaining({
          _keychainVaultId: "1234abcd",
          activeModels: [expect.objectContaining({ apiKey: "" })],
        })
      );
    });

    it("keeps credentials empty when Keychain is unavailable", async () => {
      const { module, keychain } = await loadModule();
      keychain.isAvailable.mockReturnValue(false);

      const loaded = await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        jest.fn().mockResolvedValue(undefined),
        backedUp
      );

      expect(loaded.activeModels[0].apiKey).toBe("");
      expect(keychain.hydrateFromKeychain).not.toHaveBeenCalled();
    });

    it("persists a vault namespace for a fresh install", async () => {
      const { module, keychain } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(null, saveData, backedUp);

      expect(keychain.setVaultId).toHaveBeenCalledWith("abcd1234");
      expect(saveData).toHaveBeenCalledWith({
        _keychainVaultId: "abcd1234",
      });
    });

    it("leaves data.json intact when the credential backup fails", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        saveData,
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );

      expect(saveData).not.toHaveBeenCalled();
    });

    it("strips data.json once the credentials are backed up", async () => {
      const { module } = await loadModule();
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        saveData,
        jest.fn().mockResolvedValue({
          status: "backed-up",
          path: "plugins/copilot/backup.json",
          encrypted: false,
        })
      );

      expect(saveData.mock.calls[0][0].activeModels[0].apiKey).toBe("");
    });

    it("rejects later settings writes rather than skipping them when the backup fails", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [["copilot-vabcd1234-api-key", "re-entered"]],
          keychainIdsToDelete: [],
        }),
      });
      await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );
      const saveData = jest.fn().mockResolvedValue(undefined);

      await expect(module.persistSettings(makeSettings(), saveData)).rejects.toThrow(
        "cannot save settings"
      );
      expect(saveData).not.toHaveBeenCalled();
      expect(keychain.setSecretById).not.toHaveBeenCalled();
    });

    it("rejects a durable transaction while the hold is active", async () => {
      const { module } = await loadModule();
      await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );

      await expect(
        module.persistSettingsWithinTransaction(
          makeSettings(),
          jest.fn().mockResolvedValue(undefined)
        )
      ).rejects.toThrow("cannot save settings");
    });
  });

  describe("releaseLegacyCredentialHold()", () => {
    it("resumes writing once a dedicated flow has stripped data.json", async () => {
      const { module } = await loadModule();
      await module.loadSettingsWithKeychain(
        {
          _keychainVaultId: "1234abcd",
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "plaintext-disk-key" }],
        },
        jest.fn().mockResolvedValue(undefined),
        jest.fn().mockResolvedValue({ status: "failed", error: new Error("read-only") })
      );
      const saveData = jest.fn().mockResolvedValue(undefined);

      module.releaseLegacyCredentialHold();
      await module.persistSettings(makeSettings(), saveData);

      expect(saveData).toHaveBeenCalledTimes(1);
    });
  });

  describe("persistSettingsWithinTransaction()", () => {
    it("writes Keychain entries and strips the disk snapshot immediately", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [["copilot-vabcd1234-api-key", "new-key"]],
          keychainIdsToDelete: [],
        }),
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.persistSettingsWithinTransaction(
        makeSettings({
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "new-key" }],
        }),
        saveData
      );

      expect(keychain.setSecretById).toHaveBeenCalledWith("copilot-vabcd1234-api-key", "new-key");
      expect(saveData.mock.calls[0][0].activeModels[0].apiKey).toBe("");
    });
  });

  describe("persistSettings()", () => {
    it("round-trips the startup notice marker", async () => {
      const { module } = await loadModule();
      const stored = makeSettings({
        lastDismissedVersion: "4.0.9",
        lastShownStartupVersion: "4.1.0",
      });
      const saveData = jest.fn(async (_data: CopilotSettings) => undefined);
      await module.persistSettings(stored, saveData);
      module.resetPersistenceState();
      const loaded = await module.loadSettingsWithKeychain(
        saveData.mock.calls[0][0],
        saveData,
        backedUp
      );
      expect(loaded.lastShownStartupVersion).toBe("4.1.0");
      expect(loaded.lastDismissedVersion).toBe("4.0.9");
    });

    it("tombstones cleared credentials and never writes them to data.json", async () => {
      const { module, keychain } = await loadModule({
        persistSecrets: jest.fn().mockReturnValue({
          secretEntries: [],
          keychainIdsToDelete: ["copilot-vabcd1234-api-key"],
        }),
      });
      const saveData = jest.fn().mockResolvedValue(undefined);

      await module.persistSettings(makeSettings(), saveData);

      expect(keychain.setSecretById).toHaveBeenCalledWith("copilot-vabcd1234-api-key", "");
    });

    it("rolls Keychain values back when the disk save fails", async () => {
      const persistSecrets = jest
        .fn()
        .mockReturnValueOnce({
          secretEntries: [["credential-id", "new-key"]],
          keychainIdsToDelete: [],
        })
        .mockReturnValueOnce({
          secretEntries: [["credential-id", "old-key"]],
          keychainIdsToDelete: [],
        });
      const { module, keychain } = await loadModule({ persistSecrets });
      module.refreshLastPersistedSettings(
        makeSettings({
          activeModels: [{ name: "custom", provider: "ollama", apiKey: "old-key" }],
        })
      );

      await expect(
        module.persistSettings(
          makeSettings({
            activeModels: [{ name: "custom", provider: "ollama", apiKey: "new-key" }],
          }),
          jest.fn().mockRejectedValue(new Error("disk full"))
        )
      ).rejects.toThrow("disk full");

      expect(keychain.setSecretById).toHaveBeenNthCalledWith(1, "credential-id", "new-key");
      expect(keychain.setSecretById).toHaveBeenNthCalledWith(2, "credential-id", "old-key");
    });
  });
});
