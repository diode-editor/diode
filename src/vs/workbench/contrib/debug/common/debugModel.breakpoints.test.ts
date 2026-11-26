/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/breakpoints.test.ts
// The model's part of the suite. Not here: `getExpandedBodySize` (BREAKPOINTS view), "message and class name" and
// "decorations" (the editor), each with its task; `createTestSession` (a `DebugSession`, the session task) is a
// session id, all the model reads of it. "updates when storage changes" becomes a reload on a workspace switch:
// there is no other window writing the store.

import assert from "assert";
import { beforeEach as setup } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { createMockDebugModel, mockStateService } from "../../../../../TestUtils/mockDebug.ts";
import { dispose } from "../../../../base/common/lifecycle.ts";
import { Uri as uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { DataBreakpointSetType, type IBreakpointData, type IBreakpointUpdateData } from "./debug.ts";
import { Breakpoint, type DebugModel } from "./debugModel.ts";
import { DebugStorage } from "./debugStorage.ts";

function addBreakpointsAndCheckEvents(model: DebugModel, uri: uri, data: IBreakpointData[]) {
    let eventCount = 0;
    const toDispose = model.onDidChangeBreakpoints((e) => {
        assert.ok(e);
        assert.strictEqual(e.sessionOnly, false);
        assert.strictEqual(e.changed, undefined);
        assert.strictEqual(e.removed, undefined);
        const added = e.added;
        assert.notStrictEqual(added, undefined);
        assert.strictEqual(added!.length, data.length);
        eventCount++;
        dispose(toDispose);
        for (let i = 0; i < data.length; i++) {
            assert.strictEqual(e.added![i] instanceof Breakpoint, true);
            assert.strictEqual((e.added![i] as Breakpoint).lineNumber, data[i].lineNumber);
        }
    });
    const bps = model.addBreakpoints(uri, data);
    assert.strictEqual(eventCount, 1);
    return bps;
}

suite("Debug - Breakpoints", () => {
    let model: DebugModel;
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    setup(() => {
        model = createMockDebugModel(disposables);
    });

    // Breakpoints

    test("simple", () => {
        const modelUri = uri.file("/myfolder/myfile.js");

        addBreakpointsAndCheckEvents(model, modelUri, [
            { lineNumber: 5, enabled: true },
            { lineNumber: 10, enabled: false },
        ]);
        assert.strictEqual(model.areBreakpointsActivated(), true);
        assert.strictEqual(model.getBreakpoints().length, 2);

        let eventCount = 0;
        const toDispose = model.onDidChangeBreakpoints((e) => {
            assert.ok(e);
            eventCount++;
            assert.strictEqual(e.added, undefined);
            assert.strictEqual(e.sessionOnly, false);
            assert.strictEqual(e.removed?.length, 2);
            assert.strictEqual(e.changed, undefined);

            dispose(toDispose);
        });

        model.removeBreakpoints(model.getBreakpoints());
        assert.strictEqual(eventCount, 1);
        assert.strictEqual(model.getBreakpoints().length, 0);
    });

    test("toggling", () => {
        const modelUri = uri.file("/myfolder/myfile.js");

        addBreakpointsAndCheckEvents(model, modelUri, [
            { lineNumber: 5, enabled: true },
            { lineNumber: 10, enabled: false },
        ]);
        addBreakpointsAndCheckEvents(model, modelUri, [{ lineNumber: 12, enabled: true, condition: "fake condition" }]);
        assert.strictEqual(model.getBreakpoints().length, 3);
        const bp = model.getBreakpoints().at(-1);
        if (bp) {
            model.removeBreakpoints([bp]);
        }
        assert.strictEqual(model.getBreakpoints().length, 2);

        model.setBreakpointsActivated(false);
        assert.strictEqual(model.areBreakpointsActivated(), false);
        model.setBreakpointsActivated(true);
        assert.strictEqual(model.areBreakpointsActivated(), true);
    });

    test("two files", () => {
        const modelUri1 = uri.file("/myfolder/my file first.js");
        const modelUri2 = uri.file("/secondfolder/second/second file.js");
        addBreakpointsAndCheckEvents(model, modelUri1, [
            { lineNumber: 5, enabled: true },
            { lineNumber: 10, enabled: false },
        ]);

        addBreakpointsAndCheckEvents(model, modelUri2, [
            { lineNumber: 1, enabled: true },
            { lineNumber: 2, enabled: true },
            { lineNumber: 3, enabled: false },
        ]);

        assert.strictEqual(model.getBreakpoints().length, 5);
        assert.strictEqual(model.getBreakpoints({ uri: modelUri1 }).length, 2);
        assert.strictEqual(model.getBreakpoints({ uri: modelUri2 }).length, 3);
        assert.strictEqual(model.getBreakpoints({ lineNumber: 5 }).length, 1);
        assert.strictEqual(model.getBreakpoints({ column: 5 }).length, 0);

        const bp = model.getBreakpoints()[0];
        const update = new Map<string, IBreakpointUpdateData>();
        update.set(bp.getId(), { lineNumber: 100 });
        let eventFired = false;
        const toDispose = model.onDidChangeBreakpoints((e) => {
            assert.ok(e);
            eventFired = true;
            assert.strictEqual(e.added, undefined);
            assert.strictEqual(e.removed, undefined);
            assert.strictEqual(e.changed?.length, 1);
            dispose(toDispose);
        });
        model.updateBreakpoints(update);
        assert.strictEqual(eventFired, true);
        assert.strictEqual(bp.lineNumber, 100);

        assert.strictEqual(model.getBreakpoints({ enabledOnly: true }).length, 3);
        model.enableOrDisableAllBreakpoints(false);
        model.getBreakpoints().forEach((bp) => {
            assert.strictEqual(bp.enabled, false);
        });
        assert.strictEqual(model.getBreakpoints({ enabledOnly: true }).length, 0);

        model.setEnablement(bp, true);
        assert.strictEqual(bp.enabled, true);

        model.removeBreakpoints(model.getBreakpoints({ uri: modelUri1 }));

        assert.strictEqual(model.getBreakpoints().length, 3);
    });

    test("conditions", () => {
        const modelUri1 = uri.file("/myfolder/my file first.js");
        addBreakpointsAndCheckEvents(model, modelUri1, [
            { lineNumber: 5, condition: "i < 5", hitCondition: "17" },
            { lineNumber: 10, condition: "j < 3" },
        ]);
        const breakpoints = model.getBreakpoints();

        assert.strictEqual(breakpoints[0].condition, "i < 5");
        assert.strictEqual(breakpoints[0].hitCondition, "17");
        assert.strictEqual(breakpoints[1].condition, "j < 3");
        assert.strictEqual(!!breakpoints[1].hitCondition, false);

        assert.strictEqual(model.getBreakpoints().length, 2);
        model.removeBreakpoints(model.getBreakpoints());
        assert.strictEqual(model.getBreakpoints().length, 0);
    });

    test("function breakpoints", () => {
        model.addFunctionBreakpoint({ name: "foo" }, "1");
        model.addFunctionBreakpoint({ name: "bar" }, "2");
        model.updateFunctionBreakpoint("1", { name: "fooUpdated" });
        model.updateFunctionBreakpoint("2", { name: "barUpdated" });

        const functionBps = model.getFunctionBreakpoints();
        assert.strictEqual(functionBps[0].name, "fooUpdated");
        assert.strictEqual(functionBps[1].name, "barUpdated");

        model.removeFunctionBreakpoints();
        assert.strictEqual(model.getFunctionBreakpoints().length, 0);
    });

    test("multiple sessions", () => {
        const modelUri = uri.file("/myfolder/myfile.js");
        addBreakpointsAndCheckEvents(model, modelUri, [
            { lineNumber: 5, enabled: true, condition: "x > 5" },
            { lineNumber: 10, enabled: false },
        ]);
        const breakpoints = model.getBreakpoints();
        const session = "session-1";
        const data = new Map<string, DebugProtocol.Breakpoint>();

        assert.strictEqual(breakpoints[0].lineNumber, 5);
        assert.strictEqual(breakpoints[1].lineNumber, 10);

        data.set(breakpoints[0].getId(), { verified: false, line: 10 });
        data.set(breakpoints[1].getId(), { verified: true, line: 50 });
        model.setBreakpointSessionData(session, {}, data);
        assert.strictEqual(breakpoints[0].lineNumber, 5);
        assert.strictEqual(breakpoints[1].lineNumber, 50);

        const session2 = "session-2";
        const data2 = new Map<string, DebugProtocol.Breakpoint>();
        data2.set(breakpoints[0].getId(), { verified: true, line: 100 });
        data2.set(breakpoints[1].getId(), { verified: true, line: 500 });
        model.setBreakpointSessionData(session2, {}, data2);

        // Breakpoint is verified only once, show that line
        assert.strictEqual(breakpoints[0].lineNumber, 100);
        // Breakpoint is verified two times, show the original line
        assert.strictEqual(breakpoints[1].lineNumber, 10);

        model.setBreakpointSessionData(session, {}, undefined);
        // No more double session verification
        assert.strictEqual(breakpoints[0].lineNumber, 100);
        assert.strictEqual(breakpoints[1].lineNumber, 500);

        assert.strictEqual(breakpoints[0].supported, false);
        const data3 = new Map<string, DebugProtocol.Breakpoint>();
        data3.set(breakpoints[0].getId(), { verified: true, line: 500 });
        model.setBreakpointSessionData(session2, { supportsConditionalBreakpoints: true }, data2);
        assert.strictEqual(breakpoints[0].supported, true);
    });

    test("exception breakpoints", () => {
        let eventCount = 0;
        disposables.add(model.onDidChangeBreakpoints(() => eventCount++));
        model.setExceptionBreakpointsForSession("session-id-1", [
            { filter: "uncaught", label: "UNCAUGHT", default: true },
        ]);
        assert.strictEqual(eventCount, 1);
        let exceptionBreakpoints = model.getExceptionBreakpointsForSession("session-id-1");
        assert.strictEqual(exceptionBreakpoints.length, 1);
        assert.strictEqual(exceptionBreakpoints[0].filter, "uncaught");
        assert.strictEqual(exceptionBreakpoints[0].enabled, true);

        model.setExceptionBreakpointsForSession("session-id-2", [
            { filter: "uncaught", label: "UNCAUGHT" },
            { filter: "caught", label: "CAUGHT" },
        ]);
        assert.strictEqual(eventCount, 2);
        exceptionBreakpoints = model.getExceptionBreakpointsForSession("session-id-2");
        assert.strictEqual(exceptionBreakpoints.length, 2);
        assert.strictEqual(exceptionBreakpoints[0].filter, "uncaught");
        assert.strictEqual(exceptionBreakpoints[0].enabled, true);
        assert.strictEqual(exceptionBreakpoints[1].filter, "caught");
        assert.strictEqual(exceptionBreakpoints[1].label, "CAUGHT");
        assert.strictEqual(exceptionBreakpoints[1].enabled, false);

        model.setExceptionBreakpointsForSession("session-id-3", [{ filter: "all", label: "ALL" }]);
        assert.strictEqual(eventCount, 3);
        assert.strictEqual(model.getExceptionBreakpointsForSession("session-id-3").length, 1);
        exceptionBreakpoints = model.getExceptionBreakpoints();
        assert.strictEqual(exceptionBreakpoints[0].filter, "uncaught");
        assert.strictEqual(exceptionBreakpoints[0].enabled, true);
        assert.strictEqual(exceptionBreakpoints[1].filter, "caught");
        assert.strictEqual(exceptionBreakpoints[1].label, "CAUGHT");
        assert.strictEqual(exceptionBreakpoints[1].enabled, false);
        assert.strictEqual(exceptionBreakpoints[2].filter, "all");
        assert.strictEqual(exceptionBreakpoints[2].label, "ALL");
    });

    test("exception breakpoints multiple sessions", () => {
        let eventCount = 0;
        disposables.add(model.onDidChangeBreakpoints(() => eventCount++));

        model.setExceptionBreakpointsForSession("session-id-4", [
            { filter: "uncaught", label: "UNCAUGHT", default: true },
            { filter: "caught", label: "CAUGHT" },
        ]);
        model.setExceptionBreakpointFallbackSession("session-id-4");
        assert.strictEqual(eventCount, 1);
        let exceptionBreakpointsForSession = model.getExceptionBreakpointsForSession("session-id-4");
        assert.strictEqual(exceptionBreakpointsForSession.length, 2);
        assert.strictEqual(exceptionBreakpointsForSession[0].filter, "uncaught");
        assert.strictEqual(exceptionBreakpointsForSession[1].filter, "caught");

        model.setExceptionBreakpointsForSession("session-id-5", [
            { filter: "all", label: "ALL" },
            { filter: "caught", label: "CAUGHT" },
        ]);
        assert.strictEqual(eventCount, 2);
        exceptionBreakpointsForSession = model.getExceptionBreakpointsForSession("session-id-5");
        let exceptionBreakpointsForUndefined = model.getExceptionBreakpointsForSession(undefined);
        assert.strictEqual(exceptionBreakpointsForSession.length, 2);
        assert.strictEqual(exceptionBreakpointsForSession[0].filter, "caught");
        assert.strictEqual(exceptionBreakpointsForSession[1].filter, "all");
        assert.strictEqual(exceptionBreakpointsForUndefined.length, 2);
        assert.strictEqual(exceptionBreakpointsForUndefined[0].filter, "uncaught");
        assert.strictEqual(exceptionBreakpointsForUndefined[1].filter, "caught");

        model.removeExceptionBreakpointsForSession("session-id-4");
        assert.strictEqual(eventCount, 2);
        exceptionBreakpointsForUndefined = model.getExceptionBreakpointsForSession(undefined);
        assert.strictEqual(exceptionBreakpointsForUndefined.length, 2);
        assert.strictEqual(exceptionBreakpointsForUndefined[0].filter, "uncaught");
        assert.strictEqual(exceptionBreakpointsForUndefined[1].filter, "caught");

        model.setExceptionBreakpointFallbackSession("session-id-5");
        assert.strictEqual(eventCount, 2);
        exceptionBreakpointsForUndefined = model.getExceptionBreakpointsForSession(undefined);
        assert.strictEqual(exceptionBreakpointsForUndefined.length, 2);
        assert.strictEqual(exceptionBreakpointsForUndefined[0].filter, "caught");
        assert.strictEqual(exceptionBreakpointsForUndefined[1].filter, "all");

        const exceptionBreakpoints = model.getExceptionBreakpoints();
        assert.strictEqual(exceptionBreakpoints.length, 3);
    });

    test("instruction breakpoints", () => {
        let eventCount = 0;
        disposables.add(model.onDidChangeBreakpoints(() => eventCount++));
        //address: string, offset: number, condition?: string, hitCondition?: string
        model.addInstructionBreakpoint({
            instructionReference: "0xCCCCFFFF",
            offset: 0,
            address: 0n,
            canPersist: false,
        });

        assert.strictEqual(eventCount, 1);
        let instructionBreakpoints = model.getInstructionBreakpoints();
        assert.strictEqual(instructionBreakpoints.length, 1);
        assert.strictEqual(instructionBreakpoints[0].instructionReference, "0xCCCCFFFF");
        assert.strictEqual(instructionBreakpoints[0].offset, 0);

        model.addInstructionBreakpoint({
            instructionReference: "0xCCCCEEEE",
            offset: 1,
            address: 0n,
            canPersist: false,
        });
        assert.strictEqual(eventCount, 2);
        instructionBreakpoints = model.getInstructionBreakpoints();
        assert.strictEqual(instructionBreakpoints.length, 2);
        assert.strictEqual(instructionBreakpoints[0].instructionReference, "0xCCCCFFFF");
        assert.strictEqual(instructionBreakpoints[0].offset, 0);
        assert.strictEqual(instructionBreakpoints[1].instructionReference, "0xCCCCEEEE");
        assert.strictEqual(instructionBreakpoints[1].offset, 1);
    });

    test("data breakpoints", () => {
        let eventCount = 0;
        disposables.add(model.onDidChangeBreakpoints(() => eventCount++));

        model.addDataBreakpoint(
            {
                description: "label",
                src: { type: DataBreakpointSetType.Variable, dataId: "id" },
                canPersist: true,
                accessTypes: ["read"],
                accessType: "read",
            },
            "1",
        );
        model.addDataBreakpoint(
            {
                description: "second",
                src: { type: DataBreakpointSetType.Variable, dataId: "secondId" },
                canPersist: false,
                accessTypes: ["readWrite"],
                accessType: "readWrite",
            },
            "2",
        );
        model.updateDataBreakpoint("1", { condition: "aCondition" });
        model.updateDataBreakpoint("2", { hitCondition: "10" });
        const dataBreakpoints = model.getDataBreakpoints();
        assert.strictEqual(dataBreakpoints[0].canPersist, true);
        assert.deepStrictEqual(dataBreakpoints[0].src, { type: DataBreakpointSetType.Variable, dataId: "id" });
        assert.strictEqual(dataBreakpoints[0].accessType, "read");
        assert.strictEqual(dataBreakpoints[0].condition, "aCondition");
        assert.strictEqual(dataBreakpoints[1].canPersist, false);
        assert.strictEqual(dataBreakpoints[1].description, "second");
        assert.strictEqual(dataBreakpoints[1].accessType, "readWrite");
        assert.strictEqual(dataBreakpoints[1].hitCondition, "10");

        assert.strictEqual(eventCount, 4);

        model.removeDataBreakpoints(dataBreakpoints[0].getId());
        assert.strictEqual(eventCount, 5);
        assert.strictEqual(model.getDataBreakpoints().length, 1);

        model.removeDataBreakpoints();
        assert.strictEqual(model.getDataBreakpoints().length, 0);
        assert.strictEqual(eventCount, 6);
    });

    test("updates when the workspace store is replaced", () => {
        const state1 = mockStateService();
        const debugStorage1 = disposables.add(new DebugStorage(state1, { isDirty: () => false }, NULL_LOGGER));
        const model1 = createMockDebugModel(disposables, state1);

        // 1. create breakpoints in the first model
        const modelUri = uri.file("/myfolder/my file first.js");
        const first = [
            { lineNumber: 1, enabled: true, condition: "x > 5" },
            { lineNumber: 2, column: 4, enabled: false },
        ];

        addBreakpointsAndCheckEvents(model1, modelUri, first);
        debugStorage1.storeBreakpoints(model1);

        // 2. a model over another workspace picks the breakpoints up when that store is opened
        const state2 = mockStateService();
        const model2 = createMockDebugModel(disposables, state2);
        let reloaded = 0;
        disposables.add(model2.onDidChangeBreakpoints(() => reloaded++));
        state2.openWorkspace(state1.values);
        assert.strictEqual(reloaded, 1);
        assert.deepStrictEqual(
            model2.getBreakpoints().map((b) => b.getId()),
            model1.getBreakpoints().map((b) => b.getId()),
        );
    });
});
