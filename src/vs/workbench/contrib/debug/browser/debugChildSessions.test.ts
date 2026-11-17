// Child sessions: an adapter's reverse `startDebugging` (js-debug's child processes, the synthetic adapter's
// `workers`), the Call Stack tree of several sessions, the Stop and Restart of a child that the parent manages, and
// the pickers of sessions and consoles.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { codicon, type IProductIcon } from "../../../../base/common/codicons.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { ProductIconServiceDIToken } from "../../../../platform/theme/common/productIconService.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import { QuickOpenServiceDIToken } from "../../quickaccess/browser/quickOpenService.ts";
import { type IDebugSession, REPL_VIEW_ID, State } from "../common/debug.ts";

import { CallStackDataSource } from "./callStackView.ts";
import {
    focusSessionAction,
    restartSessionAction,
    SELECT_AND_START_ID,
    selectDebugSessionAction,
    stopAction,
} from "./debugCommands.ts";
import { DebugConsoleQuickAccess } from "./debugConsoleQuickAccess.ts";
import { DebugServiceDIToken, DebugServicePortsDIToken } from "./debugService.ts";
import { START_NEW_DEBUG_SESSION } from "./debugSessionPicker.ts";
import { ReplDIToken } from "./repl.ts";
import {
    DEBUG_CONSOLE_QUICK_ACCESS_PREFIX,
    nextDebugConsoleAction,
    prevDebugConsoleAction,
    selectDebugConsoleAction,
    selectReplAction,
} from "./replActions.ts";

/** The unicode glyph of the asked codicon. */
const ICONS = { glyph: (icon: IProductIcon) => icon.unicode };
const PLUS = codicon("plus").unicode;

const WORKERS_CONFIG = { ...SYNTHETIC_LAUNCH_CONFIG, name: "app", workers: ["task A", "task B"] };

describe("child sessions", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let accessor: ServiceAccessor;
    let executed: unknown[][];
    let opened: string[];
    let replShown: boolean;
    let picks: QuickPickItem[][];
    let activeIndexes: (number | undefined)[];
    let pick: (items: readonly QuickPickItem[]) => QuickPickItem | undefined;
    let replSelected: (IDebugSession | undefined)[];
    let quickOpened: string[];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        executed = [];
        opened = [];
        replShown = false;
        picks = [];
        activeIndexes = [];
        pick = () => undefined;
        replSelected = [];
        quickOpened = [];
        const services = new Map<Token<unknown>, unknown>([
            [DebugServiceDIToken, fx.service],
            [DebugServicePortsDIToken, fx.ports],
            [CommandRegistryDIToken, { execute: (...args: unknown[]) => executed.push(args) }],
            [
                QuickInputServiceDIToken,
                {
                    quickPick: (opts: { items: readonly QuickPickItem[]; activeIndex?: number }) => {
                        picks.push([...opts.items]);
                        activeIndexes.push(opts.activeIndex);
                        return Promise.resolve(pick(opts.items));
                    },
                },
            ],
            [
                ViewsServiceDIToken,
                {
                    isViewShown: () => replShown,
                    openView: (id: string, focus: boolean) => opened.push(`${id}:${String(focus)}`),
                },
            ],
            [ProductIconServiceDIToken, ICONS],
            [ReplDIToken, { selectSession: (s: IDebugSession | undefined) => replSelected.push(s) }],
            [QuickOpenServiceDIToken, { show: (prefix: string) => quickOpened.push(prefix) }],
        ]);
        accessor = {
            get: <T>(token: Token<T>): T => {
                if (!services.has(token)) throw new Error(`unexpected ${token.id}`);
                return services.get(token) as T;
            },
        };
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        factory.adapters.forEach((a) => {
            a.dispose();
        });
        fx.service.dispose();
    });

    /** Whether each focus change since the call was the user's (`explicit`). */
    function explicitFocus(): boolean[] {
        const explicit: boolean[] = [];
        fx.service.getViewModel().onDidFocusStackFrame((e) => explicit.push(e.explicit));
        return explicit;
    }

    function sessions(): IDebugSession[] {
        return fx.service.getModel().getSessions();
    }

    function named(name: string): IDebugSession {
        const found = sessions().find((s) => s.name === name);
        if (!found) throw new Error(`no session ${name}`);
        return found;
    }

    /** The app and its two workers, all stopped on the breakpoint. */
    async function startWithWorkers(): Promise<{ app: IDebugSession; w1: IDebugSession; w2: IDebugSession }> {
        expect(await fx.service.startDebugging(undefined, { ...WORKERS_CONFIG })).toBe(true);
        await vi.waitFor(() => {
            expect(sessions().map((s) => [s.name, s.state])).toEqual([
                ["app", State.Stopped],
                ["task A", State.Stopped],
                ["task B", State.Stopped],
            ]);
        });
        return { app: named("app"), w1: named("task A"), w2: named("task B") };
    }

    it("the adapter's `startDebugging` starts each worker as a child of the app, of the app's type", async () => {
        const { app, w1, w2 } = await startWithWorkers();

        expect([w1.parentSession, w2.parentSession]).toEqual([app, app]);
        expect(w1.configuration).toMatchObject({ type: "synthetic", request: "attach", name: "task A", __workerOf: 0 });
        expect(factory.adapters[0].responses.map((r) => [r.command, r.success])).toEqual([
            ["startDebugging", true],
            ["startDebugging", true],
        ]);
    });

    it("Call Stack shows the app with its threads and its workers under it", async () => {
        const { app, w1, w2 } = await startWithWorkers();
        const dataSource = new CallStackDataSource(fx.service);

        expect(await dataSource.getRoots()).toEqual([app]);
        expect(await dataSource.getChildren(app)).toEqual([...app.getAllThreads(), w1, w2]);
    });

    it("children do not make the toolbar's several sessions, unless `debug.showSubSessionsInToolBar`", async () => {
        await startWithWorkers();
        expect(fx.contextKeys.getRaw("multiSessionDebug")).toBe(false);

        await fx.configuration.updateValue("debug.showSubSessionsInToolBar", true);
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "another" })).toBe(true);
        expect(fx.contextKeys.getRaw("multiSessionDebug")).toBe(true);
    });

    it("a second root session makes several sessions", async () => {
        await startWithWorkers();
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "another" })).toBe(true);
        expect(fx.contextKeys.getRaw("multiSessionDebug")).toBe(true);
    });

    it("Stop of the app ends its workers too", async () => {
        const { app } = await startWithWorkers();

        await stopAction.run(accessor, undefined, { sessionId: app.getId() });

        await vi.waitFor(() => {
            expect(sessions()).toEqual([]);
        });
        expect(factory.adapters[0].requests.map((r) => r.command)).toContain("terminate");
    });

    describe("a child whose lifecycle the parent manages", () => {
        async function startManagedChild(): Promise<{ parent: IDebugSession; child: IDebugSession }> {
            expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "parent" })).toBe(
                true,
            );
            const parent = named("parent");
            expect(
                await fx.service.startDebugging(
                    undefined,
                    { ...SYNTHETIC_LAUNCH_CONFIG, name: "child" },
                    { parentSession: parent, lifecycleManagedByParent: true },
                ),
            ).toBe(true);
            return { parent, child: named("child") };
        }

        it("Stop goes to the root parent", async () => {
            const { parent, child } = await startManagedChild();
            const stop = vi.spyOn(fx.service, "stopSession");

            await stopAction.run(accessor, undefined, { sessionId: child.getId() });

            expect(stop).toHaveBeenCalledWith(parent, false);
        });

        it("Restart goes to the root parent", async () => {
            const { parent, child } = await startManagedChild();
            const restart = vi.spyOn(fx.service, "restartSession").mockResolvedValue();

            await restartSessionAction.run(accessor, undefined, { sessionId: child.getId() });

            expect(restart).toHaveBeenCalledWith(parent);
        });

        it("with `debug.showSubSessionsInToolBar` Stop and Restart stay with the child", async () => {
            const { child } = await startManagedChild();
            await fx.configuration.updateValue("debug.showSubSessionsInToolBar", true);
            const stop = vi.spyOn(fx.service, "stopSession").mockResolvedValue();
            const restart = vi.spyOn(fx.service, "restartSession").mockResolvedValue();

            await stopAction.run(accessor, undefined, { sessionId: child.getId() });
            await restartSessionAction.run(accessor, undefined, { sessionId: child.getId() });

            expect(stop).toHaveBeenCalledWith(child, false);
            expect(restart).toHaveBeenCalledWith(child);
        });
    });

    it("a child the parent does not manage stops alone", async () => {
        const { w1 } = await startWithWorkers();
        const stop = vi.spyOn(fx.service, "stopSession").mockResolvedValue();

        await stopAction.run(accessor, undefined, { sessionId: w1.getId() });

        expect(stop).toHaveBeenCalledWith(w1, false);
    });

    describe("Select Debug Session", () => {
        it("lists the sessions, the focused one active, a child naming its parent, then a new session", async () => {
            const { w1 } = await startWithWorkers();
            await fx.service.focusStackFrame(undefined, undefined, w1);

            await selectDebugSessionAction.run(accessor);

            expect(picks[0].map((p) => [p.label, p.description])).toEqual([
                ["app", undefined],
                ["task A", "app"],
                ["task B", "app"],
                [START_NEW_DEBUG_SESSION, undefined],
            ]);
            expect(picks[0][3].icon).toBe(PLUS);
            expect(activeIndexes).toEqual([1]);
        });

        it("picking a session focuses it and shows the Debug Console; the last item selects and starts", async () => {
            await startWithWorkers();
            pick = (items) => items[2];
            const explicit = explicitFocus();

            await selectDebugSessionAction.run(accessor);

            expect(fx.service.getViewModel().focusedSession?.name).toBe("task B");
            expect(explicit).toEqual([true]);
            expect(opened).toEqual([`${REPL_VIEW_ID}:true`]);

            replShown = true;
            pick = (items) => items[0];
            await selectDebugSessionAction.run(accessor);
            expect(fx.service.getViewModel().focusedSession?.name).toBe("app");
            expect(opened).toHaveLength(1);

            pick = (items) => items.at(-1);
            await selectDebugSessionAction.run(accessor);
            expect(executed).toEqual([[SELECT_AND_START_ID]]);
        });

        it("an ended session is not one of them", async () => {
            const { w1 } = await startWithWorkers();
            await fx.service.stopSession(w1);
            await vi.waitFor(() => {
                expect(w1.state).toBe(State.Inactive);
            });

            await selectDebugSessionAction.run(accessor);

            expect(picks[0].map((p) => p.label)).toEqual(["app", "task B", START_NEW_DEBUG_SESSION]);
        });

        it("the parent of a compact child is not a row of its own", async () => {
            expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "launcher" })).toBe(
                true,
            );
            const launcher = named("launcher");
            await fx.service.startDebugging(
                undefined,
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "program" },
                { parentSession: launcher, compact: true },
            );

            await selectDebugSessionAction.run(accessor);

            expect(picks[0].map((p) => [p.label, p.description])).toEqual([
                ["program", "launcher"],
                [START_NEW_DEBUG_SESSION, undefined],
            ]);
        });

        it("Focus Session with a session focuses it and opens its frame without taking the focus", async () => {
            const { w2 } = await startWithWorkers();

            await focusSessionAction.run(accessor, w2);

            expect(fx.service.getViewModel().focusedSession).toBe(w2);
            expect(fx.openedFrames.at(-1)).toMatchObject({ preserveFocus: true, sideBySide: false });
        });
    });

    describe("the consoles", () => {
        it("Select Debug Console opens its quick access", () => {
            selectDebugConsoleAction.run(accessor);
            expect(quickOpened).toEqual([DEBUG_CONSOLE_QUICK_ACCESS_PREFIX]);
        });

        it("the quick access lists the consoles by the typed name, then a new session", async () => {
            await startWithWorkers();
            const provider = new DebugConsoleQuickAccess(
                fx.service,
                accessor.get(ViewsServiceDIToken),
                accessor.get(CommandRegistryDIToken),
                ICONS,
            );

            expect(provider.getItems(DebugConsoleQuickAccess.PREFIX).map((i) => i.label)).toEqual([
                "app",
                "task A",
                "task B",
                START_NEW_DEBUG_SESSION,
            ]);
            const filtered = provider.getItems(`${DebugConsoleQuickAccess.PREFIX}tB`);
            expect(filtered.map((i) => [i.label, i.labelMatchRanges])).toEqual([
                [
                    "task B",
                    [
                        [0, 1],
                        [5, 6],
                    ],
                ],
                [START_NEW_DEBUG_SESSION, undefined],
            ]);

            expect(provider.getPlaceholder()).toBe("");
            expect(filtered[1].icon).toBe(PLUS);
            const explicit = explicitFocus();
            filtered[0].accept?.();
            await vi.waitFor(() => {
                expect(fx.service.getViewModel().focusedSession?.name).toBe("task B");
            });
            expect(explicit).toEqual([true]);
            expect(opened).toEqual([`${REPL_VIEW_ID}:true`]);
            filtered[1].accept?.();
            expect(executed).toEqual([[SELECT_AND_START_ID]]);
        });

        it("the console of an ended session stays one of them, for Next too", async () => {
            const { app, w1 } = await startWithWorkers();
            await fx.service.stopSession(w1);
            await vi.waitFor(() => {
                expect(w1.state).toBe(State.Inactive);
            });
            const provider = new DebugConsoleQuickAccess(
                fx.service,
                accessor.get(ViewsServiceDIToken),
                {
                    execute: vi.fn(),
                },
                ICONS,
            );

            expect(provider.getItems(DebugConsoleQuickAccess.PREFIX).map((i) => i.label)).toEqual([
                "app",
                "task A",
                "task B",
                START_NEW_DEBUG_SESSION,
            ]);
            await fx.service.focusStackFrame(undefined, undefined, app);
            const explicit = explicitFocus();
            await nextDebugConsoleAction.run(accessor);
            expect(fx.service.getViewModel().focusedSession).toBe(w1);
            expect(explicit).toEqual([true]);
        });

        it("a child that shares its parent's console is not one of them", async () => {
            expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "parent" })).toBe(
                true,
            );
            await fx.service.startDebugging(
                undefined,
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "merged" },
                { parentSession: named("parent"), repl: "mergeWithParent" },
            );
            const provider = new DebugConsoleQuickAccess(
                fx.service,
                { isViewShown: () => true, openView: vi.fn() },
                {
                    execute: vi.fn(),
                },
                ICONS,
            );

            expect(provider.getItems(DebugConsoleQuickAccess.PREFIX).map((i) => i.label)).toEqual([
                "parent",
                START_NEW_DEBUG_SESSION,
            ]);
        });

        it("Next and Previous Debug Console go round the consoles and show the Debug Console", async () => {
            const { app } = await startWithWorkers();
            await fx.service.focusStackFrame(undefined, undefined, app);

            await nextDebugConsoleAction.run(accessor);
            expect(fx.service.getViewModel().focusedSession?.name).toBe("task A");
            expect(opened).toEqual([`${REPL_VIEW_ID}:true`]);

            await prevDebugConsoleAction.run(accessor);
            await prevDebugConsoleAction.run(accessor);
            expect(fx.service.getViewModel().focusedSession?.name).toBe("task B");
            await nextDebugConsoleAction.run(accessor);
            expect(fx.service.getViewModel().focusedSession?.name).toBe("app");
        });

        it("a session that shares its parent's console steps from the parent's", async () => {
            expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "parent" })).toBe(
                true,
            );
            const parent = named("parent");
            await fx.service.startDebugging(
                undefined,
                { ...SYNTHETIC_LAUNCH_CONFIG, name: "merged" },
                { parentSession: parent, repl: "mergeWithParent" },
            );
            await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "other" });
            await fx.service.focusStackFrame(undefined, undefined, named("merged"));

            await nextDebugConsoleAction.run(accessor);

            expect(fx.service.getViewModel().focusedSession?.name).toBe("other");
        });

        it("the console's select focuses the picked session (its stopped child for a parent) and shows it", async () => {
            const { app, w2 } = await startWithWorkers();
            await fx.service.focusStackFrame(undefined, undefined, app);

            const explicit = explicitFocus();
            await selectReplAction.run(accessor, w2);
            expect(fx.service.getViewModel().focusedSession).toBe(w2);
            expect(explicit).toEqual([true]);
            expect(replSelected.at(-1)).toBe(w2);

            await selectReplAction.run(accessor, app);
            // Upstream `resolveChildSession`: a parent stands for its stopped child.
            expect(fx.service.getViewModel().focusedSession?.name).toBe("task A");
            expect(replSelected.at(-1)?.name).toBe("task A");

            // The focused one only selects: the view model would not tell the console.
            await selectReplAction.run(accessor, named("task A"));
            expect(replSelected).toHaveLength(3);
            expect(explicit).toHaveLength(2);

            // An ended session is only shown, not focused; nothing at all selects what the console finds itself.
            await fx.service.stopSession(w2);
            await vi.waitFor(() => {
                expect(w2.state).toBe(State.Inactive);
            });
            await selectReplAction.run(accessor, w2);
            await selectReplAction.run(accessor, undefined);
            expect(replSelected.slice(-2)).toEqual([w2, undefined]);
            expect(fx.service.getViewModel().focusedSession).not.toBe(w2);
        });
    });
});
