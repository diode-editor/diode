import { describe, expect, it } from "vitest";

import {
    parseWireDebugConsoleAppend,
    parseWireDebugCustomRequest,
    parseWireDebugProtocolBreakpointRequest,
    parseWireDebugRegisterBreakpoints,
    parseWireDebugSetSessionName,
    parseWireDebugUnregisterBreakpoints,
} from "./debugWireParsers.ts";

describe("debugWireParsers — what extensions ask of the sessions", () => {
    it("a custom request: a session id and a command; the arguments are anything", () => {
        expect(parseWireDebugCustomRequest({ sessionId: "s", command: "c", args: [1] })).toEqual({
            sessionId: "s",
            command: "c",
            args: [1],
        });
        expect(parseWireDebugCustomRequest({ sessionId: "s", command: "c" })).toEqual({
            sessionId: "s",
            command: "c",
            args: undefined,
        });
        for (const raw of [null, { command: "c" }, { sessionId: "s", command: 1 }]) {
            expect(parseWireDebugCustomRequest(raw)).toBeNull();
        }
    });

    it("a protocol breakpoint request: a session id and a breakpoint id", () => {
        expect(parseWireDebugProtocolBreakpointRequest({ sessionId: "s", breakpointId: "b" })).toEqual({
            sessionId: "s",
            breakpointId: "b",
        });
        for (const raw of [null, { sessionId: "s" }, { breakpointId: "b" }, { sessionId: "s", breakpointId: 1 }]) {
            expect(parseWireDebugProtocolBreakpointRequest(raw)).toBeNull();
        }
    });

    it("a session name and console output must be strings", () => {
        expect(parseWireDebugSetSessionName({ sessionId: "s", name: "n" })).toEqual({ sessionId: "s", name: "n" });
        for (const raw of [null, { sessionId: "s" }, { name: "n" }, { sessionId: 1, name: "n" }]) {
            expect(parseWireDebugSetSessionName(raw)).toBeNull();
        }
        expect(parseWireDebugConsoleAppend({ value: "" })).toEqual({ value: "" });
        expect(parseWireDebugConsoleAppend({ value: 1 })).toBeNull();
        expect(parseWireDebugConsoleAppend(null)).toBeNull();
    });
});

describe("debugWireParsers — breakpoints of extensions", () => {
    const line = { id: "b", enabled: true, line: 1, character: 2 };

    it("source breakpoints by file and function breakpoints keep their fields; optional ones of another type go", () => {
        expect(
            parseWireDebugRegisterBreakpoints({
                breakpoints: [
                    {
                        type: "sourceMulti",
                        uri: "file:///a",
                        lines: [
                            { ...line, condition: "c", hitCondition: "h", logMessage: "l", mode: "m" },
                            { ...line, id: "b2", condition: 1, hitCondition: null, logMessage: [], mode: {} },
                        ],
                    },
                    { type: "function", id: "f", enabled: false, functionName: "main", condition: "c" },
                ],
            }),
        ).toEqual({
            breakpoints: [
                {
                    type: "sourceMulti",
                    uri: "file:///a",
                    lines: [
                        { ...line, condition: "c", hitCondition: "h", logMessage: "l", mode: "m" },
                        { ...line, id: "b2" },
                    ],
                },
                { type: "function", id: "f", enabled: false, functionName: "main", condition: "c" },
            ],
        });
    });

    it("malformed breakpoints and lines are dropped", () => {
        const fn = { type: "function", id: "f", enabled: true, functionName: "main" };
        expect(
            parseWireDebugRegisterBreakpoints({
                breakpoints: [
                    null,
                    { type: "data", id: "d", enabled: true },
                    { type: "sourceMulti", uri: 1, lines: [line] },
                    { type: "sourceMulti", uri: "file:///a", lines: line },
                    {
                        type: "sourceMulti",
                        uri: "file:///a",
                        lines: [null, { ...line, id: 1 }, { ...line, line: "1" }],
                    },
                    {
                        type: "sourceMulti",
                        uri: "file:///a",
                        lines: [
                            { ...line, character: null },
                            { ...line, enabled: 1 },
                        ],
                    },
                    { ...fn, functionName: 1 },
                    { ...fn, id: 1 },
                    { ...fn, enabled: "yes" },
                ],
            }),
        ).toEqual({
            breakpoints: [
                { type: "sourceMulti", uri: "file:///a", lines: [] },
                { type: "sourceMulti", uri: "file:///a", lines: [] },
            ],
        });
        expect(parseWireDebugRegisterBreakpoints({ breakpoints: fn })).toEqual({ breakpoints: [] });
        expect(parseWireDebugRegisterBreakpoints(null)).toEqual({ breakpoints: [] });
    });

    it("removed ids: strings only", () => {
        expect(
            parseWireDebugUnregisterBreakpoints({ breakpointIds: ["a", 1, "b"], functionBreakpointIds: ["f", null] }),
        ).toEqual({ breakpointIds: ["a", "b"], functionBreakpointIds: ["f"] });
        expect(parseWireDebugUnregisterBreakpoints({ breakpointIds: "a" })).toEqual({
            breakpointIds: [],
            functionBreakpointIds: [],
        });
        expect(parseWireDebugUnregisterBreakpoints(null)).toEqual({ breakpointIds: [], functionBreakpointIds: [] });
    });
});
