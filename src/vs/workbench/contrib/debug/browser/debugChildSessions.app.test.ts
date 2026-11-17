// Child sessions on the whole workbench with the synthetic debugger: the app's workers (its reverse `startDebugging`)
// under it in CALL STACK, the toolbar's select of the root sessions, the Debug Console's select of the consoles and
// Ctrl+PageDown through them, and Stop of the app ending its workers.

import type { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { SYNTHETIC_LAUNCH_CONFIG } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { type IDebugSession, State } from "../common/debug.ts";

import { DebugServiceDIToken } from "./debugService.ts";

const FILE = "src/main.cpp";

describe("child sessions in the workbench", () => {
    let ws: ITempWorkspace;
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        ws = createTempWorkspace({ files: { [FILE]: "alpha\nbeta\ngamma\n" } });
        t = await createDebugViewletHarness(ws.dir, ws.dir);
        t.h.workbench.openFile(ws.path(FILE));
        t.registerDebugger();
    });

    afterEach(async () => {
        await t.dispose();
        ws.dispose();
    });

    function sessions(): IDebugSession[] {
        return t.h.container.get(DebugServiceDIToken).getModel().getSessions();
    }

    function focusedName(): string | undefined {
        return t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession?.name;
    }

    async function start(config: Record<string, unknown>, stopped: number): Promise<void> {
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG, ...config });
        await vi.waitFor(() => {
            expect(sessions().filter((s) => s.state === State.Stopped)).toHaveLength(stopped);
        });
    }

    function startWithWorkers(): Promise<void> {
        return start({ name: "app", workers: ["task A", "task B"] }, 3);
    }

    function click(point: Point): void {
        for (const action of ["press", "release"] as const) {
            t.h.testApp.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: point.x + 1,
                y: point.y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
    }

    /** The rows of the screen from the one with `from` to the one with `to`. */
    function between(from: string, to: string): string[] {
        const rows = t.lines();
        const start = rows.findIndex((row) => row.includes(from));
        const end = rows.findIndex((row, i) => i > start && row.includes(to));
        return rows.slice(start, end);
    }

    it("CALL STACK shows the app, its threads and frames, and its workers under it", async () => {
        await startWithWorkers();

        await vi.waitFor(() => {
            const callStack = between("CALL STACK", "BREAKPOINTS").join("\n");
            expect(callStack).toMatch(/app[\s\S]*task A[\s\S]*task B/u);
        });
        const rows = between("CALL STACK", "BREAKPOINTS");
        const indent = (name: string): number => {
            const row = rows.find((r) => r.includes(name))!;
            return row.indexOf(name);
        };
        // The workers are children of the app's row.
        expect(indent("task A")).toBeGreaterThan(indent("app"));
        expect(indent("task B")).toBe(indent("task A"));
    });

    /** The rows with a closed select, but the launcher's of the configurations in the Run and Debug title. */
    function sessionSelects(): string[] {
        return t.lines().filter((row) => row.includes("⌄") && !row.includes("RUN AND DEBUG"));
    }

    /** The closed select showing `label`: the label, padded to the widest option, then the arrow. */
    function selectOf(label: string): Point | undefined {
        const rows = t.lines();
        const pattern = new RegExp(`${label} *⌄`, "u");
        const y = rows.findIndex((row) => pattern.test(row));
        return y < 0 ? undefined : ({ x: rows[y].search(pattern), y } as Point);
    }

    /** Clicks the option `label` of the open select under the row `below`. */
    function pickOption(label: string, below: number): void {
        const rows = t.lines();
        const y = rows.findIndex((row, i) => i > below && row.includes(label));
        expect(y, `option ${label}`).toBeGreaterThan(below);
        click({ x: rows[y].indexOf(label), y } as Point);
    }

    it("children alone do not put a select in the toolbar; a second root session does, and picks the focus", async () => {
        await startWithWorkers();
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("multiSessionDebug")).toBe(false);
        expect(sessionSelects()).toEqual([]);

        await start({ name: "another" }, 4);

        // The focused session is still the app's: the select stands for it, in the toolbar's box with Stop.
        const select = selectOf("app")!;
        expect(t.lines()[select.y]).toContain("■");
        click(select);
        // The options: the roots only, while `debug.showSubSessionsInToolBar` is off.
        const options = t
            .lines()
            .slice(select.y + 1, select.y + 5)
            .join("\n");
        expect(options).toMatch(/app[\s\S]*another/u);
        expect(options).not.toContain("task A");
        pickOption("another", select.y);

        await vi.waitFor(() => {
            expect(focusedName()).toBe("another");
        });
        await vi.waitFor(() => {
            expect(selectOf("another")?.y).toBe(select.y);
        });
    });

    it("with `debug.showSubSessionsInToolBar` the toolbar's select lists the children indented", async () => {
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("debug.showSubSessionsInToolBar", true);
        await startWithWorkers();
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("multiSessionDebug")).toBe(true);

        const select = selectOf("app")!;
        click(select);
        const options = t.lines().slice(select.y + 1, select.y + 6);
        const at = (label: string): number => {
            const row = options.find((r) => r.includes(label))!;
            return row.indexOf(label);
        };
        expect(at("task A")).toBe(at("app") + 2);
        pickOption("task B", select.y);

        await vi.waitFor(() => {
            expect(focusedName()).toBe("task B");
        });
    });

    it("the Debug Console picks one of several consoles; Ctrl+PageDown goes to the next", async () => {
        await startWithWorkers();
        await t.h.commands.execute("workbench.debug.action.focusRepl");
        await vi.waitFor(() => {
            expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("inDebugRepl")).toBe(true);
        });
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("multiSessionRepl")).toBe(true);

        // The panel under the editor gets the room of a usual sidebar: the tabs, the filter and the select fit.
        t.h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(-40);
        const select = selectOf("app")!;
        expect(t.lines()[select.y]).toContain("DEBUG CONSOLE");
        click(select);
        const options = t.lines().slice(select.y + 1, select.y + 6);
        const at = (label: string): number => {
            const row = options.find((r) => r.includes(label))!;
            return row.indexOf(label);
        };
        // A worker is indented under the app.
        expect(at("task A")).toBe(at("app") + 2);
        pickOption("task B", select.y);
        await vi.waitFor(() => {
            expect(focusedName()).toBe("task B");
        });
        await vi.waitFor(() => {
            expect(selectOf("task B")?.y).toBe(select.y);
        });

        await t.h.commands.execute("workbench.debug.action.focusRepl");
        t.h.testApp.sendKey("Ctrl+PageDown");
        await vi.waitFor(() => {
            expect(focusedName()).toBe("app");
        });
        await vi.waitFor(() => {
            expect(selectOf("app")?.y).toBe(select.y);
        });
    });

    it("one console, no select in the Debug Console's title", async () => {
        await start({ name: "alone" }, 1);
        await t.h.commands.execute("workbench.debug.action.focusRepl");

        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("multiSessionRepl")).toBe(false);
        expect(sessionSelects()).toEqual([]);
    });

    /** The row of the Debug Console's title. */
    function consoleTitle(): string {
        return t.lines().find((row) => row.includes("DEBUG CONSOLE")) ?? "";
    }

    async function openConsole(): Promise<void> {
        await t.h.commands.execute("workbench.debug.action.focusRepl");
        t.h.container.get(LayoutServiceDIToken).nudgeSidebarWidth(-40);
    }

    function service() {
        return t.h.container.get(DebugServiceDIToken);
    }

    it("no session yet: the console's title has no select", async () => {
        await openConsole();

        expect(consoleTitle()).toContain("Filter");
        expect(consoleTitle()).not.toContain("⌄");
    });

    /** A session and a child that shares its console. */
    async function startMerged(): Promise<{ parent: IDebugSession; merged: IDebugSession }> {
        await start({ name: "parent" }, 1);
        const parent = sessions().find((s) => s.name === "parent")!;
        await service().startDebugging(
            undefined,
            { ...SYNTHETIC_LAUNCH_CONFIG, name: "merged" },
            { parentSession: parent, repl: "mergeWithParent" },
        );
        return { parent, merged: sessions().find((s) => s.name === "merged")! };
    }

    it("a child that shares its parent's console stands for the parent in the select", async () => {
        const { merged } = await startMerged();
        await start({ name: "other" }, 3);
        await openConsole();

        await service().focusStackFrame(undefined, undefined, merged, { explicit: true });

        await vi.waitFor(() => {
            expect(consoleTitle()).toMatch(/parent *⌄/u);
        });
    });

    it("one console for a parent and its child; when the parent ends, the child's own is a second", async () => {
        const { parent, merged } = await startMerged();
        await openConsole();
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("multiSessionRepl")).toBe(false);
        expect(consoleTitle()).not.toContain("⌄");

        await service().stopSession(parent);

        await vi.waitFor(() => {
            expect(merged.parentSession).toBeUndefined();
        });
        await vi.waitFor(() => {
            expect(consoleTitle()).toContain("⌄");
        });
    });

    it("Clear Console of an ended session takes its console out of the select", async () => {
        await start({ name: "kept" }, 1);
        await start({ name: "ended" }, 2);
        await openConsole();
        const ended = sessions().find((s) => s.name === "ended")!;
        await service().stopSession(ended);
        await vi.waitFor(() => {
            expect(ended.state).toBe(State.Inactive);
        });
        expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("multiSessionRepl")).toBe(true);

        await t.h.commands.execute("workbench.action.debug.selectRepl", ended);
        await t.h.commands.execute("workbench.debug.panel.action.clearReplAction");

        await vi.waitFor(() => {
            expect(consoleTitle()).not.toContain("⌄");
        });
    });

    it("Stop of the app ends its workers", async () => {
        await startWithWorkers();
        const app = sessions().find((s) => s.name === "app")!;
        await t.h.commands.execute("workbench.action.debug.stop", undefined, { sessionId: app.getId() });

        await vi.waitFor(() => {
            expect(sessions()).toEqual([]);
        });
        expect(t.screen()).not.toContain("task A");
    });
});
