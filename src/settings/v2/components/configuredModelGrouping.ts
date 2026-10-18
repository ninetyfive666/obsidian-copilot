import type { ModelEnableGroup, ModelEnableRow } from "@/components/ui/ModelEnableList";
import {
  capabilitiesFromConfiguredInfo,
  type ConfiguredModel,
  type Provider,
} from "@/modelManagement";

export interface Candidate {
  configuredModel: ConfiguredModel;
  provider: Provider;
  enabled: boolean;
}

export function partitionChatCandidates(
  configuredModels: readonly ConfiguredModel[],
  providers: Readonly<Record<string, Provider>>,
  enabledIds: ReadonlySet<string>
): Candidate[] {
  const candidates: Candidate[] = [];
  for (const configuredModel of configuredModels) {
    if (configuredModel.info.isEmbedding) continue;
    const provider = providers[configuredModel.providerId];
    if (!provider) continue;
    candidates.push({
      configuredModel,
      provider,
      enabled: enabledIds.has(configuredModel.configuredModelId),
    });
  }
  return candidates;
}

export function toRow(candidate: Candidate): ModelEnableRow {
  const { configuredModel, enabled } = candidate;
  const { displayName, id, description } = configuredModel.info;
  return {
    id: configuredModel.configuredModelId,
    label: displayName || id,
    description: description || undefined,
    wireId: id,
    enabled,
    capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
  };
}

export function rowMatches(row: ModelEnableRow, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    row.label.toLowerCase().includes(needle) ||
    row.id.toLowerCase().includes(needle) ||
    (row.wireId?.toLowerCase().includes(needle) ?? false) ||
    (row.description?.toLowerCase().includes(needle) ?? false)
  );
}

export function buildModelEnableGroups(
  candidates: readonly Candidate[],
  query: string
): ModelEnableGroup[] {
  const q = query.trim().toLowerCase();
  const byProvider = new Map<string, { label: string; rows: ModelEnableRow[] }>();
  for (const candidate of candidates) {
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const key = candidate.provider.providerId;
    const bucket = byProvider.get(key);
    if (bucket) bucket.rows.push(row);
    else byProvider.set(key, { label: candidate.provider.displayName, rows: [row] });
  }
  return Array.from(byProvider, ([providerId, { label, rows }]) => ({
    key: `byok:${providerId}`,
    label,
    rows,
  }));
}
