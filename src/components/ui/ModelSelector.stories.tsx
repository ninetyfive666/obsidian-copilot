import { ModelSelector, type ModelSelectorEntry } from "@/components/ui/ModelSelector";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

type ModelSelectorProps = ComponentProps<typeof ModelSelector>;

const DISABLED_MODEL_ROW: ModelSelectorEntry = {
  name: "qwen2.5:14b",
  provider: "ollama",
  displayName: "ollama/qwen2.5:14b",
  enabled: false,
  _group: "Ollama",
  _disabledReason: "Ollama is not reachable at http://localhost:11434",
};

const LOCAL_MODELS: ModelSelectorEntry[] = [
  {
    name: "llama3.1:8b",
    provider: "ollama",
    displayName: "ollama/llama3.1:8b",
    enabled: true,
    _group: "Ollama",
    _subtitle: "Runs locally via Ollama.",
  },
  {
    name: "mistral-7b-instruct",
    provider: "lmstudio",
    displayName: "lmstudio/mistral-7b-instruct",
    enabled: true,
    _group: "LM Studio",
  },
];

const meta = {
  title: "UI/Model Selector",
  component: ModelSelector,
  args: {
    value: "llama3.1:8b|ollama",
    onChange: () => undefined,
    models: LOCAL_MODELS,
  },
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<ModelSelectorProps>;
export default meta;

export const LocalModels: StoryObj<ModelSelectorProps> = {};

export const UnreachableProvider: StoryObj<ModelSelectorProps> = {
  args: {
    models: [DISABLED_MODEL_ROW, ...LOCAL_MODELS],
  },
};

export const NoModels: StoryObj<ModelSelectorProps> = {
  args: {
    value: "",
    models: [],
  },
};

export const CommandNeedsSelection: StoryObj<ModelSelectorProps> = { args: { value: "" } };
