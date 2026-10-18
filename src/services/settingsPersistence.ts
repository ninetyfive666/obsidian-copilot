import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { type LegacyBackupResult } from "@/services/legacyCredentialBackup";
import { cleanupLegacyFields, stripKeychainFields } from "@/services/settingsSecretTransforms";
import { type CopilotSettings, sanitizeSettings } from "@/settings/model";
import { type App, Notice } from "obsidian";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: CopilotSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
let legacyCredentialsUnprotected = false;
const pendingTombstones = new Set<string>();

const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

function cloneRawSettings(rawData: unknown): CopilotSettings {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return {} as CopilotSettings;
  }
  return structuredClone(rawData) as CopilotSettings;
}

function buildDiskSettings(rawData: unknown, vaultId: string): CopilotSettings {
  const stripped = stripKeychainFields(cleanupLegacyFields(cloneRawSettings(rawData)));
  stripped._keychainVaultId = vaultId;
  return stripped;
}

export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  lastPersistedSettings = undefined;
  suppressNextPersist = false;
  transactionEpoch = 0;
  legacyCredentialsUnprotected = false;
  pendingTombstones.clear();
}

export function releaseLegacyCredentialHold(): void {
  legacyCredentialsUnprotected = false;
}

export function refreshLastPersistedSettings(data: CopilotSettings): void {
  lastPersistedSettings = structuredClone(data);
}

export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

export async function loadSettingsWithKeychain(
  rawData: unknown,
  saveData: (data: CopilotSettings) => Promise<void>,
  backupLegacyCredentials: (rawData: unknown) => Promise<LegacyBackupResult>
): Promise<CopilotSettings> {
  const isFreshInstall = rawData == null;
  const rawSettings = cloneRawSettings(rawData);
  const keychain = KeychainService.getInstance();
  const persistedVaultId = rawSettings._keychainVaultId;
  const vaultId = isValidKeychainVaultId(persistedVaultId)
    ? persistedVaultId
    : keychain.getVaultId();
  keychain.setVaultId(vaultId);
  const diskSettings = buildDiskSettings(rawData, vaultId);

  if (JSON.stringify(rawSettings) !== JSON.stringify(diskSettings)) {
    const backup = await backupLegacyCredentials(rawData);
    if (backup.status === "failed") {
      legacyCredentialsUnprotected = true;
      new Notice(
        "Copilot could not back up the API keys stored in data.json, so it left the file untouched. Check that the vault is writable, then restart Obsidian."
      );
    } else {
      if (backup.status === "backed-up") {
        new Notice(
          `Copilot moved credential storage to the Obsidian Keychain. Your previous keys were copied to ${backup.path}. Delete that file when you no longer need it.`,
          15000
        );
      }
      try {
        await saveData(diskSettings);
      } catch {
        new Notice(
          "Copilot could not remove API keys from data.json. Check that the vault is writable, then restart Obsidian."
        );
      }
    }
  }

  const runtimeSource = isFreshInstall ? structuredClone(DEFAULT_SETTINGS) : rawSettings;
  const sanitized = cleanupLegacyFields(sanitizeSettings(runtimeSource));
  const baseline = stripKeychainFields({
    ...sanitized,
    _keychainVaultId: vaultId,
  });

  if (!keychain.isAvailable()) {
    new Notice(
      "Obsidian Keychain is unavailable. Copilot cannot load or save API keys in this Obsidian build."
    );
    lastPersistedSettings = structuredClone(baseline);
    return baseline;
  }

  const { settings: hydrated, hadFailures } = await keychain.hydrateFromKeychain(baseline);
  if (hadFailures) {
    new Notice(
      "Some API keys could not be loaded from the Obsidian Keychain. Restart Obsidian if the issue persists."
    );
  }
  lastPersistedSettings = structuredClone(hydrated);
  return hydrated;
}

async function persistKeychainSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prev: CopilotSettings | undefined
): Promise<void> {
  if (legacyCredentialsUnprotected) {
    throw new Error(
      "Copilot cannot save settings until it can back up the API keys still in data.json. " +
        "Check that the vault is writable, then restart Obsidian."
    );
  }

  const keychain = KeychainService.getInstance();
  const cleaned = cleanupLegacyFields(settings);
  const keychainDiffBase = lastPersistedSettings ?? prev;
  const rollbackSettings = lastPersistedSettings ?? prev;
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(cleaned, keychainDiffBase);
  const replayedTombstones: string[] = [];

  try {
    for (const id of pendingTombstones) {
      keychain.setSecretById(id, "");
      replayedTombstones.push(id);
    }

    for (const [id, value] of secretEntries) {
      keychain.setSecretById(id, value);
    }

    for (const id of keychainIdsToDelete) {
      try {
        keychain.setSecretById(id, "");
      } catch (error) {
        pendingTombstones.add(id);
        throw error;
      }
    }

    await saveData(stripKeychainFields(cleaned));
    lastPersistedSettings = structuredClone(cleaned);
    for (const id of replayedTombstones) {
      pendingTombstones.delete(id);
    }
  } catch (error) {
    try {
      await restoreKeychainFromSettings(keychain, rollbackSettings, cleaned);
    } catch (rollbackError) {
      logWarn("Failed to roll back Keychain after settings persistence failed.", rollbackError);
    }
    throw error;
  }
}

export async function persistSettingsWithinTransaction(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  await persistKeychainSettings(settings, saveData, prevSettings);
}

export async function persistSettings(
  settings: CopilotSettings,
  saveData: (data: CopilotSettings) => Promise<void>,
  prevSettings?: CopilotSettings
): Promise<void> {
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }

  const epochAtEnqueue = transactionEpoch;
  const job = writeQueue.then(() => {
    if (epochAtEnqueue !== transactionEpoch) return;
    return persistKeychainSettings(settings, saveData, prevSettings);
  });
  writeQueue = job.catch(() => {});
  return job;
}

async function restoreKeychainFromSettings(
  keychain: KeychainService,
  restoreFrom: CopilotSettings | undefined,
  failedSettings: CopilotSettings
): Promise<void> {
  if (!restoreFrom) return;

  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(
    restoreFrom,
    failedSettings
  );

  for (const [id, value] of secretEntries) {
    try {
      keychain.setSecretById(id, value);
    } catch (error) {
      logWarn(`Failed to restore Keychain entry "${id}" during rollback.`, error);
    }
  }

  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
      pendingTombstones.delete(id);
    } catch (error) {
      logWarn(`Failed to write Keychain tombstone "${id}" during rollback.`, error);
    }
  }
}
