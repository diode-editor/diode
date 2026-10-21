import { describe, expect, it } from "vitest";

import {
    parseWireDiagnosticsPublish,
    parseWireOutputAppend,
    parseWireOutputShow,
    parseWireProgressEnd,
    parseWireProgressReport,
    parseWireProgressStart,
} from "./hostWireParsers.ts";

describe("hostWireParsers — window.progress.*", () => {
    it("start: handle and title as is", () => {
        expect(parseWireProgressStart({ handle: 3, title: "Indexing" })).toStrictEqual({
            handle: 3,
            title: "Indexing",
        });
        expect(parseWireProgressStart({ handle: 0, title: "" })).toStrictEqual({ handle: 0, title: "" });
    });

    it("start: foreign envelope → null", () => {
        expect(parseWireProgressStart(null)).toBeNull();
        expect(parseWireProgressStart("x")).toBeNull();
        expect(parseWireProgressStart({ title: "t" })).toBeNull();
        expect(parseWireProgressStart({ handle: Number.NaN, title: "t" })).toBeNull();
        expect(parseWireProgressStart({ handle: "1", title: "t" })).toBeNull();
        expect(parseWireProgressStart({ handle: 1 })).toBeNull();
        expect(parseWireProgressStart({ handle: 1, title: 5 })).toBeNull();
    });

    it("report: optional fields only when valid, absent ≠ undefined", () => {
        expect(parseWireProgressReport({ handle: 1 })).toStrictEqual({ handle: 1 });
        expect(parseWireProgressReport({ handle: 1, message: "step", increment: 10 })).toStrictEqual({
            handle: 1,
            message: "step",
            increment: 10,
        });
        expect(parseWireProgressReport({ handle: 1, message: 7, increment: Number.POSITIVE_INFINITY })).toStrictEqual({
            handle: 1,
        });
        expect(parseWireProgressReport({ handle: 1, increment: "5" })).toStrictEqual({ handle: 1 });
    });

    it("report: foreign envelope → null", () => {
        expect(parseWireProgressReport(null)).toBeNull();
        expect(parseWireProgressReport(42)).toBeNull();
        expect(parseWireProgressReport({ message: "m" })).toBeNull();
    });

    it("end: handle as is, extras are not carried over", () => {
        expect(parseWireProgressEnd({ handle: 2, extra: true })).toStrictEqual({ handle: 2 });
        expect(parseWireProgressEnd(null)).toBeNull();
        expect(parseWireProgressEnd("2")).toBeNull();
        expect(parseWireProgressEnd({ handle: Number.NaN })).toBeNull();
    });
});

describe("hostWireParsers — output.*", () => {
    const line = { channel: "extensions.a", label: "A", level: "info", value: "hello" };

    it("append: a valid line passes as is", () => {
        expect(parseWireOutputAppend(line)).toStrictEqual(line);
        expect(parseWireOutputAppend({ ...line, value: "" })).toStrictEqual({ ...line, value: "" });
        for (const level of ["trace", "debug", "info", "warn", "error"]) {
            expect(parseWireOutputAppend({ ...line, level })?.level).toBe(level);
        }
    });

    it("append: foreign envelope → null", () => {
        expect(parseWireOutputAppend(null)).toBeNull();
        expect(parseWireOutputAppend("x")).toBeNull();
        expect(parseWireOutputAppend({ ...line, channel: "" })).toBeNull();
        expect(parseWireOutputAppend({ ...line, channel: 1 })).toBeNull();
        expect(parseWireOutputAppend({ ...line, label: "" })).toBeNull();
        expect(parseWireOutputAppend({ ...line, label: null })).toBeNull();
        expect(parseWireOutputAppend({ ...line, level: "fatal" })).toBeNull();
        expect(parseWireOutputAppend({ ...line, level: 2 })).toBeNull();
        expect(parseWireOutputAppend({ ...line, value: 5 })).toBeNull();
    });

    it("show: channel and label, extras are not carried over", () => {
        expect(parseWireOutputShow({ channel: "extensions.a", label: "A", value: "x" })).toStrictEqual({
            channel: "extensions.a",
            label: "A",
        });
    });

    it("show: foreign envelope → null", () => {
        expect(parseWireOutputShow(null)).toBeNull();
        expect(parseWireOutputShow(7)).toBeNull();
        expect(parseWireOutputShow({ channel: "", label: "A" })).toBeNull();
        expect(parseWireOutputShow({ channel: 1, label: "A" })).toBeNull();
        expect(parseWireOutputShow({ channel: "c", label: "" })).toBeNull();
        expect(parseWireOutputShow({ channel: "c", label: 1 })).toBeNull();
    });
});

describe("hostWireParsers — diagnostics.publish", () => {
    const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };
    const marker = { severity: 0, range, message: "bad" };

    it("a marker without code/source has no such fields; with them, as is", () => {
        expect(parseWireDiagnosticsPublish({ owner: "ts", resource: "file:///a.ts", markers: [marker] })).toStrictEqual(
            { owner: "ts", resource: "file:///a.ts", markers: [marker] },
        );
        const full = { ...marker, code: "TS1", source: "tsserver" };
        expect(parseWireDiagnosticsPublish({ owner: "ts", resource: "file:///a.ts", markers: [full] })).toStrictEqual({
            owner: "ts",
            resource: "file:///a.ts",
            markers: [full],
        });
    });

    it("non-string code/source are dropped, the marker stays", () => {
        const parsed = parseWireDiagnosticsPublish({
            owner: "ts",
            resource: "file:///a.ts",
            markers: [{ ...marker, code: 1, source: null }],
        });
        expect(parsed?.markers).toStrictEqual([marker]);
    });

    it("malformed markers are dropped one by one, an empty set is a valid publish", () => {
        const parsed = parseWireDiagnosticsPublish({
            owner: "ts",
            resource: "file:///a.ts",
            markers: [
                null,
                7,
                { ...marker, severity: Number.NaN },
                { ...marker, severity: "0" },
                { ...marker, range: { start: { line: 0, character: 0 } } },
                { ...marker, message: 5 },
                marker,
            ],
        });
        expect(parsed?.markers).toStrictEqual([marker]);
        expect(parseWireDiagnosticsPublish({ owner: "ts", resource: "file:///a.ts", markers: [] })).toStrictEqual({
            owner: "ts",
            resource: "file:///a.ts",
            markers: [],
        });
    });

    it("foreign envelope → null", () => {
        const ok = { owner: "ts", resource: "file:///a.ts", markers: [] };
        expect(parseWireDiagnosticsPublish(null)).toBeNull();
        expect(parseWireDiagnosticsPublish("x")).toBeNull();
        expect(parseWireDiagnosticsPublish({ ...ok, owner: "" })).toBeNull();
        expect(parseWireDiagnosticsPublish({ ...ok, owner: 1 })).toBeNull();
        expect(parseWireDiagnosticsPublish({ ...ok, resource: "" })).toBeNull();
        expect(parseWireDiagnosticsPublish({ ...ok, resource: 1 })).toBeNull();
        expect(parseWireDiagnosticsPublish({ ...ok, markers: {} })).toBeNull();
    });
});

/** A function with the required fields: `typeof` is `"function"`, fields read like an object's. */
function fnWith(fields: Record<string, unknown>): unknown {
    return Object.assign(() => undefined, fields);
}

describe("hostWireParsers — window.*: non-object with the right fields is rejected", () => {
    it("progress.start/report/end: function envelope → null", () => {
        expect(parseWireProgressStart(fnWith({ handle: 1, title: "t" }))).toBeNull();
        expect(parseWireProgressReport(fnWith({ handle: 1 }))).toBeNull();
        expect(parseWireProgressEnd(fnWith({ handle: 1 }))).toBeNull();
    });

    it("output.append/show: function envelope → null", () => {
        expect(parseWireOutputAppend(fnWith({ channel: "c", label: "L", level: "info", value: "v" }))).toBeNull();
        expect(parseWireOutputShow(fnWith({ channel: "c", label: "L" }))).toBeNull();
    });

    it("diagnostics.publish: function envelope → null, function marker is dropped", () => {
        const marker = {
            severity: 1,
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
            message: "m",
        };
        expect(parseWireDiagnosticsPublish(fnWith({ owner: "o", resource: "file:///a", markers: [] }))).toBeNull();
        expect(
            parseWireDiagnosticsPublish({ owner: "o", resource: "file:///a", markers: [fnWith(marker)] }),
        ).toStrictEqual({ owner: "o", resource: "file:///a", markers: [] });
    });
});
