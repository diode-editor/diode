import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IConfig, IDebugAdapterFactory, IDebugService, IDebugSession } from "../common/debug.ts";

import { AdapterManager } from "./debugAdapterManager.ts";

function sessionOf(type: string): IDebugSession {
    return mockSession({ configuration: { type, name: "n", request: "launch" } });
}

describe("AdapterManager", () => {
    let contextKeys: ContextKeyService;
    let manager: AdapterManager;
    let debugService: Pick<IDebugService, "getModel" | "startDebugging">;

    beforeEach(() => {
        contextKeys = new ContextKeyService();
        debugService = {
            getModel: () =>
                ({ getSession: (id: string | undefined) => (id === "parent" ? sessionOf("p") : undefined) }) as never,
            startDebugging: vi.fn(() => Promise.resolve(true)),
        };
        manager = new AdapterManager(() => debugService as IDebugService, contextKeys);
    });

    afterEach(() => {
        manager.dispose();
    });

    function factory(): IDebugAdapterFactory & { adapter: MockDebugAdapter } {
        const adapter = new MockDebugAdapter();
        return {
            adapter,
            createDebugAdapter: () => adapter,
            substituteVariables: (_folder, config) => Promise.resolve({ ...config, name: "substituted" }),
            runInTerminal: () => Promise.resolve(42),
        };
    }

    it("without debuggers nothing is available", () => {
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(false);
        expect(contextKeys.getRaw("debugExtensionAvailable")).toBe(false);
        expect(manager.hasEnabledDebuggers()).toBe(false);
        expect(manager.getDebugger("lldb")).toBeUndefined();
    });

    it("a registered debugger is available, found by its type in any case, until it goes away", () => {
        const registered = vi.fn();
        manager.onDidRegisterDebugger(registered);

        const registration = manager.registerDebugger({ type: "lldb", label: "CodeLLDB" });

        expect(registered).toHaveBeenCalledTimes(1);
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(true);
        expect(manager.getDebugger("LLDB")?.label).toBe("CodeLLDB");
        registration.dispose();
        registration.dispose();
        expect(manager.getDebugger("lldb")).toBeUndefined();
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(false);
    });

    it("disposing a registration twice leaves the other debuggers", () => {
        const first = manager.registerDebugger({ type: "lldb" });
        manager.registerDebugger({ type: "gdb" });

        first.dispose();
        first.dispose();

        expect(manager.getDebugger("gdb")?.type).toBe("gdb");
    });

    it("a debugger whose `when` does not hold is installed but not available", () => {
        manager.registerDebugger({ type: "lldb", when: "isLinux && false" });

        expect(manager.hasEnabledDebuggers()).toBe(false);
        expect(contextKeys.getRaw("debuggersAvailable")).toBe(false);
        expect(contextKeys.getRaw("debugExtensionAvailable")).toBe(true);
        expect(manager.getDebugger("lldb")?.enabled).toBe(false);
    });

    it("a debugger is enabled by its `when`", () => {
        contextKeys.setRaw("myKey", true);
        manager.registerDebugger({ type: "lldb", when: "myKey" });

        expect(manager.getDebugger("lldb")?.enabled).toBe(true);
    });

    it("creates the adapter of the session's type through its factory", () => {
        const f = factory();
        const registration = manager.registerDebugAdapterFactory(["lldb", "gdb"], f);

        expect(manager.createDebugAdapter(sessionOf("gdb"))).toBe(f.adapter);
        expect(manager.createDebugAdapter(sessionOf("node"))).toBeUndefined();
        registration.dispose();
        expect(manager.createDebugAdapter(sessionOf("lldb"))).toBeUndefined();
        f.adapter.dispose();
    });

    it("substitutes variables and runs in a terminal through the type's factory, as is without one", async () => {
        const f = factory();
        manager.registerDebugAdapterFactory(["lldb"], f);
        const config: IConfig = { type: "lldb", name: "n", request: "launch" };

        expect(await manager.substituteVariables("lldb", undefined, config)).toMatchObject({ name: "substituted" });
        expect(await manager.substituteVariables("gdb", undefined, config)).toBe(config);
        expect(await manager.runInTerminal("lldb", { cwd: "/", args: [] }, "s")).toBe(42);
        expect(await manager.runInTerminal("gdb", { cwd: "/", args: [] }, "s")).toBeUndefined();
        f.adapter.dispose();
    });

    describe("Debugger", () => {
        it("has the contribution's label, or its type", () => {
            manager.registerDebugger({ type: "lldb", label: "CodeLLDB", languages: ["cpp"] });
            manager.registerDebugger({ type: "gdb", uiMessages: { unverifiedBreakpoints: "u" } });

            const lldb = manager.getDebugger("lldb");
            const gdb = manager.getDebugger("gdb");
            expect([lldb?.label, lldb?.type, gdb?.label]).toEqual(["CodeLLDB", "lldb", "gdb"]);
            expect([
                lldb?.interestedInLanguage("cpp"),
                lldb?.interestedInLanguage("c"),
                gdb?.interestedInLanguage("c"),
            ]).toEqual([true, false, false]);
            expect(gdb?.strings).toEqual({ unverifiedBreakpoints: "u" });
            expect(lldb?.strings).toBeUndefined();
        });

        it("takes `strings` over the deprecated `uiMessages`", () => {
            manager.registerDebugger({
                type: "lldb",
                strings: { unverifiedBreakpoints: "s" },
                uiMessages: { unverifiedBreakpoints: "u" },
            });

            expect(manager.getDebugger("lldb")?.strings).toEqual({ unverifiedBreakpoints: "s" });
        });

        it("creates its adapter through the manager, and fails without a factory", async () => {
            const f = factory();
            manager.registerDebugger({ type: "lldb" });
            manager.registerDebugger({ type: "gdb" });
            manager.registerDebugAdapterFactory(["lldb"], f);

            expect(await manager.getDebugger("lldb")?.createDebugAdapter(sessionOf("lldb"))).toBe(f.adapter);
            await expect(manager.getDebugger("gdb")?.createDebugAdapter(sessionOf("gdb"))).rejects.toThrow(
                "Cannot find debug adapter for type 'gdb'.",
            );
            f.adapter.dispose();
        });

        it("substitutes variables and runs in a terminal through its type", async () => {
            const f = factory();
            manager.registerDebugger({ type: "lldb" });
            manager.registerDebugAdapterFactory(["lldb"], f);
            const dbg = manager.getDebugger("lldb");

            expect(
                await dbg?.substituteVariables(undefined, { type: "lldb", name: "n", request: "launch" }),
            ).toMatchObject({
                name: "substituted",
            });
            expect(await dbg?.runInTerminal({ cwd: "/", args: [] }, "s")).toBe(42);
            f.adapter.dispose();
        });

        it("starts a child session of its parent", async () => {
            manager.registerDebugger({ type: "lldb" });
            const config: IConfig = { type: "lldb", name: "child", request: "attach" };

            expect(await manager.getDebugger("lldb")?.startDebugging(config, "parent")).toBe(true);

            expect(debugService.startDebugging).toHaveBeenCalledWith(undefined, config, {
                parentSession: expect.objectContaining({
                    configuration: expect.objectContaining({ type: "p" }) as unknown,
                }) as unknown,
            });
        });

        it("writes the contribution's initial configurations and the given ones into upstream's launch.json skeleton", async () => {
            manager.registerDebugger({ type: "lldb", initialConfigurations: [{ name: "a" }] });

            const content = await manager
                .getDebugger("lldb")
                ?.getInitialConfigurationContent([{ type: "lldb", request: "launch", name: "b" }]);

            expect(content).toBe(
                [
                    "{",
                    "\t// Use IntelliSense to learn about possible attributes.",
                    "\t// Hover to view descriptions of existing attributes.",
                    "\t// For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387",
                    '\t"version": "0.2.0",',
                    '\t"configurations": [',
                    "\t\t{",
                    '\t\t\t"name": "a"',
                    "\t\t},",
                    "\t\t{",
                    '\t\t\t"type": "lldb",',
                    '\t\t\t"request": "launch",',
                    '\t\t\t"name": "b"',
                    "\t\t}",
                    "\t]",
                    "}",
                ].join("\n"),
            );
            expect(await manager.getDebugger("lldb")?.getInitialConfigurationContent()).toContain('"name": "a"');
        });

        it("a contribution without initial configurations writes only the given ones", async () => {
            manager.registerDebugger({ type: "gdb" });

            const content = await manager
                .getDebugger("gdb")
                ?.getInitialConfigurationContent([{ type: "gdb", request: "launch", name: "b" }]);

            expect(content).toContain('\t"configurations": [\n\t\t{\n\t\t\t"type": "gdb",');
            expect(await manager.getDebugger("gdb")?.getInitialConfigurationContent()).toContain(
                '\t"configurations": []',
            );
        });
    });
});
