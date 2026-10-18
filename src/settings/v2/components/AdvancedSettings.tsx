import { Button } from "@/components/ui/button";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { LegacyChatPromptsNotice } from "@/settings/v2/components/LegacyChatPromptsNotice";
import { useApp } from "@/context";
import { getCopilotSaveData } from "@/settings/copilotSaveData";
import { KeychainService } from "@/services/keychainService";
import {
  refreshLastPersistedSettings,
  releaseLegacyCredentialHold,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { hasPersistedSecrets } from "@/services/settingsSecretTransforms";
import { logError } from "@/logger";
import {
  type CopilotSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { Info, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Notice } from "obsidian";
import React, { useCallback, useState } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export const AdvancedSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  const [forgetting, setForgetting] = useState(false);

  const keychainAvailable = KeychainService.getInstance().isAvailable();
  const keychainAppearsEmpty = keychainAvailable && !hasPersistedSecrets(settings);

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        "This will remove all API keys for this vault from the Obsidian Keychain, data.json, " +
          "and memory. You will need to re-enter them. Any credential backup files written " +
          "during the v4 upgrade are left in place — delete those yourself once you no longer " +
          "need them.",
        "\u26A0\uFE0F Forget All Secrets",
        "Remove",
        "Cancel",
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = getCopilotSaveData(app);

      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          async (data) => {
            await saveData(data);
            releaseLegacyCredentialHold();
          },
          (nextSettings) => {
            refreshLastPersistedSettings(nextSettings as CopilotSettings);
            suppressNextPersistOnce();
            setSettings(nextSettings);
          }
        )
      );
    } catch (error) {
      logError("Failed to forget secrets.", error);
      new Notice("Failed to remove API keys. Please try again.");
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  return (
    <div className="tw-space-y-4">
      <LegacyChatPromptsNotice />

      <SettingSection label="Others">
        <SettingItem
          type="custom"
          title="API Key Storage"
          description={
            !keychainAvailable ? (
              <>
                Update Obsidian to <code>1.11.4+</code> to use the{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>. Keys
                cannot be loaded or saved in this build.
              </>
            ) : keychainAppearsEmpty ? (
              <span className="tw-text-warning">
                No API keys found in this device&apos;s{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
                Re-enter your API keys in the relevant settings sections — each device has a
                separate Keychain.
              </span>
            ) : (
              <>
                API keys are stored in this device&apos;s{" "}
                <strong className="tw-font-semibold tw-text-normal">Obsidian Keychain</strong>.
              </>
            )
          }
        >
          <div className="tw-flex tw-flex-col tw-items-start tw-gap-2 sm:tw-items-end">
            {keychainAvailable ? (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-bg-success tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-success">
                <ShieldCheck className="tw-size-4" />
                Obsidian Keychain
              </div>
            ) : (
              <div className="tw-inline-flex tw-items-center tw-gap-1.5 tw-rounded-md tw-border tw-border-border tw-bg-secondary tw-px-3 tw-py-1 tw-text-smallest tw-font-semibold tw-text-muted">
                <Info className="tw-size-4" />
                Unavailable
              </div>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={safeAsyncHandler(handleForgetAllSecrets)}
              disabled={forgetting || !keychainAvailable}
              title={
                keychainAvailable
                  ? undefined
                  : "Update Obsidian to 1.11.4+ to delete Keychain entries."
              }
              className="tw-gap-1.5"
            >
              <Trash2 className="tw-size-4" />
              {forgetting ? "Removing..." : "Delete All Keys"}
            </Button>
          </div>
        </SettingItem>
      </SettingSection>

      <DebuggingSupportSection
        debug={settings.debug}
        onDebugChange={(checked) => updateSetting("debug", checked)}
      />
    </div>
  );
};
