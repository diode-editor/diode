// Upstream's choice of a breakpoint's icon by its kind and state (`getBreakpointMessageAndIcon`), and the rows of
// the view over the model with a stub of the debug service: the kinds the workbench tests do not reach.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel, mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import {
    DataBreakpointSetType,
    DEBUG_SCHEME,
    type IBaseBreakpoint,
    type IDebugService,
    State,
} from "../common/debug.ts";
import { type DebugModel, Thread } from "../common/debugModel.ts";

import { BreakpointsView, getBreakpointIcon, type IBreakpointSources } from "./breakpointsView.ts";

const FILE = Uri.file("/w/main.cpp");

/** The adapter's word on a breakpoint in session `s` with the given capabilities. */
function verify(model: DebugModel, bp: IBaseBreakpoint, verified: boolean, capabilities = {}): void {
    model.setBreakpointSessionData("s", capabilities, new Map([[bp.getId(), { verified }]]));
}

describe("getBreakpointIcon", () => {
    it("a source breakpoint: plain, disabled, deactivated, unverified only while debugging", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);

        expect(getBreakpointIcon(State.Inactive, true, bp, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Inactive, false, bp, model)).toBe("debug-breakpoint-disabled");
        model.setEnablement(bp, false);
        expect(getBreakpointIcon(State.Inactive, true, bp, model)).toBe("debug-breakpoint-disabled");
        model.setEnablement(bp, true);

        verify(model, bp, false);
        expect(getBreakpointIcon(State.Inactive, true, bp, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Initializing, true, bp, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Running, true, bp, model)).toBe("debug-breakpoint-unverified");
        expect(getBreakpointIcon(State.Stopped, true, bp, model)).toBe("debug-breakpoint-unverified");
    });

    it("a condition, a hit count or a trigger makes it conditional; a log message a logpoint", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const [trigger] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        const [condition, hit, triggered, log] = model.addBreakpoints(FILE, [
            { lineNumber: 2, condition: "i > 3" },
            { lineNumber: 3, hitCondition: "5" },
            { lineNumber: 4, triggeredBy: trigger.getId() },
            { lineNumber: 5, logMessage: "i = {i}" },
        ]);
        const [orphan] = model.addBreakpoints(FILE, [{ lineNumber: 6, triggeredBy: "gone" }]);

        expect(getBreakpointIcon(State.Inactive, true, condition, model)).toBe("debug-breakpoint-conditional");
        expect(getBreakpointIcon(State.Inactive, true, hit, model)).toBe("debug-breakpoint-conditional");
        expect(getBreakpointIcon(State.Inactive, true, triggered, model)).toBe("debug-breakpoint-conditional");
        expect(getBreakpointIcon(State.Inactive, true, log, model)).toBe("debug-breakpoint-log");
        // A trigger that is no more: a plain breakpoint.
        expect(getBreakpointIcon(State.Inactive, true, orphan, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Inactive, false, log, model)).toBe("debug-breakpoint-log-disabled");
        verify(model, log, false);
        expect(getBreakpointIcon(State.Stopped, true, log, model)).toBe("debug-breakpoint-log-unverified");
    });

    it("a feature the adapter lacks: unsupported; a triggered breakpoint not sent yet: pending", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const [trigger] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        const [condition, log, triggered] = model.addBreakpoints(FILE, [
            { lineNumber: 2, condition: "i > 3" },
            { lineNumber: 3, logMessage: "i = {i}" },
            { lineNumber: 4, triggeredBy: trigger.getId() },
        ]);
        verify(model, condition, true);
        verify(model, log, true, { supportsLogPoints: true });

        expect(getBreakpointIcon(State.Stopped, true, condition, model)).toBe("debug-breakpoint-unsupported");
        expect(getBreakpointIcon(State.Stopped, true, log, model)).toBe("debug-breakpoint-log");
        expect(getBreakpointIcon(State.Stopped, true, triggered, model)).toBe("debug-breakpoint-pending");
        expect(getBreakpointIcon(State.Inactive, true, triggered, model)).toBe("debug-breakpoint-conditional");
    });

    it("function, data and instruction breakpoints: their own icons, unverified where the adapter lacks them", () => {
        const model = createMockDebugModel({ add: (o) => o });
        const fn = model.addFunctionBreakpoint({ name: "main" });
        model.addDataBreakpoint({
            description: "sum",
            src: { type: DataBreakpointSetType.Variable, dataId: "sum" },
            canPersist: true,
            accessTypes: undefined,
            accessType: "write",
            // A log message does not make a data breakpoint a logpoint.
            logMessage: "x",
        });
        const data = model.getDataBreakpoints()[0];
        model.addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: true, address: 16n });
        const instruction = model.getInstructionBreakpoints()[0];

        expect(getBreakpointIcon(State.Inactive, true, fn, model)).toBe("debug-breakpoint-function");
        expect(getBreakpointIcon(State.Inactive, true, data, model)).toBe("debug-breakpoint-data");
        expect(getBreakpointIcon(State.Inactive, true, instruction, model)).toBe("debug-breakpoint");
        expect(getBreakpointIcon(State.Inactive, false, fn, model)).toBe("debug-breakpoint-function-disabled");
        expect(getBreakpointIcon(State.Inactive, false, data, model)).toBe("debug-breakpoint-data-disabled");

        for (const bp of [fn, data, instruction]) verify(model, bp, true);
        expect(getBreakpointIcon(State.Stopped, true, fn, model)).toBe("debug-breakpoint-function-unverified");
        expect(getBreakpointIcon(State.Stopped, true, data, model)).toBe("debug-breakpoint-data-unverified");
        expect(getBreakpointIcon(State.Stopped, true, instruction, model)).toBe("debug-breakpoint-unverified");

        const supported = {
            supportsFunctionBreakpoints: true,
            supportsDataBreakpoints: true,
            supportsInstructionBreakpoints: true,
        };
        for (const bp of [fn, data, instruction]) verify(model, bp, true, supported);
        expect(getBreakpointIcon(State.Stopped, true, fn, model)).toBe("debug-breakpoint-function");
        expect(getBreakpointIcon(State.Stopped, true, data, model)).toBe("debug-breakpoint-data");
        expect(getBreakpointIcon(State.Stopped, true, instruction, model)).toBe("debug-breakpoint");
    });
});

describe("BreakpointsView", () => {
    const disposables = new DisposableStore();
    let model: DebugModel;
    let service: ReturnType<typeof testDebugService>;
    let state: State;
    let onDidChangeState: Emitter<State>;
    let presentation: "tree" | "list";
    let sources: IBreakpointSources & { lines: Map<string, readonly string[]> };
    let view: BreakpointsView;
    let app: TestApp;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
        service = testDebugService(model);
        state = State.Inactive;
        onDidChangeState = disposables.add(new Emitter<State>());
        presentation = "list";
        const lines = new Map<string, readonly string[]>();
        sources = {
            lines,
            uriLabel: (uri) => uri.path.slice(1),
            readLines: (uri) => {
                const read = lines.get(uri.toString());
                return read ? Promise.resolve(read) : Promise.reject(new Error("unreadable"));
            },
            openBreakpoint: vi.fn().mockResolvedValue(undefined),
        };
    });

    afterEach(() => {
        disposables.clear();
        service.viewModel.dispose();
    });

    async function mount(): Promise<void> {
        const debugService = { ...service, onDidChangeState: onDidChangeState.event } as IDebugService;
        Object.defineProperty(debugService, "state", { get: () => state });
        const icons = new StaticProductIconService(false);
        view = disposables.add(new BreakpointsView(debugService, sources, { icons, presentation: () => presentation }));
        app = TestApp.createWithContent(view.tree.element, new Size(70, 14));
        bindWidgetGlyphs(app.root, icons);
        view.focus();
        await settle();
    }

    async function settle(): Promise<void> {
        await flushMicrotasks(20);
    }

    function lines(): string[] {
        app.render();
        return app.backend.screenToString().split("\n");
    }

    function row(text: string): string {
        const found = lines().find((line) => line.includes(text));
        expect(found, `a row with "${text}"`).toBeDefined();
        return (found ?? "").trimEnd();
    }

    function fgOf(text: string): unknown {
        const all = lines();
        const y = all.findIndex((line) => line.includes(text));
        return app.backend.getFgAt(new Point(all[y].indexOf(text), y));
    }

    function addData(description: string, accessType: "read" | "write" | "readWrite", options = {}): void {
        model.addDataBreakpoint({
            description,
            src: { type: DataBreakpointSetType.Variable, dataId: description },
            canPersist: false,
            accessTypes: undefined,
            accessType,
            ...options,
        });
    }

    function exceptionFilters(): void {
        model.setExceptionBreakpointsForSession("s", [
            { filter: "uncaught", label: "" },
            { filter: "all", label: "All Exceptions" },
        ]);
        service.viewModel.setFocus(undefined, undefined, mockSession({ getId: () => "s", capabilities: {} }), false);
    }

    it("data, instruction and exception rows; a condition with a hit count; a column and a mode on the right", async () => {
        addData("sum", "read", { condition: "sum > 1", hitCondition: "3" });
        addData("count", "write", { hitCondition: "5" });
        addData("total", "readWrite");
        model.addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: false, address: 31n });
        model.addFunctionBreakpoint({ name: "main", condition: "argc > 1" });
        model.addBreakpoints(Uri.file("/w/a.c"), [
            { lineNumber: 4, column: 7 },
            { lineNumber: 9, mode: "hw", modeLabel: "Hardware" },
        ]);
        exceptionFilters();
        // The adapter took one filter: the other stays muted.
        const [uncaught] = model.getExceptionBreakpoints();
        model.setBreakpointSessionData("s", {}, new Map([[uncaught.getId(), { verified: true }]]));
        await mount();

        expect(fgOf("uncaught")).not.toBe(fgOf("All Exceptions"));
        expect(row("uncaught")).toMatch(/\[ \] uncaught exceptions$/u);
        expect(row("sum")).toMatch(/sum {2}Read {2}Condition: sum > 1 \| Hit Count: 3$/u);
        expect(row("count")).toMatch(/count {2}Write {2}5$/u);
        expect(row("total")).toMatch(/total {2}Access$/u);
        expect(row("0x1f")).toMatch(/\[✓\] . 0x1f$/u);
        expect(row("main")).toMatch(/main {2}argc > 1$/u);
        expect(row("a.c w")).toMatch(/a\.c w +4:7$/u);
        expect(row("Hardware")).toMatch(/a\.c w +Hardware: 9$/u);
    });

    it("typing goes to the row by its label, of every kind", async () => {
        addData("sum", "read");
        model.addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: false, address: 31n });
        exceptionFilters();
        vi.useFakeTimers();
        try {
            await mount();
            // Each key alone: the list forgets the typed prefix after a pause.
            const typed = (key: string): unknown => {
                vi.advanceTimersByTime(2000);
                app.sendKey(key);
                return view.tree.focused;
            };
            expect(typed("A")).toBe(model.getExceptionBreakpoints()[1]);
            expect(typed("u")).toBe(model.getExceptionBreakpoints()[0]);
            expect(typed("s")).toBe(model.getDataBreakpoints()[0]);
            expect(typed("0")).toBe(model.getInstructionBreakpoints()[0]);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a data breakpoint is muted where the focused session cannot set one", async () => {
        addData("sum", "read");
        await mount();
        const plain = fgOf("sum");

        service.viewModel.setFocus(
            undefined,
            undefined,
            mockSession({ getId: () => "s", capabilities: { supportsDataBreakpoints: false } }),
            false,
        );
        await settle();

        expect(fgOf("sum")).not.toBe(plain);
    });

    it("the tree presentation: the source line, an empty one, an unreadable file; the folder checkbox", async () => {
        presentation = "tree";
        const file = Uri.file("/w/a.c");
        sources.lines.set(file.toString(), ["int x;", "   ", "return 0;"]);
        model.addBreakpoints(file, [{ lineNumber: 1 }, { lineNumber: 2 }]);
        model.addBreakpoints(Uri.file("/w/gone.c"), [{ lineNumber: 1 }]);
        await mount();
        await settle();

        expect(row("int x;").length).toBeGreaterThan(0);
        expect(row("(empty line)").length).toBeGreaterThan(0);
        expect(row("(cannot load line)").length).toBeGreaterThan(0);

        // The cursor on a file row: no breakpoint is under it.
        view.tree.list.focusFirst();
        expect(view.focusedBreakpoint).toBeUndefined();

        // All enabled: the click disables them.
        const all = lines();
        const y = all.findIndex((line) => line.includes("[✓] a.c"));
        for (const action of ["press", "release"] as const) {
            app.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: all[y].indexOf("[✓]") + 2,
                y: y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
        expect(vi.mocked(service.enableOrDisableBreakpoints).mock.calls.map((call) => call[0])).toEqual([false, false]);

        // Deactivated: the file name is muted too.
        const active = fgOf("a.c");
        model.setBreakpointsActivated(false);
        view.tree.rerender();
        expect(fgOf("a.c")).not.toBe(active);
    });

    it("Enter opens a source breakpoint, not another kind; a source of the adapter only while debugging", async () => {
        const fn = model.addFunctionBreakpoint({ name: "main" });
        const [adapterSource] = model.addBreakpoints(Uri.from({ scheme: DEBUG_SCHEME, path: "/eval.js" }), [
            { lineNumber: 1 },
        ]);
        await mount();

        view.tree.onActivate(fn);
        view.tree.onActivate(adapterSource);
        await settle();
        expect(sources.openBreakpoint).not.toHaveBeenCalled();

        state = State.Stopped;
        view.tree.onActivate(adapterSource);
        await settle();
        expect(sources.openBreakpoint).toHaveBeenCalledWith(adapterSource, false);
    });

    it("a stop at a breakpoint puts the cursor on it; going on takes it away unless the user moved it", async () => {
        const [first, second] = model.addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 1 }, { lineNumber: 2 }]);
        model.setBreakpointSessionData("s", {}, new Map([[second.getId(), { verified: true, id: 7 }]]));
        await mount();
        const session = mockSession({ getId: () => "s", capabilities: {} });
        const thread = new Thread(session, "main", 1);
        thread.stoppedDetails = { reason: "breakpoint", hitBreakpointIds: [7] };
        const stopAt = (): void => {
            service.viewModel.setFocus(undefined, thread, session, false);
            state = State.Stopped;
            onDidChangeState.fire(state);
        };
        const goOn = (): void => {
            service.viewModel.setFocus(undefined, undefined, undefined, false);
            state = State.Running;
            onDidChangeState.fire(state);
        };

        stopAt();
        expect(view.tree.focused).toBe(second);
        goOn();
        expect(view.tree.focused).toBeUndefined();

        stopAt();
        view.tree.reveal(first);
        goOn();
        expect(view.tree.focused).toBe(first);
    });
});
