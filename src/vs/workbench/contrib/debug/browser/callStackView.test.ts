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
    getSpecificSourceName,
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

describe("CallStackDataSource", () => {
    function setup(): {
        sessions: IDebugSession[];
        view: { multi: boolean };
        dataSource: CallStackDataSource;
        session: (name: string, threadCount: number, parentSession?: IDebugSession) => IDebugSession;
    } {
        const sessions: IDebugSession[] = [];
        const view = { multi: false };
        const service = {
            getModel: () => ({ getSessions: () => sessions }),
            getViewModel: () => ({ isMultiSessionView: () => view.multi }),
        } as unknown as IDebugService;
        const session = (name: string, threadCount: number, parentSession?: IDebugSession): IDebugSession => {
            const threads: Thread[] = [];
            const created = mockSession({
                getId: () => name,
                getAllThreads: () => threads,
                parentSession,
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
            new CallStackView(service, new StaticProductIconService(false), (message) => stateMessages.push(message)),
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
        expect(text).toContain("--- async ---");
        expect(text).toContain("native");
        expect(text).not.toContain("Unknown Source");
        expect(text).toContain("Unable to read the stack");
        expect(stateMessages.at(-1)).toBeUndefined();

        app.sendKey("U");
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
        stopThread(session, { reason: "step" }, (t) => [frame(t, "main")]);
        mount({ ...debugService, state: State.Stopped });
        await settle();

        expect(screen()).toContain("main");
    });
});
