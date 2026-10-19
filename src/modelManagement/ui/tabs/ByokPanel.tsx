import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/ui/SearchBar";
import { useApp } from "@/context";
import { logError } from "@/logger";
import {
  CUSTOM_OPENAI_DEFINITION,
  LOCAL_PROVIDER_DEFINITIONS,
} from "@/modelManagement/catalog/builtinDefinitions";
import { configuredModelsAtom, visibleByokProvidersAtom } from "@/modelManagement/state/atoms";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { ProviderVerificationProgress } from "@/modelManagement/ui/components/ProviderVerificationStatus";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import {
  ByokGlobalTable,
  type ByokTableGroup,
} from "@/modelManagement/ui/components/ByokGlobalTable";
import { AddProviderModal } from "@/modelManagement/ui/dialogs/AddProviderDialog";
import { ConfigureProviderModal } from "@/modelManagement/ui/dialogs/ConfigureProviderDialog";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import { Plus } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";

const EMPTY_VERIFICATION: Readonly<Record<string, VerificationResult>> = Object.freeze({});
const EMPTY_MODELS: readonly ConfiguredModel[] = Object.freeze([]);

export const ByokPanel: React.FC = () => {
  const api = useModelManagement();
  const app = useApp();

  const providers = useAtomValue(visibleByokProvidersAtom, { store: settingsStore });
  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });

  const [query, setQuery] = useState("");
  const [verification, setVerification] =
    useState<Readonly<Record<string, VerificationResult>>>(EMPTY_VERIFICATION);
  const [verificationProviders, setVerificationProviders] = useState(() =>
    api.providerRegistry.listByOrigin("byok")
  );
  const pendingChecks = verificationProviders.length - Object.keys(verification).length;
  const refreshVerification = (): void => {
    setVerification(EMPTY_VERIFICATION);
    setVerificationProviders([...api.providerRegistry.listByOrigin("byok")]);
  };

  useEffect(() => {
    let cancelled = false;
    // https://github.com/logancyang/obsidian-copilot/issues/3147:
    // Check completed saves, including CORS-only edits. Registry events can fire
    // between key and endpoint writes and would send the new key to the old URL.

    for (const provider of verificationProviders) {
      void api.providerRegistry
        .verify(provider.providerId)
        .catch(
          (): VerificationResult => ({
            ok: false,
            message: "Could not verify this provider. Reopen this tab to retry.",
            checkedAt: Date.now(),
          })
        )
        .then((result) => {
          if (cancelled) return;
          setVerification((results) => ({ ...results, [provider.providerId]: result }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [api, verificationProviders]);

  const groups = useMemo<ByokTableGroup[]>(() => {
    const byProvider = new Map<string, ConfiguredModel[]>();
    for (const model of configuredModels) {
      const list = byProvider.get(model.providerId);
      if (list) list.push(model);
      else byProvider.set(model.providerId, [model]);
    }
    const q = query.trim().toLowerCase();
    return providers
      .map((provider) => {
        const all = byProvider.get(provider.providerId) ?? (EMPTY_MODELS as ConfiguredModel[]);
        if (!q || provider.displayName.toLowerCase().includes(q)) {
          return {
            provider,
            models: all,
            verification: verification[provider.providerId],
          };
        }
        const models = all.filter(
          (m) => m.info.displayName.toLowerCase().includes(q) || m.info.id.toLowerCase().includes(q)
        );
        return {
          provider,
          models,
          verification: verification[provider.providerId],
        };
      })
      .filter((g) => !q || g.models.length > 0 || g.provider.displayName.toLowerCase().includes(q));
  }, [providers, configuredModels, query, verification]);

  const handleAddProvider = (): void => {
    new AddProviderModal(app, {
      localTemplates: LOCAL_PROVIDER_DEFINITIONS,
      customTemplate: CUSTOM_OPENAI_DEFINITION,
      onPick: (source) =>
        new ConfigureProviderModal(app, {
          state: { mode: "new", source },
          api,
          onSaved: refreshVerification,
        }).open(),
    }).open();
  };

  const handleRemove = (providerId: string): void => {
    const provider = providers.find((p) => p.providerId === providerId);
    if (!provider) return;
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeProvider(providerId);
        } catch (err) {
          logError("[ByokPanel] removeProvider failed", err);
          new Notice("Failed to remove provider.");
        }
      },
      `Remove ${provider.displayName}? This also removes all of its models from every model picker.`,
      "Remove provider",
      "Remove",
      "Cancel"
    );
    modal.open();
  };

  return (
    <div className="tw-relative tw-flex tw-flex-col tw-gap-4 tw-py-4">
      <ProviderVerificationProgress pending={pendingChecks} />
      <div className="tw-flex tw-items-start tw-justify-between tw-gap-4">
        <div className="tw-flex tw-flex-col tw-gap-1">
          <div className="tw-text-xl tw-font-bold tw-text-normal">Local Models</div>
          <div className="tw-max-w-xl tw-text-sm tw-text-muted">
            Connect a local OpenAI-compatible server — llama.cpp llama-server, LM Studio, Ollama or
            any custom endpoint.
          </div>
        </div>
        <Button className="tw-shrink-0" onClick={handleAddProvider}>
          <Plus className="tw-size-4" />
          Add a provider
        </Button>
      </div>

      <SearchBar value={query} onChange={setQuery} placeholder="Search providers…" />

      <div className="tw-flex tw-flex-col">
        <ByokGlobalTable
          groups={groups}
          emptyMessage={
            query.trim() && providers.length > 0 ? "No providers match your search." : undefined
          }
          onConfigure={(id) =>
            new ConfigureProviderModal(app, {
              state: { mode: "edit", providerId: id },
              api,
              onSaved: refreshVerification,
            }).open()
          }
          onRemove={handleRemove}
        />
      </div>
    </div>
  );
};
