import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ModelSelector } from "./ModelSelector";
import type { ModelSelectorEntry } from "./ModelSelector";

const model = (over: Partial<ModelSelectorEntry>): ModelSelectorEntry => ({
  name: "llama3.1:8b",
  provider: "ollama",
  enabled: true,
  ...over,
});

describe("ModelSelector", () => {
  describe("ModelSelector()", () => {
    beforeEach(() => {
      jest.spyOn(window, "open").mockImplementation(() => null);
    });
    afterEach(() => jest.restoreAllMocks());

    it("selects an available model", async () => {
      const onChange = jest.fn();
      render(<ModelSelector value="" onChange={onChange} models={[model({})]} />);
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
      fireEvent.click(await screen.findByRole("menuitem", { name: /llama3.1:8b/ }));
      expect(onChange).toHaveBeenCalledWith("llama3.1:8b|ollama");
    });

    it("does not select a row disabled for a local cause (https://github.com/Brevilabs/obsidian-copilot-private/issues/476)", async () => {
      const onChange = jest.fn();
      render(
        <ModelSelector
          value="llama3.1:8b|ollama"
          onChange={onChange}
          models={[
            model({}),
            model({
              name: "unreachable",
              _disabledReason: "Ollama is not reachable at http://localhost:11434",
            }),
          ]}
        />
      );
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });
      const row = await screen.findByRole("menuitem", { name: /unreachable/ });

      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Enter" });
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(onChange).not.toHaveBeenCalled();
      expect(window.open).not.toHaveBeenCalled();
    });

    it("renders a row's subtitle under its name and keeps it off the collapsed trigger", async () => {
      const described = model({
        displayName: "Llama 3.1 8B",
        _subtitle: "A solid local general-purpose model.",
      });
      render(<ModelSelector value="llama3.1:8b|ollama" onChange={jest.fn()} models={[described]} />);

      expect(screen.queryByText("A solid local general-purpose model.")).toBeNull();

      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByText("A solid local general-purpose model.")).toBeTruthy();
    });

    it("keeps the right-side reason for a row disabled for a local cause", async () => {
      const unreachable = model({ _disabledReason: "Ollama is not reachable" });
      const onChange = jest.fn();
      render(
        <ModelSelector value="llama3.1:8b|ollama" onChange={onChange} models={[unreachable]} />
      );
      fireEvent.keyDown(screen.getByRole("button"), { key: "Enter" });

      expect(await screen.findByText("Ollama is not reachable")).toBeTruthy();
      const row = screen.getByRole("menuitem");
      fireEvent.click(row);
      expect(row.getAttribute("aria-disabled")).toBe("true");
      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
