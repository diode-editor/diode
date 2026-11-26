// The breakpoint widget as a quick input on the real quick input: the kinds under the input line and the value of
// the kind shown, what it writes on accept (upstream's `close(true)`), the trigger and mode lists, and the question
// before a click removes a breakpoint with a condition.

import { Point, Size } from "@tuidom/core/common/geometryPromitives";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type TestDebugService, testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { QuickInputComponent } from "../../../browser/parts/quickinput/quickInputComponent.ts";
import { QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import type { IBreakpoint, IBreakpointData } from "../common/debug.ts";
import type { DebugModel } from "../common/debugModel.ts";

import { BreakpointInput, BreakpointWidgetContext } from "./breakpointInput.ts";

const FILE = Uri.file("/w/a.cpp");
const CONDITION_PLACEHOLDER = "Break when expression evaluates to true. 'Enter' to accept, 'Escape' to cancel.";

describe("BreakpointInput", () => {
    let store: DisposableStore;
    let model: DebugModel;
    let service: TestDebugService;
    let answers: { notification: number | undefined };
    let notifications: { message: string; items?: readonly string[]; modal?: boolean; closeAffordance?: number }[];
    let component: QuickInputComponent;
    let testApp: TestApp;
    let input: BreakpointInput;

    beforeEach(() => {
        store = new DisposableStore();
        model = createMockDebugModel(store);
        service = testDebugService(model);
        answers = { notification: undefined };
        notifications = [];
        component = new QuickInputComponent();
        const body = new BodyElement();
        testApp = TestApp.create(body, new Size(110, 16));
        component.attachHost(body);
        input = new BreakpointInput(
            service,
            new QuickInputService(component),
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

    function type(text: string): void {
        for (const ch of text) testApp.sendKey(ch);
    }

    /** Replaces the input line's text, the cursor being at its end. */
    function retype(text: string): void {
        for (const _ of component.view.getQuery()) testApp.sendKey("Backspace");
        type(text);
    }

    function screen(): string {
        testApp.render();
        return Array.from({ length: 16 }, (_, y) => testApp.backend.getTextAt(new Point(0, y), 110).trimEnd()).join(
            "\n",
        );
    }

    /** The widget's state: the input line, its placeholder, the rows with their descriptions, the active row. */
    function widget(): { value: string; placeholder: string; rows: string[]; active: string | undefined } {
        const view = component.view;
        return {
            value: view.getQuery(),
            placeholder: view.placeholder,
            rows: view.items.map((item) => (item.description ? `${item.label}: ${item.description}` : item.label)),
            active: view.items.at(view.selectedIndex)?.label,
        };
    }

    /** Lets the lists the widget opens after a choice come up. */
    async function settle(): Promise<void> {
        await new Promise((resolve) => setTimeout(resolve));
    }

    function updates(): unknown[] {
        return vi
            .mocked(service.updateBreakpoints)
            .mock.calls.map(([uri, data, onSave]) => [uri, Object.fromEntries(data), onSave]);
    }

    describe("show", () => {
        it("on an empty line shows the kinds under an empty line, Expression first; Enter adds the conditional breakpoint", async () => {
            const shown = input.show(FILE, 4, undefined);
            expect(widget()).toEqual({
                value: "",
                placeholder: CONDITION_PLACEHOLDER,
                rows: ["Expression", "Hit Count", "Log Message", "Wait for Breakpoint"],
                active: "Expression",
            });
            type("i % 100 == 0");
            expect(screen()).toContain("i % 100 == 0");
            // The value is no filter: every kind stays.
            expect(widget().rows).toHaveLength(4);
            testApp.sendKey("Enter");
            await shown;

            expect(component.isOpen()).toBe(false);
            expect(service.addBreakpoints).toHaveBeenCalledWith(FILE, [
                {
                    lineNumber: 4,
                    column: undefined,
                    enabled: true,
                    condition: "i % 100 == 0",
                    hitCondition: undefined,
                    logMessage: undefined,
                    triggeredBy: undefined,
                    mode: undefined,
                    modeLabel: undefined,
                },
            ]);
        });

        it("the arrows switch the kind: each keeps what was typed for it, and all of them are written", async () => {
            const shown = input.show(FILE, 4, 3);
            type("x > 1");
            testApp.sendKey("ArrowDown");
            expect(widget()).toEqual({
                value: "",
                placeholder: "Break when hit count condition is met. 'Enter' to accept, 'Escape' to cancel.",
                rows: ["Expression: x > 1", "Hit Count", "Log Message", "Wait for Breakpoint"],
                active: "Hit Count",
            });
            type(">= 3");
            testApp.sendKey("ArrowDown");
            expect(widget().placeholder).toBe(
                "Message to log when breakpoint is hit. Expressions within {} are interpolated. 'Enter' to accept, 'Escape' to cancel.",
            );
            type("sum={sum} i={i}");
            testApp.sendKey("ArrowUp");
            testApp.sendKey("ArrowUp");
            expect(widget().value).toBe("x > 1");
            retype("x > 2");
            testApp.sendKey("Enter");
            await shown;

            expect(service.addBreakpoints).toHaveBeenCalledWith(FILE, [
                expect.objectContaining({
                    lineNumber: 4,
                    column: 3,
                    condition: "x > 2",
                    hitCondition: ">= 3",
                    logMessage: "sum={sum} i={i}",
                }),
            ]);
        });

        it("asked for a kind starts on it; an empty answer still writes the asked field", async () => {
            let shown = input.show(FILE, 4, 3, BreakpointWidgetContext.LOG_MESSAGE);
            expect(widget().active).toBe("Log Message");
            testApp.sendKey("Enter");
            await shown;
            shown = input.show(FILE, 5, undefined, BreakpointWidgetContext.CONDITION);
            testApp.sendKey("Enter");
            await shown;
            shown = input.show(FILE, 6, undefined, BreakpointWidgetContext.HIT_COUNT);
            expect(widget().active).toBe("Hit Count");
            testApp.sendKey("Enter");
            await shown;

            expect(vi.mocked(service.addBreakpoints).mock.calls).toEqual([
                [FILE, [expect.objectContaining({ column: 3, condition: undefined, logMessage: "" })]],
                [FILE, [expect.objectContaining({ condition: "", hitCondition: undefined })]],
                [FILE, [expect.objectContaining({ condition: undefined, hitCondition: "" })]],
            ]);
        });

        it("Escape changes nothing", async () => {
            let shown = input.show(FILE, 4, undefined);
            type("x");
            testApp.sendKey("Escape");
            await shown;
            add({ lineNumber: 5, condition: "a" });
            shown = input.show(FILE, 5, undefined);
            testApp.sendKey("Escape");
            await shown;

            expect(service.addBreakpoints).not.toHaveBeenCalled();
            expect(service.updateBreakpoints).not.toHaveBeenCalled();
        });

        it("on a breakpoint starts on its kind with its values, keeps its other fields, and sends it at once", async () => {
            const logpoint = add({ lineNumber: 2, logMessage: "hi {x}", hitCondition: "" });
            const hits = add({ lineNumber: 3, hitCondition: "5", logMessage: "m" });
            const conditional = add({ lineNumber: 4, condition: "c", hitCondition: "2", logMessage: "m" });

            let shown = input.show(FILE, 2, undefined);
            expect(widget()).toEqual(
                expect.objectContaining({
                    value: "hi {x}",
                    active: "Log Message",
                    rows: expect.arrayContaining(["Log Message: hi {x}"]) as unknown,
                }),
            );
            retype("bye");
            testApp.sendKey("Enter");
            await shown;
            shown = input.show(FILE, 3, undefined);
            expect(widget().value).toBe("5");
            retype("6");
            testApp.sendKey("Enter");
            await shown;
            shown = input.show(FILE, 4, undefined);
            expect(widget()).toEqual(
                expect.objectContaining({
                    value: "c",
                    active: "Expression",
                    rows: ["Expression: c", "Hit Count: 2", "Log Message: m", "Wait for Breakpoint"],
                }),
            );
            retype("d");
            testApp.sendKey("Enter");
            await shown;

            const fields = { triggeredBy: undefined, mode: undefined, modeLabel: undefined };
            expect(updates()).toEqual([
                [
                    FILE,
                    {
                        [logpoint.getId()]: {
                            condition: undefined,
                            hitCondition: undefined,
                            logMessage: "bye",
                            ...fields,
                        },
                    },
                    false,
                ],
                [
                    FILE,
                    { [hits.getId()]: { condition: undefined, hitCondition: "6", logMessage: "m", ...fields } },
                    false,
                ],
                [
                    FILE,
                    { [conditional.getId()]: { condition: "d", hitCondition: "2", logMessage: "m", ...fields } },
                    false,
                ],
            ]);
        });

        it("Enter on Wait for Breakpoint lists the other breakpoints without logpoints; the pick drops the conditions", async () => {
            const other = add({ lineNumber: 1 }, Uri.file("/w/b.cpp"));
            add({ lineNumber: 2, logMessage: "log" });
            const edited = add({ lineNumber: 9, condition: "c" });

            const shown = input.show(FILE, 9, undefined, BreakpointWidgetContext.TRIGGER_POINT);
            expect(widget()).toEqual(
                expect.objectContaining({
                    value: "",
                    placeholder: "Select breakpoint. 'Enter' to pick, 'Escape' to cancel.",
                    active: "Wait for Breakpoint",
                }),
            );
            testApp.sendKey("Enter");
            await settle();
            expect(widget()).toEqual(
                expect.objectContaining({ placeholder: "Wait for Breakpoint", rows: ["w/b.cpp: 1"] }),
            );
            testApp.sendKey("Enter");
            await shown;

            expect(updates()).toEqual([
                [
                    FILE,
                    {
                        [edited.getId()]: {
                            condition: undefined,
                            hitCondition: undefined,
                            logMessage: undefined,
                            triggeredBy: other.getId(),
                            mode: undefined,
                            modeLabel: undefined,
                        },
                    },
                    false,
                ],
            ]);
        });

        it("a breakpoint waiting for another starts on the trigger, named; Escape in the list comes back to the kinds", async () => {
            const trigger = add({ lineNumber: 1 });
            add({ lineNumber: 2, triggeredBy: trigger.getId() });

            const shown = input.show(FILE, 2, undefined);
            expect(widget()).toEqual(
                expect.objectContaining({
                    active: "Wait for Breakpoint",
                    rows: expect.arrayContaining(["Wait for Breakpoint: w/a.cpp: 1"]) as unknown,
                }),
            );
            testApp.sendKey("Enter");
            await settle();
            testApp.sendKey("Escape");
            await settle();
            expect(widget().active).toBe("Wait for Breakpoint");
            testApp.sendKey("Escape");
            await shown;

            expect(service.updateBreakpoints).not.toHaveBeenCalled();
        });

        it("with more than one mode of source breakpoints, the Mode row picks the mode, written with its label", async () => {
            model.registerBreakpointModes("lldb", [
                { mode: "hw", label: "Hardware", description: "In the CPU", appliesTo: ["source"] },
                { mode: "sw", label: "Software", appliesTo: ["source"] },
            ]);
            const breakpoint = add({ lineNumber: 3, mode: "sw", modeLabel: "Software" });

            const shown = input.show(FILE, 3, undefined);
            expect(widget().rows).toEqual([
                "Mode: Software",
                "Expression",
                "Hit Count",
                "Log Message",
                "Wait for Breakpoint",
            ]);
            expect(widget().active).toBe("Expression");
            type("x");
            testApp.sendKey("ArrowUp");
            expect(widget()).toEqual(
                expect.objectContaining({
                    value: "",
                    placeholder: "Mode. 'Enter' to pick, 'Escape' to cancel.",
                    active: "Mode",
                }),
            );
            testApp.sendKey("Enter");
            await settle();
            expect(widget()).toEqual(
                expect.objectContaining({
                    placeholder: "Select Breakpoint Mode",
                    rows: ["Hardware: In the CPU", "Software"],
                    active: "Software",
                }),
            );
            testApp.sendKey("ArrowUp");
            testApp.sendKey("Enter");
            await settle();
            // Back on the kinds, on the Mode row; Escape in the mode list keeps the mode.
            expect(widget()).toEqual(
                expect.objectContaining({
                    active: "Mode",
                    rows: expect.arrayContaining(["Mode: Hardware", "Expression: x"]) as unknown,
                }),
            );
            testApp.sendKey("Enter");
            await settle();
            testApp.sendKey("Escape");
            await settle();
            expect(widget().active).toBe("Mode");
            testApp.sendKey("ArrowDown");
            expect(widget().value).toBe("x");
            testApp.sendKey("Enter");
            await shown;

            expect(updates()).toEqual([
                [
                    FILE,
                    {
                        [breakpoint.getId()]: expect.objectContaining({
                            condition: "x",
                            mode: "hw",
                            modeLabel: "Hardware",
                        }) as unknown,
                    },
                    false,
                ],
            ]);
        });

        it("a new breakpoint with modes offered starts without a mode, and is added without one unless picked", async () => {
            model.registerBreakpointModes("lldb", [
                { mode: "hw", label: "Hardware", appliesTo: ["source"] },
                { mode: "sw", label: "Software", appliesTo: ["source"] },
            ]);
            const shown = input.show(FILE, 8, undefined);
            expect(widget().rows[0]).toBe("Mode");
            testApp.sendKey("Enter");
            await shown;

            expect(service.addBreakpoints).toHaveBeenCalledWith(FILE, [
                expect.objectContaining({ lineNumber: 8, mode: undefined, modeLabel: undefined }),
            ]);
        });

        it("one mode only is no choice, and nothing is written of it", async () => {
            model.registerBreakpointModes("lldb", [{ mode: "only", label: "Only", appliesTo: ["source"] }]);
            const breakpoint = add({ lineNumber: 3, mode: "only", modeLabel: "Only" });
            const shown = input.show(FILE, 3, undefined);
            expect(widget().rows).toHaveLength(4);
            testApp.sendKey("Enter");
            await shown;

            expect(updates()).toEqual([
                [
                    FILE,
                    {
                        [breakpoint.getId()]: expect.objectContaining({
                            mode: undefined,
                            modeLabel: undefined,
                        }) as unknown,
                    },
                    false,
                ],
            ]);
        });
    });

    describe("confirmRemoval", () => {
        it("asks modally, with upstream's message and buttons, Cancel as the close", async () => {
            const breakpoint = add({ lineNumber: 1, condition: "c" });
            await input.confirmRemoval([breakpoint], true);

            expect(notifications).toEqual([
                expect.objectContaining({
                    severity: "info",
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

        it("of a logpoint and a conditional breakpoint names the condition", async () => {
            const logpoint = add({ lineNumber: 1, logMessage: "m" });
            const conditional = add({ lineNumber: 1, column: 4, condition: "c" });
            await input.confirmRemoval([logpoint, conditional], true);

            expect(notifications[0].items).toEqual(["Remove Breakpoint", "Disable Breakpoint", "Cancel"]);
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
