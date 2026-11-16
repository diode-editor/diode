import { describe, expect, it } from "vitest";

import {
    parseWireDebugConfiguration,
    parseWireDebugConfigurationProvider,
    parseWireDebugConfigurations,
    parseWireDebugProviderHandle,
    parseWireDebugResolveResult,
    parseWireDebugStartDebugging,
    parseWireDebugStopDebugging,
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
});
