import type { CustomCommand } from "@/commands/type";

export interface SlashMenuItem {
  key: string;
  name: string;
  description: string;
  body: string;
  command: CustomCommand;
}

export function composeSlashMenuItems(commands: CustomCommand[]): SlashMenuItem[] {
  return commands
    .filter((command) => command.showInSlashMenu)
    .map<SlashMenuItem>((command, index) => ({
      key: `command:${command.title}:${index}`,
      name: command.title,
      description: "",
      body: command.content,
      command,
    }));
}
