import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";
import { createTextEdit, type ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { IModelContentChangedEvent } from "../../../editor/common/model/iDocumentContentChange.ts";
import { TextDocument } from "../../../editor/common/model/textDocument.ts";

import { DocumentRegistry, DocumentSyncTracker, type IDocumentChangeEvent } from "./extHostDocuments.ts";
import { Position, Range, Uri } from "./vscodeTypes.ts";
import type { IWireDocumentContentChange } from "./wireTypes.ts";

const URI = Uri.file("/a.ts").toString();

function toWire(event: IModelContentChangedEvent): IWireDocumentContentChange[] {
    return event.changes.map(({ range, text }) => ({ range, text }));
}

function wireChange(startLine: number, startCharacter: number, endLine: number, endCharacter: number, text: string) {
    return { range: createRange(startLine, startCharacter, endLine, endCharacter), text };
}

function setup(text: string) {
    const registry = new DocumentRegistry();
    const warnings: string[] = [];
    const tracker = new DocumentSyncTracker(registry, (message) => warnings.push(message));
    const changes: IDocumentChangeEvent[] = [];
    tracker.onDidChangeEmitter.event((e) => changes.push(e));
    const doc = tracker.open({ uri: URI, languageId: "typescript", version: 1, text });
    return { registry, tracker, doc, changes, warnings };
}

describe("ExtHostTextDocument — mirror via edits", () => {
    it("edit: text, model version and contentChange with offset/length against the lines BEFORE it", () => {
        const { tracker, doc, changes } = setup("ab\ncd");
        tracker.change({ uri: URI, version: 7, changes: [wireChange(1, 1, 1, 2, "XY\nZ")] });

        expect(doc.getText()).toBe("ab\ncXY\nZ");
        expect(doc.version).toBe(7);
        expect(doc.lineCount).toBe(3);
        expect(changes).toHaveLength(1);
        expect(changes[0].document).toBe(doc);
        expect(changes[0].contentChanges).toEqual([
            { range: new Range(1, 1, 1, 2), rangeOffset: 4, rangeLength: 1, text: "XY\nZ" },
        ]);
    });

    it("batch of several edits applies in wire order (bottom-up)", () => {
        const { tracker, doc, changes } = setup("one\ntwo\nthree");
        tracker.change({
            uri: URI,
            version: 2,
            changes: [wireChange(2, 0, 2, 5, "3"), wireChange(0, 0, 1, 3, "1")],
        });
        expect(doc.getText()).toBe("1\n3");
        expect(changes[0].contentChanges.map((c) => [c.rangeOffset, c.rangeLength])).toEqual([
            [8, 5],
            [0, 7],
        ]);
    });

    it("dirty from the event updates the meta; without it the previous one stays", () => {
        const { tracker, doc } = setup("a");
        tracker.change({ uri: URI, version: 2, changes: [], isDirty: true });
        expect(doc.isDirty).toBe(true);
        tracker.change({ uri: URI, version: 3, changes: [] });
        expect(doc.isDirty).toBe(true);
        expect(doc.version).toBe(3);
    });

    it("out-of-bounds range is clamped to the document (validateRange contract)", () => {
        const { tracker, doc } = setup("ab");
        tracker.change({ uri: URI, version: 2, changes: [wireChange(0, 5, 9, 9, "!")] });
        expect(doc.getText()).toBe("ab!");
    });

    it("after an edit getText, offsetAt and positionAt use the new text", () => {
        const { tracker, doc } = setup("ab\ncd");
        tracker.change({ uri: URI, version: 2, changes: [wireChange(0, 2, 1, 0, "")] });
        expect(doc.getText()).toBe("abcd");
        expect(doc.offsetAt(new Position(0, 3))).toBe(3);
        expect(doc.positionAt(10)).toEqual(new Position(0, 4));
    });

    it("edits to an unopened (or closed) document are dropped with a warning", () => {
        const { tracker, doc, changes, warnings } = setup("a");
        const other = Uri.file("/b.ts").toString();
        expect(tracker.change({ uri: other, version: 2, changes: [wireChange(0, 0, 0, 0, "x")] })).toBeNull();
        tracker.close(Uri.parse(URI));
        expect(tracker.change({ uri: URI, version: 2, changes: [wireChange(0, 0, 0, 0, "x")] })).toBeNull();
        expect(doc.getText()).toBe("a");
        expect(changes).toEqual([]);
        expect(warnings).toEqual([
            `document sync: changes for a document that is not open: ${other}`,
            `document sync: changes for a document that is not open: ${URI}`,
        ]);
    });

    it("property: mirror converges with the core model on random batches", () => {
        let seed = 0x51a7;
        const random = (): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pick = (n: number): number => Math.floor(random() * n);
        const pieces = ["", "x", "yz", "\n", "a\nb", "\r\n", "é"];
        // A fresh small document per round: exercises the version chain without letting the document grow.
        for (let round = 0; round < 100; round++) {
            const model = new TextDocument(["ab", "", "cde", "f"].slice(0, 1 + pick(4)).join("\n"));
            const { tracker, doc } = setup(model.getText());
            const events: IModelContentChangedEvent[] = [];
            model.onDidChangeModelContent((e) => events.push(e));
            for (let step = 0; step < 4; step++) {
                const edits: ITextEdit[] = [];
                for (let line = 0; line < model.lineCount; line++) {
                    if (random() < 0.6) continue;
                    const length = model.getLineLength(line);
                    const start = pick(length + 1);
                    const end = start + pick(length - start + 1);
                    edits.push(createTextEdit(createRange(line, start, line, end), pieces[pick(pieces.length)]));
                }
                model.applyEdits(edits);
            }
            for (const event of events) {
                tracker.change({ uri: URI, version: event.versionId, changes: toWire(event) });
            }
            expect(doc.getText(), `round ${String(round)}`).toBe(model.getText());
            expect(doc.version).toBe(model.versionId === 0 ? 1 : model.versionId);
        }
    });
});

describe("DocumentSyncTracker.resolve — request document from the mirror by version", () => {
    it("matching version yields the same document, no event and no version change; a string languageId applies", () => {
        const { tracker, doc, changes, warnings } = setup("a");
        expect(tracker.resolve(URI, 1, "javascript")).toBe(doc);
        expect(changes).toEqual([]);
        expect(warnings).toEqual([]);
        expect(doc.version).toBe(1);
        expect(doc.getText()).toBe("a");
        expect(doc.languageId).toBe("javascript");
    });

    it("version after a didChange edit yields the document with new text", () => {
        const { tracker, doc } = setup("ab");
        tracker.change({ uri: URI, version: 4, changes: [wireChange(0, 2, 0, 2, "c")] });
        expect(tracker.resolve(URI, 4)).toBe(doc);
        expect(doc.getText()).toBe("abc");
    });

    it("non-string languageId (or none) leaves the document language alone", () => {
        const { tracker, doc } = setup("a");
        for (const languageId of [undefined, null, 42, { id: "javascript" }]) {
            expect(tracker.resolve(URI, 1, languageId)).toBe(doc);
            expect(doc.languageId).toBe("typescript");
        }
    });

    it("unopened document yields null without a warning and without opening", () => {
        const registry = new DocumentRegistry();
        const warnings: string[] = [];
        const tracker = new DocumentSyncTracker(registry, (message) => warnings.push(message));
        const opened: string[] = [];
        tracker.onDidOpenEmitter.event((d) => opened.push(d.uri.toString()));
        expect(tracker.resolve(URI, 1, "typescript")).toBeNull();
        expect(registry.get(Uri.parse(URI))).toBeUndefined();
        expect(opened).toEqual([]);
        expect(warnings).toEqual([]);
    });

    it("stale request (version below the mirror) yields null silently, language unchanged", () => {
        const { tracker, doc, warnings } = setup("a");
        tracker.change({ uri: URI, version: 3, changes: [wireChange(0, 1, 0, 1, "b")] });
        expect(tracker.resolve(URI, 2, "javascript")).toBeNull();
        expect(warnings).toEqual([]);
        expect(doc.languageId).toBe("typescript");
    });

    it("request without a version yields null silently", () => {
        const { tracker, warnings } = setup("a");
        expect(tracker.resolve(URI, undefined)).toBeNull();
        expect(warnings).toEqual([]);
    });

    it("request ahead of the mirror yields null with an out-of-order warning", () => {
        const { tracker, doc, warnings } = setup("a");
        expect(tracker.resolve(URI, 5, "javascript")).toBeNull();
        expect(warnings).toEqual([`document sync: request for ${URI} v5 is ahead of the mirror v1`]);
        expect(doc.languageId).toBe("typescript");
    });

    it("closed document yields null even though the version matches", () => {
        const { tracker, warnings } = setup("a");
        tracker.close(Uri.parse(URI));
        expect(tracker.resolve(URI, 1)).toBeNull();
        expect(warnings).toEqual([]);
    });
});

describe("DocumentSyncTracker — default warnings", () => {
    it("without its own sink writes to the subprocess stderr with the ext-host prefix", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            const tracker = new DocumentSyncTracker(new DocumentRegistry());
            tracker.change({ uri: URI, version: 1, changes: [] });
            expect(warn).toHaveBeenCalledWith(
                `[ext-host] document sync: changes for a document that is not open: ${URI}`,
            );
        } finally {
            warn.mockRestore();
        }
    });
});
