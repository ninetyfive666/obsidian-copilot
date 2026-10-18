import { ChainType } from "@/chainType";
import { ChatModeSelector } from "@/components/chat-components/ChatModeSelector";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("ChatModeSelector", () => {
  beforeAll(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
    if (!("PointerEvent" in window)) {
      (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
    }
    Element.prototype.hasPointerCapture = () => false;
    Element.prototype.releasePointerCapture = () => {};
    Element.prototype.scrollIntoView = () => {};
  });

  describe("ChatModeSelector()", () => {
    it("offers plain chat and the Copilot Plus chain https://github.com/Brevilabs/obsidian-copilot-private/issues/286", () => {
      const onModeChange = jest.fn();
      render(
        <ChatModeSelector
          selectedChain={ChainType.LLM_CHAIN}
          onModeChange={onModeChange}
          defaultOpen
        />
      );

      expect(screen.getAllByText("chat").length).toBeGreaterThan(0);
      expect(screen.getByText("copilot plus")).toBeTruthy();

      fireEvent.click(screen.getByRole("menuitem", { name: "copilot plus" }));
      expect(onModeChange).toHaveBeenCalledWith(ChainType.COPILOT_PLUS_CHAIN);
    });

    it("switches from the Copilot Plus chain back to plain chat https://github.com/Brevilabs/obsidian-copilot-private/issues/286", () => {
      const onModeChange = jest.fn();
      render(
        <ChatModeSelector
          selectedChain={ChainType.COPILOT_PLUS_CHAIN}
          onModeChange={onModeChange}
          defaultOpen
        />
      );

      fireEvent.click(screen.getByRole("menuitem", { name: "chat" }));
      expect(onModeChange).toHaveBeenCalledWith(ChainType.LLM_CHAIN);
    });
  });
});
