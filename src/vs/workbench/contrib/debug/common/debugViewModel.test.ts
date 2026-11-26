/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/debugViewModel.test.ts

import assert from "assert";
import { afterEach as teardown, beforeEach as setup, describe, expect, it, vi } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import type { ContextKey } from "../../../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import type { IExpressionContainer } from "./debug.ts";
import { Expression, StackFrame, Thread } from "./debugModel.ts";
import { Source } from "./debugSource.ts";
import { ViewModel } from "./debugViewModel.ts";

suite("Debug - View Model", () => {
    let model: ViewModel;

    setup(() => {
        model = new ViewModel(new ContextKeyService());
    });

    teardown(() => {
        model.dispose();
    });

    ensureNoDisposablesAreLeakedInTestSuite();

    test("focused stack frame", () => {
        assert.strictEqual(model.focusedStackFrame, undefined);
        assert.strictEqual(model.focusedThread, undefined);
        const session = mockSession();
        const thread = new Thread(session, "myThread", 1);
        const source = new Source(
            {
                name: "internalModule.js",
                sourceReference: 11,
                presentationHint: "deemphasize",
            },
            "aDebugSessionId",
            NULL_LOGGER,
        );
        const frame = new StackFrame(
            thread,
            1,
            source,
            "app.js",
            "normal",
            { startColumn: 1, startLineNumber: 1, endColumn: 1, endLineNumber: 1 },
            0,
            true,
        );
        model.setFocus(frame, thread, session, false);

        assert.strictEqual(model.focusedStackFrame!.getId(), frame.getId());
        assert.strictEqual(model.focusedThread!.threadId, 1);
        assert.strictEqual(model.focusedSession!.getId(), session.getId());
    });

    test("selected expression", () => {
        assert.strictEqual(model.getSelectedExpression(), undefined);
        const expression = new Expression("my expression");
        model.setSelectedExpression(expression, false);

        assert.strictEqual(model.getSelectedExpression()?.expression, expression);
    });

    test("multi session view and changed workbench state", () => {
        assert.strictEqual(model.isMultiSessionView(), false);
        model.setMultiSessionView(true);
        assert.strictEqual(model.isMultiSessionView(), true);
    });
});

const CAPABILITY_KEYS: [keyof DebugProtocol.Capabilities, ContextKey][] = [
    ["supportsLoadedSourcesRequest", "loadedScriptsSupported"],
    ["supportsStepBack", "stepBackSupported"],
    ["supportsRestartFrame", "restartFrameSupported"],
    ["supportsStepInTargetsRequest", "stepIntoTargetsSupported"],
    ["supportsGotoTargetsRequest", "jumpToCursorSupported"],
    ["supportsSetVariable", "debugSetVariableSupported"],
    ["supportsDataBreakpointBytes", "debugSetDataBreakpointAddressSupported"],
    ["supportsSetExpression", "debugSetExpressionSupported"],
    ["supportTerminateDebuggee", "terminateDebuggeeSupported"],
    ["supportSuspendDebuggee", "suspendDebuggeeSupported"],
    ["supportsTerminateThreadsRequest", "terminateThreadsSupported"],
    ["supportsDisassembleRequest", "disassembleRequestSupported"],
];

describe("ViewModel: focus events and context keys", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    function create(): { model: ViewModel; keys: ContextKeyService } {
        const keys = disposables.add(new ContextKeyService());
        return { model: disposables.add(new ViewModel(keys)), keys };
    }

    function frameOf(thread: Thread, instructionPointerReference?: string): StackFrame {
        const source = new Source({ path: "/a.cpp" }, "s", NULL_LOGGER);
        const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
        return new StackFrame(thread, 1, source, "main", undefined, range, 0, true, instructionPointerReference);
    }

    it("writes the keys' defaults at once, like upstream's bindTo", () => {
        const { keys } = create();
        for (const [, key] of CAPABILITY_KEYS) expect(keys.get(key), key).toBe(false);
        expect(keys.get("expressionSelected")).toBe(false);
        expect(keys.get("multiSessionDebug")).toBe(false);
        expect(keys.get("focusedSessionIsAttach")).toBe(false);
        expect(keys.get("focusedSessionIsNoDebug")).toBe(false);
        expect(keys.get("focusedStackFrameHasInstructionReference")).toBe(false);
    });

    it("each capability of the focused session sets its key", () => {
        for (const [capability, key] of CAPABILITY_KEYS) {
            const { model, keys } = create();
            const session = mockSession({ capabilities: { [capability]: true } });
            model.setFocus(undefined, undefined, session, false);
            for (const [, other] of CAPABILITY_KEYS)
                expect(keys.get(other), `${capability} → ${other}`).toBe(other === key);
        }
    });

    it("attach, noDebug and an instruction pointer of the focus set their keys, losing the focus clears them", () => {
        const { model, keys } = create();
        const session = mockSession({
            configuration: { type: "lldb", request: "attach", name: "a", noDebug: true },
        });
        const thread = new Thread(session, "main", 1);
        model.setFocus(frameOf(thread, "0x1000"), thread, session, true);
        expect(keys.get("focusedSessionIsAttach")).toBe(true);
        expect(keys.get("focusedSessionIsNoDebug")).toBe(true);
        expect(keys.get("focusedStackFrameHasInstructionReference")).toBe(true);

        model.setFocus(undefined, undefined, undefined, false);
        expect(keys.get("focusedSessionIsAttach")).toBe(false);
        expect(keys.get("focusedSessionIsNoDebug")).toBe(false);
        expect(keys.get("focusedStackFrameHasInstructionReference")).toBe(false);
    });

    it("fires the session and the frame, or the thread when the frame stays, and nothing when nothing changes", () => {
        const { model } = create();
        const sessions = vi.fn();
        const threads = vi.fn();
        const frames = vi.fn();
        disposables.add(model.onDidFocusSession(sessions));
        disposables.add(model.onDidFocusThread(threads));
        disposables.add(model.onDidFocusStackFrame(frames));

        const session = mockSession();
        const thread = new Thread(session, "main", 1);
        const frame = frameOf(thread);
        model.setFocus(frame, thread, session, true);
        expect(sessions).toHaveBeenCalledExactlyOnceWith(session);
        expect(frames).toHaveBeenCalledExactlyOnceWith({ stackFrame: frame, explicit: true, session });
        expect(threads).not.toHaveBeenCalled();

        const other = new Thread(session, "worker", 2);
        model.setFocus(frame, other, session, false);
        expect(threads).toHaveBeenCalledExactlyOnceWith({ thread: other, explicit: false, session });
        expect(sessions).toHaveBeenCalledOnce();
        expect(frames).toHaveBeenCalledOnce();

        model.setFocus(frame, other, session, false);
        expect(sessions).toHaveBeenCalledOnce();
        expect(threads).toHaveBeenCalledOnce();
        expect(frames).toHaveBeenCalledOnce();
    });

    it("selecting an expression sets expressionSelected and fires, clearing does both back", () => {
        const { model, keys } = create();
        const selected = vi.fn();
        disposables.add(model.onDidSelectExpression(selected));
        const expression = new Expression("x");
        model.setSelectedExpression(expression, true);
        expect(keys.get("expressionSelected")).toBe(true);
        expect(selected).toHaveBeenLastCalledWith({ expression, settingWatch: true });

        model.setSelectedExpression(undefined, false);
        expect(keys.get("expressionSelected")).toBe(false);
        expect(model.getSelectedExpression()).toBeUndefined();
        expect(selected).toHaveBeenLastCalledWith(undefined);
    });

    it("updateViews fires onWillUpdateViews, a lazy expression fires after it is evaluated", async () => {
        const { model } = create();
        const updates = vi.fn();
        disposables.add(model.onWillUpdateViews(updates));
        model.updateViews();
        expect(updates).toHaveBeenCalledOnce();

        const evaluated = vi.fn();
        disposables.add(model.onDidEvaluateLazyExpression(evaluated));
        const order: string[] = [];
        const expression = {
            evaluateLazy: () => {
                order.push("evaluate");
                return Promise.resolve();
            },
        } as unknown as IExpressionContainer;
        disposables.add(model.onDidEvaluateLazyExpression(() => order.push("fire")));
        await model.evaluateLazyExpression(expression);
        expect(evaluated).toHaveBeenCalledExactlyOnceWith(expression);
        expect(order).toEqual(["evaluate", "fire"]);
    });

    it("is the root of the view tree", () => {
        expect(create().model.getId()).toBe("root");
    });
});
