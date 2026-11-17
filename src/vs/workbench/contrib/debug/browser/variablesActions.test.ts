import { describe, expect, it, vi } from "vitest";

import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { Token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { ServiceAccessor } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IDebugSession, IStackFrame } from "../common/debug.ts";
import { Expression, Scope, Variable } from "../common/debugModel.ts";

import { variableMenuKeys } from "./debugContextMenus.ts";
import { DebugServiceDIToken } from "./debugService.ts";
import { DebugViewletComponentDIToken } from "./debugViewlet.ts";
import {
    breakWhenValueChangesAction,
    copyEvaluatePathAction,
    copyValueAction,
    copyWatchExpressionAction,
    setWatchExpressionAction,
} from "./variablesActions.ts";

interface IFixture {
    readonly accessor: ServiceAccessor;
    readonly written: string[];
    readonly evaluated: unknown[][];
    readonly selected: unknown[];
    readonly dataBreakpoints: unknown[];
}

/** The services the commands ask for, with a session whose `evaluate` answers `answer`. */
function fixture(capabilities: Record<string, boolean>, answer: () => Promise<unknown>): IFixture {
    const written: string[] = [];
    const evaluated: unknown[][] = [];
    const selected: unknown[] = [];
    const dataBreakpoints: unknown[] = [];
    const session = {
        capabilities,
        configuration: { type: "lldb" },
        evaluate: (...args: unknown[]) => {
            evaluated.push(args);
            return answer();
        },
        dataBreakpointInfo: () => Promise.resolve({ dataId: null, description: "count" }),
    } as unknown as IDebugSession;
    const services = new Map<unknown, unknown>([
        [ClipboardDIToken, { writeText: (text: string) => Promise.resolve(void written.push(text)) }],
        [
            DebugServiceDIToken,
            {
                getViewModel: () => ({
                    focusedStackFrame: { frameId: 5 },
                    focusedSession: session,
                    setSelectedExpression: (expression: unknown) => selected.push(expression),
                }),
                addDataBreakpoint: (opts: unknown) => Promise.resolve(void dataBreakpoints.push(opts)),
            },
        ],
        [DebugViewletComponentDIToken, { watch: { tree: { focused: undefined } } }],
    ]);
    const accessor = { get: <T>(token: Token<T>) => services.get(token) as T };
    return { accessor, written, evaluated, selected, dataBreakpoints };
}

function variable(session: IDebugSession | undefined, evaluateName: string | undefined): Variable {
    const frame = { thread: { session, threadId: 1 } } as unknown as IStackFrame;
    return new Variable(
        session,
        1,
        new Scope(frame, 0, "Locals", 7, false),
        0,
        "v",
        evaluateName,
        "true",
        0,
        0,
        undefined,
        undefined,
    );
}

describe("the commands of the VARIABLES and WATCH rows", () => {
    it("Copy Value of a watch row evaluates in the `watch` context without the clipboard capability", async () => {
        const fx = fixture({}, () => Promise.resolve({ body: { result: "3" } }));
        await copyValueAction.run(fx.accessor, new Expression("a + b"));
        expect(fx.evaluated).toEqual([["a + b", 5, "watch"]]);
        expect(fx.written).toEqual(["3"]);
    });

    it("Copy Value of a variable without an evaluate name evaluates its value; no answer copies nothing", async () => {
        const fx = fixture({ supportsClipboardContext: true }, () => Promise.resolve(undefined));
        await copyValueAction.run(fx.accessor, variable(undefined, ""));
        expect(fx.evaluated).toEqual([["true", 5, "clipboard"]]);
        expect(fx.written).toEqual([]);
    });

    it("Copy as Expression of a variable without an evaluate name copies an empty string", async () => {
        const fx = fixture({}, () => Promise.resolve(undefined));
        await copyEvaluatePathAction.run(fx.accessor, { sessionId: "s1", variable: { name: "v" } });
        expect(fx.written).toEqual([""]);
    });

    it("Break on Value Change with an info without an id asks for an empty one, as upstream's `!`", async () => {
        const fx = fixture({ supportsDataBreakpoints: true }, () => Promise.resolve(undefined));
        const session = (fx.accessor.get(DebugServiceDIToken).getViewModel() as { focusedSession: IDebugSession })
            .focusedSession;
        await variableMenuKeys(variable(session, "count"));
        await breakWhenValueChangesAction.run(fx.accessor);
        expect(fx.dataBreakpoints).toMatchObject([{ src: { dataId: "" }, accessType: "write" }]);
    });

    it("Set Value of WATCH takes only an expression or a variable; Copy Expression without one copies nothing", async () => {
        const fx = fixture({}, () => Promise.resolve(undefined));
        setWatchExpressionAction.run(fx.accessor, "not an expression");
        expect(fx.selected).toEqual([]);
        await copyWatchExpressionAction.run(fx.accessor, undefined);
        expect(fx.written).toEqual([]);
        vi.restoreAllMocks();
    });
});
