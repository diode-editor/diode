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
            openSource: vi.fn().mockResolvedValue(undefined),
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
        // The adapter refused one filter: it is muted; the other (no word yet) is not.
        const all = model.getExceptionBreakpoints()[1];
        model.setBreakpointSessionData("s", {}, new Map([[all.getId(), { verified: false }]]));
        await mount();
        // The cursor sits on the first row: compare rows below it.
        view.tree.reveal(model.getFunctionBreakpoints()[0]);

        // The access of a data breakpoint is always muted.
        const muted = fgOf("Read");
        expect(fgOf("All Exceptions")).toBe(muted);
        expect(fgOf("uncaught")).not.toBe(muted);
        expect(row("uncaught")).toMatch(/\[ \] uncaught exceptions$/u);
        expect(row("sum")).toMatch(/sum {2}Read {2}Condition: sum > 1 \| Hit Count: 3$/u);
        expect(row("count")).toMatch(/count {2}Write {2}5$/u);
        expect(row("total")).toMatch(/total {2}Access$/u);
        expect(row("0x1f")).toMatch(/\[✓\] . 0x1f$/u);
        expect(row("main")).toMatch(/main {2}argc > 1$/u);
        expect(row("a.c w")).toMatch(/a\.c w +4:7$/u);
        expect(row("Hardware")).toMatch(/a\.c w +Hardware: 9$/u);
    });

    it("a source breakpoint's row tells its condition, hit count, log message and the breakpoint it waits for", async () => {
        const [trigger] = model.addBreakpoints(Uri.file("/w/t.c"), [{ lineNumber: 2 }]);
        model.addBreakpoints(Uri.file("/w/a.c"), [
            { lineNumber: 4, condition: "i % 100 == 0", hitCondition: ">= 3" },
            { lineNumber: 5, logMessage: "sum={sum}" },
            { lineNumber: 6, triggeredBy: trigger.getId() },
            { lineNumber: 7, condition: "" },
        ]);
        await mount();

        expect(row("4")).toMatch(/a\.c w {2}if i % 100 == 0 {2}hit count >= 3 +4$/u);
        expect(row("5")).toMatch(/a\.c w {2}log "sum=\{sum\}" +5$/u);
        expect(row(" 6")).toMatch(/a\.c w {2}after w\/t\.c: 2 +6$/u);
        // An empty condition is none.
        expect(row(" 7")).toMatch(/a\.c w +7$/u);
    });

    it("upstream's message of a breakpoint the debugger does not support, in the warning color", async () => {
        const [conditional, plain] = model.addBreakpoints(Uri.file("/w/a.c"), [
            { lineNumber: 4, condition: "x" },
            { lineNumber: 5 },
        ]);
        const disabled = model.addFunctionBreakpoint({ name: "off", enabled: false });
        model.addFunctionBreakpoint({ name: "main" });
        addData("sum", "write");
        model.addInstructionBreakpoint({ instructionReference: "0x10", offset: 0, canPersist: false, address: 31n });
        const all = [conditional, plain, disabled, ...model.getFunctionBreakpoints(), ...model.getDataBreakpoints()];
        model.setBreakpointSessionData(
            "s",
            {},
            new Map([...all, ...model.getInstructionBreakpoints()].map((bp) => [bp.getId(), { verified: true }])),
        );
        await mount();

        expect(row("4")).toContain("if x  Breakpoints of this type are not supported");
        expect(row(" 5")).not.toContain("supported");
        expect(row("main")).toContain("main  Function breakpoints not supported");
        expect(row("off")).not.toContain("supported");
        expect(row("sum")).toContain("Write  Data breakpoints not supported");
        expect(row("0x1f")).toContain("0x1f  Instruction breakpoints not supported");
        // Not in the muted color of the notes.
        expect(fgOf("Data breakpoints not")).not.toBe(fgOf("Write"));
    });

    it("no warning while a running session has not verified the breakpoint, nor with the breakpoints deactivated", async () => {
        const [conditional] = model.addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 4, condition: "x" }]);
        model.setBreakpointSessionData("s", {}, new Map([[conditional.getId(), { verified: false }]]));
        state = State.Running;
        await mount();
        expect(row("4")).not.toContain("supported");
        state = State.Stopped;
        view.refresh();
        await settle();
        expect(row("4")).not.toContain("supported");

        state = State.Inactive;
        model.setBreakpointsActivated(false);
        view.refresh();
        await settle();
        expect(row("4")).not.toContain("supported");
        model.setBreakpointsActivated(true);
        view.refresh();
        await settle();
        expect(row("4")).toContain("not supported");
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
        // The adapter names two hit ids; only 7 is a breakpoint of this view.
        thread.stoppedDetails = { reason: "breakpoint", hitBreakpointIds: [3, 7] };
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

    it("a stop without a hit breakpoint leaves the cursor where it is", async () => {
        const [first, second] = model.addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 1 }, { lineNumber: 2 }]);
        model.setBreakpointSessionData("s", {}, new Map([[first.getId(), { verified: true, id: 7 }]]));
        await mount();
        view.tree.reveal(second);
        const session = mockSession({ getId: () => "s", capabilities: {} });
        const thread = new Thread(session, "main", 1);

        // No details yet, then a stop on a step: no breakpoint was hit.
        service.viewModel.setFocus(undefined, thread, session, false);
        onDidChangeState.fire(State.Stopped);
        thread.stoppedDetails = { reason: "step" };
        onDidChangeState.fire(State.Stopped);

        expect(view.tree.focused).toBe(second);
    });

    it("a source breakpoint is muted while debugging until the adapter verifies it; the rows follow the state", async () => {
        const [plain, refused] = model.addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 1 }, { lineNumber: 2 }]);
        verify(model, refused, false);
        verify(model, plain, true);
        // The cursor on a row of its own, away from the compared ones.
        model.addFunctionBreakpoint({ name: "main" });
        await mount();
        // The folder beside the name is always muted.
        const muted = fgOf(" w ");
        const rowFg = (line: number): unknown => {
            const all = lines();
            const y = all.findIndex((text) => text.trimEnd().endsWith(` ${String(line)}`) && text.includes("a.c"));
            return app.backend.getFgAt(new Point(all[y].indexOf("a.c"), y));
        };

        for (const s of [State.Inactive, State.Initializing]) {
            state = s;
            onDidChangeState.fire(s);
            expect(rowFg(2)).not.toBe(muted);
        }
        for (const s of [State.Running, State.Stopped]) {
            state = s;
            onDidChangeState.fire(s);
            expect(rowFg(2)).toBe(muted);
            expect(rowFg(1)).not.toBe(muted);
        }
    });

    it("a function breakpoint is muted only where the focused session cannot set one", async () => {
        model.addFunctionBreakpoint({ name: "main" });
        addData("sum", "read");
        await mount();
        view.tree.reveal(model.getDataBreakpoints()[0]);
        const muted = fgOf("Read");
        const focus = (supportsFunctionBreakpoints?: boolean): void => {
            const capabilities = supportsFunctionBreakpoints === undefined ? {} : { supportsFunctionBreakpoints };
            service.viewModel.setFocus(undefined, undefined, mockSession({ getId: () => "s", capabilities }), false);
        };

        state = State.Running;
        onDidChangeState.fire(state);
        expect(fgOf("main")).not.toBe(muted);
        focus();
        await settle();
        expect(fgOf("main")).not.toBe(muted);
        focus(true);
        await settle();
        expect(fgOf("main")).not.toBe(muted);
        focus(false);
        await settle();
        expect(fgOf("main")).toBe(muted);
    });

    it("a data breakpoint with no session focused is not muted", async () => {
        addData("sum", "read");
        model.addFunctionBreakpoint({ name: "main" });
        await mount();
        view.tree.reveal(model.getFunctionBreakpoints()[0]);

        expect(fgOf("sum")).not.toBe(fgOf("Read"));
    });

    it("the file row's checkbox: all, some or none of its breakpoints; a click on some enables them all", async () => {
        presentation = "tree";
        const [one, two] = model.addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 1 }, { lineNumber: 2 }]);
        await mount();
        expect(row("a.c w")).toMatch(/\[✓\] a\.c w$/u);

        model.setEnablement(one, false);
        model.setEnablement(two, false);
        await settle();
        expect(row("a.c w")).toMatch(/\[ \] a\.c w$/u);

        model.setEnablement(two, true);
        await settle();
        expect(row("a.c w")).toMatch(/\[-\] a\.c w$/u);
        const all = lines();
        const y = all.findIndex((line) => line.includes("[-] a.c"));
        for (const action of ["press", "release"] as const) {
            app.backend.simulateMouse({
                kind: "mouse",
                button: "left",
                action,
                x: all[y].indexOf("[-]") + 2,
                y: y + 1,
                shiftKey: false,
                altKey: false,
                ctrlKey: false,
                raw: "",
            });
        }
        expect(vi.mocked(service.enableOrDisableBreakpoints).mock.calls).toEqual([
            [true, one],
            [true, two],
        ]);
    });

    it("the tree presentation: lines in order, the last line, past the end, a file read anew on a change", async () => {
        presentation = "tree";
        const file = Uri.file("/w/a.c");
        sources.lines.set(file.toString(), ["one", "two", "three"]);
        const [moved] = model.addBreakpoints(file, [{ lineNumber: 1 }, { lineNumber: 2 }, { lineNumber: 7 }]);
        // The adapter moves the first one past the second: the model keeps its order, the view sorts.
        model.setBreakpointSessionData("s", {}, new Map([[moved.getId(), { verified: true, line: 3 }]]));
        await mount();

        const breakpointRows = (): string[] =>
            lines().filter((line) => / \d+\s*$/u.test(line) && !line.includes("a.c"));
        expect(breakpointRows().map((line) => line.trim().split(/\s+/u).slice(-2).join(" "))).toEqual([
            "two 2",
            "three 3",
            "found) 7",
        ]);
        expect(row(" 7")).toContain("(line not found)");

        // A change in the model reads the file again.
        sources.lines.set(file.toString(), ["one", "TWO", "three"]);
        model.addFunctionBreakpoint({ name: "main" });
        await settle();
        expect(row(" 2")).toContain("TWO");
    });

    it("the tree presentation: the line reads Loading... until the file is read, which is read once", async () => {
        presentation = "tree";
        const file = Uri.file("/w/a.c");
        let resolve: (lines: readonly string[]) => void = () => undefined;
        sources.readLines = vi.fn(() => new Promise<readonly string[]>((done) => (resolve = done)));
        model.addBreakpoints(file, [{ lineNumber: 1 }]);
        await mount();
        expect(row(" 1")).toContain("Loading...");
        view.tree.rerender();
        expect(row(" 1")).toContain("Loading...");
        expect(sources.readLines).toHaveBeenCalledTimes(1);

        resolve(["int x;"]);
        await settle();
        expect(row(" 1")).toContain("int x;");
    });

    it("the tree presentation: Left on a file row folds its breakpoints", async () => {
        presentation = "tree";
        sources.lines.set(Uri.file("/w/a.c").toString(), ["int x;"]);
        model.addBreakpoints(Uri.file("/w/a.c"), [{ lineNumber: 1 }]);
        await mount();
        view.tree.list.focusFirst();
        expect(row("int x;").length).toBeGreaterThan(0);

        app.sendKey("ArrowLeft");
        await settle();
        expect(lines().some((line) => line.includes("int x;"))).toBe(false);
    });

    it("typing goes to a source breakpoint by its file name", async () => {
        model.addFunctionBreakpoint({ name: "main" });
        const [bp] = model.addBreakpoints(Uri.file("/w/zed.c"), [{ lineNumber: 3 }]);
        await mount();

        app.sendKey("z");
        expect(view.tree.focused).toBe(bp);
    });
});
