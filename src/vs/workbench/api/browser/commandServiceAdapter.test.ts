import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { NULL_COMMAND_SERVICE } from "../common/iCommandService.ts";

import { CommandServiceAdapter } from "./commandServiceAdapter.ts";

describe("CommandServiceAdapter", () => {
    it("execute delegates to CommandRegistry and passes args/result through", () => {
        const registry = new CommandRegistry();
        registry.register("core.sum", (a, b) => (a as number) + (b as number));
        const adapter = new CommandServiceAdapter(registry);

        expect(adapter.execute("core.sum", [4, 5])).toBe(9);
    });

    it("execute of an unknown command throws", () => {
        const adapter = new CommandServiceAdapter(new CommandRegistry());
        expect(() => adapter.execute("nope", [])).toThrow(/not found/);
    });

    it("registerProxy stores a callable entry, invoke receives args as an array", () => {
        const registry = new CommandRegistry();
        const adapter = new CommandServiceAdapter(registry);
        const seen: unknown[][] = [];
        adapter.registerProxy("ext.proxy", (args) => {
            seen.push([...args]);
            return "ok";
        });

        expect(registry.has("ext.proxy")).toBe(true);
        expect(registry.execute("ext.proxy", 1, 2, 3)).toBe("ok");
        expect(seen).toEqual([[1, 2, 3]]);
    });

    it("disposing the registration removes the command from the registry", () => {
        const registry = new CommandRegistry();
        const adapter = new CommandServiceAdapter(registry);
        const disposable = adapter.registerProxy("ext.temp", () => undefined);
        expect(registry.has("ext.temp")).toBe(true);

        disposable.dispose();
        expect(registry.has("ext.temp")).toBe(false);
    });
});

describe("NULL_COMMAND_SERVICE", () => {
    it("execute: no-op returns undefined", () => {
        expect(NULL_COMMAND_SERVICE.execute("any", [1, 2])).toBeUndefined();
    });

    it("registerProxy: no-op returns a safe Disposable", () => {
        const disposable = NULL_COMMAND_SERVICE.registerProxy("any", () => undefined);
        expect(() => {
            disposable.dispose();
        }).not.toThrow();
    });
});
