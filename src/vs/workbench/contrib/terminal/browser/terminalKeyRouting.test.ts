import { describe, expect, it } from "vitest";

import { DEFAULT_COMMANDS_TO_SKIP_SHELL } from "../../../common/configuration/terminalCommandsToSkipShell.ts";

import { computeCommandsToSkipShell } from "./terminalKeyRouting.ts";

describe("computeCommandsToSkipShell", () => {
    it("is the default set without user entries", () => {
        expect(computeCommandsToSkipShell([])).toEqual(new Set(DEFAULT_COMMANDS_TO_SKIP_SHELL));
    });

    it("`-<id>` removes a default, `<id>` adds a command", () => {
        const skip = computeCommandsToSkipShell(["-workbench.action.quickOpen", "workbench.action.files.save"]);

        expect(skip.has("workbench.action.quickOpen")).toBe(false);
        expect(skip.has("workbench.action.files.save")).toBe(true);
        expect(skip.size).toBe(DEFAULT_COMMANDS_TO_SKIP_SHELL.length);
    });

    it("ignores entries that are not strings", () => {
        expect(computeCommandsToSkipShell([42, null, "my.command"])).toEqual(
            new Set([...DEFAULT_COMMANDS_TO_SKIP_SHELL, "my.command"]),
        );
    });

    it("a `-` only in the middle of an id adds it as is", () => {
        expect(computeCommandsToSkipShell(["my-ext.run"]).has("my-ext.run")).toBe(true);
    });
});
