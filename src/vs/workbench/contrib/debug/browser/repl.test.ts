// The Debug Console view on its own, over a debug service with the synthetic debugger: which session's console it
// shows (upstream `selectSession`), the rows of groups and nameless objects, the input's hint and keys.

import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugServiceFixture, type IDebugServiceFixture } from "../../../../../TestUtils/debugServiceFixture.ts";
import { TestVariable } from "../../../../../TestUtils/debugViewsFixture.ts";
import { mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import {
    NO_DELAY_TIMING,
    registerSyntheticDebugger,
    SYNTHETIC_LAUNCH_CONFIG,
    type SyntheticDebugAdapterFactory,
} from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { IViewContainerDescriptor, IViewDescriptor } from "../../../browser/parts/views/viewsService.ts";
import { DEBUG_PANEL_ID, type IDebugSession, REPL_VIEW_ID, State } from "../common/debug.ts";

import { Repl, START_DEBUG_FIRST } from "./repl.ts";

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

    beforeEach(() => {
        fx = createDebugServiceFixture();
        factory = registerSyntheticDebugger(fx.service.getAdapterManager(), NO_DELAY_TIMING).factory;
        containers = [];
        views = [];
        glyphs = ">";
        shown = true;
        const icons = { glyph: () => glyphs, onDidChange: iconsChanged.event } as unknown as IProductIconService;
        repl = new Repl(
            fx.service,
            {
                registerContainer: (descriptor: IViewContainerDescriptor) => containers.push(descriptor),
                registerView: (descriptor: IViewDescriptor) => views.push(descriptor),
                isViewShown: () => shown,
                onDidShowView: viewShown.event,
            } as never,
            { get: () => false, onDidChangeConfiguration: () => ({ dispose: () => undefined }) } as never,
            icons,
            mockStateService(),
        );
        app = TestApp.createWithContent(repl.view, new Size(60, 12));
    });

    afterEach(async () => {
        await fx.service.stopSession(undefined);
        for (const adapter of factory.adapters) adapter.dispose();
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
