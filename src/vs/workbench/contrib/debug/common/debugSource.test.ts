/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/test/browser/debugSource.test.ts

import assert from "assert";
import { describe, expect, it, vi } from "vitest";

import { suite, test } from "../../../../../TestUtils/mochaCompat.ts";
import { Uri as uri } from "../../../../base/common/uri.ts";
import { ensureNoDisposablesAreLeakedInTestSuite } from "../../../../base/test/common/utils.ts";
import { NULL_LOGGER } from "../../../../platform/log/common/nullLogService.ts";

import { getUriFromSource, Source } from "./debugSource.ts";

const isWindows = process.platform === "win32";

suite("Debug - Source", () => {
    ensureNoDisposablesAreLeakedInTestSuite();

    test("from raw source", () => {
        const source = new Source(
            {
                name: "zz",
                path: "/xx/yy/zz",
                sourceReference: 0,
                presentationHint: "emphasize",
            },
            "aDebugSessionId",
            NULL_LOGGER,
        );

        assert.strictEqual(source.presentationHint, "emphasize");
        assert.strictEqual(source.name, "zz");
        assert.strictEqual(source.inMemory, false);
        assert.strictEqual(source.reference, 0);
        assert.strictEqual(source.uri.toString(), uri.file("/xx/yy/zz").toString());
    });

    test("from raw internal source", () => {
        const source = new Source(
            {
                name: "internalModule.js",
                sourceReference: 11,
                presentationHint: "deemphasize",
            },
            "aDebugSessionId",
            NULL_LOGGER,
        );

        assert.strictEqual(source.presentationHint, "deemphasize");
        assert.strictEqual(source.name, "internalModule.js");
        assert.strictEqual(source.inMemory, true);
        assert.strictEqual(source.reference, 11);
        assert.strictEqual(source.uri.toString(), "debug:internalModule.js?session%3DaDebugSessionId%26ref%3D11");
    });

    test("get encoded debug data", () => {
        const checkData = (
            uri: uri,
            expectedName: string,
            expectedPath: string,
            expectedSourceReference: number | undefined,
            expectedSessionId?: string,
        ) => {
            const { name, path, sourceReference, sessionId } = Source.getEncodedDebugData(uri);
            assert.strictEqual(name, expectedName);
            assert.strictEqual(path, expectedPath);
            assert.strictEqual(sourceReference, expectedSourceReference);
            assert.strictEqual(sessionId, expectedSessionId);
        };

        checkData(uri.file("a/b/c/d"), "d", isWindows ? "\\a\\b\\c\\d" : "/a/b/c/d", undefined, undefined);
        checkData(
            uri.from({ scheme: "file", path: "/my/path/test.js", query: "ref=1&session=2" }),
            "test.js",
            isWindows ? "\\my\\path\\test.js" : "/my/path/test.js",
            undefined,
            undefined,
        );

        checkData(
            uri.from({ scheme: "http", authority: "www.example.com", path: "/my/path" }),
            "path",
            "http://www.example.com/my/path",
            undefined,
            undefined,
        );
        checkData(
            uri.from({ scheme: "debug", authority: "www.example.com", path: "/my/path", query: "ref=100" }),
            "path",
            "/my/path",
            100,
            undefined,
        );
        checkData(
            uri.from({ scheme: "debug", path: "a/b/c/d.js", query: "session=100" }),
            "d.js",
            "a/b/c/d.js",
            undefined,
            "100",
        );
        checkData(
            uri.from({ scheme: "debug", path: "a/b/c/d/foo.txt", query: "session=100&ref=10" }),
            "foo.txt",
            "a/b/c/d/foo.txt",
            10,
            "100",
        );
    });
});

describe("Source: what upstream's suite leaves out", () => {
    it("a missing source is an unavailable `Unknown Source` in the debug scheme", () => {
        const source = new Source(undefined, "s1", NULL_LOGGER);
        expect(source.available).toBe(false);
        expect(source.name).toBe("Unknown Source");
        expect(source.inMemory).toBe(true);
        expect(source.uri.toString(true)).toBe("debug:Unknown Source");
    });

    it("the name falls back to the uri's basename, the origin is the adapter's", () => {
        const source = new Source({ path: "/src/main.cpp", origin: "from lldb" }, "s1", NULL_LOGGER);
        expect(source.name).toBe("main.cpp");
        expect(source.origin).toBe("from lldb");
        expect(source.available).toBe(true);
    });

    it("a path that looks like a uri is parsed as one", () => {
        expect(new Source({ path: "http://host/a.js" }, "s1", NULL_LOGGER).uri.toString()).toBe("http://host/a.js");
    });

    it("a relative path asks the adapter for the content, a nameless source is the session's root", () => {
        expect(new Source({ path: "lib/a.js" }, "s1", NULL_LOGGER).uri.toString(true)).toBe(
            "debug:lib/a.js?session=s1",
        );
        expect(new Source({}, "s1", NULL_LOGGER).uri.toString(true)).toBe("debug:?session=s1");
    });

    it("a source reference collapses the leading slashes of the path (#174054)", () => {
        const source = new Source({ path: "///a/b.js", sourceReference: 3 }, "s1", NULL_LOGGER);
        expect(source.uri.toString(true)).toBe("debug:/a/b.js?session=s1&ref=3");
    });

    it("a debug uri without a query or with a malformed pair gives only the path", () => {
        expect(Source.getEncodedDebugData(uri.from({ scheme: "debug", path: "/a.js" }))).toEqual({
            name: "a.js",
            path: "/a.js",
            sourceReference: undefined,
            sessionId: undefined,
        });
        expect(
            Source.getEncodedDebugData(uri.from({ scheme: "debug", path: "/a.js", query: "ref&session=1=2&x=3" })),
        ).toEqual({
            name: "a.js",
            path: "/a.js",
            sourceReference: undefined,
            sessionId: undefined,
        });
    });

    it("a uri vscode-uri rejects falls back to /invalidDebugSource and is logged", () => {
        const logger = { ...NULL_LOGGER, error: vi.fn() };
        expect(getUriFromSource({ path: "ab:////x" }, "ab:////x", "s1", logger).toString(true)).toBe(
            "file:///invalidDebugSource",
        );
        expect(logger.error).toHaveBeenCalledWith("Invalid path from debug adapter: ab:////x");
    });
});
