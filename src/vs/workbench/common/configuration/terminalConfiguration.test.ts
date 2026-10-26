import { describe, expect, it } from "vitest";

import { DEFAULT_COMMANDS_TO_SKIP_SHELL } from "./terminalCommandsToSkipShell.ts";
import { terminalConfiguration } from "./terminalConfiguration.ts";

describe("terminalConfiguration", () => {
    it("keyboard.platform: auto by default and exactly three keyboard OSes", () => {
        expect(terminalConfiguration.properties["keyboard.platform"]).toMatchObject({
            type: "string",
            default: "auto",
            enum: ["auto", "mac", "linux", "windows"],
        });
    });
});

describe("terminalConfiguration — keys in the focused terminal (verbatim upstream)", () => {
    const properties = terminalConfiguration.properties;

    it("sendKeybindingsToShell, allowChords and allowMnemonics: booleans with upstream defaults", () => {
        expect(properties["terminal.integrated.sendKeybindingsToShell"]).toMatchObject({
            type: "boolean",
            default: false,
        });
        expect(properties["terminal.integrated.allowChords"]).toMatchObject({ type: "boolean", default: true });
        expect(properties["terminal.integrated.allowMnemonics"]).toMatchObject({ type: "boolean", default: false });
    });

    it("commandsToSkipShell: an empty array whose description lists the sorted defaults", () => {
        const schema = properties["terminal.integrated.commandsToSkipShell"];
        expect(schema).toMatchObject({ type: "array", default: [] });
        const listed = schema.description.split("Default Skipped Commands:\n\n")[1].split("\n");
        expect(listed).toEqual([...DEFAULT_COMMANDS_TO_SKIP_SHELL].sort().map((command) => `- ${command}`));
        expect(listed[0]).toBe("- editor.action.accessibilityHelp");
    });
});

describe("terminalConfiguration — kitty keyboard protocol (verbatim upstream)", () => {
    it("enableKittyKeyboardProtocol: a boolean on by default with the upstream description", () => {
        expect(terminalConfiguration.properties["terminal.integrated.enableKittyKeyboardProtocol"]).toStrictEqual({
            scope: "window",
            type: "boolean",
            default: true,
            description:
                "Whether to enable the kitty keyboard protocol, which allows a program in the terminal to request more detailed keyboard input reporting. This can, for example, enable `Shift+Enter` to be handled by the program.",
        });
    });
});
