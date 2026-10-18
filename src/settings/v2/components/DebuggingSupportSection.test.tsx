import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { DebuggingSupportSection } from "./DebuggingSupportSection";

function renderSection(debug = false) {
  const props = { debug, onDebugChange: jest.fn() };
  render(<DebuggingSupportSection {...props} />);
  return props;
}

describe("DebuggingSupportSection", () => {
  describe("DebuggingSupportSection()", () => {
    it("shows the Debug Mode switch reflecting the passed debug state", () => {
      renderSection(true);
      const debugSwitch = screen.getByRole("switch");
      expect(screen.getByText("Debug Mode")).toBeTruthy();
      expect(debugSwitch.getAttribute("aria-checked")).toBe("true");
    });

    it("reports the next value when the Debug Mode switch is toggled", () => {
      const props = renderSection(false);

      fireEvent.click(screen.getByRole("switch"));

      expect(props.onDebugChange).toHaveBeenCalledWith(true);
    });
  });
});
