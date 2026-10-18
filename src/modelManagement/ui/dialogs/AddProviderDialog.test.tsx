import type { ProviderDefinition } from "@/modelManagement/types/runtime";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { AddProviderContent } from "./AddProviderDialog";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

const localTemplates: ProviderDefinition[] = [
  {
    id: "ollama",
    displayName: "Ollama",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:11434/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. llama3.2",
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    providerType: "openai-compatible",
    defaultBaseUrl: "http://localhost:1234/v1",
    requiresApiKey: false,
    modelInputHint: "e.g. qwen2.5",
  },
];

const customTemplate: ProviderDefinition = {
  id: "custom-openai-compatible",
  displayName: "Custom OpenAI-compatible",
  providerType: "openai-compatible",
  requiresApiKey: true,
  modelInputHint: "e.g. qwen2.5",
};

function renderDialog(overrides: Partial<React.ComponentProps<typeof AddProviderContent>> = {}) {
  const props: React.ComponentProps<typeof AddProviderContent> = {
    localTemplates,
    customTemplate,
    onPick: jest.fn(),
    ...overrides,
  };
  render(<AddProviderContent {...props} />);
  return props;
}

describe("AddProviderDialog", () => {
  describe("AddProviderContent()", () => {
    it("lists the local runners in their own group on the first screen", () => {
      renderDialog();
      expect(screen.getByTestId("add-provider-local")).toBeTruthy();
      expect(screen.getByTestId("add-provider-template-ollama")).toBeTruthy();
      expect(screen.getByTestId("add-provider-template-lmstudio")).toBeTruthy();
    });

    it("hides every local runner that does not match the search query", () => {
      renderDialog();
      fireEvent.change(screen.getByPlaceholderText("Search providers…"), {
        target: { value: "ollama" },
      });
      expect(screen.queryByTestId("add-provider-template-lmstudio")).toBeNull();
      expect(screen.getByTestId("add-provider-template-ollama")).toBeTruthy();
    });

    it("shows the empty state when nothing matches the search query", () => {
      renderDialog();
      fireEvent.change(screen.getByPlaceholderText("Search providers…"), {
        target: { value: "no-such-runner" },
      });
      expect(screen.getByText("No providers match your search.")).toBeTruthy();
    });

    it("picks the local template as-is, without a catalog id, when a local runner is clicked", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-template-ollama"));
      expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: "ollama" }));
      expect(onPick.mock.calls[0][0].catalogProviderId).toBeUndefined();
    });

    it("picks the custom OpenAI-compatible definition, without a catalog id, from the CTA", () => {
      const onPick = jest.fn();
      renderDialog({ onPick });
      fireEvent.click(screen.getByTestId("add-provider-custom-cta"));
      expect(onPick).toHaveBeenCalledWith(
        expect.objectContaining({ id: "custom-openai-compatible" })
      );
      expect(onPick.mock.calls[0][0].catalogProviderId).toBeUndefined();
    });

    it.each([["Enter"], ["Space", " "]])(
      "activates the custom-provider CTA with the %s key",
      (_name, key = _name) => {
        const onPick = jest.fn();
        renderDialog({ onPick });
        fireEvent.keyDown(screen.getByTestId("add-provider-custom-cta"), { key });
        expect(onPick).toHaveBeenCalledWith(
          expect.objectContaining({ id: "custom-openai-compatible" })
        );
      }
    );
  });
});
