/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/callStack.test.ts
// The view's part of the suite: "stack frame get specific source name". Below it, what the tree shows under a
// session and a thread (upstream's `CallStackDataSource`), over a stub of the debug service, and the rows of the
// view over the model with sessions that have no adapter.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDebugSession, testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel, mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import { bindWidgetGlyphs } from "../../../../platform/theme/browser/widgetGlyphs.ts";
import { StaticProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import { type IDebugService, type IDebugSession, type IStackFrame, State } from "../common/debug.ts";
import { type DebugModel, StackFrame, Thread, ThreadAndSessionIds } from "../common/debugModel.ts";
import { Source } from "../common/debugSource.ts";

import {
    CALL_STACK_REFRESH_DELAY_MS,
    CallStackDataSource,
    CallStackView,
    getContextForContributedActions,
    getSpecificSourceName,
    isDebugSession,
} from "./callStackView.ts";
import type { DebugSession } from "./debugSession.ts";

const RANGE = { startLineNumber: 1, startColumn: 2, endLineNumber: 1, endColumn: 10 };

function source(raw: DebugProtocol.Source = { path: "/src/main.cpp" }): Source {
    return new Source(raw, "s", NULL_LOGGER);
}

let nextFrameId = 0;

/** Each frame its own index: the index is part of its id, and so of its row. */
function frame(thread: Thread, name: string, options: { hint?: string; src?: Source } = {}): StackFrame {
    const index = nextFrameId++;
    return new StackFrame(thread, index, options.src ?? source(), name, options.hint, RANGE, index, true);
}

function setCallStack(thread: Thread, frames: IStackFrame[]): void {
    (thread as unknown as { callStack: IStackFrame[] }).callStack = frames;
}

function stopped(thread: Thread, details: Thread["stoppedDetails"] = { reason: "step" }): Thread {
    thread.stopped = true;
    thread.stoppedDetails = details;
    return thread;
}

describe("Debug - CallStack (the view)", () => {
    it("stack frame get specific source name", () => {
        const thread = new Thread(mockSession(), "mockthread", 1);
        const first = frame(thread, "app.js", {
            src: source({ name: "internalModule.js", path: "a/b/c/d/internalModule.js", sourceReference: 10 }),
        });
        const second = frame(thread, "app2.js", {
            src: source({ name: "internalModule.js", path: "z/x/c/d/internalModule.js", sourceReference: 11 }),
        });
        const other = frame(thread, "lib.js", { src: source({ name: "lib.js", path: "/lib/lib.js" }) });
        setCallStack(thread, [first, second, other]);

        expect(getSpecificSourceName(first)).toBe(".../b/c/d/internalModule.js");
        expect(getSpecificSourceName(second)).toBe(".../x/c/d/internalModule.js");
        expect(getSpecificSourceName(other)).toBe("lib.js");

        // A stack being fetched again: the names come from the stale one, so they do not flash.
        thread.clearCallStack();
        expect(getSpecificSourceName(first)).toBe(".../b/c/d/internalModule.js");
    });

    it("a name that differs only in the first directory starts at the root, without the ellipsis", () => {
        const thread = new Thread(mockSession(), "mockthread", 1);
        const first = frame(thread, "a", { src: source({ name: "m.js", path: "/a/m.js" }) });
        const second = frame(thread, "b", { src: source({ name: "m.js", path: "/b/m.js" }) });
        setCallStack(thread, [first, second]);

        expect(getSpecificSourceName(first)).toBe("/a/m.js");
    });
});

describe("getContextForContributedActions", () => {
    it("a frame of a file gives its uri; an in-memory one its path, else its reference, else its name", () => {
        const thread = new Thread(mockSession(), "mockthread", 1);
        expect(getContextForContributedActions(frame(thread, "f"))).toBe(source().uri.toString());
        const inMemory = (raw: DebugProtocol.Source): string | number =>
            getContextForContributedActions(frame(thread, "f", { src: source(raw) }));
        expect(inMemory({ path: "gen.js", sourceReference: 5 })).toBe("gen.js");
        expect(inMemory({ name: "gen", sourceReference: 5 })).toBe(5);
        expect(inMemory({ name: "gen" })).toBe("gen");
    });
});

describe("CallStackDataSource", () => {
    function setup(): {
        sessions: IDebugSession[];
        view: { multi: boolean };
        dataSource: CallStackDataSource;
        session: (name: string, threadCount: number, parentSession?: IDebugSession, compact?: boolean) => IDebugSession;
    } {
        const sessions: IDebugSession[] = [];
        const view = { multi: false };
        const service = {
            getModel: () => ({ getSessions: () => sessions }),
            getViewModel: () => ({ isMultiSessionView: () => view.multi }),
        } as unknown as IDebugService;
        const session = (
            name: string,
            threadCount: number,
            parentSession?: IDebugSession,
            compact = false,
        ): IDebugSession => {
            const threads: Thread[] = [];
            const created = mockSession({
                getId: () => name,
                getAllThreads: () => threads,
                parentSession,
                compact,
                capabilities: {},
            });
            for (let id = 1; id <= threadCount; id++) {
                const thread = new Thread(created, `${name} thread ${String(id)}`, id);
                thread.reachedEndOfCallStack = true;
                threads.push(thread);
            }
            sessions.push(created);
            return created;
        };
        return { sessions, view, dataSource: new CallStackDataSource(service), session };
    }

    function threadOf(session: IDebugSession, index = 0): Thread {
        return session.getAllThreads()[index] as Thread;
    }

    it("the roots: nothing, the frames of a lone thread, the threads of one session, the top sessions of several", async () => {
        const { dataSource, session, view } = setup();
        expect(await dataSource.getRoots()).toEqual([]);

        const parent = session("parent", 1);
        const main = frame(stopped(threadOf(parent)), "main");
        setCallStack(threadOf(parent), [main]);
        expect(await dataSource.getRoots()).toEqual([main]);

        view.multi = true;
        expect(await dataSource.getRoots()).toEqual([parent]);
        view.multi = false;

        const child = session("child", 2, parent);
        expect(await dataSource.getRoots()).toEqual([parent]);
        expect(await dataSource.getChildren(parent)).toEqual([main, child]);
        expect(await dataSource.getChildren(child)).toEqual(child.getAllThreads());
    });

    it("a session whose only child is a compact session shows as that child, as upstream's compressed tree", async () => {
        const { dataSource, session } = setup();
        const launcher = session("launcher", 0);
        const program = session("program", 2, launcher, true);
        const worker = session("worker", 2, program);

        // The launcher (no threads) and its compact program are one row: the program's.
        expect(await dataSource.getRoots()).toEqual([program]);
        expect(await dataSource.getChildren(program)).toEqual([...program.getAllThreads(), worker]);

        // A second child: the launcher has two rows under it, nothing to compress.
        const other = session("other", 1, launcher);
        expect(await dataSource.getRoots()).toEqual([launcher]);
        expect(await dataSource.getChildren(launcher)).toEqual([program, other]);
    });

    it("a lone child that is not compact keeps its parent's row; a compact parent folds into its lone child", async () => {
        const { dataSource, session } = setup();
        const parent = session("parent", 0);
        const child = session("child", 0, parent);
        expect(await dataSource.getRoots()).toEqual([parent]);
        expect(await dataSource.getChildren(parent)).toEqual([child]);

        const compactParent = session("compact parent", 0, undefined, true);
        const lone = session("lone", 0, compactParent);
        // `lone` is not compact and has no compact child: it stays a row of its own under its parent.
        expect(await dataSource.getRoots()).toEqual([parent, compactParent]);
        expect(await dataSource.getChildren(compactParent)).toEqual([lone]);

        const grandChild = session("grand child", 0, lone, true);
        // Now `lone` is the parent of a compact session: the chain folds to its last row.
        expect(await dataSource.getRoots()).toEqual([parent, grandChild]);
    });

    it("a session is told apart from the other rows and from no row at all", () => {
        const { session } = setup();
        const thread = new Thread(session("s", 0), "t", 1);
        expect(isDebugSession(session("other", 0))).toBe(true);
        expect([undefined, null, "error", thread, [frame(thread, "f")]].map(isDebugSession)).toEqual([
            false,
            false,
            false,
            false,
            false,
        ]);
    });

    it("one session with two threads shows the threads", async () => {
        const { dataSource, session } = setup();
        const only = session("only", 2);
        expect(await dataSource.getRoots()).toEqual(only.getAllThreads());
    });

    it("children: a session with threads, a stopped lone thread or a child session; a stopped thread", () => {
        const { dataSource, session } = setup();
        const two = session("two", 2);
        const running = session("running", 1);
        const stoppedOne = session("stopped", 1);
        stopped(threadOf(stoppedOne));
        const parent = session("parent", 0);
        session("child", 0, parent);
        const empty = session("empty", 0);

        expect(dataSource.hasChildren(two)).toBe(true);
        expect(dataSource.hasChildren(running)).toBe(false);
        expect(dataSource.hasChildren(stoppedOne)).toBe(true);
        expect(dataSource.hasChildren(parent)).toBe(true);
        expect(dataSource.hasChildren(empty)).toBe(false);
        expect(dataSource.hasChildren(threadOf(stoppedOne))).toBe(true);
        expect(dataSource.hasChildren(threadOf(running))).toBe(false);
        expect(dataSource.hasChildren("error")).toBe(false);
    });

    it("a run of deemphasized frames folds into one item; a lone one, or one the user unfolded, stays", async () => {
        const { dataSource, session } = setup();
        const thread = stopped(threadOf(session("s", 2)));
        const user = frame(thread, "user");
        const lib1 = frame(thread, "lib1", { hint: "deemphasize" });
        const lib2 = frame(thread, "lib2", { src: source({ path: "/x", presentationHint: "deemphasize" }) });
        const lib3 = frame(thread, "lib3", { hint: "subtle" });
        const lone = frame(thread, "lone", { hint: "deemphasize" });
        setCallStack(thread, [user, lib1, lib2, lib3, user, lone, user]);

        expect(await dataSource.getChildren(thread)).toEqual([user, [lib1, lib2, lib3], user, lone, user]);

        dataSource.deemphasizedStackFramesToShow.add(lib1);
        dataSource.deemphasizedStackFramesToShow.add(lib2);
        dataSource.deemphasizedStackFramesToShow.add(lib3);
        expect(await dataSource.getChildren(thread)).toEqual([user, lib1, lib2, lib3, user, lone, user]);
    });

    it("an empty stack is fetched first; the error of the stack trace and Load More follow the frames", async () => {
        const { dataSource, session } = setup();
        const thread = stopped(threadOf(session("s", 2)), {
            reason: "exception",
            framesErrorMessage: "no frames",
        });
        thread.reachedEndOfCallStack = false;
        const main = frame(thread, "main");
        const fetch = vi.spyOn(thread, "fetchCallStack").mockImplementation(() => {
            setCallStack(thread, [main]);
            return Promise.resolve();
        });

        const children = await dataSource.getChildren(thread);

        expect(fetch).toHaveBeenCalledOnce();
        expect(children.slice(0, 2)).toEqual([main, "no frames"]);
        expect(children[2]).toBeInstanceOf(ThreadAndSessionIds);
        expect((children[2] as ThreadAndSessionIds).getId()).toBe(new ThreadAndSessionIds("s", 1).getId());

        // A thread that is not stopped has no Load More, whatever the adapter says.
        thread.stoppedDetails = undefined;
        expect(await dataSource.getChildren(thread)).toEqual([main]);
    });

    it("with delayed loading, the top frame alone is followed by the stale stack until the rest arrives", async () => {
        const { dataSource, session } = setup();
        const created = session("s", 2);
        created.capabilities.supportsDelayedStackTraceLoading = true;
        const thread = stopped(threadOf(created), { reason: "step", totalFrames: 3 });
        const [top, a, b] = [frame(thread, "top"), frame(thread, "a"), frame(thread, "b")];
        setCallStack(thread, [top, a, b]);
        thread.clearCallStack();
        const fresh = frame(thread, "fresh");
        setCallStack(thread, [fresh]);

        expect(await dataSource.getChildren(thread)).toEqual([fresh, a, b]);
        // More than the top frame arrived: the stale stack is not appended.
        setCallStack(thread, [fresh, b]);
        expect(await dataSource.getChildren(thread)).toEqual([fresh, b]);
        setCallStack(thread, [fresh]);
        // A thread that went on.
        thread.stoppedDetails = undefined;
        expect(await dataSource.getChildren(thread)).toEqual([fresh]);

        // Without the total, or with a total of one, nothing is appended.
        thread.stoppedDetails = { reason: "step", totalFrames: 1 };
        expect(await dataSource.getChildren(thread)).toEqual([fresh]);
        thread.stoppedDetails = { reason: "step" };
        expect(await dataSource.getChildren(thread)).toEqual([fresh]);
        created.capabilities.supportsDelayedStackTraceLoading = false;
        thread.stoppedDetails = { reason: "step", totalFrames: 3 };
        expect(await dataSource.getChildren(thread)).toEqual([fresh]);
    });
});

describe("CallStackView", () => {
    const disposables = new DisposableStore();
    let model: DebugModel;
    let debugService: ReturnType<typeof testDebugService>;
    let view: CallStackView;
    let app: TestApp;
    const stateMessages: (string | undefined)[] = [];

    beforeEach(() => {
        vi.useFakeTimers();
        model = createMockDebugModel(disposables);
        debugService = testDebugService(model);
        stateMessages.length = 0;
    });

    afterEach(() => {
        disposables.clear();
        debugService.viewModel.dispose();
        vi.useRealTimers();
    });

    function mount(service: IDebugService = debugService): void {
        view = disposables.add(
            new CallStackView(
                service,
                new StaticProductIconService(false),
                (message) => stateMessages.push(message),
                () => true,
            ),
        );
        app = TestApp.createWithContent(view.tree.element, new Size(50, 12));
        bindWidgetGlyphs(app.root, new StaticProductIconService(false));
        view.focus();
    }

    function addSession(name: string): DebugSession {
        const session = disposables.add(createTestDebugSession(model, name, undefined, debugService));
        model.addSession(session);
        return session;
    }

    /** A thread stopped by itself: the session has no stop of its own. */
    function stopThread(
        session: DebugSession,
        details: Thread["stoppedDetails"],
        frames: (t: Thread) => IStackFrame[],
    ) {
        model.rawUpdate({
            sessionId: session.getId(),
            threads: [{ id: 1, name: "main" }],
            stoppedDetails: { threadId: 1, ...details },
        });
        const thread = session.getThread(1)!;
        thread.reachedEndOfCallStack = true;
        setCallStack(thread, frames(thread));
        return thread;
    }

    /** The threads of a session, by name; the model's update, so a stack change. */
    function threads(session: DebugSession, names: string[]): Thread[] {
        model.rawUpdate({ sessionId: session.getId(), threads: names.map((name, i) => ({ id: i + 1, name })) });
        return names.map((_, i) => session.getThread(i + 1)!);
    }

    function withFrames(thread: Thread, ...names: string[]): StackFrame[] {
        const frames = names.map((name) => frame(thread, name));
        thread.reachedEndOfCallStack = true;
        setCallStack(thread, frames);
        return frames;
    }

    /** Types into the tree, then lets the type-ahead forget it. */
    function type(text: string): void {
        for (const ch of text) app.sendKey(ch);
        vi.advanceTimersByTime(1000);
    }

    function rowOf(name: string): string {
        return screen()
            .split("\n")
            .find((row) => row.includes(` ${name} `))!;
    }

    async function settle(): Promise<void> {
        await vi.advanceTimersByTimeAsync(CALL_STACK_REFRESH_DELAY_MS);
        await flushMicrotasks(20);
    }

    function screen(): string {
        app.render();
        return app.backend.screenToString();
    }

    it("the error of the stack trace, a label frame and a frame without a source; typing finds the error row", async () => {
        mount();
        const session = addSession("s");
        stopThread(session, { reason: "step", framesErrorMessage: "Unable to read the stack" }, (t) => [
            frame(t, "--- async ---", { hint: "label" }),
            new StackFrame(t, 1, new Source(undefined, "s", NULL_LOGGER), "native", undefined, RANGE, 1, true),
        ]);
        await settle();

        const text = screen();
        // A label frame is its name alone: no marker, no location.
        expect(
            text
                .split("\n")
                .find((row) => row.includes("--- async ---"))
                ?.trim(),
        ).toBe("--- async ---");
        expect(text).toContain("native");
        expect(text).not.toContain("Unknown Source");
        expect(text).toContain("Unable to read the stack");
        expect(stateMessages.at(-1)).toBeUndefined();

        type("U");
        expect(view.tree.focused).toBe("Unable to read the stack");
    });

    it("Load More without a total reads the rest; the row of a thread that is gone reads nothing", async () => {
        mount();
        const session = addSession("s");
        const thread = stopThread(session, { reason: "step" }, (t) => [frame(t, "main")]);
        thread.reachedEndOfCallStack = false;
        const fetch = vi.spyOn(thread, "fetchCallStack").mockResolvedValue();
        model.rawUpdate({ sessionId: session.getId(), threads: [{ id: 1, name: "main" }] });
        await settle();
        expect(screen()).toContain("Load More Stack Frames");

        const loadMore = new ThreadAndSessionIds(session.getId(), 1);
        view.tree.onActivate(loadMore);
        await flushMicrotasks(5);
        expect(fetch).toHaveBeenCalledWith(undefined);

        view.tree.onActivate(new ThreadAndSessionIds(session.getId(), 2));
        view.tree.onActivate(new ThreadAndSessionIds("gone", 1));
        await flushMicrotasks(5);
        expect(fetch).toHaveBeenCalledOnce();

        // With the total, the count left: read just those.
        thread.stoppedDetails = { reason: "step", totalFrames: 5 };
        view.tree.rerender();
        expect(screen()).toContain("Load 4 More Stack Frames");
        view.tree.onActivate(loadMore);
        await flushMicrotasks(5);
        expect(fetch).toHaveBeenLastCalledWith(4);

        // The thread went on: the rest, whatever it is.
        thread.stoppedDetails = undefined;
        view.tree.rerender();
        expect(screen()).toContain("Load More Stack Frames");
        view.tree.onActivate(loadMore);
        await flushMicrotasks(5);
        expect(fetch).toHaveBeenLastCalledWith(undefined);

        // The thread is gone, and the row repainted before the refresh drops it.
        thread.stoppedDetails = { reason: "step" };
        await view.tree.refresh();
        model.rawUpdate({ sessionId: session.getId(), threads: [] });
        view.tree.rerender();
        expect(screen()).toContain("Load More Stack Frames");
    });

    it("deemphasized frames of one origin fold into Show N More with the origin; a lone one is muted", async () => {
        mount();
        const internal = (path: string): Source =>
            source({ path, origin: "internal", presentationHint: "deemphasize" });
        stopThread(addSession("s"), { reason: "step" }, (t) => [
            frame(t, "main"),
            frame(t, "lone", { hint: "subtle" }),
            frame(t, "user"),
            frame(t, "a", { src: internal("/a.js") }),
            frame(t, "b", { src: internal("/b.js") }),
        ]);
        await settle();

        const text = screen();
        expect(text).toContain("Show 2 More: internal");
        const rows = text.split("\n");
        const fgOf = (name: string): unknown => {
            const y = rows.findIndex((r) => r.includes(` ${name} `));
            return app.backend.getFgAt(new Point(rows[y].indexOf(` ${name} `) + 1, y));
        };
        expect(fgOf("lone")).not.toBe(fgOf("user"));
    });

    it("Enter on a frame or a session focuses it; a session's state is its stopped thread's", async () => {
        mount();
        const first = addSession("first");
        stopThread(first, { reason: "pause" }, (t) => [frame(t, "main")]);
        addSession("second");
        await settle();
        expect(screen()).toMatch(/first +PAUSED ON PAUSE/u);

        view.tree.onActivate(first);
        expect(debugService.focusStackFrame).toHaveBeenLastCalledWith(undefined, undefined, first, {
            explicit: true,
            preserveFocus: true,
        });
        const main = first.getThread(1)?.getCallStack()[0];
        view.tree.onActivate(main!);
        expect(debugService.focusStackFrame).toHaveBeenLastCalledWith(main, main?.thread, first, {
            explicit: true,
            preserveFocus: true,
        });
    });

    it("a view made while a session is stopped shows its stack without a change", async () => {
        const session = addSession("s");
        const thread = stopThread(session, { reason: "step" }, (t) => [frame(t, "main"), frame(t, "caller")]);
        void debugService.focusStackFrame(thread.getCallStack()[1], thread, session);
        mount({ ...debugService, state: State.Stopped });
        await settle();

        expect(screen()).toContain("main");
        expect(view.tree.focused).toBe(thread.getCallStack()[1]);
    });

    it("threads: each with its state on the right, closed until focused; the markers and the cursor follow the focus", async () => {
        mount();
        const session = addSession("s");
        const [one, two] = threads(session, ["one", "two", "three"]);
        stopped(one, { reason: "exception" });
        stopped(two, { reason: "step" });
        const [top1, mid1] = withFrames(one, "top1", "mid1", "low1");
        withFrames(two, "top2");
        await settle();

        expect(rowOf("one")).toMatch(/one +PAUSED ON EXCEPTION/u);
        expect(rowOf("two")).toMatch(/two +PAUSED ON STEP/u);
        expect(rowOf("three")).toMatch(/three +RUNNING/u);
        // The dark theme tells the two states apart by the background.
        const bgOf = (text: string): unknown => {
            const rows = screen().split("\n");
            const y = rows.findIndex((r) => r.includes(text));
            return app.backend.getBgAt(new Point(rows[y].indexOf(text), y));
        };
        expect(bgOf("PAUSED ON STEP")).not.toBe(bgOf("PAUSED ON EXCEPTION"));
        // Nothing focused: no thread is open.
        expect(screen()).not.toContain("top");

        // A focus from outside opens the thread and puts the cursor on the frame; the top frame keeps its arrow.
        await debugService.focusStackFrame(mid1, one, session);
        await flushMicrotasks(20);
        expect(view.tree.focused).toBe(mid1);
        expect(rowOf("top1")).toContain("➜ top1");
        expect(rowOf("mid1")).toContain("➜ mid1");
        expect(rowOf("low1")).not.toContain("➜");
        expect(rowOf("low1").indexOf("low1")).toBe(rowOf("mid1").indexOf("mid1"));

        // The user's cursor on a thread focuses it, and stays there: the thread does not open.
        app.sendKey("ArrowDown");
        app.sendKey("ArrowDown");
        await flushMicrotasks(20);
        expect(view.tree.focused).toBe(two);
        expect(debugService.getViewModel().focusedThread).toBe(two);
        expect(screen()).not.toContain("top2");

        // A focus from outside again moves the cursor.
        await debugService.focusStackFrame(top1, one, session);
        await flushMicrotasks(20);
        expect(view.tree.focused).toBe(top1);
    });

    it("a session focused without a thread gets the cursor; two sessions have no message in the title", async () => {
        mount();
        await settle();
        expect(stateMessages).toEqual([undefined]);
        addSession("alpha");
        const beta = addSession("beta");
        await settle();

        await debugService.focusStackFrame(undefined, undefined, beta);
        await flushMicrotasks(20);
        expect(view.tree.focused).toBe(beta);
        expect(stateMessages.at(-1)).toBeUndefined();
    });

    it("the title: Running, a stop of the whole session, nothing for a stop shown on a thread row", async () => {
        mount();
        const session = addSession("s");
        const state = vi.spyOn(session, "state", "get").mockReturnValue(State.Running);
        threads(session, ["main", "worker"]);
        await settle();
        expect(stateMessages.at(-1)).toBe("Running");

        const details = vi.spyOn(session, "getStoppedDetails").mockReturnValue({ reason: "pause" });
        state.mockReturnValue(State.Stopped);
        threads(session, ["main", "worker"]);
        await settle();
        expect(stateMessages.at(-1)).toBe("Paused on pause");

        details.mockReturnValue({ reason: "step", threadId: 1 });
        threads(session, ["main", "worker"]);
        await settle();
        expect(stateMessages.at(-1)).toBeUndefined();

        threads(session, ["main"]);
        await settle();
        expect(stateMessages.at(-1)).toBe("Paused on step");

        // An adapter that names neither a reason nor a description.
        details.mockReturnValue({ reason: "" });
        threads(session, ["main", "worker"]);
        await settle();
        expect(stateMessages.at(-1)).toBe("Paused");
    });

    it("a burst of stack changes refreshes once, a delay after the first", async () => {
        mount();
        await settle();
        stopThread(addSession("s"), { reason: "step" }, (t) => [frame(t, "main")]);
        await vi.advanceTimersByTimeAsync(CALL_STACK_REFRESH_DELAY_MS - 20);
        model.rawUpdate({ sessionId: model.getSessions()[0].getId(), threads: [{ id: 1, name: "main" }] });
        await vi.advanceTimersByTimeAsync(20);
        await flushMicrotasks(20);

        expect(screen()).toContain("main");
    });

    it("a focus during a slow stop lands after the refresh; a later change leaves the user's cursor alone", async () => {
        mount();
        await settle();
        const session = addSession("s");
        model.rawUpdate({
            sessionId: session.getId(),
            threads: [{ id: 1, name: "main" }],
            stoppedDetails: { threadId: 1, reason: "step" },
        });
        const thread = session.getThread(1)!;
        const [first, second] = [frame(thread, "first"), frame(thread, "second")];
        vi.spyOn(thread, "fetchCallStack").mockImplementation(
            () =>
                new Promise((resolve) => {
                    setTimeout(() => {
                        setCallStack(thread, [first, second]);
                        resolve();
                    }, 100);
                }),
        );
        await debugService.focusStackFrame(second, thread, session);
        await vi.advanceTimersByTimeAsync(300);
        await flushMicrotasks(20);
        expect(view.tree.focused).toBe(second);

        // Load More: the cursor there focuses nothing; a stack change keeps it there.
        app.sendKey("ArrowDown");
        expect(view.tree.focused).toBeInstanceOf(ThreadAndSessionIds);
        model.rawUpdate({ sessionId: session.getId(), threads: [{ id: 1, name: "main" }] });
        await settle();
        expect(view.tree.focused).toBeInstanceOf(ThreadAndSessionIds);
    });

    it("typing finds a session, a thread and a frame by name, and the other rows by their text", async () => {
        mount();
        const alpha = addSession("alpha");
        const beta = addSession("beta");
        const lib = (path: string, origin: string): Source => source({ path, origin, presentationHint: "deemphasize" });
        const thread = stopThread(alpha, { reason: "step", framesErrorMessage: "Bad stack" }, (t) => [
            frame(t, "main"),
            frame(t, "x", { src: lib("/x.js", "one") }),
            frame(t, "y", { src: lib("/y.js", "two") }),
        ]);
        thread.reachedEndOfCallStack = false;
        const [, w2] = threads(beta, ["w1", "w2"]);
        await settle();
        // Folded frames of several origins name none.
        expect(screen()).toContain("Show 2 More Stack Frames");

        type("beta");
        expect(view.tree.focused).toBe(beta);
        type("w2");
        expect(view.tree.focused).toBe(w2);
        type("main");
        expect(view.tree.focused).toBe(thread.getCallStack()[0]);
        type("bad");
        expect(view.tree.focused).toBe("Bad stack");
        type("load");
        expect(view.tree.focused).toBeInstanceOf(ThreadAndSessionIds);
        type("show");
        expect(Array.isArray(view.tree.focused)).toBe(true);
        type("alpha");
        expect(view.tree.focused).toBe(alpha);
    });

    it("the cursor on the second of two folds stays on it through a refresh", async () => {
        mount();
        const deemphasized = (t: Thread, name: string): StackFrame => frame(t, name, { hint: "deemphasize" });
        const session = addSession("s");
        const thread = stopThread(session, { reason: "step" }, (t) => [
            frame(t, "main"),
            deemphasized(t, "d1"),
            deemphasized(t, "d2"),
            frame(t, "user"),
            deemphasized(t, "d3"),
            deemphasized(t, "d4"),
        ]);
        await settle();
        view.tree.list.focusFirst();
        for (let i = 0; i < 3; i++) app.sendKey("ArrowDown");
        expect((view.tree.focused as IStackFrame[])[0]).toBe(thread.getCallStack()[4]);

        model.rawUpdate({ sessionId: session.getId(), threads: [{ id: 1, name: "main" }] });
        await settle();
        expect((view.tree.focused as IStackFrame[])[0]).toBe(thread.getCallStack()[4]);
    });
});
