/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/repl.test.ts
// Upstream's model tests (the filter one belongs to the view, #1146), then ours: the settings, ANSI clear, variables.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestDebugSession, DEFAULT_REPL_CONFIGURATION } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel } from "../../../../../TestUtils/mockDebug.ts";
import { MockDebugAdapter } from "../../../../../TestUtils/mockDebugAdapter.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { DisposableStore } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";
import { RawDebugSession } from "../browser/rawDebugSession.ts";

import type { IExpression, IReplElement, IReplElementSource } from "./debug.ts";
import { type DebugModel, StackFrame, Thread } from "./debugModel.ts";
import { Source } from "./debugSource.ts";
import {
    type IReplConsoleConfiguration,
    ReplEvaluationInput,
    ReplEvaluationResult,
    ReplGroup,
    ReplModel,
    ReplOutputElement,
    ReplVariableElement,
} from "./replModel.ts";

function outputs(repl: ReplModel): ReplOutputElement[] {
    return repl.getReplElements() as ReplOutputElement[];
}

function fakeExpression(value: string, children: IExpression[] = []): IExpression {
    const expression: IExpression & { toString(): string } = {
        name: "fake",
        value,
        hasChildren: children.length > 0,
        getId: () => `fake:${value}`,
        getSession: () => undefined,
        evaluateLazy: () => Promise.resolve(),
        getChildren: () => Promise.resolve(children),
        toString: () => `fake = ${value}`,
    };
    return expression;
}

function sourceAt(path: string, lineNumber: number, column = 1): IReplElementSource {
    return {
        source: new Source({ name: path.split("/").pop(), path }, "session", NULL_LOGGER),
        lineNumber,
        column,
    };
}

describe("Debug - REPL", () => {
    let model: DebugModel;
    const disposables = new DisposableStore();
    let config: IReplConsoleConfiguration;
    const newRepl = (): ReplModel => new ReplModel(() => config);

    beforeEach(() => {
        model = createMockDebugModel(disposables);
        config = DEFAULT_REPL_CONFIGURATION;
    });

    afterEach(() => {
        disposables.clear();
    });

    it("repl output", () => {
        const session = disposables.add(createTestDebugSession(model));
        const repl = newRepl();
        repl.appendToRepl(session, { output: "first line\n", sev: "error" });
        repl.appendToRepl(session, { output: "second line ", sev: "error" });
        repl.appendToRepl(session, { output: "third line ", sev: "error" });
        repl.appendToRepl(session, { output: "fourth line", sev: "error" });

        let elements = outputs(repl);
        expect(elements.length).toBe(2);
        expect(elements[0].value).toBe("first line\n");
        expect(elements[0].severity).toBe("error");
        expect(elements[1].value).toBe("second line third line fourth line");
        expect(elements[1].severity).toBe("error");

        repl.appendToRepl(session, { output: "1", sev: "warning" });
        elements = outputs(repl);
        expect(elements.length).toBe(3);
        expect(elements[2].value).toBe("1");
        expect(elements[2].severity).toBe("warning");

        repl.removeReplExpressions();
        expect(repl.getReplElements().length).toBe(0);

        repl.appendToRepl(session, { output: "1\n", sev: "info" });
        repl.appendToRepl(session, { output: "2", sev: "info" });
        repl.appendToRepl(session, { output: "3\n4", sev: "info" });
        repl.appendToRepl(session, { output: "5\n", sev: "info" });
        repl.appendToRepl(session, { output: "6", sev: "info" });
        elements = outputs(repl);
        expect(elements.map((e) => e.toString())).toEqual(["1\n", "23\n", "45\n", "6"]);
    });

    it("repl output count", () => {
        const session = disposables.add(createTestDebugSession(model));
        const repl = newRepl();
        repl.appendToRepl(session, { output: "first line\n", sev: "info" });
        repl.appendToRepl(session, { output: "first line\n", sev: "info" });
        repl.appendToRepl(session, { output: "first line\n", sev: "info" });
        repl.appendToRepl(session, { output: "second line\n", sev: "info" });
        repl.appendToRepl(session, { output: "second line\n", sev: "info" });
        repl.appendToRepl(session, { output: "third line\n", sev: "info" });

        expect(outputs(repl).map((e) => ({ value: e.value, count: e.count }))).toEqual([
            { value: "first line\n", count: 3 },
            { value: "second line\n", count: 2 },
            { value: "third line\n", count: 1 },
        ]);
    });

    it("repl merging", () => {
        // 'mergeWithParent' should be ignored when there is no parent.
        const parent = disposables.add(createTestDebugSession(model, "parent", { repl: "mergeWithParent" }));
        const child1 = disposables.add(
            createTestDebugSession(model, "child1", { parentSession: parent, repl: "separate" }),
        );
        const child2 = disposables.add(
            createTestDebugSession(model, "child2", { parentSession: parent, repl: "mergeWithParent" }),
        );
        const grandChild = disposables.add(
            createTestDebugSession(model, "grandChild", { parentSession: child2, repl: "mergeWithParent" }),
        );
        const child3 = disposables.add(createTestDebugSession(model, "child3", { parentSession: parent }));

        let parentChanges = 0;
        disposables.add(parent.onDidChangeReplElements(() => ++parentChanges));

        parent.appendToRepl({ output: "1\n", sev: "info" });
        expect(parentChanges).toBe(1);
        expect([parent, child1, child2, grandChild, child3].map((s) => s.getReplElements().length)).toEqual([
            1, 0, 1, 1, 0,
        ]);

        grandChild.appendToRepl({ output: "2\n", sev: "info" });
        expect(parentChanges).toBe(2);
        expect([parent, child1, child2, grandChild, child3].map((s) => s.getReplElements().length)).toEqual([
            2, 0, 2, 2, 0,
        ]);

        child3.appendToRepl({ output: "3\n", sev: "info" });
        expect(parentChanges).toBe(2);
        expect([parent, child1, child2, grandChild, child3].map((s) => s.getReplElements().length)).toEqual([
            2, 0, 2, 2, 1,
        ]);

        child1.appendToRepl({ output: "4\n", sev: "info" });
        expect(parentChanges).toBe(2);
        expect([parent, child1, child2, grandChild, child3].map((s) => s.getReplElements().length)).toEqual([
            2, 1, 2, 2, 1,
        ]);
    });

    it("repl expressions", () => {
        const session = disposables.add(createTestDebugSession(model));
        expect(session.getReplElements().length).toBe(0);
        model.addSession(session);

        const thread = new Thread(session, "mockthread", 1);
        const stackFrame = new StackFrame(
            thread,
            1,
            new Source({ name: "app.js" }, session.getId(), NULL_LOGGER),
            "app.js",
            "normal",
            { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 },
            1,
            true,
        );
        const replModel = newRepl();
        void replModel.addReplExpression(session, stackFrame, "myVariable");
        void replModel.addReplExpression(session, stackFrame, "myVariable");
        void replModel.addReplExpression(session, stackFrame, "myVariable");

        expect(replModel.getReplElements().length).toBe(3);
        replModel.getReplElements().forEach((re) => {
            expect((re as ReplEvaluationInput).value).toBe("myVariable");
        });

        replModel.removeReplExpressions();
        expect(replModel.getReplElements().length).toBe(0);
    });

    it("repl ordering", async () => {
        const session = disposables.add(createTestDebugSession(model));
        model.addSession(session);

        const adapter = disposables.add(new MockDebugAdapter());
        const raw = disposables.add(
            new RawDebugSession(adapter, { type: "mock" } as never, "", "", { error: () => undefined }),
        );
        session.initializeForTest(raw);

        await session.addReplExpression(undefined, "before.1");
        expect(session.getReplElements().length).toBe(3);
        expect((session.getReplElements()[0] as ReplEvaluationInput).value).toBe("before.1");
        expect((session.getReplElements()[1] as ReplOutputElement).value).toBe("before.1");
        expect((session.getReplElements()[2] as ReplEvaluationResult).value).toBe("=before.1");

        await session.addReplExpression(undefined, "after.2");
        await settle(0);
        expect(session.getReplElements().length).toBe(6);
        expect((session.getReplElements()[3] as ReplEvaluationInput).value).toBe("after.2");
        expect((session.getReplElements()[4] as ReplEvaluationResult).value).toBe("=after.2");
        expect((session.getReplElements()[5] as ReplOutputElement).value).toBe("after.2");
    });

    it("repl groups", () => {
        const session = disposables.add(createTestDebugSession(model));
        const repl = newRepl();

        repl.appendToRepl(session, { output: "first global line", sev: "info" });
        repl.startGroup(session, "group_1", true);
        repl.appendToRepl(session, { output: "first line in group", sev: "info" });
        repl.appendToRepl(session, { output: "second line in group", sev: "info" });
        const elements = repl.getReplElements();
        expect(elements.length).toBe(2);
        const group = elements[1] as ReplGroup;
        expect(group.name).toBe("group_1");
        expect(group.autoExpand).toBe(true);
        expect(group.hasChildren).toBe(true);
        expect(group.hasEnded).toBe(false);

        repl.startGroup(session, "group_2", false);
        repl.appendToRepl(session, { output: "first line in subgroup", sev: "info" });
        repl.appendToRepl(session, { output: "second line in subgroup", sev: "info" });
        const children = group.getChildren();
        expect(children.length).toBe(3);
        expect((children[0] as ReplOutputElement).value).toBe("first line in group");
        expect((children[1] as ReplOutputElement).value).toBe("second line in group");
        expect((children[2] as ReplGroup).name).toBe("group_2");
        expect((children[2] as ReplGroup).hasEnded).toBe(false);
        expect((children[2] as ReplGroup).getChildren().length).toBe(2);
        repl.endGroup();
        expect((children[2] as ReplGroup).hasEnded).toBe(true);
        repl.appendToRepl(session, { output: "third line in group", sev: "info" });
        expect(group.getChildren().length).toBe(4);
        expect(group.hasEnded).toBe(false);
        repl.endGroup();
        expect(group.hasEnded).toBe(true);
        repl.appendToRepl(session, { output: "second global line", sev: "info" });
        expect(repl.getReplElements().length).toBe(3);
        expect((repl.getReplElements()[2] as ReplOutputElement).value).toBe("second global line");
    });

    it("repl identical line collapsing - character by character", () => {
        const session = disposables.add(createTestDebugSession(model));
        const repl = newRepl();

        // Character-by-character output should NOT be collapsed: "111\n", not "(3)1"
        repl.appendToRepl(session, { output: "1", sev: "info" });
        repl.appendToRepl(session, { output: "1", sev: "info" });
        repl.appendToRepl(session, { output: "1", sev: "info" });
        repl.appendToRepl(session, { output: "\n", sev: "info" });
        let elements = outputs(repl);
        expect(elements.map((e) => [e.value, e.count])).toEqual([["111\n", 1]]);

        repl.removeReplExpressions();
        repl.appendToRepl(session, { output: "5", sev: "info" });
        repl.appendToRepl(session, { output: "5", sev: "info" });
        repl.appendToRepl(session, { output: "\n", sev: "info" });
        elements = outputs(repl);
        expect(elements.map((e) => [e.value, e.count])).toEqual([["55\n", 1]]);
    });

    it("repl identical line collapsing - single event multiple lines", () => {
        const session = disposables.add(createTestDebugSession(model));
        const repl = newRepl();

        repl.appendToRepl(session, { output: "hello\nhello\n", sev: "info" });

        expect(outputs(repl).map((e) => [e.value, e.count])).toEqual([["hello\n", 2]]);
    });

    it("repl identical line collapsing - mixed scenarios", () => {
        const session = disposables.add(createTestDebugSession(model));
        const repl = newRepl();

        repl.appendToRepl(session, { output: "test\n", sev: "info" });
        repl.appendToRepl(session, { output: "test\ntest\n", sev: "info" });

        expect(outputs(repl).map((e) => [e.value, e.count])).toEqual([["test\n", 3]]);
    });

    describe("ours", () => {
        it("a completed line identical to the one before collapses into it", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            const changes: (IReplElement | undefined)[] = [];
            repl.onDidChangeElements((e) => changes.push(e));

            repl.appendToRepl(session, { output: "tick\n", sev: "info" });
            repl.appendToRepl(session, { output: "ti", sev: "info" });
            changes.length = 0;
            repl.appendToRepl(session, { output: "ck\n", sev: "info" });

            expect(outputs(repl).map((e) => [e.value, e.count])).toEqual([["tick\n", 2]]);
            expect(changes).toEqual([undefined, undefined]);
        });

        it("a completed line is not collapsed into one of another severity or source", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();

            repl.appendToRepl(session, { output: "tick\n", sev: "error" });
            repl.appendToRepl(session, { output: "ti", sev: "info" });
            repl.appendToRepl(session, { output: "ck\n", sev: "info" });
            repl.appendToRepl(session, { output: "tick\n", sev: "info", source: sourceAt("/a.c", 3) });

            expect(outputs(repl).map((e) => [e.value, e.severity, e.count])).toEqual([
                ["tick\n", "error", 1],
                ["tick\n", "info", 1],
                ["tick\n", "info", 1],
            ]);
        });

        it("a line completed with more lines splits and collapses each", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();

            repl.appendToRepl(session, { output: "a\n", sev: "info" });
            repl.appendToRepl(session, { output: "a", sev: "info" });
            const changes: (IReplElement | undefined)[] = [];
            repl.onDidChangeElements((e) => changes.push(e));
            repl.appendToRepl(session, { output: "\nb\nb", sev: "info" });

            expect(changes.map((e) => e?.toString())).toEqual([undefined, "b\n", "b", undefined]);

            expect(outputs(repl).map((e) => [e.value, e.count])).toEqual([
                ["a\n", 2],
                ["b\n", 1],
                ["b", 1],
            ]);
        });

        it("without collapsing identical lines stay apart and multi-line output stays whole", () => {
            config = { collapseIdenticalLines: false, maximumLines: 10000 };
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();

            repl.appendToRepl(session, { output: "same", sev: "info" });
            repl.appendToRepl(session, { output: "\n", sev: "info" });
            repl.appendToRepl(session, { output: "same\n", sev: "info" });
            repl.appendToRepl(session, { output: "x\nx\n", sev: "info" });
            repl.appendToRepl(session, { output: "x\nx\n", sev: "info" });

            expect(outputs(repl).map((e) => [e.value, e.count])).toEqual([
                ["same\n", 1],
                ["same\n", 1],
                ["x\nx\n", 1],
                ["x\nx\n", 1],
            ]);
        });

        it("the same output without a line break collapses into the one before", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "same\n", sev: "info" });
            repl.appendToRepl(session, { output: "same\n", sev: "info" });
            const counted = outputs(repl)[0];
            const countChanges: number[] = [];
            counted.onDidChangeCount(() => countChanges.push(counted.count));

            repl.appendToRepl(session, { output: "same\n", sev: "info" });

            expect(countChanges).toEqual([3]);
            expect(counted.toString()).toBe("same\nsame\nsame\n");
        });

        it("a counted element without a line break repeats on lines", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "x\n", sev: "info" });
            const element = outputs(repl)[0];
            element.value = "x";
            element.count = 3;

            expect(element.toString()).toBe("x\nx\nx");
        });

        it("keeps no more than `maximumLines` elements, dropping the oldest", () => {
            config = { collapseIdenticalLines: true, maximumLines: 2 };
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();

            for (const line of ["1\n", "2\n", "3\n"]) repl.appendToRepl(session, { output: line, sev: "info" });

            expect(outputs(repl).map((e) => e.value)).toEqual(["2\n", "3\n"]);
        });

        it("ANSI 'clear display' empties the console and keeps what follows", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "old\n", sev: "info" });

            repl.appendToRepl(session, { output: "gone\u001b[2Jnew\n", sev: "info" });

            expect(outputs(repl).map((e) => [e.value, e.severity])).toEqual([
                ["Console was cleared", "ignore"],
                ["new\n", "info"],
            ]);
        });

        it("a logged variable with text is an output element with the expression, without it a variable element", async () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            const child = fakeExpression("1");
            const parent = fakeExpression("{...}", [child]);
            const source = sourceAt("/a.c", 7, 2);

            repl.appendToRepl(session, { output: "obj = {...}", expression: parent, sev: "info", source });
            repl.appendToRepl(session, { output: "", expression: parent, sev: "warning" });

            const [withText, bare] = repl.getReplElements();
            expect(withText).toBeInstanceOf(ReplOutputElement);
            expect((withText as ReplOutputElement).hasChildren).toBe(true);
            expect(await (withText as ReplOutputElement).getChildren()).toEqual([child]);
            expect(withText.toString(true)).toBe("obj = {...} a.c");
            expect(withText.toString()).toBe("obj = {...}");
            expect(bare).toBeInstanceOf(ReplVariableElement);
            const variable = bare as ReplVariableElement;
            expect([variable.hasChildren, variable.severity, variable.getSession()]).toEqual([
                true,
                "warning",
                session,
            ]);
            expect(await variable.getChildren()).toEqual([child]);
            expect(variable.toString()).toBe("fake = {...}");
            expect(variable.getId()).not.toBe(new ReplVariableElement(session, parent, "info").getId());
        });

        it("plain output has no children", async () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "text", sev: "info" });

            const element = outputs(repl)[0];
            expect(element.hasChildren).toBe(false);
            expect(await element.getChildren()).toEqual([]);
            expect(element.getId()).toMatch(/^topReplElement:\d+$/u);
        });

        it("a group shows its source only when asked; ids are distinct", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.startGroup(session, "loop", false, sourceAt("/src/main.cpp", 3));
            repl.startGroup(session, "inner", true);

            const outer = repl.getReplElements()[0] as ReplGroup;
            const inner = outer.getChildren()[0] as ReplGroup;
            expect(outer.toString()).toBe("loop");
            expect(outer.toString(true)).toBe("loop main.cpp");
            expect(inner.toString(true)).toBe("inner");
            expect(outer.getId()).not.toBe(inner.getId());
            expect(outer.getId()).toMatch(/^replGroup:\d+$/u);
        });

        it("ending a group with none open does nothing", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "text", sev: "info" });

            repl.endGroup();

            expect(outputs(repl).map((e) => e.value)).toEqual(["text"]);
        });

        it("removing a non-empty console fires once", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "x\n", sev: "info" });
            let changes = 0;
            repl.onDidChangeElements(() => ++changes);

            repl.removeReplExpressions();

            expect(changes).toBe(1);
        });

        it("an empty output is an element of its own", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "x\n", sev: "info" });

            repl.appendToRepl(session, { output: "", sev: "info" });

            expect(outputs(repl).map((e) => e.value)).toEqual(["x\n", ""]);
        });

        it("identical lines of another severity stay apart", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();

            repl.appendToRepl(session, { output: "x\n", sev: "error" });
            repl.appendToRepl(session, { output: "x\n", sev: "info" });

            expect(outputs(repl).map((e) => [e.severity, e.count])).toEqual([
                ["error", 1],
                ["info", 1],
            ]);
        });

        it("without collapsing a completed line stays apart from the identical one before", () => {
            config = { collapseIdenticalLines: false, maximumLines: 10000 };
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();

            repl.appendToRepl(session, { output: "tick\n", sev: "info" });
            repl.appendToRepl(session, { output: "ti", sev: "info" });
            repl.appendToRepl(session, { output: "ck\n", sev: "info" });

            expect(outputs(repl).map((e) => [e.value, e.count])).toEqual([
                ["tick\n", 1],
                ["tick\n", 1],
            ]);
        });

        it("removing from an empty console fires nothing", () => {
            const repl = newRepl();
            let changes = 0;
            repl.onDidChangeElements(() => ++changes);

            repl.removeReplExpressions();

            expect(changes).toBe(0);
        });

        it("an evaluation input has a fresh id and shows its text", () => {
            const input = new ReplEvaluationInput("a + b");
            expect(input.toString()).toBe("a + b");
            expect(input.getId()).not.toBe(new ReplEvaluationInput("a + b").getId());
        });

        it("an evaluation without a session is not available", async () => {
            const result = new ReplEvaluationResult("x");
            expect(result.available).toBe(true);

            await result.evaluateExpression("x", undefined, undefined, "repl");

            expect(result.available).toBe(false);
            expect(result.originalExpression).toBe("x");
            expect(result.toString()).toBe(result.value);
        });

        it("a clone has the same elements and grows on its own", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            repl.appendToRepl(session, { output: "a\n", sev: "info" });

            const clone = repl.clone();
            clone.appendToRepl(session, { output: "b\n", sev: "info" });

            expect(outputs(repl).map((e) => e.value)).toEqual(["a\n"]);
            expect(outputs(clone).map((e) => e.value)).toEqual(["a\n", "b\n"]);
        });

        it("sources are the same by line, column and uri", () => {
            const session = disposables.add(createTestDebugSession(model));
            const repl = newRepl();
            const at = (path: string, line: number, column: number): IReplElementSource => sourceAt(path, line, column);

            repl.appendToRepl(session, { output: "x\n", sev: "info", source: at("/a.c", 1, 1) });
            repl.appendToRepl(session, { output: "x\n", sev: "info", source: at("/a.c", 1, 1) });
            repl.appendToRepl(session, { output: "x\n", sev: "info", source: at("/a.c", 2, 1) });
            repl.appendToRepl(session, { output: "x\n", sev: "info", source: at("/a.c", 2, 3) });
            repl.appendToRepl(session, { output: "x\n", sev: "info", source: at("/b.c", 2, 3) });
            repl.appendToRepl(session, { output: "x\n", sev: "info" });

            expect(outputs(repl).map((e) => e.count)).toEqual([2, 1, 1, 1, 1]);
            expect(Uri.file("/a.c").toString()).toBe(outputs(repl)[0].sourceData?.source.uri.toString());
        });
    });
});
