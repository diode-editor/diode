import { describe, expect, it } from "vitest";

import {
    parseWireDebugAdapterError,
    parseWireDebugAdapterExit,
    parseWireDebugAdapterMessage,
    parseWireDebugConfiguration,
    parseWireDebugConfigurationProvider,
    parseWireDebugConfigurations,
    parseWireDebugProviderHandle,
    parseWireDebugResolveResult,
    parseWireDebugStartDebugging,
    parseWireDebugStopDebugging,
    parseWireDebugTypes,
} from "./debugWireParsers.ts";

const CONFIG = { type: "lldb", request: "launch", name: "Launch" };

describe("debugWireParsers — debug messages from the subprocess", () => {
    it("a configuration is any object; not an object, an array or null is none", () => {
        expect(parseWireDebugConfiguration(CONFIG)).toBe(CONFIG);
        expect(parseWireDebugConfiguration({})).toEqual({});
        for (const raw of [null, undefined, "Launch", 1, [CONFIG]]) expect(parseWireDebugConfiguration(raw)).toBeNull();
    });

    it("configurations drop what is not an object; not an array is none", () => {
        expect(parseWireDebugConfigurations([CONFIG, "x", null, { name: "b" }])).toEqual([CONFIG, { name: "b" }]);
        expect(parseWireDebugConfigurations(CONFIG)).toEqual([]);
    });

    it("a resolve answer: a configuration, null, or undefined for no or a malformed one", () => {
        expect(parseWireDebugResolveResult({ config: CONFIG })).toBe(CONFIG);
        expect(parseWireDebugResolveResult({ config: null })).toBeNull();
        expect(parseWireDebugResolveResult({})).toBeUndefined();
        expect(parseWireDebugResolveResult({ config: "x" })).toBeUndefined();
        expect(parseWireDebugResolveResult(null)).toBeUndefined();
    });

    it("a provider registration needs a handle, a type, a known trigger kind and the extension; the flags are true only when true", () => {
        const raw = {
            handle: 3,
            type: "lldb",
            triggerKind: 2,
            hasProvide: true,
            hasResolve: "yes",
            extensionId: "a.b",
        };
        expect(parseWireDebugConfigurationProvider(raw)).toEqual({
            handle: 3,
            type: "lldb",
            triggerKind: 2,
            hasProvide: true,
            hasResolve: false,
            hasResolveWithSubstitutedVariables: false,
            extensionId: "a.b",
        });
        expect(parseWireDebugConfigurationProvider({ ...raw, triggerKind: 1 })?.triggerKind).toBe(1);
        for (const broken of [
            { ...raw, handle: "3" },
            { ...raw, type: 1 },
            { ...raw, triggerKind: 0 },
            { ...raw, triggerKind: 3 },
            { ...raw, extensionId: undefined },
            null,
            [raw],
        ]) {
            expect(parseWireDebugConfigurationProvider(broken)).toBeNull();
        }
    });

    it("a provider handle", () => {
        expect(parseWireDebugProviderHandle({ handle: 0 })).toEqual({ handle: 0 });
        expect(parseWireDebugProviderHandle({ handle: Number.NaN })).toBeNull();
        expect(parseWireDebugProviderHandle(undefined)).toBeNull();
    });

    it("a start: a name or a configuration, the folder when it is a string, the options of known types only", () => {
        expect(
            parseWireDebugStartDebugging({
                folder: "file:///ws",
                nameOrConfig: "Launch",
                options: {
                    parentSessionId: "p",
                    lifecycleManagedByParent: true,
                    consoleMode: 1,
                    noDebug: false,
                    compact: true,
                    suppressSaveBeforeStart: true,
                    suppressDebugStatusbar: true,
                    suppressDebugToolbar: false,
                    suppressDebugView: true,
                    testRun: { runId: "r", taskId: "t" },
                },
            }),
        ).toEqual({
            folder: "file:///ws",
            nameOrConfig: "Launch",
            options: {
                parentSessionId: "p",
                lifecycleManagedByParent: true,
                consoleMode: 1,
                noDebug: false,
                compact: true,
                suppressSaveBeforeStart: true,
                suppressDebugStatusbar: true,
                suppressDebugToolbar: false,
                suppressDebugView: true,
                testRun: { runId: "r", taskId: "t" },
            },
        });
        const typeless = parseWireDebugStartDebugging({
            folder: 5,
            nameOrConfig: CONFIG,
            options: {
                parentSessionId: 1,
                lifecycleManagedByParent: "yes",
                consoleMode: "1",
                noDebug: 1,
                compact: "x",
                suppressSaveBeforeStart: null,
                suppressDebugStatusbar: 0,
                suppressDebugToolbar: "",
                suppressDebugView: [],
                testRun: { runId: "r", taskId: 1 },
            },
        });
        expect(typeless).toEqual({ nameOrConfig: CONFIG, options: {} });
        expect(typeless && "folder" in typeless).toBe(false);
        expect(parseWireDebugStartDebugging({ nameOrConfig: "a" })).toEqual({ nameOrConfig: "a", options: {} });
        expect(parseWireDebugStartDebugging({ nameOrConfig: 1, options: {} })).toBeNull();
        expect(parseWireDebugStartDebugging("Launch")).toBeNull();
    });

    it("a stop: the session id when it is a string", () => {
        expect(parseWireDebugStopDebugging({ sessionId: "s" })).toEqual({ sessionId: "s" });
        expect(parseWireDebugStopDebugging({ sessionId: 1 })).toEqual({});
        expect(parseWireDebugStopDebugging(null)).toEqual({});
    });

    it("debug types: the strings of `types`; anything else is none", () => {
        expect(parseWireDebugTypes({ types: ["lldb", 1, null, "go"] })).toEqual(["lldb", "go"]);
        for (const raw of [null, {}, { types: "lldb" }]) expect(parseWireDebugTypes(raw)).toEqual([]);
    });

    it("an adapter message needs a numeric handle and an object with a string `type`", () => {
        const message = { seq: 1, type: "event", event: "stopped" };
        expect(parseWireDebugAdapterMessage({ handle: 2, message })).toEqual({ handle: 2, message });
        for (const raw of [
            null,
            { message },
            { handle: "2", message },
            { handle: 2 },
            { handle: 2, message: { seq: 1 } },
            { handle: 2, message: { type: 1 } },
            { handle: 2, message: [message] },
        ]) {
            expect(parseWireDebugAdapterMessage(raw)).toBeNull();
        }
    });

    it("an adapter error is a serialized error: `$isError`, a string name and message, a string stack or none", () => {
        const error = { $isError: true, name: "TypeError", message: "m", stack: "s", code: "ENOENT" };
        expect(parseWireDebugAdapterError({ handle: 1, error })).toEqual({ handle: 1, error });
        const noStack = { $isError: true, name: "Error", message: "m" };
        expect(parseWireDebugAdapterError({ handle: 1, error: noStack })).toEqual({ handle: 1, error: noStack });
        for (const raw of [
            null,
            { error },
            { handle: "1", error },
            { handle: 1 },
            { handle: 1, error: { ...error, $isError: 1 } },
            { handle: 1, error: { ...error, name: 1 } },
            { handle: 1, error: { ...error, message: null } },
            { handle: 1, error: { ...error, stack: 2 } },
        ]) {
            expect(parseWireDebugAdapterError(raw)).toBeNull();
        }
    });

    it("an adapter exit: a numeric code or none", () => {
        expect(parseWireDebugAdapterExit({ handle: 1, code: 0 })).toEqual({ handle: 1, code: 0 });
        expect(parseWireDebugAdapterExit({ handle: 1, code: "1" })).toEqual({ handle: 1 });
        expect(parseWireDebugAdapterExit({ code: 1 })).toBeNull();
        expect(parseWireDebugAdapterExit(null)).toBeNull();
    });
});
