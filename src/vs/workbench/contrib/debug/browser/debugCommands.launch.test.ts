// The launch configuration commands on the debug service: Start Debugging with the selected configuration, Select
// and Start Debugging, Open 'launch.json' and Add Configuration (what they open; the edit of the file is in
// debugCommands.launch.app.test.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    createDebugServiceFixture,
    fakeLaunch,
    type IDebugServiceFixture,
} from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_DEBUG_TYPE,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { SidebarServiceDIToken } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { ExtensionsComponentDIToken } from "../../extensions/browser/extensionsComponent.ts";
import { QuickOpenServiceDIToken } from "../../quickaccess/browser/quickOpenService.ts";
import { DebugConfigurationProviderTriggerKind } from "../common/debug.ts";

import {
    addConfigurationAction,
    configureAction,
    DEBUG_ACTIONS,
    installAdditionalDebuggersAction,
    runAction,
    selectAndStartAction,
    startAction,
} from "./debugCommands.ts";
import { DebugServiceDIToken, DebugServicePortsDIToken } from "./debugService.ts";

const FOLDER = { uri: Uri.file("/w"), name: "w", index: 0 };
const LAUNCH_JSON = "file:///w/.diode/launch.json";

describe("launch configuration commands", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let executed: unknown[][];
    let quickOpen: string[];
    let picks: QuickPickItem[][];
    let pick: (items: QuickPickItem[]) => QuickPickItem | undefined;
    let accessor: ServiceAccessor;
    let searches: string[];
    let shownViewlets: string[];
    let activeEditor: TextEditorPane | null;

    function create(launch?: unknown): void {
        fx = createDebugServiceFixture({ workspaceLaunch: launch, folders: [FOLDER] });
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        // A missing launch.json is created for the debugger of the active file.
        fx.activeEditor = { resource: "file:///w/main.cpp", languageId: "cpp" };
    }

    beforeEach(() => {
        executed = [];
        quickOpen = [];
        picks = [];
        searches = [];
        shownViewlets = [];
        activeEditor = null;
        pick = () => undefined;
        accessor = {
            get: <T>(token: Token<T>): T => {
                const services = new Map<Token<unknown>, unknown>([
                    [DebugServiceDIToken, fx.service],
                    [DebugServicePortsDIToken, fx.ports],
                    [CommandRegistryDIToken, { execute: (...args: unknown[]) => executed.push(args) }],
                    [QuickOpenServiceDIToken, { show: (prefix: string) => quickOpen.push(prefix) }],
                    [
                        QuickInputServiceDIToken,
                        {
                            quickPick: ({ items }: { items: QuickPickItem[] }) => {
                                picks.push(items);
                                return Promise.resolve(pick(items));
                            },
                        },
                    ],
                    [EditorServiceDIToken, { getActiveEditor: () => activeEditor }],
                    [SidebarServiceDIToken, { showViewlet: (id: string) => shownViewlets.push(id) }],
                    [ExtensionsComponentDIToken, { setQuery: (query: string) => searches.push(query) }],
                ]);
                if (!services.has(token)) throw new Error(`unexpected ${token.id}`);
                return services.get(token) as T;
            },
        };
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        fx.service.dispose();
    });

    describe("Start Debugging", () => {
        it("saves, then starts a copy of the selected configuration with the passed attributes, without saving again", async () => {
            create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
            const start = vi.spyOn(fx.service, "startDebugging");

            await startAction.run(accessor, { config: { stopOnEntry: false }, noDebug: false });

            const { launch } = fx.service.getConfigurationManager().selectedConfiguration;
            expect(start).toHaveBeenCalledWith(
                launch,
                expect.objectContaining({ name: "Run", stopOnEntry: false }),
                { noDebug: false, startedByUser: true },
                false,
            );
            expect(fx.saves).toHaveLength(1);
            expect(await fx.service.getConfigurationManager().selectedConfiguration.getConfig()).not.toHaveProperty(
                "stopOnEntry",
            );
        });

        it("Start Without Debugging starts it without debugging", async () => {
            create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
            const start = vi.spyOn(fx.service, "startDebugging");

            await runAction.run(accessor);

            expect(start.mock.calls[0][2]).toEqual({ noDebug: true, startedByUser: true });
        });

        it("a selected compound is started by its name", async () => {
            create({
                configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }],
                compounds: [{ name: "All", configurations: ["Run"], presentation: { order: 0 } }],
            });
            const manager = fx.service.getConfigurationManager();
            await manager.selectConfiguration(manager.getLaunches()[0], "All");
            const start = vi.spyOn(fx.service, "startDebugging");

            await startAction.run(accessor);

            expect(start.mock.calls[0].slice(0, 2)).toEqual([manager.getLaunches()[0], "All"]);
        });
    });

    it("Select and Start Debugging opens the launch configurations picker", async () => {
        create();

        await selectAndStartAction.run(accessor);

        expect(quickOpen).toEqual(["debug "]);
    });

    describe("Select and Start Debugging with a debug type", () => {
        function provideDynamic(): void {
            fx.service.getConfigurationManager().registerDebugConfigurationProvider({
                type: SYNTHETIC_DEBUG_TYPE,
                triggerKind: DebugConfigurationProviderTriggerKind.Dynamic,
                provideDebugConfigurations: () => Promise.resolve([{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Dyn" }]),
            });
        }

        it("picks one of the type's dynamic configurations, selects it and starts it, with noDebug", async () => {
            create();
            provideDynamic();
            const start = vi.spyOn(fx.service, "startDebugging");
            fx.pickLabel = "Dyn";

            await selectAndStartAction.run(accessor, SYNTHETIC_DEBUG_TYPE, { noDebug: true });

            expect(start).toHaveBeenCalledWith(
                expect.objectContaining({ name: "w" }),
                expect.objectContaining({ name: "Dyn" }),
                { noDebug: true, startedByUser: true },
            );
            expect(fx.service.getConfigurationManager().selectedConfiguration.type).toBe(SYNTHETIC_DEBUG_TYPE);
            expect(quickOpen).toEqual([]);
        });

        it("a cancelled pick, or a type without dynamic configurations, opens the picker of all", async () => {
            create();
            provideDynamic();

            await selectAndStartAction.run(accessor, SYNTHETIC_DEBUG_TYPE);
            await selectAndStartAction.run(accessor, "other");

            expect(fx.picks).toHaveLength(1);
            expect(quickOpen).toEqual(["debug ", "debug "]);
        });
    });

    it("Install Additional Debuggers searches the Marketplace's debuggers, with the query given", async () => {
        create();

        await installAdditionalDebuggersAction.run(accessor, "'Plain Text'");
        await installAdditionalDebuggersAction.run(accessor, 3);

        expect(searches).toEqual(["@category:debuggers 'Plain Text'", "@category:debuggers"]);
        expect(shownViewlets).toEqual(["extensions", "extensions"]);
    });

    describe("Open 'launch.json'", () => {
        it("opens the launch of the selected configuration", async () => {
            create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });

            await configureAction.run(accessor);

            expect(fx.opened).toEqual([{ resource: LAUNCH_JSON, preserveFocus: false }]);
            expect(picks).toEqual([]);
        });

        it("a configuration selected in the user settings opens them, though their launch is hidden", async () => {
            create();
            await fx.configuration.updateValue(
                "launch",
                { configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Mine" }] },
                "user",
            );
            expect(fx.service.getConfigurationManager().selectedConfiguration.name).toBe("Mine");

            await configureAction.run(accessor);

            expect(fx.opened.map((o) => o.resource)).toEqual(["file:///user/settings.json"]);
        });

        it("without a selection opens the only visible launch: the folder's", async () => {
            create();

            await configureAction.run(accessor);

            expect(fx.opened.map((o) => o.resource)).toEqual([LAUNCH_JSON]);
        });

        it("with several visible launches asks which one; a cancel opens none", async () => {
            create();
            const manager = fx.service.getConfigurationManager();
            const other = fakeLaunch({
                workspace: undefined,
                getConfiguration: () => undefined,
                name: "workspace",
                openConfigFile: vi.fn(() => Promise.resolve({ opened: true, created: false })),
            });
            vi.spyOn(manager, "getLaunches").mockReturnValue([...manager.getLaunches(), other]);
            pick = (items) => items[1];

            await configureAction.run(accessor);
            pick = () => undefined;
            await configureAction.run(accessor);

            expect(picks.map((items) => items.map((p) => p.label))).toEqual([
                ["w", "workspace"],
                ["w", "workspace"],
            ]);
            expect(other.openConfigFile).toHaveBeenCalledTimes(1);
            expect(other.openConfigFile).toHaveBeenCalledWith({ preserveFocus: false });
            expect(fx.opened).toEqual([]);
        });
    });

    describe("Add Configuration", () => {
        it("opens the launch of the given uri, else the selected one", async () => {
            create({ configurations: [{ ...SYNTHETIC_LAUNCH_CONFIG, name: "Run" }] });
            await fx.configuration.updateValue("launch", { configurations: [] }, "user");

            await addConfigurationAction.run(accessor, "file:///user/settings.json");
            await addConfigurationAction.run(accessor);

            expect(fx.opened).toEqual([
                { resource: "file:///user/settings.json", preserveFocus: false },
                { resource: LAUNCH_JSON, preserveFocus: false },
            ]);
        });

        it("an unknown uri without a selected launch opens nothing", async () => {
            create();
            const manager = fx.service.getConfigurationManager();
            vi.spyOn(manager, "selectedConfiguration", "get").mockReturnValue({
                ...manager.selectedConfiguration,
                launch: undefined,
            });

            await addConfigurationAction.run(accessor, "file:///nowhere/launch.json");

            expect(fx.opened).toEqual([]);
        });
    });

    it("the palette lists them with upstream's titles while debuggers are available", () => {
        const entry = (id: string) => DEBUG_ACTIONS.find((a) => a.id === id);

        expect(
            ["workbench.action.debug.selectandstart", "workbench.action.debug.configure", "debug.addConfiguration"].map(
                (id) => [entry(id)?.title, entry(id)?.menus?.filter((menu) => menu.menuId === MenuId.CommandPalette)],
            ),
        ).toEqual([
            [
                "Debug: Select and Start Debugging",
                [
                    {
                        menuId: MenuId.CommandPalette,
                        when: "debuggersAvailable && debugState != 'initializing'",
                        enablement: undefined,
                    },
                ],
            ],
            [
                "Debug: Open 'launch.json'",
                [{ menuId: MenuId.CommandPalette, when: "debuggersAvailable", enablement: undefined }],
            ],
            [
                "Debug: Add Configuration...",
                [{ menuId: MenuId.CommandPalette, when: "debuggersAvailable", enablement: undefined }],
            ],
        ]);
    });
});
