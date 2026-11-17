import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adapterManagerPorts, idleDebugService } from "../../../../../TestUtils/mockDebug.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IConfig, IDebugVariableResolver } from "../common/debug.ts";

import { AdapterManager } from "./debugAdapterManager.ts";

const CONFIG: IConfig = { type: "lldb", name: "n", request: "launch" };

describe("AdapterManager — contributions of extensions, activation and variables", () => {
    let manager: AdapterManager;
    let contextKeys: ContextKeyService;
    let activated: string[];
    let variables: ReturnType<typeof vi.fn<IDebugVariableResolver>>;

    beforeEach(() => {
        contextKeys = new ContextKeyService();
        activated = [];
        variables = vi.fn<IDebugVariableResolver>((_folder, config) => Promise.resolve({ ...config, resolved: true }));
        manager = new AdapterManager(
            idleDebugService,
            adapterManagerPorts({
                contextKeys,
                extensions: {
                    activateByEvent: (event) => {
                        activated.push(event);
                        return Promise.resolve();
                    },
                },
                variables,
            }),
        );
    });

    afterEach(() => {
        manager.dispose();
    });

    describe("contributions of one type merge as upstream's", () => {
        it("the first contribution keeps its keys, a later one adds keys and merges into objects; the type is matched in any case", () => {
            manager.registerDebugger({
                type: "lldb",
                label: "CodeLLDB",
                variables: { pickProcess: "lldb.pickProcess" },
                configurationAttributes: { launch: { required: ["program"] } },
            });
            manager.registerDebugger({
                type: "LLDB",
                label: "Other",
                languages: ["rust"],
                variables: { pickProcess: "other.pickProcess", pickMyProcess: "lldb.pickMyProcess" },
                configurationAttributes: { attach: { required: ["pid"] } },
            });

            const dbg = manager.getDebugger("lldb");
            expect(dbg?.label).toBe("CodeLLDB");
            expect(dbg?.type).toBe("lldb");
            expect(dbg?.interestedInLanguage("rust")).toBe(true);
            expect(dbg?.variables).toEqual({ pickProcess: "lldb.pickProcess", pickMyProcess: "lldb.pickMyProcess" });
        });

        it("a null in a later contribution does not replace or break an object of the first", () => {
            manager.registerDebugger({ type: "lldb", variables: { pickProcess: "lldb.pickProcess" } });
            manager.registerDebugger({ type: "lldb", variables: null } as never);

            expect(manager.getDebugger("lldb")?.variables).toEqual({ pickProcess: "lldb.pickProcess" });
        });

        it("an array is not merged: the first one stays", () => {
            manager.registerDebugger({ type: "lldb", languages: ["c"] });
            manager.registerDebugger({ type: "lldb", languages: ["rust"] });

            expect(manager.getDebugger("lldb")?.interestedInLanguage("rust")).toBe(false);
        });

        it("a `*` contribution merges into every type and is not a type of its own; the contribution itself is not changed", () => {
            const lldb = { type: "lldb", variables: { pickProcess: "lldb.pickProcess" } };
            manager.registerDebugger(lldb);
            manager.registerDebugger({ type: "*", variables: { pickProcess: "x", common: "all.common" } });
            manager.registerDebugger({ type: "gdb" });

            expect(manager.getDebugger("*")).toBeUndefined();
            expect(manager.getDebugger("lldb")?.variables).toEqual({
                pickProcess: "lldb.pickProcess",
                common: "all.common",
            });
            expect(manager.getDebugger("gdb")?.variables).toEqual({ pickProcess: "x", common: "all.common" });
            expect(lldb.variables).toEqual({ pickProcess: "lldb.pickProcess" });
            expect(contextKeys.getRaw("debugExtensionAvailable")).toBe(true);
        });

        it("`__proto__` of a contribution is not merged", () => {
            manager.registerDebugger({ type: "lldb", variables: {} });
            manager.registerDebugger(
                JSON.parse('{"type":"lldb","variables":{"__proto__":{"polluted":"yes"}}}') as never,
            );

            expect(manager.getDebugger("lldb")?.variables).toEqual({});
            expect(({} as { polluted?: string }).polluted).toBeUndefined();
        });

        it("disposing a contribution takes it out of the merge; the last one takes the type away", () => {
            const first = manager.registerDebugger({ type: "lldb", label: "First" });
            const second = manager.registerDebugger({ type: "lldb", label: "Second" });
            const star = manager.registerDebugger({ type: "*", label: "Star" });

            first.dispose();
            expect(manager.getDebugger("lldb")?.label).toBe("Second");
            second.dispose();
            expect(manager.getDebugger("lldb")).toBeUndefined();
            expect(contextKeys.getRaw("debuggersAvailable")).toBe(false);
            star.dispose();
            expect(contextKeys.getRaw("debugExtensionAvailable")).toBe(false);
        });

        it("every registration is announced", () => {
            const registered = vi.fn();
            manager.onDidRegisterDebugger(registered);

            manager.registerDebugger({ type: "lldb" });
            manager.registerDebugger({ type: "lldb" });

            expect(registered).toHaveBeenCalledTimes(2);
        });
    });

    describe("`debuggersAvailable` and the keys of `when`", () => {
        it("a change of a key no `when` reads does not evaluate the debuggers", async () => {
            contextKeys.setRaw("qaEnabled", true);
            manager.registerDebugger({ type: "qa", when: "qaEnabled" });
            await Promise.resolve();
            const evaluate = vi.spyOn(contextKeys, "evaluate");

            contextKeys.setRaw("somethingElse", 1);
            await Promise.resolve();

            expect(evaluate).not.toHaveBeenCalled();
        });

        it("a key of `when` changed in the same tick as other keys is seen", async () => {
            contextKeys.setRaw("qaEnabled", false);
            manager.registerDebugger({ type: "qa", when: "qaEnabled" });
            await Promise.resolve();

            contextKeys.setRaw("somethingElse", 1);
            contextKeys.setRaw("qaEnabled", true);
            await Promise.resolve();

            expect(contextKeys.getRaw("debuggersAvailable")).toBe(true);
        });
    });

    describe("activateDebuggers", () => {
        it("the event and `onDebug`; with a type also `event:type` — all awaited", async () => {
            const pending: (() => void)[] = [];
            manager.dispose();
            manager = new AdapterManager(
                idleDebugService,
                adapterManagerPorts({
                    extensions: {
                        activateByEvent: (event) => {
                            activated.push(event);
                            return new Promise<void>((resolve) => pending.push(resolve));
                        },
                    },
                }),
            );
            let done = false;

            const activation = manager.activateDebuggers("onDebugResolve", "lldb").then(() => {
                done = true;
            });
            pending[0]();
            pending[1]();
            await Promise.resolve();
            expect(done).toBe(false);
            pending[2]();
            await activation;

            expect(activated).toEqual(["onDebugResolve", "onDebug", "onDebugResolve:lldb"]);
        });

        it("without a type (or an empty one) only the event and `onDebug`", async () => {
            await manager.activateDebuggers("onDebugInitialConfigurations");
            await manager.activateDebuggers("onDebugResolve", "");

            expect(activated).toEqual(["onDebugInitialConfigurations", "onDebug", "onDebugResolve", "onDebug"]);
        });
    });

    describe("Debugger.substituteVariables", () => {
        it("the type's factory first, then the resolver with the debugger's `variables`", async () => {
            manager.registerDebugger({ type: "lldb", variables: { pickProcess: "lldb.pickProcess" } });
            manager.registerDebugAdapterFactory(["lldb"], {
                createDebugAdapter: () => undefined as never,
                substituteVariables: (_folder, config) => Promise.resolve({ ...config, byFactory: true }),
            });
            const folder = { uri: undefined as never, name: "w", index: 0 };

            const result = await manager.getDebugger("lldb")?.substituteVariables(folder, CONFIG);

            expect(result).toEqual({ ...CONFIG, byFactory: true, resolved: true });
            expect(variables).toHaveBeenCalledWith(
                folder,
                { ...CONFIG, byFactory: true },
                {
                    pickProcess: "lldb.pickProcess",
                },
            );
        });

        it("a cancelled resolution is `undefined`", async () => {
            manager.registerDebugger({ type: "lldb" });
            variables.mockResolvedValue(undefined);

            expect(await manager.getDebugger("lldb")?.substituteVariables(undefined, CONFIG)).toBeUndefined();
            expect(variables).toHaveBeenCalledWith(undefined, CONFIG, undefined);
        });
    });
});
