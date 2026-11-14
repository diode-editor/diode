import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockDebugModel, mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import {
    DataBreakpointSetType,
    getStateLabel,
    isDebugConfig,
    isFrameDeemphasized,
    type IStackFrame,
    State,
} from "./debug.ts";
import {
    Breakpoint,
    DataBreakpoint,
    type DebugModel,
    ExceptionBreakpoint,
    Expression,
    FunctionBreakpoint,
    InstructionBreakpoint,
    type ITextFileDirtyState,
} from "./debugModel.ts";

const FILE = Uri.file("/src/main.cpp");

function breakpoint(
    dirty: ITextFileDirtyState = { isDirty: () => false },
    extra: Partial<Breakpoint> = {},
): Breakpoint {
    return new Breakpoint(
        {
            uri: FILE,
            lineNumber: 10,
            column: 4,
            adapterData: undefined,
            triggeredBy: undefined,
            condition: "i > 1",
            hitCondition: "3",
            logMessage: "i={i}",
            mode: "hw",
            modeLabel: "Hardware",
            ...extra,
        },
        dirty,
        NULL_LOGGER,
        "bp1",
    );
}

const ALL_CAPABILITIES: DebugProtocol.Capabilities = {
    supportsConditionalBreakpoints: true,
    supportsHitConditionalBreakpoints: true,
    supportsLogPoints: true,
    supportsFunctionBreakpoints: true,
    supportsDataBreakpoints: true,
    supportsInstructionBreakpoints: true,
};

/** Session data the way the model builds it from a DAP breakpoint and the session's capabilities. */
function verify(
    model: DebugModel,
    bp: { getId(): string },
    data: DebugProtocol.Breakpoint,
    capabilities = ALL_CAPABILITIES,
    sessionId = "s1",
): void {
    model.setBreakpointSessionData(sessionId, capabilities, new Map([[bp.getId(), data]]));
}

describe("Breakpoint", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let model: DebugModel;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
    });

    function added(
        data: Parameters<DebugModel["addBreakpoints"]>[1][number] = { lineNumber: 10, column: 4 },
    ): Breakpoint {
        return model.addBreakpoints(FILE, [data])[0] as Breakpoint;
    }

    it("sends the line the user set, whatever the adapter moved it to", () => {
        const bp = breakpoint();
        expect(bp.toDAP()).toEqual({
            line: 10,
            column: 4,
            condition: "i > 1",
            hitCondition: "3",
            logMessage: "i={i}",
            mode: "hw",
        });
        expect(bp.sessionAgnosticData).toEqual({ lineNumber: 10, column: 4 });
        expect(bp.toString()).toBe("main.cpp 10");
    });

    it("an unverified breakpoint shows where the user set it, a verified one where the adapter put it", () => {
        const bp = added();
        verify(model, bp, { verified: false, line: 12, column: 1, endLine: 13, endColumn: 2, message: "no code" });
        expect([bp.verified, bp.lineNumber, bp.column, bp.endLineNumber, bp.endColumn]).toEqual([
            false,
            10,
            4,
            undefined,
            undefined,
        ]);
        expect(bp.message).toBe("no code");
        expect(bp.sessionsThatVerified).toEqual([]);

        verify(model, bp, { verified: true, line: 12, column: 1, endLine: 13, endColumn: 2, id: 7 });
        expect([bp.verified, bp.lineNumber, bp.column, bp.endLineNumber, bp.endColumn]).toEqual([true, 12, 1, 13, 2]);
        expect(bp.sessionsThatVerified).toEqual(["s1"]);
        expect(bp.getIdFromAdapter("s1")).toBe(7);
        expect(bp.getIdFromAdapter("s2")).toBeUndefined();
        expect(bp.toDAP().line).toBe(10);
    });

    it("a verified answer without a line or column keeps the user's", () => {
        const bp = added();
        verify(model, bp, { verified: true });
        expect([bp.lineNumber, bp.column]).toEqual([10, 4]);
    });

    it("a breakpoint in a modified file is unverified, and says so", () => {
        let dirty = false;
        const files: ITextFileDirtyState = { isDirty: (uri) => dirty && uri.toString() === FILE.toString() };
        const local = createMockDebugModel(disposables, undefined, files);
        const bp = local.addBreakpoints(FILE, [{ lineNumber: 10 }])[0] as Breakpoint;
        expect(bp.verified).toBe(true);
        dirty = true;
        expect(bp.verified).toBe(true);
        expect(bp.message).toBe("Unverified breakpoint. File is modified, please restart debug session.");
        verify(local, bp, { verified: true, line: 11 });
        expect(bp.verified).toBe(false);
        expect(bp.lineNumber).toBe(10);
        dirty = false;
        expect(bp.verified).toBe(true);
        expect(bp.message).toBeUndefined();
    });

    it("a verified breakpoint lives at the adapter's source, and takes its adapter data", () => {
        const bp = added();
        verify(model, bp, { verified: false, source: { path: "/moved/main.cpp", adapterData: { k: 1 } } });
        expect(bp.uri.toString()).toBe(FILE.toString());
        expect(bp.adapterData).toEqual({ k: 1 });
        verify(model, bp, { verified: true, source: { path: "/moved/main.cpp", adapterData: { k: 2 } } });
        expect(bp.uri.toString()).toBe(Uri.file("/moved/main.cpp").toString());
        expect(bp.originalUri.toString()).toBe(FILE.toString());
        expect(bp.toJSON().adapterData).toEqual({ k: 2 });

        model.setBreakpointSessionData("s1", {}, undefined);
        // The first adapter data stays the breakpoint's own once the session is gone.
        expect(bp.adapterData).toEqual({ k: 1 });
        expect(bp.uri.toString()).toBe(FILE.toString());
    });

    it("a source without adapter data keeps the breakpoint's own, a source reference is a debug uri", () => {
        const bp = new Breakpoint(
            { uri: FILE, lineNumber: 1, column: undefined, adapterData: "own", triggeredBy: undefined },
            { isDirty: () => false },
            NULL_LOGGER,
        );
        bp.setSessionData("s9", {
            verified: true,
            source: { name: "gen.js", path: "gen.js", sourceReference: 4 },
            supportsConditionalBreakpoints: false,
            supportsHitConditionalBreakpoints: false,
            supportsLogPoints: false,
            supportsFunctionBreakpoints: false,
            supportsDataBreakpoints: false,
            supportsInstructionBreakpoints: false,
            sessionId: "",
        });
        expect(bp.adapterData).toBe("own");
        expect(bp.uri.toString(true)).toBe("debug:gen.js?session=s9&ref=4");
    });

    it("is unsupported when a session cannot do its condition, hit count or log message", () => {
        const cases: [Partial<Breakpoint>, keyof DebugProtocol.Capabilities][] = [
            [{ logMessage: "x" }, "supportsLogPoints"],
            [{ condition: "x" }, "supportsConditionalBreakpoints"],
            [{ hitCondition: "2" }, "supportsHitConditionalBreakpoints"],
        ];
        for (const [option, capability] of cases) {
            const bp = added({ lineNumber: 20, ...option });
            expect(bp.supported).toBe(true);
            verify(model, bp, { verified: true }, { ...ALL_CAPABILITIES, [capability]: false });
            expect(bp.supported, capability).toBe(false);
            verify(model, bp, { verified: true });
            expect(bp.supported, capability).toBe(true);
            model.removeBreakpoints([bp]);
        }
    });

    it("two sessions verifying it at different places show the user's place, at the same place theirs", () => {
        const bp = added();
        model.setBreakpointSessionData(
            "a",
            ALL_CAPABILITIES,
            new Map([[bp.getId(), { verified: true, line: 11, column: 1 }]]),
        );
        model.setBreakpointSessionData(
            "b",
            ALL_CAPABILITIES,
            new Map([[bp.getId(), { verified: true, line: 11, column: 1 }]]),
        );
        expect(bp.lineNumber).toBe(11);
        expect(bp.sessionsThatVerified).toEqual(["a", "b"]);
        model.setBreakpointSessionData(
            "b",
            ALL_CAPABILITIES,
            new Map([[bp.getId(), { verified: true, line: 11, column: 2 }]]),
        );
        expect(bp.lineNumber).toBe(10);
        expect(bp.message).toBeUndefined();
    });

    it("hands back the DAP breakpoint a session reported", () => {
        const bp = added();
        const reported: DebugProtocol.Breakpoint = {
            id: 3,
            verified: true,
            message: "m",
            source: { path: "/src/main.cpp" },
            line: 10,
            column: 4,
            endLine: 10,
            endColumn: 9,
            instructionReference: "0x5",
            offset: 2,
        };
        verify(model, bp, reported);
        expect(model.getDebugProtocolBreakpoint(bp.getId(), "s1")).toEqual(reported);
        expect(model.getDebugProtocolBreakpoint(bp.getId(), "s2")).toBeUndefined();
        expect(model.getDebugProtocolBreakpoint("missing", "s1")).toBeUndefined();
    });

    it("pends on its trigger until a session answers, and remembers which sessions triggered it", () => {
        const bp = added({ lineNumber: 30, triggeredBy: "bp0" });
        expect(bp.pending).toBe(true);
        expect(added({ lineNumber: 31 }).pending).toBe(false);
        bp.setSessionDidTrigger("s1");
        expect(bp.getSessionDidTrigger("s1")).toBe(true);
        expect(bp.getSessionDidTrigger("s2")).toBe(false);
        bp.setSessionDidTrigger("s1", false);
        expect(bp.getSessionDidTrigger("s1")).toBe(false);
        bp.setSessionDidTrigger("s2", false);
        verify(model, bp, { verified: true });
        expect(bp.pending).toBe(false);
    });

    it("update changes only the fields given, a new trigger forgets who triggered it", () => {
        const bp = breakpoint();
        bp.setSessionDidTrigger("s1");
        bp.update({ lineNumber: undefined });
        expect(bp.lineNumber).toBe(10);
        bp.update({ column: undefined });
        expect(bp.column).toBeUndefined();
        bp.update({ condition: "j", hitCondition: "5", logMessage: "m" });
        expect([bp.condition, bp.hitCondition, bp.logMessage]).toEqual(["j", "5", "m"]);
        bp.update({ mode: "sw", modeLabel: "Software" });
        expect([bp.mode, bp.modeLabel]).toEqual(["sw", "Software"]);
        bp.update({});
        expect([bp.condition, bp.mode, bp.getSessionDidTrigger("s1")]).toEqual(["j", "sw", true]);
        bp.update({ triggeredBy: "other" });
        expect(bp.triggeredBy).toBe("other");
        expect(bp.getSessionDidTrigger("s1")).toBe(false);
        bp.update({ lineNumber: 0 });
        expect(bp.lineNumber).toBe(0);
    });

    it("serializes what the store keeps", () => {
        expect(breakpoint().toJSON()).toEqual({
            id: "bp1",
            enabled: true,
            condition: "i > 1",
            hitCondition: "3",
            logMessage: "i={i}",
            mode: "hw",
            modeLabel: "Hardware",
            uri: FILE,
            lineNumber: 10,
            column: 4,
            adapterData: undefined,
            triggeredBy: undefined,
        });
    });
});

describe("FunctionBreakpoint, DataBreakpoint, InstructionBreakpoint, ExceptionBreakpoint", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let model: DebugModel;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
    });

    it("a function breakpoint sends its name and conditions, needs the capability", () => {
        const fbp = model.addFunctionBreakpoint({
            name: "main",
            condition: "argc > 1",
            hitCondition: "2",
            enabled: false,
        });
        expect(fbp.toDAP()).toEqual({ name: "main", condition: "argc > 1", hitCondition: "2" });
        expect([(fbp as FunctionBreakpoint).toString(), fbp.enabled, fbp.supported]).toEqual(["main", false, true]);
        verify(model, fbp, { verified: true }, { supportsFunctionBreakpoints: false });
        expect(fbp.supported).toBe(false);
        expect((fbp as FunctionBreakpoint).toJSON()).toMatchObject({
            name: "main",
            condition: "argc > 1",
            enabled: false,
        });
    });

    it("updates of a function breakpoint take only the string fields, an unknown id changes nothing", () => {
        const fbp = model.addFunctionBreakpoint({ name: "main" }, "f1");
        const events = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(events));
        model.updateFunctionBreakpoint("f1", { condition: "c", hitCondition: "h" });
        expect([fbp.name, fbp.condition, fbp.hitCondition]).toEqual(["main", "c", "h"]);
        expect(events).toHaveBeenLastCalledWith({ changed: [fbp], sessionOnly: false });
        model.updateFunctionBreakpoint("nope", { name: "x" });
        expect(events).toHaveBeenCalledOnce();
        model.removeFunctionBreakpoints("nope");
        expect(model.getFunctionBreakpoints()).toEqual([fbp]);
        model.removeFunctionBreakpoints("f1");
        expect(events).toHaveBeenLastCalledWith({ removed: [fbp], sessionOnly: false });
    });

    it("a data breakpoint on a variable sends its data id", async () => {
        const dbp = new DataBreakpoint({
            description: "x",
            src: { type: DataBreakpointSetType.Variable, dataId: "d1" },
            canPersist: true,
            accessTypes: ["write"],
            accessType: "write",
            condition: "x > 1",
            hitCondition: "2",
        });
        expect(await dbp.toDAP(mockSession())).toEqual({
            dataId: "d1",
            accessType: "write",
            condition: "x > 1",
            hitCondition: "2",
        });
        expect([dbp.toString(), dbp.supported]).toEqual(["x", true]);
        expect(dbp.toJSON()).toMatchObject({
            description: "x",
            accessTypes: ["write"],
            accessType: "write",
            canPersist: true,
        });
    });

    it("a data breakpoint on an address asks each session for its data id once", async () => {
        const dataBytesBreakpointInfo = vi.fn(() => Promise.resolve({ dataId: "addr-1", description: "" }));
        const session = mockSession({ dataBytesBreakpointInfo });
        const dbp = new DataBreakpoint({
            description: "0x10",
            src: { type: DataBreakpointSetType.Address, address: "0x10", bytes: 4 },
            canPersist: false,
            accessTypes: undefined,
            accessType: "read",
        });
        expect((await dbp.toDAP(session))?.dataId).toBe("addr-1");
        expect((await dbp.toDAP(session))?.dataId).toBe("addr-1");
        expect(dataBytesBreakpointInfo).toHaveBeenCalledExactlyOnceWith("0x10", 4);

        const refusing = mockSession({ dataBytesBreakpointInfo: () => Promise.resolve(undefined) });
        expect(await dbp.toDAP(refusing)).toBeUndefined();

        const known = new DataBreakpoint({
            description: "0x20",
            src: { type: DataBreakpointSetType.Address, address: "0x20", bytes: 1 },
            canPersist: false,
            accessTypes: undefined,
            accessType: "read",
            initialSessionData: { session, dataId: "given" },
        });
        expect((await known.toDAP(session))?.dataId).toBe("given");
    });

    it("an old stored data breakpoint with a data id is read as a variable one (1.87)", () => {
        const old = new DataBreakpoint({
            description: "x",
            dataId: "d0",
            canPersist: true,
            accessType: "write",
        } as never);
        expect(old.src).toEqual({ type: DataBreakpointSetType.Variable, dataId: "d0" });
    });

    it("data and instruction breakpoints need their capability", () => {
        model.addDataBreakpoint(
            {
                description: "x",
                src: { type: DataBreakpointSetType.Variable, dataId: "d" },
                canPersist: false,
                accessTypes: undefined,
                accessType: "write",
            },
            "d1",
        );
        model.addInstructionBreakpoint({ instructionReference: "0x1", offset: 0, address: 1n, canPersist: false });
        const [dbp] = model.getDataBreakpoints();
        const [ibp] = model.getInstructionBreakpoints();
        model.setBreakpointSessionData(
            "s1",
            { supportsDataBreakpoints: false, supportsInstructionBreakpoints: false },
            new Map([
                [dbp.getId(), { verified: true }],
                [ibp.getId(), { verified: true }],
            ]),
        );
        expect([dbp.supported, ibp.supported]).toEqual([false, false]);
        model.updateDataBreakpoint("nope", { condition: "c" });
        expect(model.getDataBreakpoints()[0].condition).toBeUndefined();
        model.removeDataBreakpoints("nope");
        expect(model.getDataBreakpoints()).toHaveLength(1);
    });

    it("an instruction breakpoint sends its reference and offset", () => {
        const ibp = new InstructionBreakpoint({
            instructionReference: "0xAB",
            offset: 4,
            address: 171n,
            canPersist: false,
            condition: "c",
            hitCondition: "h",
            mode: "hw",
        });
        expect(ibp.toDAP()).toEqual({
            instructionReference: "0xAB",
            condition: "c",
            hitCondition: "h",
            mode: "hw",
            offset: 4,
        });
        expect([ibp.toString(), ibp.supported]).toEqual(["0xAB", true]);
        expect(ibp.toJSON()).toMatchObject({
            instructionReference: "0xAB",
            offset: 4,
            canPersist: false,
            address: 171n,
        });
    });

    it("instruction breakpoints are removed by reference with any offset, or all", () => {
        const add = (instructionReference: string, offset: number, address: bigint) => {
            model.addInstructionBreakpoint({ instructionReference, offset, address, canPersist: false });
        };
        add("r", 0, 1n);
        add("r", 4, 2n);
        add("q", 0, 3n);
        const events = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(events));
        model.removeInstructionBreakpoints("r");
        expect(model.getInstructionBreakpoints().map((b) => b.instructionReference)).toEqual(["q"]);
        expect(events.mock.lastCall?.[0]).toMatchObject({ sessionOnly: false });
        expect((events.mock.lastCall?.[0] as { removed: unknown[] }).removed).toHaveLength(2);
        add("p", 0, 4n);
        model.removeInstructionBreakpoints();
        expect(model.getInstructionBreakpoints()).toEqual([]);
    });

    it("an exception breakpoint matches a filter on every field and serializes them", () => {
        const ebp = new ExceptionBreakpoint({
            filter: "cpp_throw",
            label: "C++: on throw",
            supportsCondition: true,
            description: "d",
            conditionDescription: "cd",
            fallback: true,
            condition: "x",
        });
        const filter = {
            filter: "cpp_throw",
            label: "C++: on throw",
            supportsCondition: true,
            description: "d",
            conditionDescription: "cd",
        };
        expect(ebp.matches(filter)).toBe(true);
        for (const [key, value] of Object.entries({
            filter: "x",
            label: "x",
            supportsCondition: false,
            description: "x",
            conditionDescription: "x",
        })) {
            expect(ebp.matches({ ...filter, [key]: value }), key).toBe(false);
        }
        expect([ebp.toString(), ebp.supported, ebp.isSupportedSession(undefined)]).toEqual([
            "C++: on throw",
            true,
            true,
        ]);
        expect(ebp.toJSON()).toMatchObject({
            filter: "cpp_throw",
            fallback: true,
            condition: "x",
            supportsCondition: true,
        });
        ebp.setFallback(false);
        expect(ebp.isSupportedSession()).toBe(false);
        expect(
            new ExceptionBreakpoint({
                filter: "f",
                label: "l",
                supportsCondition: false,
                description: undefined,
                conditionDescription: undefined,
            }).isSupportedSession(),
        ).toBe(false);
    });

    it("an exception breakpoint's condition changes through the model", () => {
        model.setExceptionBreakpointsForSession("s", [{ filter: "f", label: "F" }]);
        model.setExceptionBreakpointsForSession("s", [{ filter: "f", label: "F" }]);
        expect(model.getExceptionBreakpoints()).toHaveLength(1);
        const events = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(events));
        const [ebp] = model.getExceptionBreakpoints();
        model.setExceptionBreakpointCondition(ebp, "e.code == 2");
        expect(ebp.condition).toBe("e.code == 2");
        expect(events).toHaveBeenCalledExactlyOnceWith(undefined);
    });
});

describe("DebugModel: breakpoint list", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();
    let model: DebugModel;

    beforeEach(() => {
        model = createMockDebugModel(disposables);
    });

    it("sorts by file name, then line, then column, and drops duplicates", () => {
        const b = Uri.file("/z/b.cpp");
        const a = Uri.file("/y/a.cpp");
        model.addBreakpoints(b, [{ lineNumber: 5 }, { lineNumber: 2, column: 9 }, { lineNumber: 2, column: 3 }]);
        model.addBreakpoints(a, [{ lineNumber: 7 }, { lineNumber: 7 }]);
        expect(model.getBreakpoints().map((bp) => `${(bp as Breakpoint).toString()}:${String(bp.column)}`)).toEqual([
            "a.cpp 7:undefined",
            "b.cpp 2:3",
            "b.cpp 2:9",
            "b.cpp 5:undefined",
        ]);
    });

    it("filters by original uri, by trigger, and enabledOnly sees nothing while breakpoints are deactivated", () => {
        model.addBreakpoints(FILE, [{ lineNumber: 1 }, { lineNumber: 2, triggeredBy: "x" }]);
        model.addBreakpoints(Uri.file("/other.cpp"), [{ lineNumber: 1 }]);
        expect(model.getBreakpoints({ originalUri: FILE })).toHaveLength(2);
        expect(model.getBreakpoints({ triggeredOnly: true }).map((bp) => bp.lineNumber)).toEqual([2]);
        expect(model.getBreakpoints({ enabledOnly: true })).toHaveLength(3);
        expect(model.getBreakpoints({ lineNumber: 1, column: 0 })).toHaveLength(2);
        model.setBreakpointsActivated(false);
        expect(model.getBreakpoints({ enabledOnly: true })).toHaveLength(0);
    });

    it("adding or enabling a breakpoint activates breakpoints again; disabling all does not", () => {
        model.setBreakpointsActivated(false);
        const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1 }], false);
        expect(model.areBreakpointsActivated()).toBe(true);
        model.setBreakpointsActivated(false);
        model.setEnablement(bp, true);
        expect(model.areBreakpointsActivated()).toBe(true);
        model.setBreakpointsActivated(false);
        model.setEnablement(bp, false);
        model.enableOrDisableAllBreakpoints(false);
        expect(model.areBreakpointsActivated()).toBe(false);
        model.enableOrDisableAllBreakpoints(true);
        expect(model.areBreakpointsActivated()).toBe(true);
    });

    it("addBreakpoints fires unless asked not to; data comes through, an id is kept", () => {
        const events = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(events));
        const [quiet] = model.addBreakpoints(
            FILE,
            [{ lineNumber: 1, id: "given", logMessage: "m", mode: "hw", modeLabel: "H", enabled: false }],
            false,
        );
        expect(events).not.toHaveBeenCalled();
        expect([quiet.getId(), quiet.logMessage, quiet.mode, quiet.modeLabel, quiet.enabled]).toEqual([
            "given",
            "m",
            "hw",
            "H",
            false,
        ]);
        model.addBreakpoints(FILE, [{ lineNumber: 2 }]);
        expect(events).toHaveBeenCalledOnce();
    });

    it("enablement changes report every kind but exception breakpoints, and only real changes", () => {
        const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        const fbp = model.addFunctionBreakpoint({ name: "f", enabled: false });
        model.addDataBreakpoint({
            description: "d",
            src: { type: DataBreakpointSetType.Variable, dataId: "d" },
            canPersist: false,
            accessTypes: undefined,
            accessType: "write",
        });
        model.addInstructionBreakpoint({ instructionReference: "i", offset: 0, address: 0n, canPersist: false });
        model.setExceptionBreakpointsForSession("s", [{ filter: "f", label: "F" }]);
        const [ebp] = model.getExceptionBreakpoints();
        const events = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(events));

        model.setEnablement(ebp, true);
        expect(ebp.enabled).toBe(true);
        expect(events).toHaveBeenLastCalledWith({ changed: [], sessionOnly: false });
        model.setEnablement(bp, true);
        expect(events).toHaveBeenLastCalledWith({ changed: [], sessionOnly: false });
        model.setEnablement(fbp, true);
        expect(events).toHaveBeenLastCalledWith({ changed: [fbp], sessionOnly: false });
        model.setEnablement(new Expression("not a breakpoint") as never, false);
        expect(events).toHaveBeenCalledTimes(3);

        model.enableOrDisableAllBreakpoints(false);
        const changed = (events.mock.lastCall?.[0] as { changed: unknown[] }).changed;
        expect(changed).toHaveLength(4);
        expect(changed).not.toContain(ebp);
        expect(model.getInstructionBreakpoints()[0].enabled).toBe(false);
        expect(model.getDataBreakpoints()[0].enabled).toBe(false);
        model.enableOrDisableAllBreakpoints(false);
        expect(events).toHaveBeenLastCalledWith({ changed: [], sessionOnly: false });
    });

    it("session data reaches every kind, removing a session's data clears it from all", () => {
        const [bp] = model.addBreakpoints(FILE, [{ lineNumber: 1 }]);
        const fbp = model.addFunctionBreakpoint({ name: "f" });
        model.addDataBreakpoint({
            description: "d",
            src: { type: DataBreakpointSetType.Variable, dataId: "d" },
            canPersist: false,
            accessTypes: undefined,
            accessType: "write",
        });
        model.addInstructionBreakpoint({ instructionReference: "i", offset: 0, address: 0n, canPersist: false });
        model.setExceptionBreakpointsForSession("s", [{ filter: "f", label: "F" }]);
        const all = [
            bp,
            fbp,
            model.getDataBreakpoints()[0],
            model.getInstructionBreakpoints()[0],
            model.getExceptionBreakpoints()[0],
        ];
        const events = vi.fn();
        disposables.add(model.onDidChangeBreakpoints(events));

        model.setBreakpointSessionData(
            "s",
            {},
            new Map(all.map((b, i) => [b.getId(), { verified: false, message: `m${String(i)}` }])),
        );
        expect(all.map((b) => b.message)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
        expect(events).toHaveBeenCalledExactlyOnceWith({ sessionOnly: true });
        model.setBreakpointSessionData("s", {}, new Map());
        expect(all.map((b) => b.message)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
        model.setBreakpointSessionData("s", {}, undefined);
        expect(all.map((b) => b.verified)).toEqual([true, true, true, true, true]);
    });

    it("breakpoint modes merge by mode and label, a label shared across debug types names its type", () => {
        model.registerBreakpointModes("lldb", [
            { mode: "hw", label: "Hardware", appliesTo: ["source"] },
            { mode: "sw", label: "Software", description: "d", appliesTo: ["source", "instruction"] },
        ]);
        model.registerBreakpointModes("lldb", [{ mode: "hw", label: "Hardware", appliesTo: ["source", "data"] }]);
        expect(model.getBreakpointModes("data")).toEqual([
            {
                mode: "hw",
                label: "Hardware",
                firstFromDebugType: "lldb",
                description: undefined,
                appliesTo: ["source", "data"],
            },
        ]);
        expect(model.getBreakpointModes("instruction").map((m) => m.description)).toEqual(["d"]);

        model.registerBreakpointModes("gdb", [{ mode: "hard", label: "Hardware", appliesTo: ["exception"] }]);
        expect(model.getBreakpointModes("source").map((m) => m.label)).toEqual(["Hardware (lldb)", "Software"]);
        expect(model.getBreakpointModes("exception").map((m) => m.label)).toEqual(["Hardware (gdb)"]);
    });

    it("a registered mode keeps its own list of targets", () => {
        const appliesTo = ["source"];
        model.registerBreakpointModes("lldb", [{ mode: "hw", label: "Hardware", appliesTo }]);
        appliesTo.push("data");
        expect(model.getBreakpointModes("data")).toEqual([]);
    });
});

describe("DebugModel: watch expressions", () => {
    const disposables = ensureNoDisposablesAreLeakedInTestSuite();

    it("fires on add, rename, move and remove; a value change fires its own event", async () => {
        const model = createMockDebugModel(disposables);
        const changed = vi.fn();
        const values = vi.fn();
        disposables.add(model.onDidChangeWatchExpressions(changed));
        disposables.add(model.onDidChangeWatchExpressionValue(values));

        const a = model.addWatchExpression("a");
        expect(changed).toHaveBeenLastCalledWith(a);
        const blank = model.addWatchExpression();
        expect(blank.name).toBe("");
        model.renameWatchExpression(a.getId(), "b");
        expect(changed).toHaveBeenLastCalledWith(a);
        model.renameWatchExpression("nope", "c");
        expect(changed).toHaveBeenCalledTimes(3);
        model.moveWatchExpression(blank.getId(), 0);
        expect(model.getWatchExpressions()).toEqual([blank, a]);
        expect(changed).toHaveBeenLastCalledWith(undefined);
        model.moveWatchExpression("nope", 0);
        expect(changed).toHaveBeenCalledTimes(4);

        const session = mockSession({
            evaluate: () =>
                Promise.resolve({ body: { result: "1", variablesReference: 0 } } as DebugProtocol.EvaluateResponse),
        });
        await (a as Expression).evaluate(session, { frameId: 1 } as IStackFrame, "watch");
        expect(values).toHaveBeenCalledExactlyOnceWith(a);

        model.removeWatchExpressions(blank.getId());
        expect(model.getWatchExpressions()).toEqual([a]);
        expect(changed).toHaveBeenLastCalledWith(undefined);
        model.removeWatchExpressions();
        await (a as Expression).evaluate(session, { frameId: 1 } as IStackFrame, "watch");
        expect(values).toHaveBeenCalledOnce();
    });
});
