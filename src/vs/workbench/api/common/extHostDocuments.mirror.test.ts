import { describe, expect, it, vi } from "vitest";

import { createRange } from "../../../editor/common/core/iRange.ts";
import { createTextEdit, type ITextEdit } from "../../../editor/common/core/iTextEdit.ts";
import type { IModelContentChangedEvent } from "../../../editor/common/model/iDocumentContentChange.ts";
import { TextDocument } from "../../../editor/common/model/textDocument.ts";

import { DocumentRegistry, DocumentSyncTracker, type IDocumentChangeEvent } from "./extHostDocuments.ts";
import { Position, Range, Uri } from "./vscodeTypes.ts";
import type { IWireDocumentContentChange } from "./wireTypes.ts";

const URI = Uri.file("/a.ts").toString();

/** Батч модели ядра в проводной форме — как его шлёт адаптер document sync. */
function toWire(event: IModelContentChangedEvent): IWireDocumentContentChange[] {
    return event.changes.map(({ range, text }) => ({
        range: {
            startLine: range.start.line,
            startCharacter: range.start.character,
            endLine: range.end.line,
            endCharacter: range.end.character,
        },
        text,
    }));
}

function wireChange(startLine: number, startCharacter: number, endLine: number, endCharacter: number, text: string) {
    return { range: { startLine, startCharacter, endLine, endCharacter }, text };
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

describe("ExtHostTextDocument — зеркало правками", () => {
    it("правка: текст, версия модели и contentChange с offset/length по строкам ДО неё", () => {
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

    it("батч из нескольких правок применяется по порядку провода (снизу вверх)", () => {
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

    it("dirty из события обновляет мету; без него — прежняя", () => {
        const { tracker, doc } = setup("a");
        tracker.change({ uri: URI, version: 2, changes: [], isDirty: true });
        expect(doc.isDirty).toBe(true);
        tracker.change({ uri: URI, version: 3, changes: [] });
        expect(doc.isDirty).toBe(true);
        expect(doc.version).toBe(3);
    });

    it("диапазон за границами прижимается к документу (контракт validateRange)", () => {
        const { tracker, doc } = setup("ab");
        tracker.change({ uri: URI, version: 2, changes: [wireChange(0, 5, 9, 9, "!")] });
        expect(doc.getText()).toBe("ab!");
    });

    it("после правки getText, offsetAt и positionAt считают по новому тексту", () => {
        const { tracker, doc } = setup("ab\ncd");
        tracker.change({ uri: URI, version: 2, changes: [wireChange(0, 2, 1, 0, "")] });
        expect(doc.getText()).toBe("abcd");
        expect(doc.offsetAt(new Position(0, 3))).toBe(3);
        expect(doc.positionAt(10)).toEqual(new Position(0, 4));
    });

    it("правки неоткрытого (или закрытого) документа отбрасываются с предупреждением", () => {
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

    it("свойство: зеркало сходится с моделью ядра на случайных батчах", () => {
        let seed = 0x51a7;
        const random = (): number => {
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        const pick = (n: number): number => Math.floor(random() * n);
        const pieces = ["", "x", "yz", "\n", "a\nb", "\r\n", "é"];
        // Свежий маленький документ на раунд и несколько батчей подряд в нём:
        // проверяется и цепочка версий, а документ не разрастается.
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
            expect(doc.getText(), `раунд ${String(round)}`).toBe(model.getText());
            expect(doc.version).toBe(model.versionId === 0 ? 1 : model.versionId);
        }
    });
});

describe("DocumentSyncTracker.verify — текст запроса сверяется с зеркалом", () => {
    it("совпал — тихо, без события и без смены версии; мета обновляется", () => {
        const { tracker, doc, changes, warnings } = setup("a");
        expect(tracker.verify({ uri: URI, languageId: "javascript", text: "a" })).toBe(doc);
        expect(changes).toEqual([]);
        expect(warnings).toEqual([]);
        expect(doc.version).toBe(1);
        expect(doc.languageId).toBe("javascript");
    });

    it("разошёлся — предупреждение и пересинхронизация полной правкой от зеркала", () => {
        const { tracker, doc, changes, warnings } = setup("old");
        tracker.verify({ uri: URI, text: "new text" });
        expect(warnings).toEqual([`document sync: request text differs from the mirror of ${URI} — resyncing`]);
        expect(doc.getText()).toBe("new text");
        expect(changes[0].contentChanges).toEqual([
            { range: new Range(0, 0, 0, 3), rangeOffset: 0, rangeLength: 3, text: "new text" },
        ]);
    });

    it("документ, открытый запросом (хост его не синхронизирует), обновляется из запросов молча", () => {
        const registry = new DocumentRegistry();
        const warnings: string[] = [];
        const tracker = new DocumentSyncTracker(registry, (message) => warnings.push(message));
        const doc = tracker.verify({ uri: URI, text: "one" });
        tracker.verify({ uri: URI, text: "two" });
        expect(doc.getText()).toBe("two");
        expect(warnings).toEqual([]);

        // Хост открыл его сам — дальше расхождение уже нарушение.
        tracker.open({ uri: URI, version: 5, text: "two" });
        tracker.verify({ uri: URI, text: "three" });
        expect(warnings).toHaveLength(1);

        // После закрытия — снова документ запросов.
        tracker.close(Uri.parse(URI));
        tracker.verify({ uri: URI, text: "four" });
        tracker.verify({ uri: URI, text: "five" });
        expect(warnings).toHaveLength(1);
    });

    it("неизвестный документ (запрос раньше didOpen) открывается из запроса без предупреждения", () => {
        const registry = new DocumentRegistry();
        const warnings: string[] = [];
        const tracker = new DocumentSyncTracker(registry, (message) => warnings.push(message));
        const opened: string[] = [];
        tracker.onDidOpenEmitter.event((d) => opened.push(d.uri.toString()));
        const doc = tracker.verify({ uri: URI, text: "x" });
        expect(doc.getText()).toBe("x");
        expect(opened).toEqual([URI]);
        expect(warnings).toEqual([]);
    });
});

describe("DocumentSyncTracker — предупреждения по умолчанию", () => {
    it("без своего приёмника пишет в stderr субпроцесса с префиксом ext-host", () => {
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
