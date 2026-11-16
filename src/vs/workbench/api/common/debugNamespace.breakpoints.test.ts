import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { FunctionBreakpoint, SourceBreakpoint } from "./debugTypes.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

const FILE = "file:///ws/main.c";

function setup() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    const changes: vscode.BreakpointsChangeEvent[] = [];
    namespace.debug.onDidChangeBreakpoints((e) => changes.push(e));
    return { stub, vscode: namespace, changes };
}

function requests(stub: ReturnType<typeof makeStubRpc>, method: string): unknown[] {
    return stub.requests.filter((r) => r.method === method).map((r) => r.params);
}

/** `vscode.d.ts` says `void`; upstream returns the promise of the core's answer, and so does Diode. */
function awaitable(
    call: (breakpoints: readonly vscode.Breakpoint[]) => void,
): (breakpoints: readonly vscode.Breakpoint[]) => Promise<void> {
    return call as (breakpoints: readonly vscode.Breakpoint[]) => Promise<void>;
}

/** The core sends all three lists. */
const delta = (d: object): object => ({ added: [], removed: [], changed: [], ...d });

const SOURCE = {
    type: "source",
    id: "b1",
    enabled: true,
    condition: "i > 2",
    uri: FILE,
    line: 4,
    character: 0,
} as const;
const FUNCTION = { type: "function", id: "f1", enabled: false, hitCondition: "3", functionName: "main" } as const;

describe("vscode.debug — the core's breakpoints", () => {
    it("[api:debug.breakpoints] [api:debug.onDidChangeBreakpoints] added ones keep the core's ids", () => {
        const { stub, vscode, changes } = setup();

        stub.fire("debug.acceptBreakpointsDelta", delta({ added: [SOURCE, FUNCTION] }));

        const [source, fn] = vscode.debug.breakpoints as [vscode.SourceBreakpoint, vscode.FunctionBreakpoint];
        expect(source).toBeInstanceOf(vscode.SourceBreakpoint);
        expect(source).toMatchObject({ id: "b1", enabled: true, condition: "i > 2" });
        expect(source.location.uri.toString()).toBe(FILE);
        expect(source.location.range.start).toMatchObject({ line: 4, character: 0 });
        expect(fn).toBeInstanceOf(vscode.FunctionBreakpoint);
        expect(fn).toMatchObject({ id: "f1", enabled: false, hitCondition: "3", functionName: "main" });
        expect(changes).toEqual([{ added: [source, fn], removed: [], changed: [] }]);
        expect(Object.isFrozen(changes[0])).toBe(true);
    });

    it("a known breakpoint is not added twice; a delta of unknown ids fires nothing", () => {
        const { stub, vscode, changes } = setup();
        stub.fire("debug.acceptBreakpointsDelta", delta({ added: [SOURCE] }));
        stub.fire("debug.acceptBreakpointsDelta", delta({ added: [SOURCE], removed: ["nope"], changed: [FUNCTION] }));

        expect(vscode.debug.breakpoints).toHaveLength(1);
        expect(changes).toHaveLength(1);
    });

    it("a changed breakpoint is the same object, updated in place", () => {
        const { stub, vscode, changes } = setup();
        stub.fire("debug.acceptBreakpointsDelta", delta({ added: [SOURCE, FUNCTION] }));
        const [source, fn] = vscode.debug.breakpoints as [vscode.SourceBreakpoint, vscode.FunctionBreakpoint];

        stub.fire(
            "debug.acceptBreakpointsDelta",
            delta({
                changed: [
                    { type: "source", id: "b1", enabled: false, logMessage: "hit", uri: FILE, line: 9, character: 2 },
                    { type: "function", id: "f1", enabled: true, functionName: "start" },
                ],
            }),
        );

        expect(source).toMatchObject({ enabled: false, condition: undefined, logMessage: "hit" });
        expect(source.location.range.start).toMatchObject({ line: 9, character: 2 });
        expect(fn).toMatchObject({ enabled: true, hitCondition: undefined, functionName: "start" });
        expect(changes[1]).toEqual({ added: [], removed: [], changed: [source, fn] });
    });

    it("a removed breakpoint leaves the list", () => {
        const { stub, vscode, changes } = setup();
        stub.fire("debug.acceptBreakpointsDelta", delta({ added: [SOURCE, FUNCTION] }));
        const [source, fn] = vscode.debug.breakpoints;

        stub.fire("debug.acceptBreakpointsDelta", delta({ removed: ["b1"] }));

        expect(vscode.debug.breakpoints).toEqual([fn]);
        expect(changes[1]).toEqual({ added: [], removed: [source], changed: [] });
    });
});

describe("vscode.debug — breakpoints of the extension", () => {
    it("[api:debug.addBreakpoints] fires at once and sends the new ones to the core, source ones by file", async () => {
        const { stub, vscode, changes } = setup();
        const at = (line: number, character: number): vscode.Location =>
            new vscode.Location(vscode.Uri.parse(FILE), new vscode.Position(line, character));
        // `mode` is not in the pinned `vscode.d.ts` (proposed in upstream); the classes take it, upstream sends it.
        const a = new SourceBreakpoint(at(1, 0), true, "x", undefined, undefined, "hw");
        const b = new vscode.SourceBreakpoint(at(5, 3), false, undefined, "2", "log {x}");
        const other = new vscode.SourceBreakpoint(
            new vscode.Location(vscode.Uri.parse("file:///ws/b.c"), new vscode.Position(0, 0)),
        );
        const fn = new FunctionBreakpoint("main", true, undefined, undefined, undefined, "m");

        const done = awaitable(vscode.debug.addBreakpoints)([a, fn, b, other, a]);
        expect(changes).toEqual([{ added: [a, fn, b, other], removed: [], changed: [] }]);
        await done;
        vscode.debug.addBreakpoints([a]);

        expect(vscode.debug.breakpoints).toEqual([a, fn, b, other]);
        expect(requests(stub, "debug.registerBreakpoints")).toEqual([
            {
                breakpoints: [
                    {
                        type: "sourceMulti",
                        uri: FILE,
                        lines: [
                            { id: a.id, enabled: true, condition: "x", mode: "hw", line: 1, character: 0 },
                            {
                                id: b.id,
                                enabled: false,
                                hitCondition: "2",
                                logMessage: "log {x}",
                                line: 5,
                                character: 3,
                            },
                        ],
                    },
                    { type: "function", id: fn.id, enabled: true, mode: "m", functionName: "main" },
                    {
                        type: "sourceMulti",
                        uri: "file:///ws/b.c",
                        lines: [{ id: other.id, enabled: true, line: 0, character: 0 }],
                    },
                ],
            },
            { breakpoints: [] },
        ]);
        expect(changes).toHaveLength(1);
    });

    it("a breakpoint of another kind joins the list and fires, but the core gets nothing of it (upstream)", async () => {
        const { stub, vscode, changes } = setup();
        const foreign = { id: "foreign", enabled: true } as vscode.Breakpoint;

        await awaitable(vscode.debug.addBreakpoints)([foreign]);

        expect(vscode.debug.breakpoints).toEqual([foreign]);
        expect(changes).toEqual([{ added: [foreign], removed: [], changed: [] }]);
        expect(requests(stub, "debug.registerBreakpoints")).toEqual([{ breakpoints: [] }]);
    });

    it("[api:debug.removeBreakpoints] removes the known ones and tells the core their ids by kind", async () => {
        const { stub, vscode, changes } = setup();
        stub.fire("debug.acceptBreakpointsDelta", delta({ added: [SOURCE, FUNCTION] }));
        const [source, fn] = vscode.debug.breakpoints;
        const unknown = new vscode.FunctionBreakpoint("nope");

        await awaitable(vscode.debug.removeBreakpoints)([fn, unknown, source]);

        expect(vscode.debug.breakpoints).toEqual([]);
        expect(changes[1]).toEqual({ added: [], removed: [fn, source], changed: [] });
        expect(requests(stub, "debug.unregisterBreakpoints")).toEqual([
            { breakpointIds: ["b1"], functionBreakpointIds: ["f1"] },
        ]);
    });
});
