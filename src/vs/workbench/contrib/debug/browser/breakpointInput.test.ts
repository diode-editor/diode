// The breakpoint widget as a quick input: what it asks, what it starts with, what it writes on accept (upstream's
// `close(true)`), the trigger list, and the question before a click removes a breakpoint with a condition.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { testDebugService, type TestDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { QuickPickItem } from "../../../common/quickPickItem.ts";
import type { IBreakpoint, IBreakpointData } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { BreakpointInput, BreakpointWidgetContext } from "./breakpointInput.ts";

const FILE = Uri.file("/w/a.cpp");

describe("BreakpointInput", () => {
    let store: DisposableStore;
    let model: DebugModel;
    let service: TestDebugService;
    let answers: { input: string | undefined; pick: number | undefined; notification: number | undefined };
    let inputs: { placeholder?: string; value?: string }[];
    let picks: { placeholder?: string; items: readonly QuickPickItem[] }[];
    let notifications: { message: string; items?: readonly string[]; modal?: boolean; closeAffordance?: number }[];
    let input: BreakpointInput;

    beforeEach(() => {
        store = new DisposableStore();
        model = createMockDebugModel(store);
        service = testDebugService(model);
        answers = { input: undefined, pick: undefined, notification: undefined };
        inputs = [];
        picks = [];
        notifications = [];
        input = new BreakpointInput(
            service,
            {
                input: (opts = {}) => {
                    inputs.push(opts);
                    return Promise.resolve(answers.input);
                },
                quickPick: (opts) => {
                    picks.push(opts);
                    return Promise.resolve(answers.pick === undefined ? undefined : opts.items[answers.pick]);
                },
            },
            {
                show: (message) => {
                    notifications.push(message as (typeof notifications)[number]);
                    return { answered: Promise.resolve(answers.notification) } as never;
                },
            },
            { uriLabel: (uri) => uri.path.slice(1) },
        );
    });

    afterEach(() => {
        store.dispose();
    });

    function add(data: IBreakpointData, uri = FILE): IBreakpoint {
        const [breakpoint] = model.addBreakpoints(uri, [data]);
        return breakpoint;
    }

    describe("show", () => {
        it("on an empty line asks for a condition and adds a conditional breakpoint with it", async () => {
            answers.input = "x > 1";
            await input.show(FILE, 4, undefined);

            expect(inputs).toEqual([
                {
                    placeholder: "Break when expression evaluates to true. 'Enter' to accept, 'Escape' to cancel.",
                    value: "",
                },
            ]);
            expect(service.addBreakpoints).toHaveBeenCalledWith(FILE, [
                {
                    lineNumber: 4,
                    column: undefined,
                    enabled: true,
                    condition: "x > 1",
                    hitCondition: undefined,
                    logMessage: undefined,
                    triggeredBy: undefined,
                },
            ]);
        });

        it("asked for a log message adds a logpoint; an empty answer still writes the asked field", async () => {
            answers.input = "";
            await input.show(FILE, 4, 3, BreakpointWidgetContext.LOG_MESSAGE);

            expect(inputs[0].placeholder).toBe(
                "Message to log when breakpoint is hit. Expressions within {} are interpolated. 'Enter' to accept, 'Escape' to cancel.",
            );
            expect(service.addBreakpoints).toHaveBeenCalledWith(FILE, [
                expect.objectContaining({ lineNumber: 4, column: 3, condition: undefined, logMessage: "" }),
            ]);
        });

        it("asked for a hit count writes it", async () => {
            answers.input = ">= 3";
            await input.show(FILE, 4, undefined, BreakpointWidgetContext.HIT_COUNT);

            expect(inputs[0].placeholder).toBe(
                "Break when hit count condition is met. 'Enter' to accept, 'Escape' to cancel.",
            );
            expect(service.addBreakpoints).toHaveBeenCalledWith(FILE, [
                expect.objectContaining({ hitCondition: ">= 3", condition: undefined, logMessage: undefined }),
            ]);
        });

        it("Escape changes nothing", async () => {
            await input.show(FILE, 4, undefined);
            add({ lineNumber: 5, condition: "a" });
            await input.show(FILE, 5, undefined);

            expect(service.addBreakpoints).not.toHaveBeenCalled();
            expect(service.updateBreakpoints).not.toHaveBeenCalled();
        });

        it("on a breakpoint edits it in its kind, keeping its other fields, and sends it at once", async () => {
            const logpoint = add({ lineNumber: 2, logMessage: "hi {x}", hitCondition: "" });
            const hits = add({ lineNumber: 3, hitCondition: "5", logMessage: "m" });
            const conditional = add({ lineNumber: 4, condition: "c", hitCondition: "2", logMessage: "m" });

            answers.input = "bye";
            await input.show(FILE, 2, undefined);
            answers.input = "6";
            await input.show(FILE, 3, undefined);
            answers.input = "d";
            await input.show(FILE, 4, undefined);

            expect(inputs.map((i) => i.value)).toEqual(["hi {x}", "5", "c"]);
            const updates = vi.mocked(service.updateBreakpoints).mock.calls.map(([uri, data, onSave]) => [
                uri,
                Object.fromEntries(data),
                onSave,
            ]);
            expect(updates).toEqual([
                [
                    FILE,
                    {
                        [logpoint.getId()]: {
                            condition: undefined,
                            hitCondition: undefined,
                            logMessage: "bye",
                            triggeredBy: undefined,
                        },
                    },
                    false,
                ],
                [
                    FILE,
                    {
                        [hits.getId()]: {
                            condition: undefined,
                            hitCondition: "6",
                            logMessage: "m",
                            triggeredBy: undefined,
                        },
                    },
                    false,
                ],
                [
                    FILE,
                    {
                        [conditional.getId()]: {
                            condition: "d",
                            hitCondition: "2",
                            logMessage: "m",
                            triggeredBy: undefined,
                        },
                    },
                    false,
                ],
            ]);
        });

        it("a trigger point is picked from the other breakpoints without logpoints, and drops the conditions", async () => {
            const other = add({ lineNumber: 1 }, Uri.file("/w/b.cpp"));
            add({ lineNumber: 2, logMessage: "log" });
            const edited = add({ lineNumber: 9, condition: "c" });

            answers.pick = 0;
            await input.show(FILE, 9, undefined, BreakpointWidgetContext.TRIGGER_POINT);

            expect(picks).toEqual([{ placeholder: "Wait for Breakpoint", items: [{ label: "w/b.cpp: 1" }] }]);
            expect(inputs).toEqual([]);
            const [[, data]] = vi.mocked(service.updateBreakpoints).mock.calls;
            expect(Object.fromEntries(data)).toEqual({
                [edited.getId()]: {
                    condition: undefined,
                    hitCondition: undefined,
                    logMessage: undefined,
                    triggeredBy: other.getId(),
                },
            });
        });

        it("a breakpoint waiting for another opens the trigger list; nothing picked, nothing changes", async () => {
            const trigger = add({ lineNumber: 1 });
            add({ lineNumber: 2, triggeredBy: trigger.getId() });

            await input.show(FILE, 2, undefined);

            expect(picks).toHaveLength(1);
            expect(service.updateBreakpoints).not.toHaveBeenCalled();
        });
    });

    describe("confirmRemoval", () => {
        it("asks modally, with upstream's message and buttons, Cancel as the close", async () => {
            const breakpoint = add({ lineNumber: 1, condition: "c" });
            await input.confirmRemoval([breakpoint], true);

            expect(notifications).toEqual([
                expect.objectContaining({
                    message:
                        "This breakpoint has a condition that will get lost on remove. Consider disabling the breakpoint instead.",
                    modal: true,
                    items: ["Remove Breakpoint", "Disable Breakpoint", "Cancel"],
                    closeAffordance: 2,
                }),
            ]);
            expect(service.removeBreakpoints).not.toHaveBeenCalled();
            expect(service.enableOrDisableBreakpoints).not.toHaveBeenCalled();
        });

        it("of logpoints that are disabled names the message and offers enabling", async () => {
            const logpoint = add({ lineNumber: 1, logMessage: "m", enabled: false });
            await input.confirmRemoval([logpoint], false);

            expect(notifications[0]).toEqual(
                expect.objectContaining({
                    message:
                        "This logpoint has a message that will get lost on remove. Consider enabling the logpoint instead.",
                    items: ["Remove Logpoint", "Enable Logpoint", "Cancel"],
                }),
            );
        });

        it("Remove removes them all, the second button flips their enablement", async () => {
            const a = add({ lineNumber: 1, condition: "c" });
            const b = add({ lineNumber: 1, column: 4 });

            answers.notification = 0;
            await input.confirmRemoval([a, b], true);
            expect(vi.mocked(service.removeBreakpoints).mock.calls).toEqual([[a.getId()], [b.getId()]]);

            answers.notification = 1;
            await input.confirmRemoval([a, b], true);
            expect(vi.mocked(service.enableOrDisableBreakpoints).mock.calls).toEqual([
                [false, a],
                [false, b],
            ]);
        });
    });
});
