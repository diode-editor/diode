// The launch configurations of the window: which launches there are, what they read, the remembered selection and
// opening launch.json.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MockStateService, mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type {
    IConfigurationChangeEvent,
    IConfigurationInspectResult,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type {
    IWorkspaceFolder,
    WorkbenchState,
} from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { IAdapterManager, IConfig, IDebugger, IDebuggerMetadata, ILaunch } from "../common/debug.ts";
import { initialConfigurationContent } from "../common/debugger.ts";

import { ConfigurationManager, type IConfigurationManagerPorts } from "./debugConfigurationManager.ts";
import { NO_DEBUG_EXTENSIONS } from "./debugService.ts";

const FOLDER: IWorkspaceFolder = { uri: Uri.file("/w"), name: "w", index: 0 };
const LAUNCH_JSON = "file:///w/.diode/launch.json";
const USER_SETTINGS = Uri.file("/user/settings.json");
const WORKSPACE_FILE = Uri.file("/w/web.code-workspace");
const PLATFORM_KEY = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "osx" : "linux";

/** A guessed debugger with no configurations of its own. */
const EMPTY_DEBUGGER = {
    type: "empty",
    getInitialConfigurationContent: () => Promise.resolve(initialConfigurationContent([])),
} as Partial<IDebugger & IDebuggerMetadata> as IDebugger & IDebuggerMetadata;

function config(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: "synthetic", request: "launch", name, ...extra };
}

interface ILayers {
    workspace?: unknown;
    workspaceFolder?: unknown;
    user?: unknown;
    profile?: unknown;
}

describe("ConfigurationManager", () => {
    let layers: ILayers;
    let state: MockStateService;
    let contextKeys: ContextKeyService;
    let folders: IWorkspaceFolder[];
    let workbenchState: WorkbenchState;
    let files: Map<string, string>;
    let opened: { resource: string; preserveFocus: boolean; line?: number }[];
    let configurationChange: Emitter<IConfigurationChangeEvent>;
    let foldersChange: Emitter<void>;
    let settings: Record<string, unknown>;
    let ports: IConfigurationManagerPorts;
    let adapterManager: Pick<IAdapterManager, "getDebugger" | "activateDebuggers" | "guessDebugger">;
    const managers: ConfigurationManager[] = [];

    beforeEach(() => {
        layers = {};
        state = mockStateService();
        contextKeys = new ContextKeyService();
        folders = [FOLDER];
        workbenchState = "folder";
        files = new Map();
        opened = [];
        settings = {};
        configurationChange = new Emitter();
        foldersChange = new Emitter();
        adapterManager = {
            getDebugger: () => undefined,
            activateDebuggers: () => Promise.resolve(),
            guessDebugger: () => Promise.resolve({ debugger: EMPTY_DEBUGGER }),
        };
        ports = {
            configuration: {
                inspect: <T>(key: string) => {
                    expect(key).toBe("launch");
                    return { ...layers } as IConfigurationInspectResult<T>;
                },
                get: ((key: string) => settings[key]) as never,
                onDidChangeConfiguration: (listener) => configurationChange.event(listener),
            },
            workspace: {
                getWorkspace: () => ({
                    id: "w" as never,
                    folders,
                    configuration: workbenchState === "workspace" ? WORKSPACE_FILE : undefined,
                }),
                getWorkbenchState: () => workbenchState,
                onDidChangeWorkspaceFolders: (listener) => foldersChange.event(listener),
            },
            state,
            contextKeys,
            files: {
                readFile: (uri) => {
                    const text = files.get(uri.toString());
                    return text === undefined
                        ? Promise.reject(new Error("ENOENT"))
                        : Promise.resolve({ value: new TextEncoder().encode(text) } as never);
                },
                writeFile: vi.fn((uri: Uri, content: Uint8Array) => {
                    files.set(uri.toString(), new TextDecoder().decode(content));
                    return Promise.resolve({} as never);
                }),
                exists: (uri) => Promise.resolve([...files.keys()].some((f) => f.startsWith(uri.toString()))),
                createFolder: vi.fn(() => Promise.resolve({} as never)),
            },
            openEditor: (resource, { preserveFocus, line }) => {
                opened.push({ resource: resource.toString(), preserveFocus, ...(line === undefined ? {} : { line }) });
                return Promise.resolve();
            },
            userSettings: {
                resource: USER_SETTINGS,
                open: () => {
                    opened.push({ resource: USER_SETTINGS.toString(), preserveFocus: false });
                    return Promise.resolve();
                },
            },
            extensions: NO_DEBUG_EXTENSIONS,
            pickLate: () => Promise.resolve(undefined),
        };
    });

    afterEach(() => {
        for (const manager of managers.splice(0)) manager.dispose();
    });

    function create(): ConfigurationManager {
        const manager = new ConfigurationManager(adapterManager as IAdapterManager, ports);
        managers.push(manager);
        return manager;
    }

    function changeLaunch(next: ILayers): void {
        layers = next;
        configurationChange.fire({
            affectedKeys: ["launch"],
            overrideIdentifiers: [],
            affectsConfiguration: (key) => key === "launch",
        });
    }

    describe("the launches", () => {
        it("a folder window has the folder's launch.json and the user's launch, hidden", () => {
            layers = { workspace: { configurations: [config("Run")] }, user: { configurations: [config("Mine")] } };
            const manager = create();

            const [folder, user] = manager.getLaunches();
            expect(manager.getLaunches()).toHaveLength(2);
            expect([folder.name, folder.uri.toString(), folder.workspace, folder.hidden]).toEqual([
                "w",
                LAUNCH_JSON,
                FOLDER,
                false,
            ]);
            expect([user.name, user.uri.toString(), user.workspace, user.hidden]).toEqual([
                "user settings",
                USER_SETTINGS.toString(),
                undefined,
                true,
            ]);
            expect(folder.getConfigurationNames()).toEqual(["Run"]);
            expect(user.getConfigurationNames()).toEqual(["Mine"]);
            expect(manager.getLaunch(FOLDER.uri)).toBe(folder);
            expect(manager.getLaunch(Uri.file("/elsewhere"))).toBeUndefined();
            expect(manager.getLaunch(undefined)).toBeUndefined();
        });

        it("a .code-workspace window adds the workspace file's launch; the folder's is its folder layer", () => {
            workbenchState = "workspace";
            layers = {
                workspace: { configurations: [config("Shared")] },
                workspaceFolder: { configurations: [config("Run")] },
            };
            const manager = create();

            const [folder, workspace] = manager.getLaunches();
            expect(manager.getLaunches().map((l) => l.name)).toEqual(["w", "workspace", "user settings"]);
            expect(folder.getConfigurationNames()).toEqual(["Run"]);
            expect([workspace.uri.toString(), workspace.workspace, workspace.hidden]).toEqual([
                WORKSPACE_FILE.toString(),
                undefined,
                false,
            ]);
            expect(workspace.getConfigurationNames()).toEqual(["Shared"]);
        });

        it("the user's launch of a named profile is the profile's", () => {
            layers = { user: { configurations: [config("Default")] }, profile: { configurations: [config("Mine")] } };

            const user = create().getLaunches()[1];

            expect(user.getConfigurationNames()).toEqual(["Mine"]);
        });

        it("a changed folder set rebuilds the launches and selects again", () => {
            layers = { workspace: { configurations: [config("Run")] } };
            const manager = create();
            folders = [];

            foldersChange.fire();

            expect(manager.getLaunches().map((l) => l.name)).toEqual(["user settings"]);
            expect(manager.selectedConfiguration.launch?.name).toBe("user settings");
            expect(manager.selectedConfiguration.name).toBeUndefined();
        });
    });

    describe("configurations and compounds of a launch", () => {
        it("lists the named configurations and the compounds with configurations, sorted by presentation", () => {
            layers = {
                workspace: {
                    configurations: [
                        config("Last"),
                        config("Hidden", { presentation: { hidden: true } }),
                        config("Second", { presentation: { order: 2 } }),
                        null,
                        { type: "synthetic", request: "launch" },
                        config("First", { presentation: { order: 1 } }),
                    ],
                    compounds: [
                        { name: "Both", configurations: ["First", "Second"] },
                        { name: "Empty", configurations: [] },
                        { name: "Missing" },
                        { configurations: ["First"] },
                    ],
                },
            };

            const launch = create().getLaunches()[0];

            expect(launch.getConfigurationNames()).toEqual(["First", "Second", "Last", "Both"]);
            expect(launch.getConfigurationNames(true)).toEqual(["Last", "Hidden", "Second", "First"]);
            expect(launch.getCompound("Both")).toEqual({ name: "Both", configurations: ["First", "Second"] });
            expect(launch.getCompound("Run")).toBeUndefined();
        });

        it("a configuration is a copy for this platform, with the layer it came from", () => {
            const run = config("Run", { args: ["a"], [PLATFORM_KEY]: { args: ["b"], presentation: { order: 3 } } });
            layers = { workspace: { configurations: [run] }, user: { configurations: [config("Mine")] } };
            const manager = create();
            const [folder, user] = manager.getLaunches();

            const got = folder.getConfiguration("Run");
            expect(got).toMatchObject({ name: "Run", args: ["b"], __configurationTarget: "workspaceFolder" });
            expect(got?.presentation).toEqual({ order: 3 });
            (got as unknown as { args: string[] }).args.push("changed");
            expect(folder.getConfiguration("Run")).toMatchObject({ args: ["b"] });
            expect(user.getConfiguration("Mine")?.__configurationTarget).toBe("user");
            expect(folder.getConfiguration("Nope")).toBeUndefined();
        });

        it("the workspace file's configurations come from the workspace", () => {
            workbenchState = "workspace";
            layers = { workspace: { configurations: [config("Shared")] } };

            const workspace = create().getLaunches()[1];

            expect(workspace.getConfiguration("Shared")?.__configurationTarget).toBe("workspace");
        });

        it("repeated names are told apart by a number, as upstream", () => {
            layers = {
                workspace: {
                    configurations: [config("Run"), config("Run"), config("Run")],
                    compounds: [
                        { name: "C", configurations: ["Run"] },
                        { name: "C", configurations: ["Run (1)"] },
                    ],
                },
            };

            const launch = create().getLaunches()[0];

            expect(launch.getConfigurationNames()).toEqual(["Run", "Run (1)", "Run (2)", "C", "C (1)"]);
            expect(launch.getConfiguration("Run (2)")?.name).toBe("Run (2)");
        });

        it("no launch section, or sections that are not arrays, give nothing", () => {
            layers = { workspace: { configurations: "Run", compounds: {} } };
            const manager = create();
            const [folder, user] = manager.getLaunches();

            expect(folder.getConfigurationNames()).toEqual([]);
            expect(user.getConfigurationNames()).toEqual([]);
            expect(user.getCompound("C")).toBeUndefined();
        });

        it("entries without a string name are skipped, whatever they are", () => {
            layers = {
                workspace: { configurations: [null, 5, "Run", {}, { name: 1 }, config("Run")], compounds: [null] },
            };

            expect(create().getLaunches()[0].getConfigurationNames()).toEqual(["Run"]);
        });

        it("a configuration renamed by its platform block is listed by the new name but not offered, as upstream", () => {
            const renamed = { name: "Other" };
            layers = {
                workspace: {
                    configurations: [config("Run", { linux: renamed, osx: renamed, windows: renamed } as never)],
                },
            };
            const manager = create();

            expect(manager.getLaunches()[0].getConfigurationNames()).toEqual(["Other"]);
            expect(manager.getAllConfigurations()).toEqual([]);
        });

        it("all configurations of the window: the visible ones of each launch with their presentation", () => {
            layers = {
                workspace: {
                    configurations: [config("Run"), config("Test", { presentation: { group: "b" } })],
                    compounds: [{ name: "Both", configurations: ["Run", "Test"], presentation: { group: "a" } }],
                },
                user: { configurations: [config("Mine")] },
            };
            const manager = create();
            const [folder, user] = manager.getLaunches();

            expect(manager.getAllConfigurations()).toEqual([
                { launch: folder, name: "Both", presentation: { group: "a" } },
                { launch: folder, name: "Test", presentation: { group: "b" } },
                { launch: folder, name: "Run", presentation: undefined },
                { launch: user, name: "Mine", presentation: undefined },
            ]);
        });
    });

    describe("the selected configuration", () => {
        it("is the first configuration of the folder at first, remembered in the workspace with its launch", async () => {
            layers = { workspace: { configurations: [config("Run"), config("Test")] } };
            const manager = create();

            const { launch, name, getConfig } = manager.selectedConfiguration;
            expect([launch?.name, name]).toEqual(["w", "Run"]);
            expect(await getConfig()).toMatchObject({ name: "Run" });
            expect(manager.selectedConfiguration.type).toBe("synthetic");
            expect(state.values.get("debug.selectedconfigname")).toBe("Run");
            expect(state.values.get("debug.selectedroot")).toBe(LAUNCH_JSON);
            expect(contextKeys.get("debugConfigurationType")).toBe("synthetic");
        });

        it("without folder configurations the first launch that has some is selected, else the folder's", () => {
            layers = { user: { configurations: [config("Mine")] } };
            expect(create().selectedConfiguration.name).toBe("Mine");

            layers = {};
            const empty = create();
            expect([empty.selectedConfiguration.launch?.name, empty.selectedConfiguration.name]).toEqual([
                "w",
                undefined,
            ]);
            expect(state.values.has("debug.selectedconfigname")).toBe(false);
            expect(contextKeys.get("debugConfigurationType")).toBeUndefined();
        });

        it("a stored selection is restored, also when the window opens another workspace", () => {
            layers = {
                workspace: { configurations: [config("Run"), config("Test")] },
                user: { configurations: [config("Mine")] },
            };
            state.values.set("debug.selectedroot", USER_SETTINGS.toString());
            state.values.set("debug.selectedconfigname", "Mine");
            const manager = create();
            expect([manager.selectedConfiguration.launch?.name, manager.selectedConfiguration.name]).toEqual([
                "user settings",
                "Mine",
            ]);

            state.openWorkspace(
                new Map<string, unknown>([
                    ["debug.selectedroot", LAUNCH_JSON],
                    ["debug.selectedconfigname", "Test"],
                ]),
            );

            expect([manager.selectedConfiguration.launch?.name, manager.selectedConfiguration.name]).toEqual([
                "w",
                "Test",
            ]);
        });

        it("a stored name without its launch is looked up in the default launch", () => {
            layers = { workspace: { configurations: [config("Run"), config("Test")] } };
            state.values.set("debug.selectedroot", "file:///gone/launch.json");
            state.values.set("debug.selectedconfigname", "Test");

            expect(create().selectedConfiguration.name).toBe("Test");
        });

        it("selecting fires the event once per change and sets the configuration type", async () => {
            layers = {
                workspace: { configurations: [config("Run"), config("Attach", { type: "other", request: "attach" })] },
            };
            const manager = create();
            const fired = vi.fn();
            manager.onDidSelectConfiguration(fired);
            const folder = manager.getLaunches()[0];

            await manager.selectConfiguration(folder, "Attach");
            await manager.selectConfiguration(folder, "Attach");
            expect(fired).toHaveBeenCalledTimes(1);
            expect(contextKeys.get("debugConfigurationType")).toBe("other");

            // An unknown name keeps the selection.
            await manager.selectConfiguration(folder, "Nope");
            expect(manager.selectedConfiguration.name).toBe("Attach");

            await manager.selectConfiguration(manager.getLaunches()[1]);
            expect(fired).toHaveBeenCalledTimes(2);
            expect(manager.selectedConfiguration.name).toBeUndefined();
        });

        it("the same name in another launch is another selection", async () => {
            layers = { workspace: { configurations: [config("Run")] }, user: { configurations: [config("Run")] } };
            const manager = create();
            const [folder, user] = manager.getLaunches();
            await manager.selectConfiguration(folder, "Run");
            const fired = vi.fn();
            manager.onDidSelectConfiguration(fired);

            await manager.selectConfiguration(user, "Run");

            expect(fired).toHaveBeenCalledTimes(1);
            expect(manager.selectedConfiguration.launch).toBe(user);
        });

        it("a passed configuration is the selected one when the launch has no such name", async () => {
            const manager = create();
            const passed = { type: "dyn", request: "launch", name: "Dynamic" };

            await manager.selectConfiguration(manager.getLaunches()[0], "Dynamic", passed);

            expect(await manager.selectedConfiguration.getConfig()).toBe(passed);
            expect(contextKeys.get("debugConfigurationType")).toBe("dyn");
        });

        it("a passed configuration gives its type even when the launch has a selected one", async () => {
            layers = { workspace: { configurations: [config("Run")] } };
            const manager = create();

            await manager.selectConfiguration(manager.getLaunches()[0], "Dynamic", {
                type: "dyn",
                request: "launch",
                name: "Dynamic",
            });

            expect(manager.selectedConfiguration.name).toBe("Run");
            expect(contextKeys.get("debugConfigurationType")).toBe("dyn");
        });

        it("a disposed manager no longer follows launch.json", () => {
            layers = { workspace: { configurations: [config("Run")] } };
            const manager = create();
            const selected = vi.fn();
            manager.onDidSelectConfiguration(selected);

            manager.dispose();
            changeLaunch({ workspace: { configurations: [config("Other")] } });

            expect(manager.selectedConfiguration.name).toBe("Run");
            expect(selected).not.toHaveBeenCalled();
        });

        it("an edit of launch.json keeps a selection that is still there, else takes the first", () => {
            layers = { workspace: { configurations: [config("Run"), config("Test")] } };
            const manager = create();
            void manager.selectConfiguration(manager.getLaunches()[0], "Test");

            changeLaunch({ workspace: { configurations: [config("Other"), config("Test")] } });
            expect(manager.selectedConfiguration.name).toBe("Test");

            changeLaunch({ workspace: { configurations: [config("Other")] } });
            expect(manager.selectedConfiguration.name).toBe("Other");

            configurationChange.fire({
                affectedKeys: ["editor.tabSize"],
                overrideIdentifiers: [],
                affectsConfiguration: () => false,
            });
            expect(manager.selectedConfiguration.name).toBe("Other");
        });
    });

    describe("Open launch.json", () => {
        it("an existing file opens at the line of the selected configuration", async () => {
            layers = { workspace: { configurations: [config("Run"), config("Test")] } };
            files.set(LAUNCH_JSON, '{\n  "configurations": [\n    { "name": "Run" },\n    { "name": "Test" }\n  ]\n}');
            const manager = create();
            await manager.selectConfiguration(manager.getLaunches()[0], "Test");

            const result = await manager.getLaunches()[0].openConfigFile({ preserveFocus: true });

            expect(result).toEqual({ opened: true, created: false });
            expect(opened).toEqual([{ resource: LAUNCH_JSON, preserveFocus: true, line: 3 }]);
            expect(ports.files.writeFile).not.toHaveBeenCalled();
        });

        it("a file without the selected name opens at its top", async () => {
            files.set(LAUNCH_JSON, "{}");

            await create().getLaunches()[0].openConfigFile({ preserveFocus: false });

            expect(opened).toEqual([{ resource: LAUNCH_JSON, preserveFocus: false }]);
        });

        it("without a type the debugger is guessed; cancelled, nothing is created or opened", async () => {
            adapterManager.guessDebugger = () => Promise.resolve(undefined);

            const result = await create().getLaunches()[0].openConfigFile({ preserveFocus: false });

            expect(result).toEqual({ opened: false, created: false });
            expect(ports.files.writeFile).not.toHaveBeenCalled();
            expect(opened).toEqual([]);
        });

        it("a dynamic configuration picked when the debugger is guessed is the only one of the new file", async () => {
            const withConfig = { launch: {} as ILaunch, config: { type: "synthetic", request: "launch", name: "D" } };
            const contents = vi.fn((configs?: IConfig[]) => Promise.resolve(JSON.stringify(configs)));
            adapterManager.guessDebugger = () =>
                Promise.resolve({
                    debugger: { ...EMPTY_DEBUGGER, getInitialConfigurationContent: contents },
                    withConfig,
                });

            await create().getLaunches()[0].openConfigFile({ preserveFocus: false });

            expect(files.get(LAUNCH_JSON)).toBe(JSON.stringify([withConfig.config]));
        });

        it("a type without a debugger gets the empty skeleton", async () => {
            await create().getLaunches()[0].openConfigFile({ preserveFocus: false, type: "nope" });

            expect(files.get(LAUNCH_JSON)).toContain('"configurations": []');
        });

        it("a missing file is created with the guessed debugger's skeleton, in the editor's indentation, folder and all", async () => {
            settings = { "editor.insertSpaces": true, "editor.tabSize": 2 };

            const result = await create().getLaunches()[0].openConfigFile({ preserveFocus: false });

            expect(result).toEqual({ opened: true, created: true });
            expect(ports.files.createFolder).toHaveBeenCalledWith(Uri.file("/w/.diode"));
            expect(files.get(LAUNCH_JSON)).toBe(
                [
                    "{",
                    "  // Use IntelliSense to learn about possible attributes.",
                    "  // Hover to view descriptions of existing attributes.",
                    "  // For more information, visit: https://go.microsoft.com/fwlink/?linkid=830387",
                    '  "version": "0.2.0",',
                    '  "configurations": []',
                    "}",
                ].join("\n"),
            );
            expect(opened).toEqual([{ resource: LAUNCH_JSON, preserveFocus: false }]);
        });

        it("with tabs and an existing folder the skeleton keeps its tabs; a type takes its debugger's configurations", async () => {
            files.set("file:///w/.diode/settings.json", "{}");
            adapterManager = {
                getDebugger: (type) =>
                    type === "synthetic"
                        ? ({
                              type: "synthetic",
                              getInitialConfigurationContent: () => Promise.resolve("{\n\t// synthetic\n}"),
                          } as never)
                        : undefined,
                activateDebuggers: () => Promise.resolve(),
                guessDebugger: () => Promise.reject(new Error("a type is given")),
            };

            await create().getLaunches()[0].openConfigFile({ preserveFocus: false, type: "synthetic" });

            expect(ports.files.createFolder).not.toHaveBeenCalled();
            expect(files.get(LAUNCH_JSON)).toBe("{\n\t// synthetic\n}");
        });

        it("spaces without a tab size indent the skeleton by 4", async () => {
            settings = { "editor.insertSpaces": true };

            await create().getLaunches()[0].openConfigFile({ preserveFocus: false });

            expect(files.get(LAUNCH_JSON)).toContain('\n    "version": "0.2.0",');
        });

        it("a file that cannot be written is an error with upstream's text", async () => {
            vi.mocked(ports.files.writeFile).mockRejectedValueOnce(new Error("EACCES"));

            const failure = create().getLaunches()[0].openConfigFile({ preserveFocus: false });
            await expect(failure).rejects.toThrow(
                "Unable to create 'launch.json' file inside the '.diode' folder (EACCES).",
            );
            await expect(failure).rejects.toHaveProperty("cause", new Error("EACCES"));
            expect(opened).toEqual([]);
        });

        it("the workspace file and the user settings are opened as they are", async () => {
            workbenchState = "workspace";
            const [, workspace, user] = create().getLaunches();

            expect(await workspace.openConfigFile({ preserveFocus: true })).toEqual({ opened: true, created: false });
            expect(await user.openConfigFile({ preserveFocus: false })).toEqual({ opened: true, created: false });

            expect(opened).toEqual([
                { resource: WORKSPACE_FILE.toString(), preserveFocus: true },
                { resource: USER_SETTINGS.toString(), preserveFocus: false },
            ]);
        });
    });
});
