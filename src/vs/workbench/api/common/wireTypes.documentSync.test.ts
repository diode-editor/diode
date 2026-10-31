import { describe, expect, it } from "vitest";

import { parseWireDocumentChangedEvent, parseWireDocumentSyncSnapshot } from "./wireTypes.ts";

const RANGE = { start: { line: 0, character: 1 }, end: { line: 2, character: 3 } };

describe("wireTypes — document sync", () => {
    it("edits: a valid batch parses, dirty is boolean only", () => {
        expect(
            parseWireDocumentChangedEvent({
                uri: "file:///a.ts",
                version: 4,
                changes: [{ range: RANGE, text: "x" }],
                isDirty: true,
            }),
        ).toEqual({ uri: "file:///a.ts", version: 4, changes: [{ range: RANGE, text: "x" }], isDirty: true });
        expect(parseWireDocumentChangedEvent({ uri: "file:///a.ts", version: 4, changes: [], isDirty: "yes" })).toEqual(
            { uri: "file:///a.ts", version: 4, changes: [] },
        );
    });

    it("edits: undo and redo marks survive parsing, anything but true is dropped", () => {
        const base = { uri: "file:///a.ts", version: 4, changes: [] };
        expect(parseWireDocumentChangedEvent({ ...base, isUndoing: true })).toEqual({ ...base, isUndoing: true });
        expect(parseWireDocumentChangedEvent({ ...base, isRedoing: true })).toEqual({ ...base, isRedoing: true });
        expect(parseWireDocumentChangedEvent({ ...base, isUndoing: "yes", isRedoing: 1 })).toEqual(base);
    });

    it("edits: a broken shape or one broken edit drops the whole batch", () => {
        const valid = { uri: "file:///a.ts", version: 1, changes: [{ range: RANGE, text: "x" }] };
        for (const raw of [
            null,
            undefined,
            "x",
            { ...valid, uri: "" },
            { ...valid, uri: 1 },
            { ...valid, version: "1" },
            { ...valid, version: Infinity },
            { ...valid, changes: "x" },
            { ...valid, changes: [...valid.changes, null] },
            { ...valid, changes: [undefined] },
            { ...valid, changes: ["x"] },
            { ...valid, changes: [{ range: RANGE }] },
            { ...valid, changes: [{ range: { ...RANGE, end: { line: "2", character: 3 } }, text: "x" }] },
            { ...valid, changes: [{ text: "x" }] },
        ]) {
            expect(parseWireDocumentChangedEvent(raw), JSON.stringify(raw)).toBeNull();
        }
    });

    it("a snapshot without edits is not mistaken for a batch: it has no `changes`", () => {
        const snapshot = { uri: "file:///a.ts", languageId: "ts", version: 1, text: "x" };
        expect(parseWireDocumentChangedEvent(snapshot)).toBeNull();
        expect(parseWireDocumentSyncSnapshot(snapshot)).toEqual(snapshot);
    });

    const BASE = { uri: "file:///a.ts", languageId: "ts", version: 1, text: "x" };

    it.each([1, 2])("a snapshot carries the line ending %s", (eol) => {
        expect(parseWireDocumentSyncSnapshot({ ...BASE, eol })).toStrictEqual({ ...BASE, eol });
    });

    it("a snapshot carries the encoding", () => {
        expect(parseWireDocumentSyncSnapshot({ ...BASE, encoding: "utf16le" })).toStrictEqual({
            ...BASE,
            encoding: "utf16le",
        });
    });

    it("junk in the line ending and the encoding stays out of the snapshot", () => {
        expect(parseWireDocumentSyncSnapshot({ ...BASE, eol: 3, encoding: 1 })).toStrictEqual(BASE);
    });
});
