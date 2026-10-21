import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../platform/commands/common/commandRegistry.ts";
import type { ContextKey } from "../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyService } from "../../platform/contextkey/common/contextKeyService.ts";

import { normalizeContextValue, SetContextCommandContribution } from "./setContextCommandContribution.ts";

function setup(): { commands: CommandRegistry; contextKeys: ContextKeyService } {
    const commands = new CommandRegistry();
    const contextKeys = new ContextKeyService();
    new SetContextCommandContribution(commands, contextKeys);
    return { commands, contextKeys };
}

describe("SetContextCommandContribution", () => {
    // Before the command was registered, the call was rejected as "command not found".
    it("setContext puts the value into the when context and a when expression sees it", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "supermaven.hasJumped", true);

        expect(contextKeys.evaluate("supermaven.hasJumped")).toBe(true);
    });

    it("a repeated call overwrites the value", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "myext.armed", true);
        commands.execute("setContext", "myext.armed", false);

        expect(contextKeys.evaluate("myext.armed")).toBe(false);
    });

    it("an array works with the in operator, like a VS Code list key", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "myext.supportedFiles", ["a.ts", "b.ts"]);
        commands.execute("setContext", "myext.current", "b.ts");

        expect(contextKeys.evaluate("myext.current in myext.supportedFiles")).toBe(true);
        expect(contextKeys.evaluate("myext.current not in myext.supportedFiles")).toBe(false);
    });

    it("strings and numbers work with comparisons", () => {
        const { commands, contextKeys } = setup();

        commands.execute("setContext", "myext.mode", "fast");
        commands.execute("setContext", "myext.count", 3);

        expect(contextKeys.evaluate("myext.mode == 'fast'")).toBe(true);
        expect(contextKeys.evaluate("myext.count > 2")).toBe(true);
    });

    it("an empty or non-string key is ignored", () => {
        const { commands, contextKeys } = setup();

        expect(commands.execute("setContext", "", true)).toBeUndefined();
        expect(commands.execute("setContext", 42, true)).toBeUndefined();
        expect(commands.execute("setContext")).toBeUndefined();

        // The evaluator's name set has no use for a key with an empty name.
        expect(contextKeys.get("" as ContextKey)).toBeUndefined();
        expect(contextKeys.get("42" as ContextKey)).toBeUndefined();

        // An invalid name breaks compilation, i.e. ALL when expressions at once.
        contextKeys.set("textInputFocus", true);
        expect(contextKeys.evaluate("textInputFocus")).toBe(true);
    });

    it("the command has no title and stays out of the command palette", () => {
        const { commands } = setup();
        expect(commands.listCommands().some((c) => c.id === "setContext")).toBe(false);
    });

    it("dispose removes the registration", () => {
        const commands = new CommandRegistry();
        const contribution = new SetContextCommandContribution(commands, new ContextKeyService());
        expect(commands.has("setContext")).toBe(true);

        contribution.dispose();
        expect(commands.has("setContext")).toBe(false);
    });
});

describe("normalizeContextValue", () => {
    it("primitives pass through as is", () => {
        expect(normalizeContextValue(true)).toBe(true);
        expect(normalizeContextValue(false)).toBe(false);
        expect(normalizeContextValue("ready")).toBe("ready");
        expect(normalizeContextValue("")).toBe("");
        expect(normalizeContextValue(0)).toBe(0);
        expect(normalizeContextValue(-1.5)).toBe(-1.5);
    });

    it("null/undefined is false: an unset key reads the same way here", () => {
        expect(normalizeContextValue(null)).toBe(false);
        expect(normalizeContextValue(undefined)).toBe(false);
    });

    it("NaN and Infinity reduce to their truthiness", () => {
        expect(normalizeContextValue(Number.NaN)).toBe(false);
        expect(normalizeContextValue(Number.POSITIVE_INFINITY)).toBe(true);
    });

    it("arrays and objects are stored as is for the in operator; arrays keep only primitives", () => {
        expect(normalizeContextValue([])).toEqual([]);
        expect(normalizeContextValue(["a", 1, true, null, { x: 1 }])).toEqual(["a", 1, true]);
        const map = { "a.ts": true };
        expect(normalizeContextValue(map)).toBe(map);
    });
});
