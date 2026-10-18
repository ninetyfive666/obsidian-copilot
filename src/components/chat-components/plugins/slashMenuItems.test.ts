import type { CustomCommand } from "@/commands/type";
import { composeSlashMenuItems } from "./slashMenuItems";

function makeCommand(overrides: Partial<CustomCommand> & { title: string }): CustomCommand {
  return {
    content: `# ${overrides.title}\n\nbody`,
    showInContextMenu: false,
    showInSlashMenu: true,
    order: 0,
    modelKey: "",
    lastUsedMs: 0,
    ...overrides,
  };
}

describe("slashMenuItems", () => {
  describe("composeSlashMenuItems()", () => {
    it("exposes only commands with showInSlashMenu", () => {
      const commands = [
        makeCommand({ title: "visible" }),
        makeCommand({ title: "hidden", showInSlashMenu: false }),
      ];
      const items = composeSlashMenuItems(commands);
      expect(items.map((item) => item.name)).toEqual(["visible"]);
    });

    it("maps command content onto the menu item body", () => {
      const commands = [makeCommand({ title: "summarize", content: "Summarize the note" })];
      const items = composeSlashMenuItems(commands);
      expect(items[0]).toEqual(
        expect.objectContaining({
          key: "command:summarize:0",
          name: "summarize",
          body: "Summarize the note",
        })
      );
    });

    it("preserves caller-supplied order", () => {
      const commands = [makeCommand({ title: "z-cmd" }), makeCommand({ title: "m-cmd" })];
      const items = composeSlashMenuItems(commands);
      expect(items.map((item) => item.name)).toEqual(["z-cmd", "m-cmd"]);
    });
  });
});
