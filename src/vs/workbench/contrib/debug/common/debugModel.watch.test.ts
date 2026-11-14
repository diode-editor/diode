/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/watch.test.ts

import assert from "assert";
import { beforeEach as setup } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";

import type { DebugModel, Expression } from "./debugModel.ts";

// Expressions

function assertWatchExpressions(watchExpressions: Expression[], expectedName: string) {
    assert.strictEqual(watchExpressions.length, 2);
    watchExpressions.forEach((we) => {
        assert.strictEqual(we.available, false);
        assert.strictEqual(we.reference, 0);
        assert.strictEqual(we.name, expectedName);
    });
}

suite("Debug - Watch", () => {
    let model: DebugModel;
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    setup(() => {
        model = createMockDebugModel(disposables);
    });

    test("watch expressions", () => {
        assert.strictEqual(model.getWatchExpressions().length, 0);
        model.addWatchExpression("console");
        model.addWatchExpression("console");
        let watchExpressions = model.getWatchExpressions();
        assertWatchExpressions(watchExpressions, "console");

        model.renameWatchExpression(watchExpressions[0].getId(), "new_name");
        model.renameWatchExpression(watchExpressions[1].getId(), "new_name");
        assertWatchExpressions(model.getWatchExpressions(), "new_name");

        assertWatchExpressions(model.getWatchExpressions(), "new_name");

        model.addWatchExpression("mockExpression");
        model.moveWatchExpression(model.getWatchExpressions()[2].getId(), 1);
        watchExpressions = model.getWatchExpressions();
        assert.strictEqual(watchExpressions[0].name, "new_name");
        assert.strictEqual(watchExpressions[1].name, "mockExpression");
        assert.strictEqual(watchExpressions[2].name, "new_name");

        model.removeWatchExpressions();
        assert.strictEqual(model.getWatchExpressions().length, 0);
    });
});
