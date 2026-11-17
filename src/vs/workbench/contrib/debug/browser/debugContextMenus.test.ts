import type { MenuEntry } from "@tuidom/elements/menu/popupMenuElement";
import { describe, expect, it } from "vitest";

import { type TestDebugService, testDebugService } from "../../../../../TestUtils/debugSessionFixture.ts";
import { createMockDebugModel, mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { MenuId } from "../../../../platform/actions/common/menuId.ts";
import type { IResolvedMenuItemEntry } from "../../../../platform/actions/common/menuRegistry.ts";
import {
    DataBreakpointSetType,
    type IDataBreakpointInfoResponse,
    type IDebugSession,
    type IStackFrame,
} from "../common/debug.ts";
import { type DebugModel, Expression, Scope, Variable } from "../common/debugModel.ts";

import {
    breakpointItemKeys,
    getDataBreakpointInfoResponse,
    getModeKindForBreakpoint,
    getVariableInternalContext,
    showDebugContextMenu,
    variableMenuKeys,
    watchItemType,
    watchMenuKeys,
} from "./debugContextMenus.ts";

interface IFakeSession {
    readonly asked: unknown[][];
    readonly session: IDebugSession;
}

/** A session with the capabilities given whose `dataBreakpointInfo` answers `info` (a rejection when an Error). */
function fakeSession(
    capabilities: Record<string, boolean>,
    info?: IDataBreakpointInfoResponse | Error,
    type = "lldb",
): IFakeSession {
    const asked: unknown[][] = [];
    const session = {
        capabilities,
        configuration: { type },
        getId: () => "s1",
        dataBreakpointInfo: (...args: unknown[]) => {
            asked.push(args);
            return info instanceof Error ? Promise.reject(info) : Promise.resolve(info);
        },
        evaluate: () => Promise.resolve({ body: { result: "1", variablesReference: 0 } }),
    } as unknown as IDebugSession;
    return { asked, session };
}

function variable(
    session: IDebugSession | undefined,
    options: {
        evaluateName?: string;
        type?: string;
        memoryReference?: string;
        presentationHint?: { attributes?: string[]; lazy?: boolean };
        menuContext?: string;
    } = {},
): Variable {
    const frame = { thread: { session, threadId: 1 } } as unknown as IStackFrame;
    const scope = new Scope(frame, 0, "Locals", 7, false);
    return new Variable(
        session,
        1,
        scope,
        0,
        "count",
        options.evaluateName,
        "0",
        0,
        0,
        options.memoryReference,
        options.presentationHint,
        options.type,
        options.menuContext,
    );
}

describe("variableMenuKeys", () => {
    it("a variable without a session: upstream's keys with nothing from an adapter", async () => {
        const v = variable(undefined);
        expect(await variableMenuKeys(v)).toEqual({
            debugProtocolVariableMenuContext: "",
            variableEvaluateNamePresent: false,
            canViewMemory: false,
            variableIsReadonly: false,
            variableType: "",
            debugType: "",
        });
        expect(getVariableInternalContext()).toBe(v);
        expect(getDataBreakpointInfoResponse()).toBeUndefined();
    });

    it("the adapter's menu context, memory, read-only and lazy flags, type and debug type", async () => {
        const { session } = fakeSession({ supportsReadMemoryRequest: true });
        expect(
            await variableMenuKeys(
                variable(session, {
                    evaluateName: "count",
                    type: "int",
                    memoryReference: "0x10",
                    presentationHint: { attributes: ["readOnly"] },
                    menuContext: "pointer",
                }),
            ),
        ).toEqual({
            debugProtocolVariableMenuContext: "pointer",
            variableEvaluateNamePresent: true,
            canViewMemory: true,
            variableIsReadonly: true,
            variableType: "int",
            debugType: "lldb",
        });
        expect(
            (await variableMenuKeys(variable(session, { presentationHint: { lazy: true } }))).variableIsReadonly,
        ).toBe(true);
        // Memory takes both the capability and a reference.
        expect((await variableMenuKeys(variable(session))).canViewMemory).toBe(false);
        const noMemory = fakeSession({});
        expect((await variableMenuKeys(variable(noMemory.session, { memoryReference: "0x10" }))).canViewMemory).toBe(
            false,
        );
    });

    it("data breakpoints: the access types offered, a change without them, none without an id or on a failure", async () => {
        const all = fakeSession(
            { supportsDataBreakpoints: true },
            { dataId: "7:count", description: "count", accessTypes: ["read", "write", "readWrite"] },
        );
        expect(await variableMenuKeys(variable(all.session))).toMatchObject({
            breakWhenValueIsReadSupported: true,
            breakWhenValueChangesSupported: true,
            breakWhenValueIsAccessedSupported: true,
        });
        expect(all.asked).toEqual([["count", 7]]);
        expect(getDataBreakpointInfoResponse()?.dataId).toBe("7:count");

        const plain = fakeSession({ supportsDataBreakpoints: true }, { dataId: "x", description: "count" });
        expect(await variableMenuKeys(variable(plain.session))).toMatchObject({ breakWhenValueChangesSupported: true });

        const none = fakeSession({ supportsDataBreakpoints: true }, { dataId: null, description: "no" });
        expect(await variableMenuKeys(variable(none.session))).toMatchObject({ breakWhenValueChangesSupported: false });

        const failing = fakeSession({ supportsDataBreakpoints: true }, new Error("not supported here"));
        expect(await variableMenuKeys(variable(failing.session))).toMatchObject({
            breakWhenValueChangesSupported: false,
        });
        expect(getDataBreakpointInfoResponse()).toBeUndefined();
    });
});

describe("showDebugContextMenu", () => {
    it("leaves the inline group out and runs every item with the row's arguments", () => {
        const ran: unknown[][] = [];
        let entries: MenuEntry[] = [];
        const item = (id: string): IResolvedMenuItemEntry => ({
            label: id,
            id,
            enabled: true,
            onSelect: () => undefined,
        });
        showDebugContextMenu(
            {
                menus: {
                    getEntryGroups: () => [
                        { group: "inline", entries: [item("glyph")] },
                        { group: "navigation", entries: [item("first")] },
                    ],
                },
                contextMenu: {
                    showContextMenu: (delegate) => {
                        entries = delegate.getEntries?.() ?? [];
                    },
                },
                commands: { execute: (...args: unknown[]) => ran.push(args) },
            },
            {
                owner: {} as never,
                anchor: { screenX: 1, screenY: 2 },
                menuId: MenuId.DebugWatchContext,
                keys: {},
                args: ["row"],
            },
        );

        expect(entries.map((entry) => (entry.type === "separator" ? "-" : entry.label))).toEqual(["first"]);
        (entries[0] as { onSelect: () => void }).onSelect();
        expect(ran).toEqual([["first", "row"]]);
    });
});

describe("watchMenuKeys", () => {
    const frame = { frameId: 3 } as IStackFrame;

    it("an expression without a session; the item type of each row", async () => {
        const expression = new Expression("a + b");
        expect(await watchMenuKeys(expression, undefined)).toEqual({
            variableEvaluateNamePresent: false,
            watchItemType: "expression",
            canViewMemory: false,
            variableIsReadonly: false,
            variableType: "",
            debugType: "",
        });
        expect(watchItemType(expression)).toBe("expression");
        expect(watchItemType(variable(undefined))).toBe("variable");
        expect(watchItemType(undefined)).toBe("");
    });

    it("asks by the evaluate name, else by the name in the container, else by the expression", async () => {
        const fake = fakeSession(
            { supportsDataBreakpoints: true, supportsReadMemoryRequest: true },
            {
                dataId: "d",
                description: "d",
                accessTypes: ["write"],
            },
        );
        expect(
            await watchMenuKeys(variable(fake.session, { evaluateName: "p.x", memoryReference: "0x1" }), frame),
        ).toMatchObject({
            variableEvaluateNamePresent: true,
            canViewMemory: true,
            breakWhenValueChangesSupported: true,
        });
        await watchMenuKeys(variable(fake.session), undefined);
        const expression = new Expression("total");
        await expression.evaluate(fake.session, frame, "watch");
        await watchMenuKeys(expression, frame);
        // Without a focused frame the request goes all the same, without a frame id.
        await watchMenuKeys(variable(fake.session, { evaluateName: "p.y" }), undefined);
        await watchMenuKeys(expression, undefined);

        expect(fake.asked).toEqual([
            ["p.x", undefined, 3],
            ["count", 7, undefined],
            ["total", undefined, 3],
            ["p.y", undefined, undefined],
            ["total", undefined, undefined],
        ]);
        // Memory takes both the capability and a reference.
        expect((await watchMenuKeys(variable(fake.session), frame)).canViewMemory).toBe(false);
        const noMemory = fakeSession({});
        expect((await watchMenuKeys(variable(noMemory.session, { memoryReference: "0x1" }), frame)).canViewMemory).toBe(
            false,
        );
    });

    it("a failed request leaves the data breakpoint items out", async () => {
        const fake = fakeSession({ supportsDataBreakpoints: true }, new Error("no"));
        expect(await watchMenuKeys(variable(fake.session), frame)).toMatchObject({
            breakWhenValueChangesSupported: false,
        });
        expect(getDataBreakpointInfoResponse()).toBeUndefined();
    });
});

describe("breakpointItemKeys", () => {
    const FILE = Uri.file("/w/a.c");

    function setup(session?: Partial<IDebugSession>): { model: DebugModel; service: TestDebugService } {
        const model = createMockDebugModel({ add: (o) => o });
        const service = testDebugService(model);
        if (session) {
            service.viewModel.setFocus(undefined, undefined, mockSession({ getId: () => "s", ...session }), false);
        }
        return { model, service };
    }

    it("the row's type; without a session a breakpoint takes a condition, a session tells by its capability", () => {
        const { model, service } = setup();
        const [breakpoint] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        expect(breakpointItemKeys(breakpoint, service)).toEqual({
            breakpointItemType: "breakpoint",
            breakpointSupportsCondition: true,
            breakpointItemBytes: false,
            breakpointHasModes: false,
        });

        const focused = setup({ capabilities: {} });
        const [other] = focused.model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        expect(breakpointItemKeys(other, focused.service).breakpointSupportsCondition).toBe(false);
        const supporting = setup({ capabilities: { supportsConditionalBreakpoints: true } });
        const [third] = supporting.model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        expect(breakpointItemKeys(third, supporting.service).breakpointSupportsCondition).toBe(true);
    });

    it("an exception filter takes a condition by its own word, whatever the session can do", () => {
        const { model, service } = setup({ capabilities: { supportsConditionalBreakpoints: true } });
        model.setExceptionBreakpointsForSession("s", [
            { filter: "a", label: "A", supportsCondition: true },
            { filter: "b", label: "B" },
        ]);
        const [a, b] = model.getExceptionBreakpoints();
        expect(breakpointItemKeys(a, service)).toEqual(
            expect.objectContaining({ breakpointItemType: "exceptionBreakpoint", breakpointSupportsCondition: true }),
        );
        expect(breakpointItemKeys(b, service).breakpointSupportsCondition).toBe(false);
    });

    it("a data breakpoint on an address is one of bytes, on a variable not", () => {
        const { model, service } = setup();
        const data = { canPersist: false, accessTypes: undefined, accessType: "write" as const };
        model.addDataBreakpoint({
            ...data,
            description: "v",
            src: { type: DataBreakpointSetType.Variable, dataId: "v" },
        });
        model.addDataBreakpoint({
            ...data,
            description: "m",
            src: { type: DataBreakpointSetType.Address, address: "0x10", bytes: 4 },
        });
        const [variable, memory] = model.getDataBreakpoints();
        expect(breakpointItemKeys(variable, service).breakpointItemBytes).toBe(false);
        expect(breakpointItemKeys(memory, service).breakpointItemBytes).toBe(true);
    });

    it("more than one mode of the row's kind: source for a breakpoint, instruction, exception for the others", () => {
        const { model, service } = setup();
        const [breakpoint] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        model.addInstructionBreakpoint({ instructionReference: "0x1", offset: 0, canPersist: false, address: 1n });
        const [instruction] = model.getInstructionBreakpoints();
        model.addFunctionBreakpoint({ name: "f" });
        const [fn] = model.getFunctionBreakpoints();
        const mode = (m: string, appliesTo: string[]): DebugProtocol.BreakpointMode => ({
            mode: m,
            label: m,
            appliesTo,
        });
        model.registerBreakpointModes("t", [
            mode("s1", ["source"]),
            mode("s2", ["source"]),
            mode("i1", ["instruction"]),
        ]);
        expect(breakpointItemKeys(breakpoint, service).breakpointHasModes).toBe(true);
        expect(breakpointItemKeys(instruction, service).breakpointHasModes).toBe(false);
        expect(breakpointItemKeys(fn, service).breakpointHasModes).toBe(false);
        model.registerBreakpointModes("t", [mode("e1", ["exception"]), mode("e2", ["exception"])]);
        expect(breakpointItemKeys(fn, service).breakpointHasModes).toBe(true);
        expect(getModeKindForBreakpoint(instruction)).toBe("instruction");
    });
});
