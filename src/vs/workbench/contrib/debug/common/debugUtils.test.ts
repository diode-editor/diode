/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/debugUtils.test.ts

import assert from "assert";
import { describe, expect, it } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { mockSession } from "../../../../../TestUtils/mockDebug.ts";
import { currentOperatingSystem, OperatingSystem } from "../../../../base/common/platform.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";

import { type IConfig, type IDebugSession, State } from "./debug.ts";
import {
    formatPII,
    getEffectiveConfigForPlatform,
    getEffectivePresentationForConfig,
    getExactExpressionStartAndEnd,
    getExtensionHostDebugSession,
    getVisibleAndSorted,
    isDebuggerMainContribution,
    isSessionAttach,
    isUriString,
    resolveChildSession,
    sourcesEqual,
} from "./debugUtils.ts";

function platformSection(
    os: OperatingSystem,
    value: NonNullable<IConfig["windows"]>,
): Pick<IConfig, "windows" | "osx" | "linux"> {
    switch (os) {
        case OperatingSystem.Windows:
            return { windows: value };
        case OperatingSystem.Macintosh:
            return { osx: value };
        case OperatingSystem.Linux:
            return { linux: value };
    }
}

suite("Debug - Utils", () => {
    ensureNoDisposablesAreLeakedInTestSuite();

    test("formatPII", () => {
        assert.strictEqual(formatPII("Foo Bar", false, {}), "Foo Bar");
        assert.strictEqual(formatPII("Foo {key} Bar", false, {}), "Foo {key} Bar");
        assert.strictEqual(formatPII("Foo {key} Bar", false, { key: "yes" }), "Foo yes Bar");
        assert.strictEqual(formatPII("Foo {_0} Bar {_0}", true, { _0: "yes" }), "Foo yes Bar yes");
        assert.strictEqual(formatPII("Foo {0} Bar {1}{2}", false, { "0": "yes" }), "Foo yes Bar {1}{2}");
        assert.strictEqual(
            formatPII("Foo {0} Bar {1}{2}", false, { "0": "yes", "1": "undefined" }),
            "Foo yes Bar undefined{2}",
        );
        assert.strictEqual(
            formatPII("Foo {_key0} Bar {key1}{key2}", true, { _key0: "yes", key1: "5", key2: "false" }),
            "Foo yes Bar {key1}{key2}",
        );
        assert.strictEqual(
            formatPII("Foo {_key0} Bar {key1}{key2}", false, { _key0: "yes", key1: "5", key2: "false" }),
            "Foo yes Bar 5false",
        );
        assert.strictEqual(
            formatPII('Unable to display threads:"{e}"', false, { e: "detached from process" }),
            'Unable to display threads:"detached from process"',
        );
    });

    test("getExactExpressionStartAndEnd", () => {
        assert.deepStrictEqual(getExactExpressionStartAndEnd("foo", 1, 2), { start: 1, end: 3 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("!foo", 2, 3), { start: 2, end: 4 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("foo", 1, 3), { start: 1, end: 3 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("foo", 1, 4), { start: 1, end: 3 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd('this.name = "John"', 1, 10), { start: 1, end: 9 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd('this.name = "John"', 6, 10), { start: 1, end: 9 });
        // Hovers over "address" should pick up this->address
        assert.deepStrictEqual(getExactExpressionStartAndEnd('this->address = "Main street"', 6, 10), {
            start: 1,
            end: 13,
        });
        // Hovers over "name" should pick up a.b.c.d.name
        assert.deepStrictEqual(getExactExpressionStartAndEnd("var t = a.b.c.d.name", 16, 20), { start: 9, end: 20 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("MyClass::StaticProp", 10, 20), { start: 1, end: 19 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("largeNumber = myVar?.prop", 21, 25), {
            start: 15,
            end: 25,
        });

        // For example in expression 'a.b.c.d', hover was under 'b', 'a.b' should be the exact range
        assert.deepStrictEqual(getExactExpressionStartAndEnd("var t = a.b.c.d.name", 11, 12), { start: 9, end: 11 });

        assert.deepStrictEqual(getExactExpressionStartAndEnd("var t = a.b;c.d.name", 16, 20), { start: 13, end: 20 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("var t = a.b.c-d.name", 16, 20), { start: 15, end: 20 });

        // "var a\u00f8\u00f1\u00e9\u00e5\u6587 = a.b.c-d.name"
        assert.deepStrictEqual(
            getExactExpressionStartAndEnd("var a\u00f8\u00f1\u00e9\u00e5\u6587 = a.b.c-d.name", 5, 5),
            {
                start: 5,
                end: 10,
            },
        );
        const word = "a\u00f8\u00f1\u00e9\u00e5\u6587";
        assert.deepStrictEqual(getExactExpressionStartAndEnd(`${word}.${word}.${word}`, 9, 9), { start: 1, end: 13 });

        // Spread syntax should extract just the identifier
        assert.deepStrictEqual(getExactExpressionStartAndEnd("[...bar]", 5, 7), { start: 5, end: 7 });
        assert.deepStrictEqual(getExactExpressionStartAndEnd("...variable", 5, 5), { start: 4, end: 11 });
    });

    test("getEffectivePresentationForConfig - platform override", () => {
        // No platform override: returns base presentation
        const config1: IConfig = { type: "node", request: "launch", name: "a", presentation: { hidden: false } };
        assert.deepStrictEqual(getEffectivePresentationForConfig(config1, OperatingSystem.Macintosh), {
            hidden: false,
        });

        // Platform-specific presentation overrides base hidden value
        const config2: IConfig = {
            type: "node",
            request: "launch",
            name: "b",
            presentation: { hidden: false },
            ...platformSection(OperatingSystem.Windows, { presentation: { hidden: true } }),
        };
        assert.deepStrictEqual(getEffectivePresentationForConfig(config2, OperatingSystem.Windows), { hidden: true });

        // Non-matching platform override does not affect result
        const config3: IConfig = {
            type: "node",
            request: "launch",
            name: "c",
            presentation: { hidden: false },
            ...platformSection(OperatingSystem.Windows, { presentation: { hidden: true } }),
        };
        assert.deepStrictEqual(getEffectivePresentationForConfig(config3, OperatingSystem.Linux), { hidden: false });

        // No base presentation, platform-specific sets hidden
        const config4: IConfig = {
            type: "node",
            request: "launch",
            name: "d",
            ...platformSection(OperatingSystem.Macintosh, { presentation: { hidden: true } }),
        };
        assert.deepStrictEqual(getEffectivePresentationForConfig(config4, OperatingSystem.Macintosh), { hidden: true });

        // Platform-specific merges with base (group and order preserved)
        const config5: IConfig = {
            type: "node",
            request: "launch",
            name: "e",
            presentation: { group: "myGroup", order: 2 },
            ...platformSection(OperatingSystem.Linux, { presentation: { hidden: true } }),
        };
        assert.deepStrictEqual(getEffectivePresentationForConfig(config5, OperatingSystem.Linux), {
            group: "myGroup",
            order: 2,
            hidden: true,
        });

        // Platform-specific config overrides other launch attributes while preserving nested sections
        const config6: IConfig = {
            type: "node",
            request: "launch",
            name: "f",
            preLaunchTask: "base-task",
            presentation: { group: "base" },
            ...platformSection(OperatingSystem.Windows, {
                preLaunchTask: "windows-task",
                presentation: { hidden: true },
            }),
        };
        assert.deepStrictEqual(getEffectiveConfigForPlatform(config6, OperatingSystem.Windows), {
            ...config6,
            preLaunchTask: "windows-task",
            presentation: { group: "base", hidden: true },
        });
    });

    test("config presentation", () => {
        const configs: IConfig[] = [];
        configs.push({ type: "node", request: "launch", name: "p" });
        configs.push({ type: "node", request: "launch", name: "a" });
        configs.push({ type: "node", request: "launch", name: "b", presentation: { hidden: false } });
        configs.push({ type: "node", request: "launch", name: "c", presentation: { hidden: true } });
        configs.push({ type: "node", request: "launch", name: "d", presentation: { group: "2_group", order: 5 } });
        configs.push({ type: "node", request: "launch", name: "e", presentation: { group: "2_group", order: 52 } });
        configs.push({ type: "node", request: "launch", name: "f", presentation: { group: "1_group", order: 500 } });
        configs.push({ type: "node", request: "launch", name: "g", presentation: { group: "5_group", order: 500 } });
        configs.push({ type: "node", request: "launch", name: "h", presentation: { order: 700 } });
        configs.push({ type: "node", request: "launch", name: "i", presentation: { order: 1000 } });

        const sorted = getVisibleAndSorted(configs);
        assert.strictEqual(sorted.length, 9);
        assert.strictEqual(sorted[0].name, "f");
        assert.strictEqual(sorted[1].name, "d");
        assert.strictEqual(sorted[2].name, "e");
        assert.strictEqual(sorted[3].name, "g");
        assert.strictEqual(sorted[4].name, "h");
        assert.strictEqual(sorted[5].name, "i");
        assert.strictEqual(sorted[6].name, "b");
        assert.strictEqual(sorted[7].name, "p");
        assert.strictEqual(sorted[8].name, "a");
    });
});

function session(
    request: string,
    type: string,
    parentSession?: IDebugSession,
    state: IDebugSession["state"] = State.Running,
): IDebugSession {
    return mockSession({ configuration: { type, request, name: type }, parentSession, state });
}

describe("debugUtils: what upstream's suite leaves out", () => {
    it("formatPII keeps a placeholder without args", () => {
        expect(formatPII("Foo {0}", false, undefined)).toBe("Foo {0}");
        expect(formatPII("Foo {}", false, {})).toBe("Foo {}");
    });

    it("an attach session is one whose whole parent chain attaches, outside the extension host", () => {
        const attach = session("attach", "cppdbg");
        expect(isSessionAttach(attach)).toBe(true);
        expect(isSessionAttach(session("launch", "cppdbg"))).toBe(false);
        expect(isSessionAttach(session("attach", "cppdbg", attach))).toBe(true);
        expect(isSessionAttach(session("attach", "cppdbg", session("launch", "cppdbg")))).toBe(false);
        expect(isSessionAttach(session("attach", "extensionHost"))).toBe(false);
    });

    it("the extension host session is found by type, through Live Share and up the parents", () => {
        const host = session("launch", "pwa-extensionHost");
        expect(getExtensionHostDebugSession(host)).toBe(host);
        expect(getExtensionHostDebugSession(session("launch", "ExtensionHost"))).toBeDefined();
        const child = session("launch", "node", host);
        expect(getExtensionHostDebugSession(child)).toBe(host);
        expect(getExtensionHostDebugSession(session("launch", "node"))).toBeUndefined();
        expect(getExtensionHostDebugSession(session("launch", ""))).toBeUndefined();

        const shared = mockSession({
            configuration: {
                type: "vslsShare",
                request: "launch",
                name: "x",
                adapterProxy: { configuration: { type: "extensionHost" } },
            } as IConfig,
        });
        expect(getExtensionHostDebugSession(shared)).toBe(shared);
        const plainShare = mockSession({ configuration: { type: "vslsShare", request: "launch", name: "x" } });
        expect(getExtensionHostDebugSession(plainShare)).toBeUndefined();
    });

    it("a main debugger contribution has a type and a label, program or runtime", () => {
        expect(isDebuggerMainContribution({ type: "lldb", label: "LLDB" })).toBe(true);
        expect(isDebuggerMainContribution({ type: "lldb", program: "./adapter" })).toBe(true);
        expect(isDebuggerMainContribution({ type: "lldb", runtime: "node" })).toBe(true);
        expect(isDebuggerMainContribution({ type: "lldb" })).toBe(false);
        expect(isDebuggerMainContribution({ type: "", label: "LLDB" })).toBe(false);
    });

    it("isUriString wants a scheme of two characters at least, so a drive letter is a path", () => {
        expect(isUriString("file:///a")).toBe(true);
        expect(isUriString("vscode-remote+x.y:/a")).toBe(true);
        expect(isUriString("c:\\a")).toBe(false);
        expect(isUriString("/a/b")).toBe(false);
        expect(isUriString(undefined)).toBe(false);
        expect(isUriString(" ab:x")).toBe(false);
    });

    it("an expression with no match under the cursor is empty", () => {
        expect(getExactExpressionStartAndEnd("a + b", 3, 3)).toEqual({ start: 0, end: 0 });
    });

    it("sourcesEqual compares name, path and reference, or identity when one is missing", () => {
        expect(sourcesEqual(undefined, undefined)).toBe(true);
        expect(sourcesEqual({ name: "a" }, undefined)).toBe(false);
        expect(
            sourcesEqual({ name: "a", path: "/a", sourceReference: 1 }, { name: "a", path: "/a", sourceReference: 1 }),
        ).toBe(true);
        expect(sourcesEqual({ name: "a" }, { name: "b" })).toBe(false);
        expect(sourcesEqual({ path: "/a" }, { path: "/b" })).toBe(false);
        expect(sourcesEqual({ sourceReference: 1 }, { sourceReference: 2 })).toBe(false);
    });

    it("resolveChildSession prefers a stopped child, then the first child, then the session itself", () => {
        const parent = session("launch", "pwa-node");
        const running = session("launch", "pwa-node", parent);
        const stopped = session("launch", "pwa-node", parent, State.Stopped);
        expect(resolveChildSession(parent, [parent, running, stopped])).toBe(stopped);
        expect(resolveChildSession(parent, [parent, running])).toBe(running);
        expect(resolveChildSession(parent, [parent])).toBe(parent);
    });

    it("the effective config defaults to the current platform and keeps a config without a section as is", () => {
        const config: IConfig = { type: "node", request: "launch", name: "a", presentation: { group: "g" } };
        expect(getEffectiveConfigForPlatform(config)).toBe(config);
        const current = currentOperatingSystem();
        const withSection: IConfig = { ...config, ...platformSection(current, { presentation: { hidden: true } }) };
        expect(getEffectivePresentationForConfig(withSection)).toEqual({ group: "g", hidden: true });
        const noPresentation: IConfig = { ...config, ...platformSection(current, { noDebug: true }) };
        expect(getEffectiveConfigForPlatform(noPresentation).presentation).toBe(config.presentation);
        expect(getEffectiveConfigForPlatform(noPresentation).noDebug).toBe(true);
    });

    it("getVisibleAndSorted puts configurations without a presentation last, in their order", () => {
        const configs: IConfig[] = [
            { type: "node", request: "launch", name: "x" },
            { type: "node", request: "launch", name: "y", presentation: { group: "g" } },
            { type: "node", request: "launch", name: "z", presentation: { group: "g", order: 1 } },
            { type: "node", request: "launch", name: "w", presentation: { group: "g" } },
            { type: "node", request: "launch", name: "v" },
        ];
        expect(getVisibleAndSorted(configs).map((c) => c.name)).toEqual(["z", "y", "w", "x", "v"]);
    });
});
