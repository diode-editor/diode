/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/common/debugModel.test.ts
// `mockObject` (sinon) is a plain object with `vi.fn`, `runWithFakedTimers` is vitest's fake timers.

import assert from "assert";
import { vi } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { createMockDebugModel, mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { DeferredPromise } from "../../../../base/common/async.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";

import type { IInstructionBreakpoint } from "./debug.ts";
import { type DebugModel, ExceptionBreakpoint, FunctionBreakpoint, type Thread } from "./debugModel.ts";

suite("DebugModel", () => {
    ensureNoDisposablesAreLeakedInTestSuite();

    suite("FunctionBreakpoint", () => {
        test("Id is saved", () => {
            const fbp = new FunctionBreakpoint({
                name: "function",
                enabled: true,
                hitCondition: "hit condition",
                condition: "condition",
                logMessage: "log message",
            });
            const strigified = JSON.stringify(fbp);
            const parsed = JSON.parse(strigified) as { id: string };
            assert.equal(parsed.id, fbp.getId());
        });
    });

    suite("InstructionBreakpoint", () => {
        function createModel(disposable: DisposableStore): DebugModel {
            return createMockDebugModel(disposable);
        }

        // Regression test for microsoft/vscode#289678: if the debug adapter hands
        // out a new `instructionReference` for the same memory location (e.g.
        // after a symbol reload or certain stepping operations), removal by
        // reference+offset must still succeed when the caller supplies the
        // resolved address.
        test("removeInstructionBreakpoints prefers address match when instructionReference has changed", () => {
            const disposable = new DisposableStore();
            try {
                const model = createModel(disposable);
                const address = BigInt(0x1000);
                model.addInstructionBreakpoint({
                    instructionReference: "oldRef",
                    offset: 0,
                    address,
                    canPersist: false,
                    enabled: true,
                    hitCondition: undefined,
                    condition: undefined,
                    logMessage: undefined,
                });

                assert.strictEqual(model.getInstructionBreakpoints().length, 1);

                // Simulate the disassembly view asking for removal after the
                // debug adapter handed out a new instruction reference.
                model.removeInstructionBreakpoints("newRef", 0, address);

                assert.strictEqual(model.getInstructionBreakpoints().length, 0);
            } finally {
                disposable.dispose();
            }
        });

        test("removeInstructionBreakpoints falls back to instructionReference+offset when address not supplied", () => {
            const disposable = new DisposableStore();
            try {
                const model = createModel(disposable);
                model.addInstructionBreakpoint({
                    instructionReference: "ref",
                    offset: 4,
                    address: BigInt(0x2000),
                    canPersist: false,
                    enabled: true,
                    hitCondition: undefined,
                    condition: undefined,
                    logMessage: undefined,
                });

                // Non-matching reference leaves the breakpoint in place.
                model.removeInstructionBreakpoints("other", 4);
                assert.strictEqual(model.getInstructionBreakpoints().length, 1);

                // Matching reference+offset removes it.
                model.removeInstructionBreakpoints("ref", 4);
                assert.strictEqual(model.getInstructionBreakpoints().length, 0);
            } finally {
                disposable.dispose();
            }
        });

        test("removeInstructionBreakpoints with only address removes the matching entry and leaves others", () => {
            const disposable = new DisposableStore();
            try {
                const model = createModel(disposable);
                const keep: IInstructionBreakpoint[] = [];

                model.addInstructionBreakpoint({
                    instructionReference: "refA",
                    offset: 0,
                    address: BigInt(0x3000),
                    canPersist: false,
                    enabled: true,
                    hitCondition: undefined,
                    condition: undefined,
                    logMessage: undefined,
                });
                model.addInstructionBreakpoint({
                    instructionReference: "refB",
                    offset: 0,
                    address: BigInt(0x4000),
                    canPersist: false,
                    enabled: true,
                    hitCondition: undefined,
                    condition: undefined,
                    logMessage: undefined,
                });

                model.removeInstructionBreakpoints(undefined, undefined, BigInt(0x3000));

                const remaining = model.getInstructionBreakpoints();
                assert.strictEqual(remaining.length, 1);
                assert.strictEqual(remaining[0].address, BigInt(0x4000));
                keep.push(...remaining);
                assert.strictEqual(keep.length, 1);
            } finally {
                disposable.dispose();
            }
        });
    });

    suite("ExceptionBreakpoint", () => {
        test("Restored matches new", () => {
            const ebp = new ExceptionBreakpoint(
                {
                    conditionDescription: "condition description",
                    description: "description",
                    filter: "condition",
                    label: "label",
                    supportsCondition: true,
                    enabled: true,
                },
                "id",
            );
            const strigified = JSON.stringify(ebp);
            const parsed = JSON.parse(strigified) as ReturnType<ExceptionBreakpoint["toJSON"]>;
            const newEbp = new ExceptionBreakpoint(parsed);
            assert.ok(ebp.matches(newEbp));
        });
    });

    suite("DebugModel", () => {
        test("refreshTopOfCallstack resolves all returned promises when called multiple times", async () => {
            vi.useFakeTimers();
            try {
                const topFrameDeferred = new DeferredPromise<void>();
                const wholeStackDeferred = new DeferredPromise<void>();
                const fakeThread = {
                    session: mockSession({ capabilities: { supportsDelayedStackTraceLoading: true } }),
                    getCallStack: () => [],
                    getStaleCallStack: () => [],
                    fetchCallStack: vi.fn((levels: number) =>
                        levels === 1 ? topFrameDeferred.p : wholeStackDeferred.p,
                    ),
                    getId: () => "1",
                } as unknown as Thread;

                const disposable = new DisposableStore();
                const model = createMockDebugModel(disposable);

                let top1Resolved = false;
                let whole1Resolved = false;
                let top2Resolved = false;
                let whole2Resolved = false;
                const result1 = model.refreshTopOfCallstack(fakeThread);
                void result1.topCallStack.then(() => (top1Resolved = true));
                void result1.wholeCallStack.then(() => (whole1Resolved = true));

                const result2 = model.refreshTopOfCallstack(fakeThread);
                void result2.topCallStack.then(() => (top2Resolved = true));
                void result2.wholeCallStack.then(() => (whole2Resolved = true));

                assert.ok(!top1Resolved);
                assert.ok(!whole1Resolved);
                assert.ok(!top2Resolved);
                assert.ok(!whole2Resolved);

                topFrameDeferred.complete();
                await result1.topCallStack;
                await result2.topCallStack;
                assert.ok(!whole1Resolved);
                assert.ok(!whole2Resolved);

                await vi.advanceTimersByTimeAsync(420);
                wholeStackDeferred.complete();
                await result1.wholeCallStack;
                await result2.wholeCallStack;

                disposable.dispose();
            } finally {
                vi.useRealTimers();
            }
        });
    });
});
