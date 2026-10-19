import type { Meta, StoryObj } from "@/lib/story";
import { BaseUrlV1Suggestion, type BaseUrlV1SuggestionProps } from "./BaseUrlV1Suggestion";

const meta = {
  title: "Settings/Base URL /v1 Suggestion",
  component: BaseUrlV1Suggestion,
  args: { suggestedBaseUrl: "http://llm.home/v1", onApply: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<BaseUrlV1SuggestionProps>;
export default meta;

export const SuggestingV1Base: StoryObj<BaseUrlV1SuggestionProps> = {};

export const SuggestingV1BaseWithPort: StoryObj<BaseUrlV1SuggestionProps> = {
  args: { suggestedBaseUrl: "http://192.168.1.103:8080/v1" },
};
