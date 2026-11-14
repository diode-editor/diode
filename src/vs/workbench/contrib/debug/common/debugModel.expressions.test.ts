import { describe, expect, it, vi } from "vitest";

import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import type { IDebugSession } from "./debug.ts";
import { Expression, ExpressionContainer, Scope, StackFrame, Thread, Variable } from "./debugModel.ts";
import { Source } from "./debugSource.ts";

type VariablesArgs = Parameters<IDebugSession["variables"]>;

/** A `variables` request answered from a table: reference → variables, sliced by `start`/`count` like an adapter. */
function variablesFrom(
    table: Record<number, DebugProtocol.Variable[]>,
): (...args: VariablesArgs) => Promise<DebugProtocol.VariablesResponse> {
    return (reference, _threadId, _filter, start, count) => {
        const all = table[reference] ?? [];
        const variables = start === undefined ? all : all.slice(start, start + (count ?? all.length));
        return Promise.resolve({ body: { variables } } as DebugProtocol.VariablesResponse);
    };
}

function variable(name: string, value: string, extra: Partial<DebugProtocol.Variable> = {}): DebugProtocol.Variable {
    return { name, value, variablesReference: 0, ...extra };
}

function rootWith(session: IDebugSession, reference: number, named = 0, indexed = 0): ExpressionContainer {
    return new ExpressionContainer(session, 1, reference, `root:${String(reference)}`, named, indexed);
}

function frameOf(session: IDebugSession): StackFrame {
    const thread = new Thread(session, "main", 1);
    const source = new Source({ path: "/a.cpp" }, "s", NULL_LOGGER);
    const range = { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 };
    return new StackFrame(thread, 7, source, "main", undefined, range, 0, true);
}

describe("ExpressionContainer: children", () => {
    it("a container without a positive reference, or a lazy one, has no children and asks nothing", async () => {
        const variables = vi.fn();
        const session = mockSession({ variables });
        expect(await rootWith(session, 0).getChildren()).toEqual([]);
        const lazy = new ExpressionContainer(session, 1, 5, "lazy", 0, 0, undefined, 0, { lazy: true });
        expect(lazy.hasChildren).toBe(false);
        expect(await lazy.getChildren()).toEqual([]);
        expect(variables).not.toHaveBeenCalled();
    });

    it("fetches the children once and caches them until the reference changes", async () => {
        const variables = vi.fn(variablesFrom({ 5: [variable("a", "1")], 6: [variable("b", "2")] }));
        const root = rootWith(mockSession({ variables }), 5);
        const first = await root.getChildren();
        expect(first.map((c) => (c as Variable).toString())).toEqual(["a: 1"]);
        expect(await root.getChildren()).toBe(first);
        expect(variables).toHaveBeenCalledExactlyOnceWith(5, 1, undefined, undefined, undefined);

        root.reference = 6;
        expect((await root.getChildren()).map((c) => c.name)).toEqual(["b"]);
    });

    it("splits 1000 indexed children into chunks of 100, named children first (the spike's vector)", async () => {
        const nums = Array.from({ length: 1000 }, (_, i) => variable(`[${String(i)}]`, String(i * 2)));
        const variables = vi.fn(
            (
                reference: number,
                threadId: number | undefined,
                filter: "indexed" | "named" | undefined,
                start?: number,
                count?: number,
            ) =>
                filter === "named"
                    ? Promise.resolve({
                          body: { variables: [variable("size", "1000")] },
                      } as DebugProtocol.VariablesResponse)
                    : variablesFrom({ 9: nums })(reference, threadId, filter, start, count),
        );
        const session = mockSession({ variables });
        const vector = rootWith(session, 9, 1, 1000);

        const children = await vector.getChildren();
        expect(children.map((c) => c.name)).toEqual([
            "size",
            ...Array.from({ length: 10 }, (_, i) => `[${String(i * 100)}..${String(i * 100 + 99)}]`),
        ]);
        const chunk = children[3] as Variable;
        expect(chunk.presentationHint).toEqual({ kind: "virtual" });
        expect(chunk.value).toBe("");
        expect(chunk.hasChildren).toBe(true);
        expect(chunk.getId()).toBe("variable:root:9:[200..299]:");

        const items = await chunk.getChildren();
        expect(items.map((c) => c.name)).toEqual(Array.from({ length: 100 }, (_, i) => `[${String(200 + i)}]`));
        expect(variables).toHaveBeenLastCalledWith(9, 1, "indexed", 200, 100);
    });

    it("grows the chunk size by a factor of 100 so a level never has more than 100 chunks", async () => {
        const root = rootWith(mockSession({ variables: variablesFrom({}) }), 9, 0, 25_000);
        const chunks = await root.getChildren();
        expect(chunks.map((c) => c.name)).toEqual(["[0..9999]", "[10000..19999]", "[20000..24999]"]);
        expect((chunks[2] as Variable).indexedVariables).toBe(5000);
    });

    it("up to 100 indexed children are fetched in one request, after the named ones", async () => {
        const variables = vi.fn(
            (_reference: number, _threadId: number | undefined, filter: "indexed" | "named" | undefined) =>
                Promise.resolve({
                    body: { variables: [variable(filter ?? "all", "")] },
                } as DebugProtocol.VariablesResponse),
        );
        const root = rootWith(mockSession({ variables }), 9, 2, 100);
        expect((await root.getChildren()).map((c) => c.name)).toEqual(["named", "indexed"]);
        expect(variables).toHaveBeenLastCalledWith(9, 1, "indexed", 0, 100);

        const onlyIndexed = rootWith(mockSession({ variables }), 9, 0, 3);
        expect((await onlyIndexed.getChildren()).map((c) => c.name)).toEqual(["indexed"]);
    });

    it("numbers duplicate names into distinct ids and keeps every variable field", async () => {
        const raw = [
            variable("x", "1", {
                variablesReference: 3,
                evaluateName: "this.x",
                namedVariables: 2,
                indexedVariables: 4,
                memoryReference: "0x10",
                type: "int",
                declarationLocationReference: 11,
                valueLocationReference: 12,
            }),
            variable("x", "2"),
            variable("x", "3"),
        ];
        (raw[0] as { __vscodeVariableMenuContext?: string }).__vscodeVariableMenuContext = "ctx";
        const root = rootWith(mockSession({ variables: variablesFrom({ 5: raw }) }), 5);
        const [first, second, third] = (await root.getChildren()) as Variable[];
        expect([first.getId(), second.getId(), third.getId()]).toEqual([
            "variable:root:5:x:",
            "variable:root:5:x:1",
            "variable:root:5:x:2",
        ]);
        expect(first.parent).toBe(root);
        expect(first.getThreadId()).toBe(1);
        expect([first.reference, first.evaluateName, first.namedVariables, first.indexedVariables]).toEqual([
            3,
            "this.x",
            2,
            4,
        ]);
        expect([first.memoryReference, first.type, first.variableMenuContext]).toEqual(["0x10", "int", "ctx"]);
        expect([first.declarationLocationReference, first.valueLocationReference, first.available]).toEqual([
            11,
            12,
            true,
        ]);
    });

    it("a variable without a string name and value or a numeric reference is an unavailable placeholder", async () => {
        const bad = [{ name: "n", value: 5, variablesReference: 0 } as unknown as DebugProtocol.Variable];
        const root = rootWith(mockSession({ variables: variablesFrom({ 5: bad }) }), 5);
        const [placeholder] = (await root.getChildren()) as Variable[];
        expect([placeholder.name, placeholder.value, placeholder.available]).toEqual([
            "",
            "Invalid variable attributes",
            false,
        ]);
        expect(placeholder.presentationHint).toEqual({ kind: "virtual" });
        expect(placeholder.reference).toBe(0);

        const noRef = [{ name: "n", value: "v" } as unknown as DebugProtocol.Variable];
        const noName = [{ value: "v", variablesReference: 0 } as unknown as DebugProtocol.Variable];
        for (const vars of [noRef, noName]) {
            const children = await rootWith(mockSession({ variables: variablesFrom({ 5: vars }) }), 5).getChildren();
            expect(children[0].value).toBe("Invalid variable attributes");
        }
    });

    it("a failed request becomes one placeholder with the error, an empty answer no children", async () => {
        const failing = rootWith(mockSession({ variables: () => Promise.reject(new Error("timeout")) }), 5);
        const [error] = (await failing.getChildren()) as Variable[];
        expect([error.value, error.available, error.name]).toEqual(["timeout", false, ""]);
        expect(error.presentationHint).toEqual({ kind: "virtual" });

        const empty = rootWith(
            mockSession({
                variables: () => Promise.resolve(undefined),
            }),
            5,
        );
        expect(await empty.getChildren()).toEqual([]);
    });

    it("with autoExpandLazyVariables, lazy children are resolved before they are returned", async () => {
        const table = {
            5: [
                variable("getter", "", { variablesReference: 6, presentationHint: { lazy: true } }),
                variable("b", "2"),
            ],
            6: [variable("", "42", { variablesReference: 0, evaluateName: "obj.getter" })],
        };
        const variables = vi.fn(variablesFrom(table));
        const lazy = rootWith(mockSession({ variables, autoExpandLazyVariables: true }), 5);
        const [getter] = (await lazy.getChildren()) as Variable[];
        expect([getter.value, getter.evaluateName, getter.reference]).toEqual(["42", "obj.getter", 0]);

        const notExpanded = rootWith(mockSession({ variables: variablesFrom(table) }), 5);
        const [still] = (await notExpanded.getChildren()) as Variable[];
        expect(still.value).toBe("");
    });
});

describe("ExpressionContainer: evaluateLazy", () => {
    it("adopts the single variable the adapter answers with", async () => {
        const session = mockSession({
            variables: variablesFrom({
                4: [
                    variable("", "{...}", {
                        variablesReference: 8,
                        namedVariables: 1,
                        indexedVariables: 2,
                        memoryReference: "0x1",
                        presentationHint: { kind: "data" },
                        valueLocationReference: 3,
                    }),
                ],
            }),
        });
        const container = new ExpressionContainer(session, 1, 4, "c", 0, 0, undefined, 0, { lazy: true });
        await container.evaluateLazy();
        expect([container.value, container.reference, container.namedVariables, container.indexedVariables]).toEqual([
            "{...}",
            8,
            1,
            2,
        ]);
        expect([container.memoryReference, container.presentationHint, container.valueLocationReference]).toEqual([
            "0x1",
            { kind: "data" },
            3,
        ]);
        expect(container.hasChildren).toBe(true);
    });

    it("keeps itself when there is no reference or the answer is not exactly one variable", async () => {
        const variables = vi.fn(variablesFrom({ 4: [variable("a", "1"), variable("b", "2")] }));
        const session = mockSession({ variables });
        const withoutReference = new ExpressionContainer(session, 1, undefined, "c");
        await withoutReference.evaluateLazy();
        expect(variables).not.toHaveBeenCalled();

        const two = new ExpressionContainer(session, 1, 4, "c2");
        await two.evaluateLazy();
        expect([two.value, two.reference]).toEqual(["", 4]);

        const container = new ExpressionContainer(
            mockSession({
                variables: () => Promise.resolve(undefined),
            }),
            1,
            4,
            "c3",
        );
        await container.evaluateLazy();
        expect(container.reference).toBe(4);
    });
});

describe("Expression", () => {
    function evaluating(body: Partial<DebugProtocol.EvaluateResponse["body"]>): IDebugSession {
        return mockSession({
            evaluate: vi.fn(() =>
                Promise.resolve({
                    body: { result: "", variablesReference: 0, ...body },
                } as DebugProtocol.EvaluateResponse),
            ),
        });
    }

    it("a named expression starts as not available, an empty one stays blank", () => {
        expect(new Expression("x").value).toBe("not available");
        expect(new Expression("").value).toBe("");
        expect(new Expression("x", "id1").getId()).toBe("id1");
    });

    it("evaluates in the frame and takes the adapter's answer", async () => {
        const session = evaluating({
            result: "{size=3}",
            variablesReference: 4,
            namedVariables: 1,
            indexedVariables: 3,
            memoryReference: "0x2",
            type: "std::vector<int>",
            presentationHint: { kind: "data" },
            valueLocationReference: 9,
        });
        const expression = new Expression("nums");
        const changed = vi.fn();
        expression.onDidChangeValue(changed);
        const frame = frameOf(session);
        await expression.evaluate(session, frame, "watch");

        expect(session.evaluate).toHaveBeenCalledWith("nums", 7, "watch", undefined);
        expect(expression.available).toBe(true);
        expect([
            expression.value,
            expression.reference,
            expression.namedVariables,
            expression.indexedVariables,
        ]).toEqual(["{size=3}", 4, 1, 3]);
        expect([expression.memoryReference, expression.type, expression.valueLocationReference]).toEqual([
            "0x2",
            "std::vector<int>",
            9,
        ]);
        expect(expression.presentationHint).toEqual({ kind: "data" });
        expect(expression.getSession()).toBe(session);
        expect(changed).toHaveBeenCalledExactlyOnceWith(expression);
        expect(expression.toString()).toBe("nums\n{size=3}");
    });

    it("fires onDidChangeValue only when the value changed since the last evaluation", async () => {
        let result = "1";
        const session = mockSession({
            evaluate: () =>
                Promise.resolve({ body: { result, variablesReference: 0 } } as DebugProtocol.EvaluateResponse),
        });
        const frame = frameOf(session);
        const expression = new Expression("i");
        const changed = vi.fn();
        expression.onDidChangeValue(changed);
        await expression.evaluate(session, frame, "watch");
        expect(changed).toHaveBeenCalledTimes(1);
        await expression.evaluate(session, frame, "watch");
        expect(changed).toHaveBeenCalledTimes(1);
        expect(expression.valueChanged).toBe(false);
        result = "2";
        await expression.evaluate(session, frame, "watch");
        expect(changed).toHaveBeenCalledTimes(2);
        expect(expression.valueChanged).toBe(true);
    });

    it("keeps the type it had when the answer has none, and an empty result is an empty value", async () => {
        const expression = new Expression("x");
        expression.type = "int";
        const session = evaluating({ result: undefined as unknown as string });
        await expression.evaluate(session, frameOf(session), "watch");
        expect([expression.value, expression.type]).toEqual(["", "int"]);
    });

    it("resolves a lazy answer unless asked to keep it lazy", async () => {
        const answer = {
            variablesReference: 4,
            presentationHint: { lazy: true },
        };
        const variables = variablesFrom({ 4: [variable("", "computed")] });
        const resolved = new Expression("getter");
        const session = mockSession({
            evaluate: () => Promise.resolve({ body: { result: "", ...answer } } as DebugProtocol.EvaluateResponse),
            variables,
        });
        await resolved.evaluate(session, frameOf(session), "hover");
        expect(resolved.value).toBe("computed");

        const kept = new Expression("getter");
        await kept.evaluate(session, frameOf(session), "hover", true);
        expect(kept.value).toBe("");
    });

    it("without a session, or without a frame outside the REPL, says why and is not available", async () => {
        const expression = new Expression("x");
        await expression.evaluate(undefined, undefined, "repl");
        expect(expression.value).toBe("Please start a debug session to evaluate expressions");
        expect([expression.available, expression.reference]).toEqual([false, 0]);

        const watch = new Expression("y");
        const session = evaluating({ result: "1" });
        await watch.evaluate(session, undefined, "watch");
        expect(watch.value).toBe("not available");
        expect(session.evaluate).not.toHaveBeenCalled();
    });

    it("the REPL evaluates without a frame", async () => {
        const session = evaluating({ result: "3" });
        const expression = new Expression("1+2");
        await expression.evaluate(session, undefined, "repl");
        expect(session.evaluate).toHaveBeenCalledWith("1+2", undefined, "repl", undefined);
        expect(expression.value).toBe("3");
    });

    it("an error answer becomes the value, no answer leaves it unavailable", async () => {
        const failing = mockSession({ evaluate: () => Promise.reject(new Error("no symbol 'x'")) });
        const expression = new Expression("x");
        expression.memoryReference = "0x1";
        await expression.evaluate(failing, frameOf(failing), "watch");
        expect([expression.value, expression.available, expression.reference, expression.memoryReference]).toEqual([
            "no symbol 'x'",
            false,
            0,
            undefined,
        ]);

        const silent = mockSession({ evaluate: () => Promise.reject(new Error("")) });
        const quiet = new Expression("q");
        await quiet.evaluate(silent, frameOf(silent), "watch");
        expect(quiet.value).toBe("");

        const empty = mockSession({ evaluate: () => Promise.resolve(undefined) });
        const none = new Expression("z");
        await none.evaluate(empty, frameOf(empty), "watch");
        expect(none.available).toBe(false);
    });

    it("setExpression writes through the session and takes the new value", async () => {
        const setExpression = vi.fn(() =>
            Promise.resolve({
                body: {
                    value: "5",
                    type: "long",
                    variablesReference: 2,
                    namedVariables: 1,
                    indexedVariables: 0,
                    memoryReference: "0x3",
                    valueLocationReference: 4,
                },
            } as DebugProtocol.SetExpressionResponse),
        );
        const session = mockSession({ setExpression, evaluate: () => Promise.resolve(undefined) });
        const expression = new Expression("x");
        await expression.setExpression("5", frameOf(session));
        expect(setExpression).not.toHaveBeenCalled();

        await expression.evaluate(session, frameOf(session), "watch");
        await expression.setExpression("5", frameOf(session));
        expect(setExpression).toHaveBeenCalledWith(7, "x", "5");
        expect([expression.value, expression.type, expression.reference, expression.namedVariables]).toEqual([
            "5",
            "long",
            2,
            1,
        ]);
        expect([expression.indexedVariables, expression.memoryReference, expression.valueLocationReference]).toEqual([
            0,
            "0x3",
            4,
        ]);
    });

    it("serializes as the DAP variable of its session", async () => {
        const session = evaluating({ result: "7", type: "int", memoryReference: "0x9", variablesReference: 0 });
        const expression = new Expression("n");
        expect(expression.toJSON()).toEqual({
            sessionId: undefined,
            variable: {
                name: "n",
                variablesReference: 0,
                memoryReference: undefined,
                value: "not available",
                type: undefined,
                evaluateName: "n",
            },
        });
        await expression.evaluate(session, frameOf(session), "watch");
        expect(expression.toJSON()).toEqual({
            sessionId: "mock",
            variable: {
                name: "n",
                variablesReference: 0,
                memoryReference: "0x9",
                value: "7",
                type: "int",
                evaluateName: "n",
            },
        });
    });
});

describe("Variable", () => {
    function child(
        session: IDebugSession,
        parent = rootWith(session, 5),
        evaluateName: string | null = "a.x",
    ): Variable {
        return new Variable(
            session,
            1,
            parent,
            0,
            "x",
            evaluateName ?? undefined,
            "1",
            0,
            0,
            undefined,
            undefined,
            "int",
        );
    }

    it("setVariable sets it in the parent's container", async () => {
        const setVariable = vi.fn(() =>
            Promise.resolve({ body: { value: "9", type: "short" } } as DebugProtocol.SetVariableResponse),
        );
        const session = mockSession({ setVariable });
        const v = child(session);
        await v.setVariable("9", frameOf(session));
        expect(setVariable).toHaveBeenCalledWith(5, "x", "9");
        expect([v.value, v.type]).toEqual(["9", "short"]);
    });

    it("an adapter with setExpression but no setVariable gets setExpression on the evaluate name", async () => {
        const setExpression = vi.fn(() =>
            Promise.resolve({ body: { value: "3" } } as DebugProtocol.SetExpressionResponse),
        );
        const setVariable = vi.fn();
        const session = mockSession({ setExpression, setVariable, capabilities: { supportsSetExpression: true } });
        const v = child(session);
        await v.setVariable("3", frameOf(session));
        expect(setExpression).toHaveBeenCalledWith(7, "a.x", "3");
        expect(setVariable).not.toHaveBeenCalled();
        expect([v.value, v.type]).toEqual(["3", "int"]);

        const both = mockSession({
            setExpression,
            setVariable: vi.fn(() => Promise.resolve(undefined)),
            capabilities: { supportsSetExpression: true, supportsSetVariable: true },
        });
        await child(both).setVariable("4", frameOf(both));
        expect(both.setVariable).toHaveBeenCalled();

        const noName = mockSession({
            setExpression,
            setVariable: vi.fn(() => Promise.resolve(undefined)),
            capabilities: { supportsSetExpression: true },
        });
        await child(noName, undefined, null).setVariable("4", frameOf(noName));
        expect(noName.setVariable).toHaveBeenCalled();
    });

    it("keeps the adapter's error of a failed set", async () => {
        const session = mockSession({ setVariable: () => Promise.reject(new Error("read-only")) });
        const v = child(session);
        await v.setVariable("2", frameOf(session));
        expect(v.errorMessage).toBe("read-only");
        expect(v.value).toBe("1");
    });

    it("does nothing without a session, setExpression nothing without an evaluate name", async () => {
        const session = mockSession({ setExpression: vi.fn() });
        const parent = rootWith(session, 5);
        const orphan = new Variable(undefined, 1, parent, 0, "x", "a.x", "1", 0, 0, undefined, undefined);
        await orphan.setVariable("2", frameOf(session));
        await orphan.setExpression("2", frameOf(session));
        await child(session, parent, null).setExpression("2", frameOf(session));
        expect(session.setExpression).not.toHaveBeenCalled();
    });

    it("adopts the evaluate name of a lazy answer", async () => {
        const session = mockSession({
            variables: variablesFrom({ 3: [variable("", "v", { evaluateName: "obj.p" })] }),
        });
        const lazy = new Variable(session, 1, rootWith(session, 5), 3, "p", undefined, "", 0, 0, undefined, {
            lazy: true,
        });
        await lazy.evaluateLazy();
        expect(lazy.evaluateName).toBe("obj.p");
    });

    it("prints as name: value, a nameless one as its value", () => {
        const session = mockSession();
        expect(child(session).toString()).toBe("x: 1");
        const nameless = new Variable(
            session,
            1,
            rootWith(session, 5),
            0,
            "",
            undefined,
            "only",
            0,
            0,
            undefined,
            undefined,
        );
        expect(nameless.toString()).toBe("only");
        expect(
            new Variable(session, 1, rootWith(session, 5), 0, "u", undefined, undefined, 0, 0, undefined, undefined)
                .value,
        ).toBe("");
    });

    it("serializes with its container: a watch expression by name, a variable or scope as DAP", () => {
        const session = mockSession();
        const watch = new Expression("obj");
        const underWatch = new Variable(session, 1, watch, 0, "x", "obj.x", "1", 0, 0, "0x4", undefined, "int");
        expect(underWatch.toJSON()).toEqual({
            sessionId: "mock",
            container: { expression: "obj" },
            variable: {
                name: "x",
                variablesReference: 0,
                memoryReference: "0x4",
                value: "1",
                type: "int",
                evaluateName: "obj.x",
            },
        });

        const scope = new Scope(frameOf(session), 1, "Locals", 2, false);
        const underScope = new Variable(session, 1, scope, 6, "y", undefined, "2", 0, 0, undefined, undefined);
        expect(underScope.toJSON().container).toEqual({ name: "Locals", variablesReference: 2, expensive: false });
        const nested = new Variable(undefined, 1, underScope, 0, "z", undefined, "3", 0, 0, undefined, undefined);
        expect(nested.toJSON()).toMatchObject({
            sessionId: undefined,
            container: { name: "y", variablesReference: 6 },
        });
    });
});

describe("ExpressionContainer: valueChanged", () => {
    it("marks a value that differs from the last one stored under the same id", () => {
        const first = new ExpressionContainer(undefined, 1, 0, "same-id-for-change");
        first.value = "1";
        expect(first.valueChanged).toBe(false);
        const second = new ExpressionContainer(undefined, 1, 0, "same-id-for-change");
        second.value = "2";
        expect(second.valueChanged).toBe(true);
        second.value = "2";
        expect(second.valueChanged).toBe(false);
        expect(second.toString()).toBe("2");
    });

    it("a value coming from not available or from nothing is not a change", () => {
        const container = new ExpressionContainer(undefined, 1, 0, "from-default");
        container.value = "not available";
        container.value = "5";
        expect(container.valueChanged).toBe(false);
        const blank = new ExpressionContainer(undefined, 1, 0, "from-blank");
        blank.value = "";
        blank.value = "5";
        expect(blank.valueChanged).toBe(false);
    });
});

describe("Scope", () => {
    it("is an expression container of the frame's thread, named after the scope", async () => {
        const variables = vi.fn(variablesFrom({ 2: [variable("i", "0")] }));
        const session = mockSession({ variables });
        const scope = new Scope(frameOf(session), 77, "Locals", 2, true, 1, 0);
        expect(scope.getId()).toBe("scope:Locals:77");
        expect(scope.toString()).toBe("Locals");
        expect(scope.expensive).toBe(true);
        expect(scope.childrenHaveBeenLoaded).toBe(false);
        expect(scope.getSession()).toBe(session);
        await scope.getChildren();
        expect(scope.childrenHaveBeenLoaded).toBe(true);
        expect(variables).toHaveBeenCalledWith(2, 1, undefined, undefined, undefined);
        expect(scope.toDebugProtocolObject()).toEqual({ name: "Locals", variablesReference: 2, expensive: true });
        expect(
            new Scope(frameOf(session), 1, "R", undefined as unknown as number, false).toDebugProtocolObject(),
        ).toEqual({
            name: "R",
            variablesReference: 0,
            expensive: false,
        });
    });
});
