// The Debug Console view on its own, over a debug service with the synthetic debugger: which session's console it
// shows (upstream `selectSession`), the rows of groups and nameless objects, the input's hint and keys.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { TestApp as TuidomTestApp } from "@tuidom/testing/TestApp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { TestVariable } from "../../../../../TestUtils/debugViewsFixture.ts";
import { mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import type { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { IViewContainerDescriptor, IViewDescriptor } from "../../../browser/parts/views/viewsService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { DEBUG_PANEL_ID, type IDebugSession, REPL_VIEW_ID, State } from "../common/debug.ts";

import { Repl, START_DEBUG_FIRST } from "./repl.ts";

const PROMPT_COLOR = 0xff0000;

describe("Repl", () => {
    let fx: IDebugServiceFixture;
    let factory: SyntheticDebugAdapterFactory;
    let containers: IViewContainerDescriptor[];
    let views: IViewDescriptor[];
    let glyphs: string;
    const iconsChanged = new Emitter<void>();
    const viewShown = new Emitter<string>();
    let shown: boolean;
    let repl: Repl;
    let app: TestApp;
    let showVariableTypes: boolean;
    /** What a keydown in the console left for the workbench: whether the console took it. */
    let prevented: Map<string, boolean>;
    const mocks: MockDebugAdapter[] = [];

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        containers = [];
        views = [];
        glyphs = ">";
        shown = true;
        showVariableTypes = false;
        prevented = new Map();
        const icons = { glyph: () => glyphs, onDidChange: iconsChanged.event } as unknown as IProductIconService;
        repl = new Repl(
            fx.service,
            {
                registerContainer: (descriptor: IViewContainerDescriptor) => containers.push(descriptor),
                registerView: (descriptor: IViewDescriptor) => views.push(descriptor),
                isViewShown: () => shown,
                onDidShowView: viewShown.event,
            } as never,
            {
                get: (key: string) => key === "debug.showVariableTypes" && showVariableTypes,
                onDidChangeConfiguration: () => ({ dispose: () => undefined }),
            } as never,
            icons,
            mockStateService(),
        );
        // The prompt's own color differs from the plain foreground it defaults to in the bundled themes.
        app = TuidomTestApp.createWithContent(repl.view, new Size(60, 12), {
            ...computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
            "debugConsoleInputIcon.foreground": PROMPT_COLOR,
        });
        repl.view.addEventListener("keydown", (event) => {
            prevented.set(event.key, event.defaultPrevented);
        });
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
        for (const adapter of mocks.splice(0)) adapter.dispose();
        repl.dispose();
        fx.service.dispose();
    });

    function screen(): string {
        app.render();
        return app.backend.screenToString();
    }

    async function start(name: string): Promise<IDebugSession> {
        expect(await fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name })).toBe(true);
        const session = fx.service
            .getModel()
            .getSessions()
            .find((s) => s.name === name);
        if (!session) throw new Error(`no session ${name}`);
        await vi.waitFor(() => {
            expect(session.state).toBe(State.Stopped);
        });
        return session;
    }

    async function shows(text: string): Promise<void> {
        await vi.waitFor(() => {
            expect(screen()).toContain(text);
        });
    }

    it("registers the DEBUG CONSOLE container of the panel after Output, its view focuses the input", () => {
        expect(containers).toEqual([
            { id: DEBUG_PANEL_ID, title: "DEBUG CONSOLE", label: "Debug Console", location: "panel", order: 1.5 },
        ]);
        expect(views).toHaveLength(1);
        expect(views[0]).toMatchObject({ id: REPL_VIEW_ID, containerId: DEBUG_PANEL_ID, title: "DEBUG CONSOLE" });
        expect(views[0].body).toBe(repl.view);

        views[0].focus();

        expect(repl.input.isFocused).toBe(true);
    });

    it("shows the focused session; an ended one stays until another starts", async () => {
        const first = await start("first");
        expect(repl.shownSession?.name).toBe("first");
        first.appendToRepl({ output: "from first\n", sev: "info" });
        await shows("from first");

        const second = await start("second");
        await fx.service.focusStackFrame(undefined, undefined, second, { explicit: true });
        await vi.waitFor(() => {
            expect(repl.shownSession?.name).toBe("second");
        });
        second.appendToRepl({ output: "from second\n", sev: "info" });
        await shows("from second");
        expect(screen()).not.toContain("from first");

        await fx.service.focusStackFrame(undefined, undefined, first, { explicit: true });
        await shows("from first");

        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(fx.service.getModel().getSessions()).toHaveLength(0);
        });
        // Nothing is focused: the console shown last stays.
        expect(repl.shownSession).toBeDefined();
    });

    /** A session of an adapter that launches and never stops: nothing focuses it. */
    async function startRunning(name: string): Promise<IDebugSession> {
        if (!fx.service.getAdapterManager().getDebugger("mock")) {
            fx.service.getAdapterManager().registerDebugger({ type: "mock" });
            fx.service.getAdapterManager().registerDebugAdapterFactory(["mock"], {
                createDebugAdapter: () => {
                    const adapter = new MockDebugAdapter();
                    mocks.push(adapter);
                    return adapter;
                },
                substituteVariables: (_folder, config) => Promise.resolve(config),
            });
        }
        expect(await fx.service.startDebugging(undefined, { type: "mock", request: "launch", name })).toBe(true);
        const session = fx.service
            .getModel()
            .getSessions()
            .find((s) => s.name === name);
        if (!session) throw new Error(`no session ${name}`);
        return session;
    }

    it("a starting session takes over only an empty or ended console, as it is announced", async () => {
        // Registered after the console's own listener: it sees what the console did, before any focus change.
        const shownOnStart: (string | undefined)[] = [];
        fx.service.onWillNewSession(() => shownOnStart.push(repl.shownSession?.name));

        await startRunning("first");
        // The first one runs: the console stays on it.
        await startRunning("second");
        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(fx.service.getModel().getSessions()).toHaveLength(0);
        });
        await startRunning("third");

        expect(shownOnStart).toEqual(["first", "first", "third"]);
    });

    it("a new session takes over the console only from an ended one", async () => {
        const first = await start("first");
        await fx.service.stopSession(first);
        await vi.waitFor(() => {
            expect(first.state).toBe(State.Inactive);
        });

        const second = fx.service.startDebugging(undefined, { ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });
        // On `onWillNewSession`, before the launch is done: the output of the start is not missed.
        await vi.waitFor(() => {
            expect(repl.shownSession?.name).toBe("second");
        });
        expect(await second).toBe(true);
        await shows("Launching:");
    });

    it("output that comes while the console is hidden is drawn when it shows", async () => {
        const session = await start("s");
        await shows("Launching:");
        shown = false;

        session.appendToRepl({ output: "while hidden\n", sev: "info" });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(screen()).not.toContain("while hidden");

        shown = true;
        viewShown.fire("other.view");
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(screen()).not.toContain("while hidden");
        viewShown.fire(REPL_VIEW_ID);
        await shows("while hidden");
    });

    it("the input's prompt is drawn in its theme color", () => {
        const rows = screen().split("\n");
        const y = rows.length - 1;

        expect(rows[y].indexOf(">")).toBe(1);
        expect(app.backend.getFgAt(new Point(1, y))).toBe(PROMPT_COLOR);
    });

    it("the console registers its view movable, as upstream", () => {
        expect(views[0]).toMatchObject({ order: 10, canMoveView: true });
    });

    it("the input's hint comes back when the shown session ends while another one keeps the focus", async () => {
        const first = await start("first");
        const second = await start("second");
        await fx.service.focusStackFrame(undefined, undefined, second, { explicit: true });
        repl.selectSession(first);
        expect(repl.input.placeholder).toBeUndefined();

        await fx.service.stopSession(first);

        await vi.waitFor(() => {
            expect(first.state).toBe(State.Inactive);
        });
        expect(fx.service.getViewModel().focusedSession?.name).toBe("second");
        expect(repl.input.placeholder).toBe(START_DEBUG_FIRST);
    });

    it("the console takes Enter, Up, Down and Escape on a non-empty input; Escape on an empty one goes on", async () => {
        repl.focus();
        app.sendKey("Escape");
        expect(prevented.get("Escape")).toBe(false);
        app.sendKey("a");
        app.sendKey("Escape");
        expect(prevented.get("Escape")).toBe(true);
        expect(repl.input.inputState.value).toBe("");
        for (const key of ["ArrowUp", "ArrowDown", "Enter"]) {
            app.sendKey(key);
            expect(prevented.get(key), key).toBe(true);
        }
    });

    it("a focus change within the shown session keeps the user's scroll position", async () => {
        const session = await start("s");
        for (let i = 0; i < 40; i++) session.appendToRepl({ output: `line ${String(i)}\n`, sev: "info" });
        await shows("line 39");
        repl.tree.list.focus();
        app.sendKey("Home");
        expect(screen()).not.toContain("line 39");

        repl.selectSession(session);
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(screen()).not.toContain("line 39");
    });

    it("rows carry the console's id prefix", async () => {
        const session = await start("s");
        await shows("Launching:");
        repl.tree.list.focus();
        app.sendKey("Home");

        expect(String(repl.tree.list.getCursorElement()?.id)).toMatch(/^repl:/u);
        expect(session).toBeDefined();
    });

    it("new output is drawn after upstream's 50 ms; a cleared console at once", async () => {
        const session = await start("s");
        await shows("Launching:");
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        try {
            session.appendToRepl({ output: "late line\n", sev: "info" });
            await vi.advanceTimersByTimeAsync(40);
            expect(screen()).not.toContain("late line");
            // More output while a refresh is pending does not postpone it.
            session.appendToRepl({ output: "later line\n", sev: "info" });
            await vi.advanceTimersByTimeAsync(15);
            expect(screen()).toContain("later line");

            session.removeReplExpressions();
            await vi.advanceTimersByTimeAsync(1);
            expect(screen()).not.toContain("late line");
        } finally {
            vi.useRealTimers();
        }
    });

    it("clearing an ended session's console hides that session", async () => {
        const first = await start("first");
        first.appendToRepl({ output: "old line\n", sev: "info" });
        await shows("old line");
        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(first.state).toBe(State.Inactive);
        });

        repl.clearRepl();

        await vi.waitFor(() => {
            expect(screen()).not.toContain("old line");
        });
        expect(first.getReplElements()).toHaveLength(0);
        expect(repl.input.isFocused).toBe(true);
    });

    it("clearing an ended console moves on to another ended session that is not cleared", async () => {
        const first = await start("first");
        const second = await start("second");
        await fx.service.focusStackFrame(undefined, undefined, second, { explicit: true });
        await vi.waitFor(() => {
            expect(repl.shownSession?.name).toBe("second");
        });
        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(first.state).toBe(State.Inactive);
            expect(second.state).toBe(State.Inactive);
        });

        repl.clearRepl();

        expect(repl.shownSession?.name).toBe("first");
    });

    it("clearing an ended console that is shown beside a focused session goes to the focused one", async () => {
        const first = await start("first");
        const second = await start("second");
        await fx.service.focusStackFrame(undefined, undefined, second, { explicit: true });
        repl.selectSession(first);
        await fx.service.stopSession(first);
        await vi.waitFor(() => {
            expect(first.state).toBe(State.Inactive);
        });
        expect(repl.shownSession?.name).toBe("first");

        repl.clearRepl();

        expect(repl.shownSession?.name).toBe("second");
    });

    it("a lazy variable evaluated elsewhere opens in the console; another container is left alone", async () => {
        const expand = vi.spyOn(repl.tree, "expand");
        const lazy = new TestVariable("getter", "(...)", [new TestVariable("x", "1")], { lazy: { value: "{x=1}" } });

        await fx.service.getViewModel().evaluateLazyExpression(lazy);
        await fx.service.getViewModel().evaluateLazyExpression({ evaluateLazy: () => Promise.resolve() } as never);

        expect(expand.mock.calls).toEqual([[lazy]]);
    });

    it("a changed child value is highlighted, then the rows are painted again", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
        try {
            const session = await start("s");
            const child = new TestVariable("x", "2");
            child.valueChanged = true;
            session.appendToRepl({
                output: "",
                expression: new TestVariable("p", "{x=2}", [child]),
                sev: "info",
            });
            await shows("{x=2}");
            repl.tree.list.focus();
            app.sendKey("End");
            app.sendKey("ArrowRight");
            await shows("x: 2");
            const rerender = vi.spyOn(repl.tree, "rerender");

            await vi.advanceTimersByTimeAsync(1100);

            expect(rerender).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });

    it("debug.showVariableTypes shows the types of an object's children", async () => {
        showVariableTypes = true;
        const session = await start("s");
        session.appendToRepl({
            output: "",
            expression: new TestVariable("p", "{x=1}", [new TestVariable("x", "1", [], { type: "int" })]),
            sev: "info",
        });
        await shows("{x=1}");
        repl.tree.list.focus();
        app.sendKey("End");
        app.sendKey("ArrowRight");

        await shows("x: int = 1");
    });

    it("an object logged with a source shows no source: only output lines and groups have one", async () => {
        const session = await start("s");
        const source = session.getSource({ name: "obj.cpp", path: "/w/obj.cpp" });
        session.appendToRepl({
            output: "",
            expression: new TestVariable("p", "{y=2}"),
            sev: "info",
            source: { lineNumber: 9, column: 1, source },
        });

        await shows("{y=2}");
        expect(screen()).not.toContain("obj.cpp");
    });

    it("an output element with several lines (collapsing off) keeps its inner line break", async () => {
        await fx.configuration.updateValue("debug.console.collapseIdenticalLines", false);
        const session = await start("s");
        session.appendToRepl({ output: "alpha\nbeta\n", sev: "info" });

        session.appendToRepl({ output: "gamma\r\n", sev: "info" });

        await shows("alpha beta");
        expect(
            screen()
                .split("\n")
                .some((row) => row.trimEnd() === " gamma"),
        ).toBe(true);
    });

    it("a group shows its name and its children when it opens expanded; a collapsed one has its chevron", async () => {
        const session = await start("s");
        session.appendToRepl({ output: "", sev: "info" });
        const raw = session as unknown as {
            repl: {
                startGroup(s: IDebugSession, name: string, expand: boolean): void;
                endGroup(): void;
            };
        };
        raw.repl.startGroup(session, "open group", true);
        session.appendToRepl({ output: "inside\n", sev: "info" });
        raw.repl.endGroup();
        raw.repl.startGroup(session, "closed group", false);
        session.appendToRepl({ output: "hidden\n", sev: "info" });
        raw.repl.endGroup();

        await shows("closed group");
        const text = screen();
        expect(text).toContain("open group");
        expect(text).toContain("inside");
        expect(text).not.toContain("hidden");
    });

    it("objects of one output without names show their values; a line's own line break is not drawn", async () => {
        const session = await start("s");
        const nameless = new TestVariable("", "[1, 2]");
        session.appendToRepl({ output: "", expression: nameless, sev: "info" });
        session.appendToRepl({ output: "with output\n", expression: new TestVariable("p", "{x=1}"), sev: "info" });

        await shows("with output");
        const rows = screen().split("\n");
        expect(rows.some((row) => row.trim() === "[1, 2]")).toBe(true);
        // The output text wins over the object's value.
        expect(screen()).not.toContain("{x=1}");
    });

    it("the input: Enter on an empty input or with a modifier evaluates nothing", async () => {
        const session = await start("s");
        const before = session.getReplElements().length;
        repl.focus();

        app.sendKey("Enter");
        app.sendKey(" ");
        app.sendKey("Enter");
        app.sendKey("x");
        app.sendKey("Shift+Enter");
        app.sendKey("Ctrl+ArrowUp");
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(session.getReplElements()).toHaveLength(before);
        expect(repl.input.inputState.value).toBe(" x");
    });

    it("without a session Clear Console takes away the answers given to the input", async () => {
        repl.focus();
        app.sendKey("a");
        app.sendKey("Enter");
        await shows("> a");

        repl.clearRepl();

        await vi.waitFor(() => {
            expect(screen()).not.toContain("> a");
        });
    });

    it("a source given as a path shows its file name", async () => {
        const session = await start("s");
        const source = session.getSource({ name: "C:\\work\\src/main.cpp", path: "/w/main.cpp" });
        session.appendToRepl({ output: "with path\n", sev: "info", source: { lineNumber: 4, column: 1, source } });

        await shows("main.cpp:4");
        expect(screen()).not.toContain("work");
        expect(screen()).not.toContain("src/");
    });

    it("the input's hint follows the shown session's state", async () => {
        expect(repl.input.placeholder).toBe(START_DEBUG_FIRST);
        await start("s");
        expect(repl.input.placeholder).toBeUndefined();
    });

    it("inDebugRepl holds while the focus is inside the console", () => {
        const contextKeys = new ContextKeyService();

        repl.updateContextKeys(contextKeys, repl.input);
        expect(contextKeys.getRaw("inDebugRepl")).toBe(true);
        repl.updateContextKeys(contextKeys, null);
        expect(contextKeys.getRaw("inDebugRepl")).toBe(false);
    });

    it("a change of the glyphs repaints the prompt and the echo", async () => {
        repl.focus();
        app.sendKey("a");
        app.sendKey("Enter");
        await shows("> a");

        glyphs = "»";
        iconsChanged.fire();

        await shows("» a");
        expect(screen().split("\n").at(-1)?.startsWith(` » ${START_DEBUG_FIRST}`)).toBe(true);
    });
});
