// CALL STACK on the whole workbench with the synthetic debugger: the threads of the stop with their state, the
// frames with "Load More" and the folded deemphasized frames, the focus that follows the cursor, the session rows of
// two sessions and the state of a single thread in the title.

import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebugViewletHarness, type IDebugViewletHarness } from "../../../../../TestUtils/debugViewletHarness.ts";
import { SYNTHETIC_LAUNCH_CONFIG } from "../../../../../TestUtils/syntheticDebugAdapter.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import { WorkbenchContextKeysDIToken } from "../../../browser/workbenchContextKeys.ts";
import { CALLSTACK_VIEW_ID, VARIABLES_VIEW_ID } from "../common/debug.ts";
import { ThreadAndSessionIds } from "../common/debugModel.ts";

import { type CallStackItem, isDebugSession } from "./callStackView.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { type DebugViewletComponent, DebugViewletComponentDIToken } from "./debugViewlet.ts";

describe("CALL STACK in the workbench", () => {
    let t: IDebugViewletHarness;

    beforeEach(async () => {
        t = await createDebugViewletHarness();
        // CALL STACK alone in the sidebar: room for all the frames.
        const views = t.h.container.get(ViewsServiceDIToken);
        for (const id of views.getContainerViews("workbench.view.debug").map((v) => v.id)) {
            if (id !== CALLSTACK_VIEW_ID) views.setViewVisible(id, false);
        }
    });

    afterEach(async () => {
        await t.dispose();
    });

    function component(): DebugViewletComponent {
        return t.h.container.get(DebugViewletComponentDIToken);
    }

    function focusedFrameName(): string | undefined {
        return t.h.container.get(DebugServiceDIToken).getViewModel().focusedStackFrame?.name;
    }

    /** What a row stands for, as the test names it. */
    function nameOf(item: CallStackItem | undefined): string {
        if (item === undefined) return "";
        if (typeof item === "string") return item;
        if (Array.isArray(item)) return "Show More";
        if (item instanceof ThreadAndSessionIds) return "Load More";
        if (isDebugSession(item)) return item.getLabel();
        return item.name;
    }

    /** Puts the cursor on the row of `name` with the arrow keys from the top, as the user would. */
    function cursorTo(name: string): void {
        const tree = component().callStack.tree;
        tree.list.focus();
        tree.list.focusFirst();
        for (let i = 0; i < 60 && nameOf(tree.focused) !== name; i++) {
            t.h.testApp.sendKey("ArrowDown");
        }
        expect(nameOf(tree.focused)).toBe(name);
    }

    it("a stop: the threads with their state on the right, the stopped one open with 20 frames and Load 6 More", async () => {
        await t.startStopped();

        await vi.waitFor(() => {
            expect(t.screen()).toContain("Load 6 More Stack Frames");
        });
        const hello = t.find("hello");
        const state = t.find("PAUSED ON BREAKPOINT");
        expect(state.y).toBe(hello.y);
        const vars = t.vars();
        expect(t.h.testApp.backend.getFgAt(state)).toBe(vars["debugView.stateLabelForeground"]);
        // A translucent badge over the sidebar.
        expect(t.h.testApp.backend.getBgAt(state)).not.toBe(t.h.testApp.backend.getBgAt(new Point(hello.x, hello.y)));
        expect(t.find("worker-1").y).toBeGreaterThan(t.find("Load 6 More").y);
        expect(t.screen()).toContain("worker-2");

        // The top frame of the stopped thread carries the editor's arrow; the location follows the name, muted.
        const top = t.find("➜ accumulate(std::vector<int> const&)");
        expect(t.h.testApp.backend.getFgAt(top)).toBe(vars["debugIcon.breakpointCurrentStackframeForeground"]);
        const location = t.find("main.cpp:27");
        expect(location.y).toBe(top.y);
        expect(t.h.testApp.backend.getFgAt(location)).toBe(vars.descriptionForeground);
        expect(t.screen()).toContain("recurse<16>(Node*)  list.cpp:106");
        expect(t.screen()).not.toContain("recurse<17>");
        expect(t.h.testApp.backend.getFgAt(t.find("Load 6 More"))).toBe(vars["textLink.foreground"]);
    });

    it("Load More reads the rest: the subtle frames at the end fold into Show 3 More, which unfolds them muted", async () => {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Load 6 More Stack Frames");
        });

        cursorTo("Load More");
        t.h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("Show 3 More Stack Frames");
        });
        expect(t.screen()).toContain("recurse<19>(Node*)");
        expect(t.screen()).not.toContain("Load 6 More");
        expect(t.screen()).not.toContain("_start");

        cursorTo("Show More");
        t.h.testApp.sendKey("Enter");

        await vi.waitFor(() => {
            expect(t.screen()).toContain("_start");
        });
        // No source: muted, no location.
        const start = t.find("_start");
        expect(t.h.testApp.backend.getFgAt(start)).toBe(t.vars().descriptionForeground);
        expect(t.lines()[start.y]).not.toContain(".cpp");
        expect(t.screen()).toContain("__libc_start_main_impl");
    });

    /** A left click on the cell at `point` (the terminal's mouse coordinates are 1-based). */
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
        t.h.testApp.render();
    }

    it("a click on Load More reads the rest, as Enter (`workbench.list.openMode: singleClick`)", async () => {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Load 6 More Stack Frames");
        });

        click(t.find("Load 6 More Stack Frames"));
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Show 3 More Stack Frames");
        });
        expect(t.screen()).toContain("recurse<19>(Node*)");
    });

    it("with `openMode: doubleClick` a click on Load More only puts the cursor there", async () => {
        await t.h.container.get(IConfigurationServiceDIToken).updateValue("workbench.list.openMode", "doubleClick");
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("Load 6 More Stack Frames");
        });

        click(t.find("Load 6 More Stack Frames"));
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(nameOf(component().callStack.tree.focused)).toBe("Load More");
        expect(t.screen()).toContain("Load 6 More Stack Frames");
    });

    it("the cursor on a frame focuses it: VARIABLES follow, the frame gets the focused marker", async () => {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("process(Config const&)");
        });
        expect(focusedFrameName()).toBe("accumulate(std::vector<int> const&)");

        cursorTo("process(Config const&)");

        // The frame's file opens first, then the focus moves (upstream `focusStackFrame`).
        await vi.waitFor(() => {
            expect(focusedFrameName()).toBe("process(Config const&)");
            const marker = t.find("➜ process(Config const&)");
            expect(t.h.testApp.backend.getFgAt(marker)).toBe(t.vars()["debugIcon.breakpointStackframeForeground"]);
        });
        // The top frame keeps its arrow.
        expect(t.screen()).toContain("➜ accumulate(");
        const keys = t.h.container.get(ContextKeyServiceDIToken);
        t.h.container.get(WorkbenchContextKeysDIToken).update();
        expect(keys.getRaw("callStackFocused")).toBe(true);
        expect(keys.getRaw("callStackItemType")).toBe("stackFrame");
        // VARIABLES read the frame's scopes at once: an explicit frame change is not postponed.
        t.h.container.get(ViewsServiceDIToken).setViewVisible(VARIABLES_VIEW_ID, true);
        await vi.waitFor(() => {
            expect(t.screen()).toContain("argc: 3");
        });
    });

    it("a thread row: its state, the type keys, and its frames with the deemphasized run folded first", async () => {
        await t.startStopped();
        await vi.waitFor(() => {
            expect(t.screen()).toContain("worker-1");
        });

        cursorTo("worker-1");
        // The keys are computed before a key is dispatched.
        t.h.container.get(WorkbenchContextKeysDIToken).update();
        const keys = t.h.container.get(ContextKeyServiceDIToken);
        expect(keys.getRaw("callStackItemType")).toBe("thread");
        expect(keys.getRaw("callStackItemStopped")).toBe(true);
        expect(t.h.container.get(DebugServiceDIToken).getViewModel().focusedThread?.name).toBe("worker-1");

        t.h.testApp.sendKey("ArrowRight");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("WorkQueue::pop()  queue.cpp:18");
        });
        const fold = t.find("Show 2 More Stack Frames");
        expect(fold.y).toBe(t.find("worker-1").y + 1);
    });

    it("one thread left: no thread rows, its state goes to the view's title", async () => {
        await t.startStopped();
        const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        await vi.waitFor(() => {
            expect(t.screen()).toContain("worker-2");
        });

        for (const thread of session?.getAllThreads().filter((th) => th.threadId !== 1) ?? []) {
            await thread.terminate();
        }

        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("worker-1");
        });
        // The narrow sidebar cuts the message.
        await vi.waitFor(() => {
            const title = t.find("CALL STACK");
            expect(t.lines()[title.y]).toContain("Paused o");
        });
        // The frames are at the top level, without the thread row: right under the line under the header.
        expect(t.find("accumulate(").y).toBe(t.find("CALL STACK").y + 2);
        expect(t.screen()).not.toContain("PAUSED ON BREAKPOINT");
    });

    it("one thread: a step keeps 'Paused on step' in the title when the adapter sends `continued` first, as CodeLLDB", async () => {
        const factory = await t.startStopped();
        const session = t.h.container.get(DebugServiceDIToken).getViewModel().focusedSession;
        for (const thread of session?.getAllThreads().filter((th) => th.threadId !== 1) ?? []) {
            await thread.terminate();
        }
        await vi.waitFor(() => {
            expect(t.lines()[t.find("CALL STACK").y]).toContain("Paused o");
        });
        // CodeLLDB answers `next`, then reports every thread running, then the stop (stock 1.12.3, seen live).
        const adapter = factory.adapters[0];
        const sendMessage = adapter.sendMessage.bind(adapter);
        adapter.sendMessage = (message) => {
            sendMessage(message);
            if (message.type === "request" && (message as DebugProtocol.Request).command === "next") {
                adapter.acceptMessage({
                    type: "event",
                    seq: 0,
                    event: "continued",
                    body: { threadId: 0, allThreadsContinued: true },
                } as DebugProtocol.ContinuedEvent);
            }
        };

        await t.h.commands.execute("workbench.action.debug.stepOver");
        await vi.waitFor(() => {
            expect(t.screen()).toContain("main.cpp:28");
        });

        await vi.waitFor(() => {
            expect(t.lines()[t.find("CALL STACK").y]).toContain("Paused o");
        });
    });

    it("an exception stop paints the thread's state in the exception colors", async () => {
        await t.startStopped();
        for (let i = 0; i < 3; i++) {
            await t.h.commands.execute("workbench.action.debug.stepOver");
            await vi.waitFor(() => {
                expect(t.h.container.get(ContextKeyServiceDIToken).getRaw("debugState")).toBe("stopped");
            });
        }

        await vi.waitFor(() => {
            expect(t.screen()).toContain("EXCEPTION");
        });
        const label = t.find("EXCEPTION");
        expect(t.h.testApp.backend.getFgAt(label)).toBe(t.vars()["debugView.exceptionLabelForeground"]);
        expect(t.h.testApp.backend.getBgAt(label)).toBe(t.vars()["debugView.exceptionLabelBackground"]);
    });

    it("two sessions: a row per session with its state; Collapse All folds them", async () => {
        await t.startStopped();
        await t.h.commands.execute("debug.startFromConfig", { ...SYNTHETIC_LAUNCH_CONFIG, name: "second" });

        await vi.waitFor(() => {
            expect(t.screen()).toContain("second");
        });
        await vi.waitFor(() => {
            const sessionRow = t.lines()[t.find("second").y];
            expect(sessionRow).toContain("※ second");
            expect(sessionRow).toContain("PAUSED ON");
        });

        await t.h.commands.execute("callStack.collapse");

        await vi.waitFor(() => {
            expect(t.screen()).not.toContain("accumulate(");
        });
        expect(t.screen()).toContain(SYNTHETIC_LAUNCH_CONFIG.name);

        // Opening the view focuses its tree; a session row sets the session keys.
        t.h.container.get(ViewsServiceDIToken).openView(CALLSTACK_VIEW_ID, true);
        const second = t.h.container
            .get(DebugServiceDIToken)
            .getModel()
            .getSessions()
            .find((s) => s.getLabel() === "second");
        component().callStack.tree.reveal(second!);
        t.h.container.get(WorkbenchContextKeysDIToken).update();
        const keys = t.h.container.get(ContextKeyServiceDIToken);
        expect(keys.getRaw("callStackFocused")).toBe(true);
        expect(keys.getRaw("callStackItemType")).toBe("session");
        expect(keys.getRaw("callStackSessionIsAttach")).toBe(false);
        expect(keys.getRaw("callStackItemStopped")).toBe(true);
        // The synthetic program runs a main thread and two workers.
        expect(keys.getRaw("callStackSessionHasOneThread")).toBe(false);
    });
});
