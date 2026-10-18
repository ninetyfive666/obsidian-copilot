import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import type { ModelCapability } from "@/constants";
import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";

type ModelEnableListProps = React.ComponentProps<typeof ModelEnableList>;

const OLLAMA_GROUP: ModelEnableGroup = {
  key: "byok:ollama",
  label: "Ollama",
  badge: "Local",
  tooltip: "Runs on http://localhost:11434",
  highlight: true,
  rows: [
    {
      id: "ollama/llama3.1:8b",
      label: "llama3.1:8b",
      enabled: true,
      capabilities: ["vision" as ModelCapability],
    },
    { id: "ollama/qwen2.5:14b", label: "qwen2.5:14b", enabled: true, capabilities: [] },
    { id: "ollama/mistral:7b", label: "mistral:7b", enabled: false, capabilities: [] },
  ],
};

const LMSTUDIO_GROUP: ModelEnableGroup = {
  key: "byok:lmstudio",
  label: "LM Studio",
  badge: "Local",
  tooltip: "Runs on http://localhost:1234/v1",
  rows: [
    { id: "lmstudio/mistral-7b-instruct", label: "mistral-7b-instruct", enabled: true },
    { id: "lmstudio/qwen2.5-coder-14b", label: "qwen2.5-coder-14b-instruct", enabled: false },
  ],
};

const CUSTOM_GROUP: ModelEnableGroup = {
  key: "byok:custom",
  label: "Custom endpoint",
  badge: "OpenAI-compatible",
  rows: Array.from({ length: 18 }, (_, i) => ({
    id: `custom/model-${i}`,
    label: `local-model-${i}`,
    enabled: i < 3,
  })),
};

const UNREACHABLE_GROUP: ModelEnableGroup = {
  key: "byok:unreachable",
  label: "Ollama (offline)",
  badge: "Local",
  tooltip: "Ollama is not reachable at http://localhost:11434",
  rows: [
    { id: "offline/llama3.1:8b", label: "llama3.1:8b", enabled: false },
    { id: "offline/mistral:7b", label: "mistral:7b", enabled: false },
  ],
};

const Controlled: React.FC<{ groups: ModelEnableGroup[]; defaultOpenGroupKey?: string }> = ({
  groups,
  defaultOpenGroupKey,
}) => {
  const [query, setQuery] = React.useState("");
  return (
    <ModelEnableList
      groups={groups}
      query={query}
      onQueryChange={setQuery}
      onToggle={() => undefined}
      defaultOpenGroupKey={defaultOpenGroupKey}
    />
  );
};

const meta = {
  title: "Settings/Model Enable List",
  component: ModelEnableList,
  args: {
    groups: [],
    query: "",
    onQueryChange: () => undefined,
    onToggle: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<ModelEnableListProps>;
export default meta;

export const OverflowingCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[OLLAMA_GROUP, LMSTUDIO_GROUP, CUSTOM_GROUP]} />,
};

export const ShortCatalog: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[OLLAMA_GROUP, LMSTUDIO_GROUP]} />,
};

export const CollapsedWithSelections: StoryObj<ModelEnableListProps> = {
  render: () => (
    <Controlled
      groups={[
        OLLAMA_GROUP,
        LMSTUDIO_GROUP,
        CUSTOM_GROUP,
        {
          ...CUSTOM_GROUP,
          key: "none",
          label: "Custom endpoint (empty)",
          rows: CUSTOM_GROUP.rows.map((row) => ({ ...row, enabled: false })),
        },
      ]}
      defaultOpenGroupKey={OLLAMA_GROUP.key}
    />
  ),
};

export const Empty: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[]} />,
};

export const UnreachableProvider: StoryObj<ModelEnableListProps> = {
  render: () => <Controlled groups={[UNREACHABLE_GROUP, OLLAMA_GROUP]} />,
};
