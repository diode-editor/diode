import { describe, expect, it } from "vitest";

import { parseWireDocumentChangedEvent, parseWireDocumentSyncSnapshot } from "./wireTypes.ts";

const RANGE = { start: { line: 0, character: 1 }, end: { line: 2, character: 3 } };

describe("wireTypes — document sync", () => {
    it("правки: валидный батч разбирается, dirty — только булев", () => {
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

    it("правки: битая форма или одна битая правка отбрасывают весь батч", () => {
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

    it("снапшот без правок не путается с батчем: у него нет `changes`", () => {
        const snapshot = { uri: "file:///a.ts", languageId: "ts", version: 1, text: "x" };
        expect(parseWireDocumentChangedEvent(snapshot)).toBeNull();
        expect(parseWireDocumentSyncSnapshot(snapshot)).toEqual(snapshot);
    });
});
