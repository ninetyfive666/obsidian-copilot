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
let mockLatestVersion: string | null = null;
let mockHasUpdate = false;
jest.mock("@/hooks/useLatestVersion", () => ({
  // eslint-disable-next-line @eslint-react/hooks-extra/no-unnecessary-use-prefix -- mocks the real hook; the name must match the export
  useLatestVersion: () => ({ latestVersion: mockLatestVersion, hasUpdate: mockHasUpdate }),
}));

const plugin = {
  app: {},
  manifest: { version: "1.2.3" },
} as unknown as CopilotPlugin;

describe("SettingsMainV2", () => {
  describe("SettingsMainV2()", () => {
    beforeEach(() => {
      mockLatestVersion = null;
      mockHasUpdate = false;
    });

    it("shows the installed version and latest version from the shared update hook", () => {
      mockLatestVersion = "4.1.0";
      mockHasUpdate = true;
      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.getByText("v1.2.3")).toBeTruthy();
      expect(screen.getByRole("link", { name: "(Update to v4.1.0)" })).toBeTruthy();
    });

    it("shows up to date when the shared check finds no newer release", () => {
      mockLatestVersion = "1.2.3";
      render(<SettingsMainV2 plugin={plugin} />);
      expect(screen.getByText("(up to date)")).toBeTruthy();
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
