// The debug service with launch.json: the selected configuration, saving before a start, the debug tasks around a
// session, compounds and a restart that reads launch.json again.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
    createDebugServiceFixture,
    fakeLaunch,
    type IDebugServiceFixture,
} from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { makeTask } from "../../../../../TestUtils/taskFixtures.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IWorkspaceFolder } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import { type IConfig, type IDebugSession, State } from "../common/debug.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/work"), name: "work", index: 0 };

function synthetic(name: string, extra: Partial<IConfig> = {}): IConfig {
    return { ...SYNTHETIC_LAUNCH_CONFIG, name, ...extra };
}

describe("DebugService with launch.json", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;

    function create(launch: unknown): void {
        fx = createDebugServiceFixture({ workspaceLaunch: launch, folders: [FOLDER] });
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
    }

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
        vi.useRealTimers();
    });

    function folderLaunch() {
        return fx.service.getConfigurationManager().getLaunches()[0];
    }

    function sessions(): IDebugSession[] {
        return fx.service.getModel().getSessions();
    }

    async function stopped(name: string): Promise<IDebugSession> {
        await vi.waitFor(() => {
            expect(sessions().find((s) => s.name === name)?.state).toBe(State.Stopped);
        });
        return sessions().find((s) => s.name === name)!;
    }

    function messages(): string[] {
        return fx.shown.map((m) => m.message);
    }

    describe("the start", () => {
        it("without a name starts the selected configuration of the launch, in its folder", async () => {
            create({ configurations: [synthetic("Run"), synthetic("Other")] });

            expect(await fx.service.startDebugging(folderLaunch())).toBe(true);

            const session = await stopped("Run");
            expect(session.root).toBe(FOLDER);
            expect(session.configuration.__configurationTarget).toBe("workspaceFolder");
            expect(fx.contextKeys.getRaw("debugUx")).toBe("default");
        });

        it("saves the editors first, unless asked not to or for a child session", async () => {
            create({ configurations: [synthetic("Run")] });

            await fx.service.startDebugging(folderLaunch(), "Run");
            expect(fx.saves).toHaveLength(1);
            await fx.service.startDebugging(folderLaunch(), "Run", undefined, false);
            await fx.service.startDebugging(folderLaunch(), "Run", { parentSession: await stopped("Run") });

            expect(fx.saves).toHaveLength(1);
        });

        it("a name missing from launch.json is upstream's error", async () => {
            create({ configurations: [synthetic("Run")] });

            await expect(fx.service.startDebugging(folderLaunch(), "Nope")).rejects.toThrow(
                "Configuration 'Nope' is missing in 'launch.json'.",
            );
            expect(fx.contextKeys.getRaw("debugState")).toBe("inactive");
        });

        it("without launch configurations the ux is simple; a configuration in launch.json makes it the default", async () => {
            fx = createDebugServiceFixture({ folders: [FOLDER] });
            factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
            expect(fx.contextKeys.getRaw("debugUx")).toBe("simple");

            await fx.configuration.updateValue("launch", { configurations: [synthetic("Run")] }, "workspace");

            expect(fx.contextKeys.getRaw("debugUx")).toBe("default");
        });

        it("the ux stays the default after a session of launch.json ends", async () => {
            create({ configurations: [synthetic("Run")] });
            await fx.service.startDebugging(folderLaunch(), "Run");

            await fx.service.stopSession(await stopped("Run"));
            await vi.waitFor(() => {
                expect(fx.service.state).toBe(State.Inactive);
            });

            expect(fx.contextKeys.getRaw("debugUx")).toBe("default");
        });
    });

    describe("preLaunchTask and postDebugTask", () => {
        it("the preLaunchTask runs before the session; the postDebugTask after it ends, before its end is announced", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "build", postDebugTask: "clean" })] });
            fx.tasks = [makeTask({ label: "build" }), makeTask({ label: "clean" })];
            const order: string[] = [];
            fx.service.onWillNewSession(() => order.push(`session ${fx.ran.join(",")}`));
            fx.service.onDidEndSession(() => order.push(`end ${fx.ran.join(",")}`));

            await fx.service.startDebugging(folderLaunch(), "Run");
            await fx.service.stopSession(await stopped("Run"));

            await vi.waitFor(() => {
                expect(order).toEqual(["session build", "end build,clean"]);
            });
        });

        it("a failing preLaunchTask the user aborts starts no session", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "build" })] });
            fx.tasks = [makeTask({ label: "build" })];
            fx.taskExitCode = 1;
            fx.answer = 2;

            expect(await fx.service.startDebugging(folderLaunch(), "Run")).toBe(false);

            expect(sessions()).toEqual([]);
            expect(messages()).toEqual(["The preLaunchTask 'build' terminated with exit code 1."]);
            expect(fx.contextKeys.getRaw("debugState")).toBe("inactive");
        });

        it("a postDebugTask that cannot be found is an error toast", async () => {
            create({ configurations: [synthetic("Run", { postDebugTask: "gone" })] });

            await fx.service.startDebugging(folderLaunch(), "Run");
            await fx.service.stopSession(await stopped("Run"));

            await vi.waitFor(() => {
                expect(fx.shown.filter((m) => m.severity === "error").map((m) => m.message)).toEqual([
                    "Could not find the task 'gone'.",
                ]);
            });
        });

        it("a configuration without a folder runs its tasks in the workspace", async () => {
            create({});
            fx.tasks = [makeTask({ label: "build" }), makeTask({ label: "clean" })];

            const config = synthetic("Run", { preLaunchTask: "build", postDebugTask: "clean" });
            expect(await fx.service.startDebugging(undefined, config)).toBe(true);
            await fx.service.stopSession(await stopped("Run"));

            await vi.waitFor(() => {
                expect(fx.ran).toEqual(["build", "clean"]);
            });
        });

        it("stopping with no session cancels a preLaunchTask that is still running", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "build" })] });
            fx.tasks = [makeTask({ label: "build" })];
            fx.taskExitCode = "pending";
            const started = fx.service.startDebugging(folderLaunch(), "Run");
            await vi.waitFor(() => {
                expect(fx.ran).toEqual(["build"]);
            });

            await fx.service.stopSession(undefined);

            expect(await started).toBe(false);
            expect(sessions()).toEqual([]);
        });

        it("a session started while the task ran asks again before a second one", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "build" })] });
            fx.tasks = [makeTask({ label: "build" })];
            fx.taskExitCode = "pending";
            fx.answer = undefined;
            const started = fx.service.startDebugging(folderLaunch(), "Run", { startedByUser: true });
            await vi.waitFor(() => {
                expect(fx.ran).toEqual(["build"]);
            });
            await fx.service.startDebugging(folderLaunch(), synthetic("Run"));
            await stopped("Run");

            fx.endTask("build", 0);

            expect(await started).toBe(false);
            expect(messages()).toEqual(["'Run' is already running. Do you want to start another instance?"]);
            expect(sessions()).toHaveLength(1);
        });

        it("a session already running: the question comes before the preLaunchTask, and a no runs no task", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "build" })] });
            fx.tasks = [makeTask({ label: "build" })];
            await fx.service.startDebugging(folderLaunch(), "Run");
            await stopped("Run");
            fx.ran.length = 0;
            fx.answer = undefined;

            expect(await fx.service.startDebugging(folderLaunch(), "Run", { startedByUser: true })).toBe(false);

            expect(fx.ran).toEqual([]);
            expect(messages()).toEqual(["'Run' is already running. Do you want to start another instance?"]);
            expect(sessions()).toHaveLength(1);
        });

        it("a session started while the task ran: a yes to the question starts the second one", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "build" })] });
            fx.tasks = [makeTask({ label: "build" })];
            fx.taskExitCode = "pending";
            fx.answer = 0;
            const started = fx.service.startDebugging(folderLaunch(), "Run", { startedByUser: true });
            await vi.waitFor(() => {
                expect(fx.ran).toEqual(["build"]);
            });
            await fx.service.startDebugging(folderLaunch(), synthetic("Run"));
            await stopped("Run");

            fx.endTask("build", 0);

            expect(await started).toBe(true);
            expect(sessions()).toHaveLength(2);
        });
    });

    describe("compounds", () => {
        const both = {
            configurations: [synthetic("Server"), synthetic("Client")],
            compounds: [{ name: "Both", configurations: ["Server", "Client"], preLaunchTask: "build" }],
        };

        it("starts every configuration of the compound after its preLaunchTask", async () => {
            create(both);
            fx.tasks = [makeTask({ label: "build" })];

            expect(await fx.service.startDebugging(folderLaunch(), "Both")).toBe(true);

            await stopped("Server");
            await stopped("Client");
            expect(fx.ran).toEqual(["build"]);
            expect(fx.contextKeys.getRaw("debugState")).not.toBe("initializing");
        });

        it("a failing preLaunchTask of the compound starts none", async () => {
            create(both);
            fx.tasks = [makeTask({ label: "build" })];
            fx.taskExitCode = 1;
            fx.answer = 2;

            expect(await fx.service.startDebugging(folderLaunch(), "Both")).toBe(false);

            expect(sessions()).toEqual([]);
            expect(fx.contextKeys.getRaw("debugState")).toBe("inactive");
        });

        it("with stopAll, stopping one session stops the others; without, they stay", async () => {
            create({
                configurations: [synthetic("Server"), synthetic("Client")],
                compounds: [
                    { name: "Linked", configurations: ["Server", "Client"], stopAll: true },
                    { name: "Loose", configurations: ["Server", "Client"] },
                ],
            });

            await fx.service.startDebugging(folderLaunch(), "Linked");
            const linkedServer = await stopped("Server");
            await fx.service.stopSession(await stopped("Client"));
            await vi.waitFor(() => {
                expect(linkedServer.state).toBe(State.Inactive);
            });

            await fx.service.startDebugging(folderLaunch(), "Loose");
            const looseServer = await stopped("Server");
            const looseClient = await stopped("Client");
            await fx.service.stopSession(looseClient);
            await vi.waitFor(() => {
                expect(looseClient.state).toBe(State.Inactive);
            });
            expect(looseServer.state).toBe(State.Stopped);
        });

        it("with stopAll, a restart of one keeps the others; a disconnect of one stops them", async () => {
            create({
                configurations: [synthetic("Server"), synthetic("Client")],
                compounds: [{ name: "Linked", configurations: ["Server", "Client"], stopAll: true }],
            });
            await fx.service.startDebugging(folderLaunch(), "Linked");
            const server = await stopped("Server");
            const client = await stopped("Client");

            await fx.service.restartSession(client);
            await stopped("Client");
            await fx.service.restartSession(client, { auto: true });
            await stopped("Client");
            expect(server.state).toBe(State.Stopped);

            await fx.service.stopSession(client, true);

            await vi.waitFor(() => {
                expect(server.state).toBe(State.Inactive);
            });
        });

        it("a compound of a launch without a folder runs its preLaunchTask in the workspace", async () => {
            create({ configurations: [synthetic("Run")] });
            fx.tasks = [makeTask({ label: "build" })];
            const user = fakeLaunch({
                workspace: undefined,
                getConfiguration: (name) => (name === "Run" ? synthetic("Run") : undefined),
                getCompound: () => ({ name: "Both", configurations: ["Run"], preLaunchTask: "build" }),
            });

            expect(await fx.service.startDebugging(user, "Both")).toBe(true);

            expect(fx.ran).toEqual(["build"]);
            await stopped("Run");
        });

        it("a compound naming itself starts nothing for that entry, and is not a success", async () => {
            create({
                configurations: [synthetic("Run")],
                compounds: [{ name: "Self", configurations: ["Run", "Self"] }],
            });

            expect(await fx.service.startDebugging(folderLaunch(), "Self")).toBe(false);
            await stopped("Run");
        });

        it("a configuration found nowhere, or in several launches, is upstream's error", async () => {
            create({ compounds: [{ name: "Missing", configurations: ["Nope"] }] });
            await expect(fx.service.startDebugging(folderLaunch(), "Missing")).rejects.toThrow(
                "Could not find launch configuration 'Nope' in the workspace.",
            );
            fx.service.dispose();

            const twice = { name: "Twice", configurations: ["Run"] };
            create({ configurations: [synthetic("Run")], compounds: [twice] });
            await fx.configuration.updateValue("launch", { configurations: [synthetic("Run")] }, "user");
            // From the launch that has it, the compound takes its own configuration.
            expect(await fx.service.startDebugging(folderLaunch(), "Twice")).toBe(true);
            await stopped("Run");
            // From a launch that has not, it cannot tell which one.
            const elsewhere = fakeLaunch({
                workspace: undefined,
                getConfiguration: () => undefined,
                getCompound: () => twice,
            });
            await expect(fx.service.startDebugging(elsewhere, "Twice")).rejects.toThrow(
                "There are multiple launch configurations 'Run' in the workspace. Use folder name to qualify the configuration.",
            );
        });

        it("a configuration qualified by its folder is looked up there", async () => {
            create({
                configurations: [synthetic("Run")],
                compounds: [
                    { name: "Here", configurations: [{ name: "Run", folder: "work" }] },
                    { name: "Elsewhere", configurations: [{ name: "Run", folder: "other" }] },
                ],
            });

            expect(await fx.service.startDebugging(folderLaunch(), "Here")).toBe(true);
            await stopped("Run");
            await expect(fx.service.startDebugging(folderLaunch(), "Elsewhere")).rejects.toThrow(
                "Can not find folder with name 'other' for configuration 'Run' in compound 'Elsewhere'.",
            );
        });
    });

    describe("restart", () => {
        it("runs preRestartTask, postDebugTask, preLaunchTask and postRestartTask in order", async () => {
            const tasks = { preRestartTask: "a", postDebugTask: "b", preLaunchTask: "c", postRestartTask: "d" };
            create({ configurations: [synthetic("Run", tasks)] });
            fx.tasks = ["a", "b", "c", "d"].map((label) => makeTask({ label }));
            await fx.service.startDebugging(folderLaunch(), "Run");
            const session = await stopped("Run");
            fx.ran.length = 0;

            await fx.service.restartSession(session);

            // The ended session runs its postDebugTask first, as upstream's.
            expect(fx.ran).toEqual(["b", "a", "b", "c", "d"]);
            expect(fx.saves).toHaveLength(2);
        });

        it("an automatic restart runs no tasks; a failing preLaunchTask leaves the session ended", async () => {
            create({ configurations: [synthetic("Run", { preLaunchTask: "c" })] });
            fx.tasks = [makeTask({ label: "c" })];
            await fx.service.startDebugging(folderLaunch(), "Run");
            const session = await stopped("Run");
            fx.ran.length = 0;

            await fx.service.restartSession(session, { auto: true });
            expect(fx.ran).toEqual([]);
            await stopped("Run");

            const ends: boolean[] = [];
            fx.service.onDidEndSession((e) => ends.push(e.restart));
            fx.taskExitCode = 1;
            fx.answer = 2;
            await fx.service.restartSession(session);

            expect(fx.ran).toEqual(["c"]);
            expect(ends.at(-1)).toBe(false);
            expect(session.state).toBe(State.Inactive);
        });

        it("reads an edited launch.json again; an unchanged one keeps the configuration", async () => {
            create({ configurations: [synthetic("Run", { args: ["1"] } as Partial<IConfig>)] });
            await fx.service.startDebugging(folderLaunch(), "Run");
            const session = await stopped("Run");
            const before = session.configuration;

            await fx.service.restartSession(session);
            await stopped("Run");
            expect(session.configuration).toBe(before);

            await fx.configuration.updateValue(
                "launch",
                { configurations: [synthetic("Run", { args: ["2"] } as Partial<IConfig>)] },
                "workspace",
            );
            await fx.service.restartSession(session);
            await stopped("Run");

            expect((session.configuration as IConfig & { args: string[] }).args).toEqual(["2"]);
        });

        it("an edited launch.json whose variables fail to resolve ends the session with the error", async () => {
            create({ configurations: [synthetic("Run")] });
            await fx.service.startDebugging(folderLaunch(), "Run");
            const session = await stopped("Run");
            const debuggerOfRun = fx.service.getAdapterManager().getDebugger(SYNTHETIC_LAUNCH_CONFIG.type)!;
            vi.spyOn(debuggerOfRun, "substituteVariables").mockRejectedValue(new Error("Variable 'x' is unknown."));
            await fx.configuration.updateValue(
                "launch",
                { configurations: [synthetic("Run", { args: ["2"] } as Partial<IConfig>)] },
                "workspace",
            );
            const ends: boolean[] = [];
            fx.service.onDidEndSession((e) => ends.push(e.restart));

            await fx.service.restartSession(session);

            expect(messages()).toEqual(["Variable 'x' is unknown."]);
            expect(ends.at(-1)).toBe(false);
            expect(session.state).toBe(State.Inactive);
        });
    });
});
