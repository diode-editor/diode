import { describe, expect, it, vi } from "vitest";

import {
    createMockDebugModel,
    mockSession,
    mockStateService,
    NO_DIRTY_FILES,
} from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import type { IBreakpointsChangeEvent, IDebugSession, IExpression } from "./debug.ts";
import { ExpressionContainer } from "./debugModel.ts";
import { DebugStorage } from "./debugStorage.ts";

type VariablesArgs = Parameters<IDebugSession["variables"]>;

/** An adapter over one array of `length` indexed elements under reference 5, named `a`, `b` on demand. */
function arrayAdapter(length: number, named: string[] = []) {
    return vi.fn((...[reference, , filter, start, count]: VariablesArgs) => {
        if (reference !== 5) {
            return Promise.resolve({ body: { variables: [] } } as unknown as DebugProtocol.VariablesResponse);
        }
        if (filter === "named") {
            const variables = named.map((name) => ({ name, value: "1", variablesReference: 0 }));
            return Promise.resolve({ body: { variables } } as DebugProtocol.VariablesResponse);
        }
        const from = start ?? 0;
        const to = Math.min(length, from + (count ?? length));
        const variables: DebugProtocol.Variable[] = [];
        for (let i = from; i < to; i++) {
            variables.push({ name: `[${String(i)}]`, value: String(i), variablesReference: 0 });
        }
        return Promise.resolve({ body: { variables } } as DebugProtocol.VariablesResponse);
    });
}

function arrayRoot(variables: ReturnType<typeof arrayAdapter>, indexed: number, named = 0): ExpressionContainer {
    return new ExpressionContainer(mockSession({ variables }), 1, 5, "root", named, indexed);
}

async function names(element: Pick<IExpression, "getChildren">): Promise<string[]> {
    return (await element.getChildren()).map((c) => c.name);
}

describe("Variables chunking at the boundaries (upstream #9774)", () => {
    it("exactly 100 indexed children are fetched in one request, 101 split into two chunks", async () => {
        const hundred = arrayAdapter(100);
        expect(await names(arrayRoot(hundred, 100))).toHaveLength(100);
        expect(hundred).toHaveBeenCalledExactlyOnceWith(5, 1, "indexed", 0, 100);

        const more = arrayAdapter(101);
        expect(await names(arrayRoot(more, 101))).toEqual(["[0..99]", "[100..100]"]);
        expect(more).not.toHaveBeenCalled();
    });

    it("10000 children make 100 chunks of 100, 10001 make two chunks of 10000", async () => {
        const tenK = await names(arrayRoot(arrayAdapter(10000), 10000));
        expect(tenK).toHaveLength(100);
        expect(tenK.at(-1)).toBe("[9900..9999]");
        expect(await names(arrayRoot(arrayAdapter(10001), 10001))).toEqual(["[0..9999]", "[10000..10000]"]);
    });

    it("a chunk of a chunk counts from its own start, and its leaves are fetched at that offset", async () => {
        const variables = arrayAdapter(25000);
        const root = arrayRoot(variables, 25000);
        const top = await root.getChildren();
        expect(top.map((c) => c.name)).toEqual(["[0..9999]", "[10000..19999]", "[20000..24999]"]);

        const last = await top[2].getChildren();
        expect(last).toHaveLength(50);
        expect(last[0].name).toBe("[20000..20099]");
        expect(last.at(-1)?.name).toBe("[24900..24999]");

        const leaves = await last.at(-1)!.getChildren();
        expect(leaves.map((c) => c.name)).toEqual(Array.from({ length: 100 }, (_, i) => `[${String(24900 + i)}]`));
        expect(variables).toHaveBeenLastCalledWith(5, 1, "indexed", 24900, 100);
    });

    it("named members come once at the top, not again inside each chunk", async () => {
        const variables = arrayAdapter(250, ["length", "capacity"]);
        const root = arrayRoot(variables, 250, 2);
        const top = await root.getChildren();
        expect(top.map((c) => c.name)).toEqual(["length", "capacity", "[0..99]", "[100..199]", "[200..249]"]);
        expect(await names(top[4])).toEqual(Array.from({ length: 50 }, (_, i) => `[${String(200 + i)}]`));
    });

    it("chunk ids are distinct across chunks and levels", async () => {
        const root = arrayRoot(arrayAdapter(25000), 25000);
        const top = await root.getChildren();
        const second = await top[1].getChildren();
        const ids = [...top, ...second].map((c) => c.getId());
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe("DebugModel and the workspace store", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    it("a new model over the stored state has the same breakpoints, watch expressions included, unicode intact", () => {
        const state = mockStateService();
        const model = createMockDebugModel(disposables, state);
        const file = Uri.file("/проект/файл с пробелом.ts");
        model.addBreakpoints(file, [
            { lineNumber: 3, condition: "имя === 'ü'", hitCondition: "> 2", logMessage: "значение {x} 🚀" },
            { lineNumber: 10, column: 4, enabled: false },
        ]);
        model.addFunctionBreakpoint({ name: "функция", condition: "a > 1" });
        model.addWatchExpression("строка.length 🙂");
        model.addWatchExpression("");
        const storage = disposables.add(new DebugStorage(state, NO_DIRTY_FILES, NULL_LOGGER));
        storage.storeBreakpoints(model);
        storage.storeWatchExpressions(model.getWatchExpressions());

        const restored = createMockDebugModel(disposables, mockStateServiceFrom(state.values));
        const bps = restored.getBreakpoints();
        expect(bps.map((b) => [b.uri.toString(), b.lineNumber, b.column, b.enabled])).toEqual([
            [file.toString(), 3, undefined, true],
            [file.toString(), 10, 4, false],
        ]);
        expect([bps[0].condition, bps[0].hitCondition, bps[0].logMessage]).toEqual([
            "имя === 'ü'",
            "> 2",
            "значение {x} 🚀",
        ]);
        expect(restored.getFunctionBreakpoints().map((f) => [f.name, f.condition])).toEqual([["функция", "a > 1"]]);
        expect(restored.getWatchExpressions().map((w) => w.name)).toEqual(["строка.length 🙂", ""]);
        expect(restored.getWatchExpressions().map((w) => w.getId())).toEqual(
            model.getWatchExpressions().map((w) => w.getId()),
        );
    });

    it("opening another workspace replaces the model's breakpoints and watch expressions, and says so", () => {
        const state = mockStateService();
        const model = createMockDebugModel(disposables, state);
        model.addBreakpoints(Uri.file("/a.ts"), [{ lineNumber: 1 }]);
        model.addFunctionBreakpoint({ name: "f" });
        model.addWatchExpression("old");
        const storage = disposables.add(new DebugStorage(state, NO_DIRTY_FILES, NULL_LOGGER));
        storage.storeBreakpoints(model);
        const onBreakpoints = vi.fn();
        const onWatch = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(onBreakpoints));
        disposables.add(model.onDidChangeWatchExpressions(onWatch));

        state.openWorkspace(new Map<string, unknown>([["debug.watchexpressions", [{ name: "new", id: "w9" }]]]));

        expect(model.getBreakpoints()).toEqual([]);
        expect(model.getFunctionBreakpoints()).toEqual([]);
        expect(model.getWatchExpressions().map((w) => w.name)).toEqual(["new"]);
        expect(onBreakpoints).toHaveBeenCalled();
        expect(onWatch).toHaveBeenCalled();
    });

    it("garbage in the store does not break building the model", () => {
        const state = mockStateServiceFrom(
            new Map<string, unknown>([
                ["debug.breakpoint", "not a list"],
                ["debug.functionbreakpoint", [null, 42]],
                ["debug.watchexpressions", { name: "x" }],
                ["debug.exceptionbreakpoint", [{}]],
                ["debug.databreakpoint", [{ description: 1 }]],
            ]),
        );
        const model = createMockDebugModel(disposables, state);
        expect(model.getBreakpoints()).toEqual([]);
        expect(model.getWatchExpressions()).toEqual([]);
    });
});

describe("Watch expressions: moves and renames at the edges", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    it("moves to the front and past the end, unknown ids change nothing", () => {
        const model = createMockDebugModel(disposables);
        const [a, b, c] = ["a", "b", "c"].map((n) => model.addWatchExpression(n));
        model.moveWatchExpression(c.getId(), 0);
        expect(model.getWatchExpressions().map((w) => w.name)).toEqual(["c", "a", "b"]);
        model.moveWatchExpression(c.getId(), 99);
        expect(model.getWatchExpressions().map((w) => w.name)).toEqual(["a", "b", "c"]);
        model.moveWatchExpression("nope", 0);
        model.renameWatchExpression("nope", "zzz");
        model.removeWatchExpressions("nope");
        expect(model.getWatchExpressions().map((w) => w.name)).toEqual(["a", "b", "c"]);
        model.renameWatchExpression(b.getId(), "ß");
        model.removeWatchExpressions(a.getId());
        expect(model.getWatchExpressions().map((w) => w.name)).toEqual(["ß", "c"]);
    });
});

function mockStateServiceFrom(values: Map<string, unknown>): ReturnType<typeof mockStateService> {
    const state = mockStateService();
    state.values = new Map(values);
    return state;
}

describe("Breakpoints: filters and edits", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    it("filters by uri, line and column together; removing in one file leaves the others", () => {
        const model = createMockDebugModel(disposables);
        const a = Uri.file("/a.ts");
        const b = Uri.file("/b.ts");
        model.addBreakpoints(a, [{ lineNumber: 5 }, { lineNumber: 5, column: 9 }, { lineNumber: 6, enabled: false }]);
        model.addBreakpoints(b, [{ lineNumber: 5 }]);
        expect(model.getBreakpoints({ uri: a })).toHaveLength(3);
        expect(model.getBreakpoints({ uri: a, lineNumber: 5 })).toHaveLength(2);
        expect(model.getBreakpoints({ uri: a, lineNumber: 5, column: 9 }).map((x) => x.column)).toEqual([9]);
        expect(model.getBreakpoints({ lineNumber: 5 })).toHaveLength(3);
        expect(model.getBreakpoints({ uri: a, enabledOnly: true })).toHaveLength(2);

        const removed = vi.fn<(e: IBreakpointsChangeEvent | undefined) => void>();
        disposables.add(model.onDidChangeBreakpoints(removed));
        model.removeBreakpoints([...model.getBreakpoints({ uri: a })]);
        expect(model.getBreakpoints().map((x) => x.uri.toString())).toEqual([b.toString()]);
        expect(removed).toHaveBeenCalledOnce();
        expect(removed.mock.calls[0][0]?.removed).toHaveLength(3);
    });

    it("updateBreakpoints moves a breakpoint when its line shifts, and the list stays sorted", () => {
        const model = createMockDebugModel(disposables);
        const a = Uri.file("/a.ts");
        const [first, second] = model.addBreakpoints(a, [{ lineNumber: 2 }, { lineNumber: 4 }]);
        model.updateBreakpoints(new Map([[first.getId(), { lineNumber: 10 }]]));
        expect(model.getBreakpoints().map((x) => x.getId())).toEqual([second.getId(), first.getId()]);
        expect(model.getBreakpoints({ uri: a, lineNumber: 10 }).map((x) => x.getId())).toEqual([first.getId()]);
    });
});
