// The Debug Console view on its own, over a debug service with the synthetic debugger: which session's console it
// shows (upstream `selectSession`), the rows of groups and nameless objects, the input's hint and keys.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { VFlexElement, vflexFill, vflexFixed } from "@tuidom/elements/layout/vFlexElement";
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
import type { Uri } from "../../../../base/common/uri.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { computeThemeVars } from "../../../../platform/theme/browser/themeStyleVars.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import type { IViewContainerDescriptor, IViewDescriptor } from "../../../browser/parts/views/viewsService.ts";
import { darkPlusTheme } from "../../../services/themes/common/themes/darkPlus.ts";
import { DEBUG_PANEL_ID, type IDebugSession, REPL_VIEW_ID, State } from "../common/debug.ts";

import { LinkDetector } from "./linkDetector.ts";
import { FILTER_PLACEHOLDER, Repl, START_DEBUG_FIRST } from "./repl.ts";

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
    let settings: Record<string, unknown>;
    const configurationChanged = new Emitter<{ affectsConfiguration(key: string): boolean }>();
    let titleWidget: TUIElement | null;
    /** What links opened: a URL, or `path@line:col` of a file. */
    let opened: string[];
    let activeUri: Uri | undefined;
    let state: ReturnType<typeof mockStateService>;

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
        settings = {
            "debug.console.wordWrap": false,
            "debug.console.historySuggestions": true,
            "debug.console.acceptSuggestionOnEnter": "off",
        };
        titleWidget = null;
        opened = [];
        state = mockStateService();
        const links = new LinkDetector(
            {
                stat: (uri: Uri) =>
                    uri.fsPath === "/src/app.ts"
                        ? Promise.resolve({ isDirectory: false })
                        : Promise.reject(new Error("missing")),
            } as never,
            {
                editorGroups: { activeGroup: { findPaneIndex: () => -1 }, groups: [] },
                openUri: (uri: Uri) => {
                    activeUri = uri;
                },
                getActiveEditor: () => ({
                    uri: activeUri,
                    goToPosition: (line: number, column: number) =>
                        opened.push(`${activeUri?.fsPath ?? ""}@${String(line)}:${String(column)}`),
                }),
            } as never,
            { jumpAsync: async (run: () => Promise<void>) => run() } as never,
            { open: (url: string) => Promise.resolve(opened.push(url) > 0) },
            { userHome: "/home/u" },
        );
        repl = new Repl(
            fx.service,
            {
                registerContainer: (descriptor: IViewContainerDescriptor) => containers.push(descriptor),
                registerView: (descriptor: IViewDescriptor) => views.push(descriptor),
                setViewTitleWidget: (_id: string, widget: TUIElement | null) => {
                    titleWidget = widget;
                },
                isViewShown: () => shown,
                onDidShowView: viewShown.event,
            } as never,
            {
                get: (key: string) => (key === "debug.showVariableTypes" ? showVariableTypes : settings[key]),
                onDidChangeConfiguration: configurationChanged.event,
            } as never,
            icons,
            state,
            // The console's menu is tested in the workbench (repl.app.test.ts).
            {} as never,
            {} as never,
            {} as never,
            links,
            {
                get mainContainer() {
                    return app.root;
                },
            },
        );
        // The prompt's own color differs from the plain foreground it defaults to in the bundled themes.
        // The view's title row with the filter over the body, as the panel shows them.
        const panel = new VFlexElement();
        // The constructor set it: the console puts its filter in the title.
        panel.addChild(titleWidget as unknown as TUIElement, { height: vflexFixed(1), width: "fill" });
        panel.addChild(repl.view, { height: vflexFill(), width: "fill" });
        app = TuidomTestApp.createWithContent(panel, new Size(60, 12), {
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

    it("switching to another session's console shows its tail, whatever the scroll of the one before", async () => {
        const first = await start("first");
        const second = await start("second");
        for (let i = 0; i < 40; i++) {
            first.appendToRepl({ output: `first ${String(i)}\n`, sev: "info" });
            second.appendToRepl({ output: `second ${String(i)}\n`, sev: "info" });
        }
        await fx.service.focusStackFrame(undefined, undefined, first, { explicit: true });
        await shows("first 39");
        repl.tree.list.focus();
        app.sendKey("Home");
        expect(screen()).not.toContain("first 39");
        // The user picks the other session elsewhere (the call stack): the console's list no longer has the focus.
        repl.focus();

        await fx.service.focusStackFrame(undefined, undefined, second, { explicit: true });

        await shows("second 39");
    });

    it("clearing a running console keeps it: it is not dropped once it ends", async () => {
        const earlier = await start("earlier");
        await fx.service.stopSession(earlier);
        await vi.waitFor(() => {
            expect(earlier.state).toBe(State.Inactive);
        });
        const running = await start("running");
        await vi.waitFor(() => {
            expect(repl.shownSession?.name).toBe("running");
        });

        repl.clearRepl();
        await fx.service.stopSession(running);
        await vi.waitFor(() => {
            expect(running.state).toBe(State.Inactive);
        });

        expect(repl.shownSession?.name).toBe("running");
    });

    it("Enter on an ended session's console answers with the hint, without asking the adapter", async () => {
        const session = await start("s");
        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(session.state).toBe(State.Inactive);
        });
        repl.focus();
        app.sendKey("x");
        app.sendKey("Enter");

        await shows("> x");
        const rows = screen().split("\n");
        const echo = rows.findIndex((row) => row.includes("> x"));
        expect(rows[echo + 1]).toContain(START_DEBUG_FIRST.slice(0, 30));
    });

    it("Evaluate in Debug Console's input is evaluated in the shown session and joins the history; not in an ended one", async () => {
        const session = await start("s");
        repl.sendReplInput("sum");
        await shows("> sum");
        await vi.waitFor(() => {
            expect(session.getReplElements().map((e) => e.toString())).toContain("sum");
        });
        repl.focus();
        app.sendKey("ArrowUp");
        expect(repl.input.inputState.value).toBe("sum");
        app.sendKey("Escape");

        await fx.service.stopSession(undefined);
        await vi.waitFor(() => {
            expect(session.state).toBe(State.Inactive);
        });
        const before = session.getReplElements().length;
        repl.sendReplInput("count");
        expect(session.getReplElements()).toHaveLength(before);
    });

    it("a refresh leaves nothing pending: showing the console or waiting does not read it again", async () => {
        const session = await start("s");
        await shows("Launching:");
        await new Promise((resolve) => setTimeout(resolve, 100));
        const refresh = vi.spyOn(repl.tree, "refresh");

        viewShown.fire(REPL_VIEW_ID);
        session.appendToRepl({ output: "pending\n", sev: "info" });
        // An immediate refresh takes over the pending one.
        repl.clearRepl();
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(refresh).toHaveBeenCalledTimes(1);
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

    it("the input: Enter on an empty input or with Ctrl evaluates nothing; Shift+Enter breaks the line", async () => {
        const session = await start("s");
        const before = session.getReplElements().length;
        repl.focus();

        app.sendKey("Enter");
        app.sendKey(" ");
        app.sendKey("Enter");
        app.sendKey("x");
        app.sendKey("Shift+Enter");
        app.sendKey("Ctrl+Enter");
        app.sendKey("Ctrl+ArrowUp");
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(session.getReplElements()).toHaveLength(before);
        expect(repl.input.inputState.value).toBe(" x\n");
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
        expect(screen()).not.toContain("src/main.cpp:4");
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

    describe("output, filter and completion (#1150)", () => {
        const themeVars = computeThemeVars(WorkbenchTheme.fromThemeFile(darkPlusTheme));

        /** A row with only `text` on it, and the scroll bar's thumb or track in its column if the console overflows. */
        function aloneOnRow(text: string): RegExp {
            return new RegExp(`^\\s+${text}\\s*[█░▀▄]?\\s*$`, "u");
        }

        /** The cell of the first `text` on the screen. */
        function cellOf(text: string): Point {
            const rows = screen().split("\n");
            const y = rows.findIndex((row) => row.includes(text));
            if (y === -1) throw new Error(`no ${text} on the screen`);
            return new Point(rows[y].indexOf(text), y);
        }

        function clickAt({ x, y }: Point): void {
            for (const action of ["press", "release"] as const) {
                app.backend.simulateMouse({
                    kind: "mouse",
                    button: "left",
                    x: x + 1,
                    y: y + 1,
                    action,
                    shiftKey: false,
                    altKey: false,
                    ctrlKey: false,
                    raw: "",
                });
            }
        }

        function type(text: string): void {
            for (const char of text) app.sendKey(char);
        }

        it("output is drawn in its ANSI colors and styles, over the severity's color", async () => {
            const linkify = vi.spyOn(LinkDetector.prototype, "linkify");
            await start("s");
            await shows("PASS self-check 3/3");
            // The bold of `3/3` reaches the row's pieces, over the plain severity.
            const pieces = linkify.mock.calls.flatMap(([spans]) => spans);
            expect(pieces.find((piece) => piece.text === "3/3")?.style).toBe(StyleFlags.Bold);
            const pass = cellOf("PASS");
            expect(app.backend.getFgAt(pass)).toBe(themeVars["terminal.ansiGreen"]);
            expect(app.backend.getFgAt(cellOf("3/3"))).toBe(themeVars["terminal.ansiYellow"]);
            expect(app.backend.getFgAt(cellOf("self-check"))).toBe(app.backend.getFgAt(cellOf("Hello")));

            const session = repl.shownSession;
            session?.appendToRepl({ output: "plain \u001b[34mblue\u001b[0m\n", sev: "error" });
            await shows("plain blue");
            expect(app.backend.getFgAt(cellOf("plain"))).toBe(themeVars["debugConsole.errorForeground"]);
            expect(app.backend.getFgAt(cellOf("blue"))).toBe(themeVars["terminal.ansiBlue"]);
        });

        it("a long line wraps with debug.console.wordWrap and is cut without it; a change applies at once", async () => {
            const session = await start("s");
            const long = `${"a".repeat(50)} ${"b".repeat(20)} tail`;
            session.appendToRepl({ output: `${long}\nnext\n`, sev: "info" });
            await shows("next");
            expect(screen()).not.toContain("tail");

            settings["debug.console.wordWrap"] = true;
            configurationChanged.fire({ affectsConfiguration: (key) => key === "debug.console.wordWrap" });
            await shows("tail");
            const rows = screen().split("\n");
            const first = rows.findIndex((row) => row.includes("aaaa"));
            expect(rows[first + 1]).toContain("bbbb");
            expect(rows[first + 2]).toContain("next");

            configurationChanged.fire({ affectsConfiguration: () => false });
            app.render();
            expect(screen()).toContain("tail");
        });

        it("a wrapped line keeps its source on its first line", async () => {
            settings["debug.console.wordWrap"] = true;
            const session = await start("s");
            const source = session.getSource({ name: "main.cpp", path: "/w/main.cpp" });
            session.appendToRepl({
                output: `${"w".repeat(80)}\n`,
                sev: "info",
                source: { lineNumber: 7, column: 1, source },
            });
            await shows("main.cpp:7");
            const rows = screen().split("\n");
            const first = rows.findIndex((row) => row.includes("main.cpp:7"));
            expect(rows[first]).toContain("www");
            expect(rows[first + 1]).toContain("www");
            const total = rows
                .filter((row) => row.includes("ww"))
                .map((row) => row.split("w").length - 1)
                .reduce((a, b) => a + b, 0);
            expect(total).toBe(80);
        });

        it("a click on a file link opens it at its line and column; on a web link, the system's opener", async () => {
            const session = await start("s");
            session.appendToRepl({ output: "at /src/app.ts:3:5 and https://example.com/x\n", sev: "info" });
            session.appendToRepl({ output: "gone /src/missing.ts:1\n", sev: "info" });
            await shows("gone");

            clickAt(cellOf("app.ts:3"));
            await vi.waitFor(() => {
                expect(opened).toEqual(["/src/app.ts@2:4"]);
            });
            clickAt(cellOf("example.com"));
            await vi.waitFor(() => {
                expect(opened).toEqual(["/src/app.ts@2:4", "https://example.com/x"]);
            });
            clickAt(cellOf("missing.ts"));
            clickAt(cellOf("and "));
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(opened).toHaveLength(2);
        });

        it("the filter in the view's title hides output lines, counts what it shows and is kept per workspace", async () => {
            // No count before there is anything to count; the scenarios find the field by its id.
            expect(repl.filterBadge.getText()).toBe("");
            expect(repl.filterInput.id).toBe("replFilter");
            const session = await start("s");
            await shows("warning:");
            expect(titleWidget).not.toBeNull();
            expect(repl.filterInput.placeholder).toBe(FILTER_PLACEHOLDER);

            repl.focusFilter();
            expect(repl.filterInput.isFocused).toBe(true);
            type("hello from,reading");
            await vi.waitFor(() => {
                expect(screen()).not.toContain("Launching");
            });
            expect(screen()).toContain("Hello from hello");
            expect(screen()).toContain("Reading input");
            expect(repl.filterBadge.getText()).toMatch(/^Showing 2 of \d+ $/u);
            expect(app.backend.getFgAt(cellOf("Showing"))).toBe(themeVars.descriptionForeground);
            expect(state.values.get("debug.repl.filter.value")).toBe("hello from,reading");

            // Evaluations stay whatever the filter says.
            repl.focus();
            type("i");
            app.sendKey("Enter");
            await shows("> i");

            repl.focusFilter();
            app.sendKey("Escape");
            await shows("Launching");
            expect(repl.filterBadge.getText()).toBe("");
            expect(session.getReplElements().length).toBeGreaterThan(3);
        });

        it("an exclusion hides what it matches; a group's children take its verdict unless an inclusion decides", async () => {
            const session = await start("s");
            const raw = session as unknown as {
                repl: { startGroup(s: IDebugSession, name: string, expand: boolean): void; endGroup(): void };
            };
            raw.repl.startGroup(session, "Group of things", true);
            session.appendToRepl({ output: "inside one\n", sev: "info" });
            session.appendToRepl({ output: "inside two\n", sev: "info" });
            raw.repl.endGroup();
            await shows("inside two");
            repl.focusFilter();

            type("!launch");
            await vi.waitFor(() => {
                expect(screen()).not.toContain("Launching");
            });
            expect(screen()).toContain("inside one");

            app.sendKey("Escape");
            type("!two");
            await vi.waitFor(() => {
                expect(screen()).not.toContain("inside two");
            });
            expect(screen()).toContain("inside one");
            expect(screen()).toContain("Launching");

            app.sendKey("Escape");
            type("!things");
            await vi.waitFor(() => {
                expect(screen()).not.toContain("inside one");
            });
            expect(screen()).not.toContain("Group of");

            // An inclusion decides the children too (upstream): the group shows, its lines do not match.
            app.sendKey("Escape");
            type("group,one");
            await vi.waitFor(() => {
                expect(screen()).not.toContain("Launching");
            });
            expect(screen()).toContain("Group of things");
            expect(screen()).toContain("inside one");
            expect(screen()).not.toContain("inside two");
        });

        it("a stored filter applies when the console is made", async () => {
            const stored = mockStateService();
            stored.store({ key: "debug.repl.filter.value", scope: "workspace", default: "" }, "nothing matches");
            const other = new Repl(
                fx.service,
                {
                    registerContainer: () => undefined,
                    registerView: () => undefined,
                    setViewTitleWidget: () => undefined,
                    isViewShown: () => true,
                    onDidShowView: viewShown.event,
                } as never,
                { get: () => false, onDidChangeConfiguration: configurationChanged.event } as never,
                { glyph: () => ">", onDidChange: iconsChanged.event } as unknown as IProductIconService,
                stored,
                {} as never,
                {} as never,
                {} as never,
                { linkify: (spans) => [...spans] },
                { mainContainer: app.root },
            );
            expect(other.filterInput.inputState.value).toBe("nothing matches");
            other.dispose();
        });

        it("typing completes through the adapter; Tab accepts, Escape closes, Enter evaluates the input", async () => {
            const session = await start("s");
            const completions = vi.spyOn(session, "completions");
            repl.focus();
            type("cf");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            // In the focused frame of the stopped thread.
            const focused = fx.service.getViewModel().focusedStackFrame;
            expect(completions.mock.calls[0].slice(0, 2)).toEqual([focused?.frameId, 1]);
            expect(focused).toBeDefined();
            expect(repl.suggest.list.items.map((item) => item.label)).toEqual(["cfg"]);
            await shows("cfg");

            app.sendKey("Tab");
            expect(repl.input.inputState.value).toBe("cfg");
            expect(repl.suggest.isOpen).toBe(false);

            app.sendKey("Backspace");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            app.sendKey("Escape");
            expect(repl.suggest.isOpen).toBe(false);
            expect(repl.input.inputState.value).toBe("cf");

            // Emptied by typing, the input asks for nothing: the popup stays closed.
            app.sendKey("Backspace");
            app.sendKey("Backspace");
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(repl.suggest.isOpen).toBe(false);

            // Enter does not take the item: the input as typed is evaluated.
            type("cf");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            app.sendKey("Enter");
            expect(repl.suggest.isOpen).toBe(false);
            await vi.waitFor(() => {
                expect(screen()).toMatch(/> cf\s/u);
            });
            expect(screen()).not.toContain("> cfg");
        });

        it("history suggestions come after the adapter's; acceptSuggestionOnEnter takes Enter; Ctrl+Space asks", async () => {
            await start("s");
            state.store({ key: "debug.repl.history", scope: "workspace", default: [] }, ["count + 1", "cfg.retries"]);
            settings["debug.console.acceptSuggestionOnEnter"] = "on";
            repl.focus();
            type("c");
            await vi.waitFor(() => {
                expect(repl.suggest.list.items.map((item) => item.label)).toEqual([
                    "cfg",
                    "count",
                    "cfg.retries",
                    "count + 1",
                ]);
            });
            app.sendKey("ArrowDown");
            app.sendKey("ArrowDown");
            app.sendKey("ArrowUp");
            app.sendKey("ArrowDown");
            app.sendKey("Enter");
            expect(repl.input.inputState.value).toBe("cfg.retries");

            settings["debug.console.historySuggestions"] = false;
            repl.input.inputState.value = "";
            app.sendKey("Ctrl+ ");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            expect(repl.suggest.list.items.map((item) => item.label)).not.toContain("count + 1");
            app.sendKey("PageDown");
            app.sendKey("PageUp");
            app.sendKey("Tab");
            expect(repl.input.inputState.value).toBe("bad");
        });

        it("an ended session's console asks its adapter for nothing", async () => {
            const session = await start("s");
            const completions = vi.spyOn(session, "completions");
            await fx.service.stopSession(session);
            await vi.waitFor(() => {
                expect(session.state).toBe(State.Inactive);
            });
            repl.focus();
            type("cf");
            app.sendKey("Ctrl+ ");
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(completions).not.toHaveBeenCalled();
            expect(repl.suggest.isOpen).toBe(false);
        });

        it("no completion without a running session or for an adapter without completions", async () => {
            repl.focus();
            type("cf");
            app.sendKey("Ctrl+ ");
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(repl.suggest.isOpen).toBe(false);

            const session = await start("s");
            (session.capabilities as { supportsCompletionsRequest?: boolean }).supportsCompletionsRequest = false;
            repl.input.inputState.value = "";
            type("cf");
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(repl.suggest.isOpen).toBe(false);
        });

        it("takes the adapter's targets as DAP gives them; a click on one accepts it", async () => {
            const session = await startRunning("s");
            (session.capabilities as { supportsCompletionsRequest?: boolean }).supportsCompletionsRequest = true;
            const asked: unknown[] = [];
            vi.spyOn(session, "completions").mockImplementation((frameId, threadId, text, position) => {
                asked.push([frameId, threadId, text, position.lineNumber, position.column]);
                // The first answer is none, as a failed request's.
                if (asked.length === 1) return Promise.resolve(undefined);
                return Promise.resolve({
                    body: {
                        targets: [
                            { label: "" },
                            { label: "plain" },
                            { label: "odd", type: "weird" as "text", length: 0 },
                            { label: "fn", type: "function" },
                            { label: "sel", text: "sel()", selectionStart: 4, length: 1 },
                        ],
                    },
                } as Awaited<ReturnType<IDebugSession["completions"]>>);
            });
            repl.focus();
            app.sendKey("a");
            await vi.waitFor(() => {
                expect(asked).toHaveLength(1);
            });
            await new Promise((resolve) => setTimeout(resolve, 10));
            expect(repl.suggest.isOpen).toBe(false);
            app.sendKey("Shift+Enter");
            type("s");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            // No focused frame while it runs: no frame id, thread 0. The position is 1-based on the cursor's line.
            expect(asked.at(-1)).toEqual([undefined, 0, "a\ns", 2, 2]);
            const askedBefore = asked.length;
            // An empty label is no item; no type and an unknown one are properties.
            expect(repl.suggest.list.items.map((item) => [item.label, item.kind])).toEqual([
                ["fn", 2],
                ["odd", 9],
                ["plain", 9],
                ["sel", 9],
            ]);
            // A key that is not the popup's goes to the input.
            type("e");
            expect(repl.input.inputState.value).toBe("a\nse");
            await vi.waitFor(() => {
                expect(asked.length).toBeGreaterThan(askedBefore);
            });
            await shows("sel");
            clickAt(cellOf("sel"));
            // `length` 1 replaces the `e` before the cursor; `selectionStart` puts the cursor in the inserted text.
            expect(repl.input.inputState.value).toBe("a\nssel()");
            expect(repl.input.inputState.cursorOffset).toBe("a\nssel(".length);
            expect(repl.suggest.isOpen).toBe(false);
        });

        it("a focus change closes the popup", async () => {
            await start("s");
            repl.focus();
            type("cf");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            repl.focusFilter();
            expect(repl.suggest.isOpen).toBe(false);
        });

        it("Shift+Enter breaks the input's line; Up and Down move in it and walk the history from its edges", async () => {
            await start("s");
            state.store({ key: "debug.repl.history", scope: "workspace", default: [] }, ["old"]);
            repl.focus();
            type("one");
            app.sendKey("Shift+Enter");
            type("two");
            app.render();
            expect(repl.input.lineCount).toBe(2);
            expect(screen().split("\n").slice(-2)).toEqual([
                expect.stringContaining("> one") as string,
                expect.stringMatching(/^ {3}two/u) as string,
            ]);

            app.sendKey("ArrowUp");
            expect(repl.input.cursorLine).toBe(0);
            expect(repl.input.inputState.value).toBe("one\ntwo");
            app.sendKey("ArrowUp");
            expect(repl.input.inputState.value).toBe("old");
            app.sendKey("ArrowDown");
            expect(repl.input.inputState.value).toBe("");
        });

        it("Copy All takes the rows shown without their ANSI codes; Collapse All closes the groups", async () => {
            const session = await start("s");
            await shows("PASS");
            expect(repl.getVisibleContent()).toContain("PASS self-check 3/3 at /home/user/hello/src/main.cpp:27:9\n");
            expect(repl.getVisibleContent()).not.toContain("\u001b");
            // A row's own trailing blanks go, its indentation stays.
            session.appendToRepl({ output: "  indented  \n", sev: "info" });
            await shows("indented");
            expect(repl.getVisibleContent()).toContain("\n  indented\n");

            const model = session as unknown as { repl: { startGroup: (...a: unknown[]) => void } };
            model.repl.startGroup(session, "G", true);
            session.appendToRepl({ output: "child\n", sev: "info" });
            await shows("child");
            repl.collapseAll();
            app.render();
            expect(screen()).not.toContain("child");
            expect(repl.getVisibleContent()).not.toContain("child");
        });

        // Upstream's echo is a HighlightedLabel under `white-space: pre-wrap` (word wrap on) and its row is as high as
        // the input's lines (ReplDelegate.estimateHeight): a two-line input is echoed on two rows.
        it("a multi-line input is echoed on as many rows as it has lines", async () => {
            settings["debug.console.wordWrap"] = true;
            await start("s");
            repl.focus();
            type("one");
            app.sendKey("Shift+Enter");
            type("two");
            app.sendKey("Enter");

            await shows("> one");
            const rows = screen().split("\n");
            const echo = rows.findIndex((row) => row.includes("> one"));
            expect(rows[echo]).not.toContain("two");
            expect(rows[echo + 1]).toMatch(aloneOnRow("two"));
        });

        // With word wrap on upstream draws an output element under `white-space: pre-wrap`: its inner line breaks are
        // line breaks.
        it("with word wrap an output element with several lines draws each line on its own row", async () => {
            settings["debug.console.wordWrap"] = true;
            await fx.configuration.updateValue("debug.console.collapseIdenticalLines", false);
            const session = await start("s");
            session.appendToRepl({ output: "alpha\nbeta\n", sev: "info" });
            session.appendToRepl({ output: "gamma\r\ndelta\n", sev: "info" });

            await shows("delta");
            const rows = screen().split("\n");
            const alpha = rows.findIndex((row) => row.includes("alpha"));
            expect(rows[alpha]).not.toContain("beta");
            expect(rows[alpha + 1]).toMatch(aloneOnRow("beta"));
            // A CRLF is one line break.
            const gamma = rows.findIndex((row) => row.includes("gamma"));
            expect(rows[gamma + 1]).toMatch(aloneOnRow("delta"));
        });

        it("only Ctrl+Space asks and only Shift+Enter breaks the line, which shows at once; Down within the input moves in it", async () => {
            const session = await start("s");
            const completions = vi.spyOn(session, "completions");
            repl.focus();
            type("ab");
            await new Promise((resolve) => setTimeout(resolve, 20));
            completions.mockClear();
            app.sendKey("Ctrl+e");
            await new Promise((resolve) => setTimeout(resolve, 20));
            expect(completions).not.toHaveBeenCalled();
            app.sendKey("Shift+ArrowLeft");
            expect(repl.input.inputState.value).toBe("ab");

            app.sendKey("End");
            app.sendKey("Shift+Enter");
            const rows = screen().split("\n");
            expect(rows.at(-2)).toContain("> ab");
            expect(rows.at(-1)?.trim()).toBe("");

            app.sendKey("ArrowUp");
            expect(repl.input.cursorLine).toBe(0);
            app.sendKey("ArrowDown");
            expect(repl.input.cursorLine).toBe(1);
            expect(repl.input.inputState.value).toBe("ab\n");
        });

        it("Escape in the filter clears it and is taken; on an empty filter it is not the filter's", async () => {
            await start("s");
            const prevented: boolean[] = [];
            titleWidget?.addEventListener("keydown", (event) => {
                if (event.key === "Escape") prevented.push(event.defaultPrevented);
            });
            repl.focusFilter();
            app.sendKey("Escape");
            expect(prevented).toEqual([false]);
            type("zzz");
            expect(screen()).toContain("zzz");
            app.sendKey("Escape");
            expect(prevented).toEqual([false, true]);
            expect(repl.filterInput.inputState.value).toBe("");
            expect(screen()).not.toContain("zzz");
            expect(screen()).toContain("Filter (e.g.");
        });

        it("showing another session's console closes the popup of the one before", async () => {
            await start("s");
            repl.focus();
            type("cf");
            await vi.waitFor(() => {
                expect(repl.suggest.isOpen).toBe(true);
            });
            repl.selectSession(await start("t"));
            expect(repl.shownSession?.name).toBe("t");
            expect(repl.suggest.isOpen).toBe(false);
        });

        it("a change of the filter scrolls the console to its end", async () => {
            const session = await start("s");
            for (let i = 0; i < 40; i++) session.appendToRepl({ output: `line ${String(i)}\n`, sev: "info" });
            await shows("line 39");
            repl.tree.list.focus();
            app.sendKey("Home");
            expect(screen()).not.toContain("line 39");
            // A filter that hides nothing: the rows and the cursor stay, the scroll goes to the end.
            repl.focusFilter();
            type("!zzz");
            await shows("line 39");
        });

        /** The list's rows of the frame: below the title row with the filter, above the input. */
        function listRows(): string[] {
            return screen().split("\n").slice(1, -1);
        }

        // Live: the Debug Demo's output wrapped in a wide terminal, then the terminal narrowed until the console
        // overflows — the last letter of each wrapped row sits under the scroll bar that came with the overflow.
        it("a wrapped line loses no character under the scroll bar that a narrowed console brings", async () => {
            settings["debug.console.wordWrap"] = true;
            app.backend.resize(new Size(100, 40));
            await start("s");
            await shows("Launched process 48213");

            // Ten rows of output for eight rows of list: the console overflows and the scroll bar takes a column.
            app.backend.resize(new Size(60, 10));
            await new Promise((resolve) => setTimeout(resolve, 100));
            const rows = listRows();
            globalThis.console.error(JSON.stringify(rows));
            const launching = rows.findIndex((row) => row.includes("Launching:"));
            const joined = (index: number): string =>
                rows
                    .slice(index, index + 2)
                    // The right padding, and the scroll bar if the console overflows: no text is under it.
                    .map((row) =>
                        row
                            .slice(1, -1)
                            .replace(/[█░▀▄]$/u, "")
                            .trimEnd(),
                    )
                    .join("");
            expect(joined(launching)).toBe("Launching: /home/user/hello/build/hello --verbose input.txt");
            expect(joined(launching + 2)).toBe("Launched process 48213 from '/home/user/hello/build/hello'");
        });

        // Upstream's list draws a row that only partly fits at the bottom; here the rows of the frame below the last
        // whole row stay blank (live: the Debug Demo in a 70-column terminal, Home in the console - blank rows under
        // "FAIL none" where the wrapped long line starts).
        it("with word wrap the console's rows have no blank gap: a tall row that partly fits shows its first lines", async () => {
            settings["debug.console.wordWrap"] = true;
            const session = await start("s");
            for (let i = 0; i < 20; i++) session.appendToRepl({ output: `filler ${String(i)}\n`, sev: "info" });
            await shows("filler 19");
            repl.tree.list.focus();
            app.sendKey("Home");
            await new Promise((resolve) => setTimeout(resolve, 20));

            const blank = listRows().findIndex((row) => row.slice(0, -3).trim() === "");
            expect({ blank, rows: listRows() }).toEqual({ blank: -1, rows: listRows() });
        });
    });
});
