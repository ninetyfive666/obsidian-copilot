import type CopilotPlugin from "@/main";
import SettingsMainV2 from "@/settings/v2/SettingsMainV2";
import { render, screen } from "@testing-library/react";
import React from "react";

jest.mock("@/settings/v2/components/BasicSettings", () => ({ BasicSettings: () => null }));
jest.mock("@/settings/v2/components/CommandSettings", () => ({ CommandSettings: () => null }));
jest.mock("@/settings/v2/components/AdvancedSettings", () => ({ AdvancedSettings: () => null }));
jest.mock("@/modelManagement", () => ({
  ByokPanel: () => null,
  ModelManagementProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock("@/settings/model", () => ({ resetSettings: jest.fn() }));

const plugin = {
  app: {},
  manifest: { version: "1.2.3" },
} as unknown as CopilotPlugin;

describe("SettingsMainV2", () => {
  describe("SettingsMainV2()", () => {
    it("shows the installed version", () => {
      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.getByText("v1.2.3")).toBeTruthy();
    });

    it("lists the tabs in the agreed order", () => {
      render(<SettingsMainV2 plugin={plugin} />);

      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Basic",
        "Models",
        "Command",
        "Advanced",
      ]);
    });

    it("opens on a requested tab (https://github.com/Brevilabs/obsidian-copilot-private/issues/280)", () => {
      render(<SettingsMainV2 plugin={plugin} initialTab="command" />);

      expect(screen.getByRole("tab", { name: "Command" }).getAttribute("aria-selected")).toBe(
        "true"
      );
    });
  });
});
