// The debug service and the configuration providers of extensions: where a start asks them, what their answers do,
// and the restart that reads an edited launch.json again.

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import {
    DebugConfigurationProviderTriggerKind,
    type IConfig,
    type IDebugConfigurationProvider,
    type IDebugSession,
    State,
} from "../common/debug.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/work"), name: "work", index: 0 };
const LAUNCH_JSON = "file:///work/.diode/launch.json";

type Extra = IConfig & Record<string, unknown>;

function synthetic(name: string, extra: Record<string, unknown> = {}): IConfig {
    return { ...SYNTHETIC_LAUNCH_CONFIG, name, ...extra };
}

describe("DebugService — configuration providers", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;

    function create(configurations: IConfig[]): void {
        fx = createDebugServiceFixture({ workspaceLaunch: { configurations }, folders: [FOLDER] });
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
    }

    function provide(provider: Partial<IDebugConfigurationProvider>, type = SYNTHETIC_DEBUG_TYPE): void {
        fx.service.getConfigurationManager().registerDebugConfigurationProvider({
            type,
            triggerKind: DebugConfigurationProviderTriggerKind.Initial,
            ...provider,
        });
    }

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
    });

    const launch = () => fx.service.getConfigurationManager().getLaunches()[0];
    const sessions = (): IDebugSession[] => fx.service.getModel().getSessions();
    const messages = (): string[] => fx.shown.map((m) => m.message);

    async function stopped(name: string): Promise<IDebugSession> {
        await vi.waitFor(() => {
            expect(sessions().find((s) => s.name === name)?.state).toBe(State.Stopped);
        });
        return sessions().find((s) => s.name === name)!;
    }

    it("the providers get the launch's folder before the variables; the substituted configuration goes to the second resolution", async () => {
        create([synthetic("Run", { program: "${workspaceFolder}/a.out" })]);
        const seen: string[] = [];
        provide({
            resolveDebugConfiguration: (folder, config) => {
                seen.push(`resolve:${String(folder)}:${String((config as Extra).program)}`);
                return Promise.resolve({ ...config, fromProvider: 1 } as IConfig);
            },
            resolveDebugConfigurationWithSubstitutedVariables: (folder, config) => {
                seen.push(`resolve2:${String(folder)}:${String((config as Extra).program)}`);
                return Promise.resolve({ ...config, port: 4711 } as IConfig);
            },
        });
        fx.variables = (_folder, config) =>
            Promise.resolve({
                ...config,
                program: String((config as Extra).program).replace("${workspaceFolder}", "/work"),
            });

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(true);

        expect(seen).toEqual(["resolve:file:///work:${workspaceFolder}/a.out", "resolve2:file:///work:/work/a.out"]);
        expect((await stopped("Run")).configuration).toMatchObject({
            fromProvider: 1,
            port: 4711,
            program: "/work/a.out",
        });
        // The unresolved configuration is the launch.json's own.
        expect((sessions()[0].unresolvedConfiguration as Extra).fromProvider).toBeUndefined();
    });

    it("a configuration started without a launch goes to the providers without a folder", async () => {
        create([]);
        const folders: (Uri | undefined)[] = [];
        provide({
            resolveDebugConfiguration: (folder, config) => {
                folders.push(folder);
                return Promise.resolve(config);
            },
        });

        expect(await fx.service.startDebugging(undefined, synthetic("Inline"))).toBe(true);
        expect(folders).toEqual([undefined]);
    });

    it("`undefined` before the variables aborts silently: no substitution, no task, nothing opened", async () => {
        create([synthetic("Run", { preLaunchTask: "build" })]);
        const variables = vi.fn(fx.variables);
        fx.variables = variables;
        provide({ resolveDebugConfiguration: () => Promise.resolve(undefined) });

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);

        expect(variables).not.toHaveBeenCalled();
        expect(fx.ran).toEqual([]);
        expect(fx.opened).toEqual([]);
        expect(messages()).toEqual([]);
        expect(fx.service.state).toBe(State.Inactive);
    });

    it("`null` before the variables opens the launch.json of the type", async () => {
        create([synthetic("Run")]);
        provide({ resolveDebugConfiguration: () => Promise.resolve(null) });
        const openConfigFile = vi.spyOn(launch(), "openConfigFile");

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);

        expect(openConfigFile).toHaveBeenCalledWith({ preserveFocus: true, type: SYNTHETIC_DEBUG_TYPE });
        expect(fx.opened.map((o) => o.resource)).toEqual([LAUNCH_JSON]);
    });

    it("`null` for a configuration without a type, or without a launch, opens nothing", async () => {
        create([]);
        provide({ resolveDebugConfiguration: () => Promise.resolve(null) });
        const resolveUntyped = vi.fn(() => Promise.resolve(null));
        provide({ resolveDebugConfiguration: resolveUntyped }, "*");

        expect(await fx.service.startDebugging(undefined, synthetic("Inline"))).toBe(false);
        expect(await fx.service.startDebugging(launch(), { name: "untyped", request: "launch" } as IConfig)).toBe(
            false,
        );

        expect(resolveUntyped).toHaveBeenCalledTimes(1);
        expect(fx.opened).toEqual([]);
        expect(messages()).toEqual([]);
    });

    it("`null` after the variables opens the launch.json of the type; `undefined` aborts silently", async () => {
        create([synthetic("Run"), synthetic("Quiet")]);
        provide({
            resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) =>
                Promise.resolve(config.name === "Run" ? null : undefined),
        });

        const openConfigFile = vi.spyOn(launch(), "openConfigFile");

        expect(await fx.service.startDebugging(launch(), "Quiet")).toBe(false);
        expect(fx.opened).toEqual([]);
        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);
        expect(openConfigFile.mock.calls).toEqual([[{ preserveFocus: true, type: SYNTHETIC_DEBUG_TYPE }]]);
        expect(fx.opened.map((o) => o.resource)).toEqual([LAUNCH_JSON]);
        expect(sessions()).toEqual([]);
        // Without a launch there is no launch.json to open.
        expect(await fx.service.startDebugging(undefined, synthetic("Run"))).toBe(false);
        expect(openConfigFile).toHaveBeenCalledTimes(1);
        expect(messages()).toEqual([]);
    });

    it("a substitution the user cancels ends the start silently", async () => {
        create([synthetic("Run")]);
        const second = vi.fn();
        provide({ resolveDebugConfigurationWithSubstitutedVariables: second });
        fx.variables = () => Promise.resolve(undefined);

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);

        expect(second).not.toHaveBeenCalled();
        expect(messages()).toEqual([]);
        expect(sessions()).toEqual([]);
    });

    it("a stop while the variables are asked for cancels the start", async () => {
        create([synthetic("Run")]);
        const asked = Promise.withResolvers<undefined>();
        const answer = Promise.withResolvers<IConfig>();
        fx.variables = (_folder, config) => {
            asked.resolve(undefined);
            return answer.promise.then(() => config);
        };

        const start = fx.service.startDebugging(launch(), "Run");
        await asked.promise;
        await fx.service.stopSession(undefined);
        answer.resolve(synthetic("Run"));

        expect(await start).toBe(false);
        expect(sessions()).toEqual([]);
        expect(messages()).toEqual([]);
    });

    it("a rejection without an error still opens launch.json and shows nothing", async () => {
        create([synthetic("Run")]);
        // The missing launch.json is created for the debugger of the active file.
        fx.activeEditor = { resource: "file:///work/main.cpp", languageId: "cpp" };
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- an extension may reject with anything
        provide({ resolveDebugConfigurationWithSubstitutedVariables: () => Promise.reject(undefined) });

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);

        expect(messages()).toEqual([]);
        expect(fx.opened.map((o) => o.resource)).toEqual([LAUNCH_JSON]);
    });

    it("the second resolution runs after the preLaunchTask", async () => {
        create([synthetic("Run", { preLaunchTask: "build" })]);
        fx.tasks = [makeTask({ label: "build" })];
        const order: string[] = [];
        fx.taskExitCode = "pending";
        provide({
            resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) => {
                order.push(`resolve2 after ${fx.ran.join(",")}`);
                return Promise.resolve(config);
            },
        });

        const start = fx.service.startDebugging(launch(), "Run");
        await vi.waitFor(() => {
            expect(fx.ran).toEqual(["build"]);
        });
        expect(order).toEqual([]);
        fx.endTask("build", 0);

        expect(await start).toBe(true);
        expect(order).toEqual(["resolve2 after build"]);
    });

    it("a failure after the first resolution is an error and opens launch.json, as upstream", async () => {
        create([synthetic("Run")]);
        provide({ resolveDebugConfigurationWithSubstitutedVariables: () => Promise.reject(new Error("no port")) });
        const openConfigFile = vi.spyOn(launch(), "openConfigFile");

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);

        expect(messages()).toEqual(["no port"]);
        expect(openConfigFile).toHaveBeenCalledWith({ preserveFocus: true });
    });

    it("a failure without a message and without a launch shows and opens nothing", async () => {
        create([]);
        provide({ resolveDebugConfigurationWithSubstitutedVariables: () => Promise.reject(new Error("")) });

        expect(await fx.service.startDebugging(undefined, synthetic("Inline"))).toBe(false);

        expect(messages()).toEqual([]);
        expect(fx.opened).toEqual([]);
    });

    it("a second resolution that drops the type is upstream's missing-type error", async () => {
        create([synthetic("Run")]);
        provide({
            resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) =>
                Promise.resolve({ ...config, type: "" }),
        });

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(false);
        expect(messages()).toEqual(["Missing property 'type' for the chosen launch configuration."]);
    });

    it("a provider may change the type to one with an adapter", async () => {
        create([synthetic("Run", { type: "cppdbg" })]);
        provide(
            {
                resolveDebugConfiguration: (_folder, config) =>
                    Promise.resolve({ ...config, type: SYNTHETIC_DEBUG_TYPE }),
            },
            "cppdbg",
        );

        expect(await fx.service.startDebugging(launch(), "Run")).toBe(true);
        expect((await stopped("Run")).configuration.type).toBe(SYNTHETIC_DEBUG_TYPE);
        expect(fx.activated).toEqual(expect.arrayContaining(["onDebugResolve:cppdbg", "onDebugResolve:synthetic"]));
    });

    describe("restart with an edited launch.json", () => {
        async function startThenEdit(): Promise<IDebugSession> {
            create([synthetic("Run", { args: ["1"] })]);
            await fx.service.startDebugging(launch(), "Run");
            const session = await stopped("Run");
            await fx.configuration.updateValue(
                "launch",
                { configurations: [synthetic("Run", { args: ["2"] })] },
                "workspace",
            );
            return session;
        }

        it("goes through the providers before and after the variables", async () => {
            const session = await startThenEdit();
            provide({
                resolveDebugConfiguration: (_folder, config) => Promise.resolve({ ...config, first: true } as IConfig),
                resolveDebugConfigurationWithSubstitutedVariables: (_folder, config) =>
                    Promise.resolve({ ...config, second: true } as IConfig),
            });

            await fx.service.restartSession(session);
            await stopped("Run");

            expect(session.configuration).toMatchObject({ args: ["2"], first: true, second: true });
        });

        it("a provider that aborts ends the session, as upstream's restart without a configuration", async () => {
            const session = await startThenEdit();
            const second = vi.fn();
            provide({
                resolveDebugConfiguration: () => Promise.resolve(undefined),
                resolveDebugConfigurationWithSubstitutedVariables: second,
            });
            const ends: boolean[] = [];
            fx.service.onDidEndSession((e) => ends.push(e.restart));

            await fx.service.restartSession(session);

            expect(second).not.toHaveBeenCalled();
            expect(ends.at(-1)).toBe(false);
            expect(session.state).toBe(State.Inactive);
            expect((session.configuration as Extra).args).toEqual(["1"]);
        });

        it("a cancelled substitution skips the second resolution and ends the session", async () => {
            const session = await startThenEdit();
            const second = vi.fn();
            provide({ resolveDebugConfigurationWithSubstitutedVariables: second });
            fx.variables = () => Promise.resolve(undefined);

            await fx.service.restartSession(session);

            expect(second).not.toHaveBeenCalled();
            expect(session.state).toBe(State.Inactive);
        });
    });
});
