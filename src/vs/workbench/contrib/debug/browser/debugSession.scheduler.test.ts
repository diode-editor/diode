/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/debugSession.test.ts

import assert from "assert";
import { afterEach, beforeEach } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";

import { ThreadStatusScheduler } from "./debugSession.ts";

suite("DebugSession - ThreadStatusScheduler", () => {
    let scheduler: ThreadStatusScheduler;

    beforeEach(() => {
        scheduler = new ThreadStatusScheduler();
    });

    afterEach(() => {
        scheduler.dispose();
    });

    test("cancel base case", async () => {
        await scheduler.run(Promise.resolve([1]), async (threadId, token) => {
            assert.strictEqual(threadId, 1);
            assert.strictEqual(token.isCancellationRequested, false);
            scheduler.cancel([1]);
            assert.strictEqual(token.isCancellationRequested, true);
        });
    });

    test("cancel global", async () => {
        await scheduler.run(Promise.resolve([1]), async (threadId, token) => {
            assert.strictEqual(threadId, 1);
            assert.strictEqual(token.isCancellationRequested, false);
            scheduler.cancel(undefined);
            assert.strictEqual(token.isCancellationRequested, true);
        });
    });

    test("cancels when new work comes in", async () => {
        let innerCalled = false;
        await scheduler.run(Promise.resolve([1]), async (threadId, token1) => {
            assert.strictEqual(threadId, 1);
            assert.strictEqual(token1.isCancellationRequested, false);
            await scheduler.run(Promise.resolve([1]), async (_threadId, token2) => {
                innerCalled = true;
                assert.strictEqual(token1.isCancellationRequested, true);
                assert.strictEqual(token2.isCancellationRequested, false);
            });
        });

        assert.strictEqual(innerCalled, true);
    });

    test("cancels slower lookups when new lookup is made", async () => {
        const innerCalled1: number[] = [];
        const innerCalled2: number[] = [];

        await Promise.all([
            scheduler.run(
                Promise.resolve()
                    .then(() => undefined)
                    .then(() => [1, 3]),
                async (threadId) => {
                    innerCalled1.push(threadId);
                },
            ),
            scheduler.run(Promise.resolve([1, 2]), async (threadId) => {
                innerCalled2.push(threadId);
            }),
        ]);

        assert.deepEqual(innerCalled1, [3]);
        assert.deepEqual(innerCalled2, [1, 2]);
    });

    test("allows work with other IDs", async () => {
        let innerCalled = false;
        await scheduler.run(Promise.resolve([1]), async (threadId, token1) => {
            assert.strictEqual(threadId, 1);
            assert.strictEqual(token1.isCancellationRequested, false);
            await scheduler.run(Promise.resolve([2]), async (_threadId, token2) => {
                innerCalled = true;
                assert.strictEqual(token1.isCancellationRequested, false);
                assert.strictEqual(token2.isCancellationRequested, false);
            });
        });

        assert.strictEqual(innerCalled, true);
    });

    test("cancels when called during reslution", async () => {
        let innerCalled = false;
        await scheduler.run(
            Promise.resolve()
                .then(() => {
                    scheduler.cancel([1]);
                })
                .then(() => [1]),
            async () => {
                innerCalled = true;
            },
        );

        assert.strictEqual(innerCalled, false);
    });

    test("global cancels when called during reslution", async () => {
        let innerCalled = false;
        await scheduler.run(
            Promise.resolve()
                .then(() => {
                    scheduler.cancel(undefined);
                })
                .then(() => [1]),
            async () => {
                innerCalled = true;
            },
        );

        assert.strictEqual(innerCalled, false);
    });

    test("a global cancel stops every running operation", async () => {
        const tokens: boolean[] = [];
        await scheduler.run(Promise.resolve([1, 2]), async (threadId, token) => {
            if (threadId === 2) {
                scheduler.cancel(undefined);
            }
            await Promise.resolve();
            tokens.push(token.isCancellationRequested);
        });

        assert.deepEqual(tokens, [true, true]);
    });

    test("cancelling other threads leaves this one's work alone", async () => {
        let cancelled: boolean | undefined;
        await scheduler.run(Promise.resolve([1]), async (_threadId, token) => {
            scheduler.cancel([2]);
            cancelled = token.isCancellationRequested;
        });

        assert.strictEqual(cancelled, false);
    });
});
