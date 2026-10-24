import { describe, expect, it } from "vitest";

import { DEFAULT_COMMANDS_TO_SKIP_SHELL } from "./terminalCommandsToSkipShell.ts";

describe("DEFAULT_COMMANDS_TO_SKIP_SHELL", () => {
    it("is upstream's list plus the terminal contributions' commands, without duplicates", () => {
        expect(DEFAULT_COMMANDS_TO_SKIP_SHELL).toHaveLength(180);
        expect(new Set(DEFAULT_COMMANDS_TO_SKIP_SHELL).size).toBe(180);
        expect(DEFAULT_COMMANDS_TO_SKIP_SHELL[0]).toBe("workbench.action.terminal.clearSelection");
        expect(DEFAULT_COMMANDS_TO_SKIP_SHELL.at(-1)).toBe("workbench.action.terminal.suggestToggleDetailsFocus");
    });

    it("keeps the workbench's own navigation, not the shell-editing commands", () => {
        expect(DEFAULT_COMMANDS_TO_SKIP_SHELL).toEqual(
            expect.arrayContaining([
                "workbench.action.quickOpen",
                "workbench.action.showCommands",
                "workbench.action.togglePanel",
                "workbench.action.terminal.killEditor",
            ]),
        );
        expect(DEFAULT_COMMANDS_TO_SKIP_SHELL).not.toContain("workbench.action.toggleSidebarVisibility");
        expect(DEFAULT_COMMANDS_TO_SKIP_SHELL).not.toContain("workbench.action.files.save");
    });
});
