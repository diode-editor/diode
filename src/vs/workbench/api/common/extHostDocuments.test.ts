import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker, type IDocumentChangeEvent } from "./extHostDocuments.ts";
import { EndOfLine, Position, Range, Uri } from "./vscodeTypes.ts";

describe("ExtHostDocuments — DocumentRegistry идентичность", () => {
    it("getOrCreate возвращает ТУ ЖЕ ссылку для того же ресурса", () => {
        const reg = new DocumentRegistry();
        const a = reg.getOrCreate(Uri.file("/a.ts"));
        const b = reg.getOrCreate(Uri.file("/a.ts"));
        expect(a).toBe(b);
        expect(reg.getOrCreate(Uri.file("/other.ts"))).not.toBe(a);
    });

    it("upsertMeta/upsertFull мутируют тот же объект (идентичность сохраняется)", () => {
        const reg = new DocumentRegistry();
        const first = reg.upsertMeta({ uri: Uri.file("/a.ts").toString() });
        const second = reg.upsertMeta({ uri: Uri.file("/a.ts").toString(), languageId: "typescript", isDirty: true });
        expect(second).toBe(first);
        expect(first.languageId).toBe("typescript");
        expect(first.isDirty).toBe(true);
        const third = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "x\n" });
        expect(third).toBe(first);
    });

    it("all() отдаёт все известные документы", () => {
        const reg = new DocumentRegistry();
        reg.getOrCreate(Uri.file("/a.ts"));
        reg.getOrCreate(Uri.file("/b.ts"));
        expect(reg.all()).toHaveLength(2);
    });

    it("get() возвращает документ или undefined", () => {
        const reg = new DocumentRegistry();
        const doc = reg.getOrCreate(Uri.file("/a.ts"));
        expect(reg.get(Uri.file("/a.ts"))).toBe(doc);
        expect(reg.get(Uri.file("/missing.ts"))).toBeUndefined();
    });
});

describe("ExtHostDocuments — ExtHostTextDocument", () => {
    it("дефолты пустого документа", () => {
        const doc = new DocumentRegistry().getOrCreate(Uri.file("/a.ts"));
        expect(doc.languageId).toBe("plaintext");
        expect(doc.isDirty).toBe(false);
        expect(doc.isUntitled).toBe(false);
        expect(doc.encoding).toBe("utf8");
        expect(doc.eol).toBe(EndOfLine.LF);
        expect(doc.version).toBe(0);
        expect(doc.getText()).toBe("");
        expect(doc.lineCount).toBe(1);
        expect(doc.lineAt(0).text).toBe("");
    });

    it("fileName выводится из uri (shorthand для uri.fsPath, как требует vscode.d.ts)", () => {
        const doc = new DocumentRegistry().getOrCreate(Uri.file("/dir/file.ts"));
        expect(doc.uri.scheme).toBe("file");
        expect(doc.uri.fsPath).toBe("/dir/file.ts");
        expect(doc.fileName).toBe(doc.uri.fsPath);
        expect(doc.isUntitled).toBe(false);
    });

    it("isUntitled выводится из схемы untitled:", () => {
        const doc = new DocumentRegistry().getOrCreate(Uri.parse("untitled:Untitled-1"));
        expect(doc.isUntitled).toBe(true);
        // fileName — shorthand для fsPath «independent of the uri scheme».
        expect(doc.fileName).toBe("Untitled-1");
    });

    it("документы с одинаковым path, но разной схемой — разные объекты", () => {
        const reg = new DocumentRegistry();
        const file = reg.getOrCreate(Uri.file("/a.ts"));
        const untitled = reg.getOrCreate(Uri.parse("untitled:/a.ts"));
        expect(untitled).not.toBe(file);
    });

    it("version растёт только на upsertFull, не на applyMeta", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertMeta({ uri: Uri.file("/a.ts").toString(), isDirty: true });
        expect(doc.version).toBe(0);
        reg.upsertMeta({ uri: Uri.file("/a.ts").toString(), languageId: "ts" });
        expect(doc.version).toBe(0);
        reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\n" });
        expect(doc.version).toBe(1);
        reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "b\n" });
        expect(doc.version).toBe(2);
    });

    it("явная версия снапшота (document sync) побеждает локальный инкремент", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\n", version: 7 });
        expect(doc.version).toBe(7);
        // Без явной версии — снова локальный инкремент от текущего значения.
        reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "b\n" });
        expect(doc.version).toBe(8);
    });

    it("getText/lineCount отражают снапшот", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "line0\nline1\nline2" });
        expect(doc.getText()).toBe("line0\nline1\nline2");
        expect(doc.lineCount).toBe(3);
        expect(doc.lineAt(1).text).toBe("line1");
    });

    it("upsertFull с eol обновляет doc.eol, без eol — оставляет прежний", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\n", eol: EndOfLine.CRLF });
        expect(doc.eol).toBe(EndOfLine.CRLF);
        // Следующий снапшот без eol не сбрасывает уже установленный.
        reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "b\n" });
        expect(doc.eol).toBe(EndOfLine.CRLF);
    });

    it("трейлинг \\n даёт пустую последнюю строку", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\nb\n" });
        expect(doc.lineCount).toBe(3);
        expect(doc.lineAt(2).text).toBe("");
    });

    it("lineAt(number) и lineAt(Position) эквивалентны", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\nbb\nccc" });
        expect(doc.lineAt(1)).toEqual(doc.lineAt(new Position(1, 99)));
    });

    it("TextLine: range/rangeIncludingLineBreak (последняя строка без переноса)", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "ab\ncd" });
        const l0 = doc.lineAt(0);
        expect(l0.range.end.character).toBe(2);
        expect(l0.rangeIncludingLineBreak.end.line).toBe(1);
        expect(l0.rangeIncludingLineBreak.end.character).toBe(0);
        const l1 = doc.lineAt(1);
        expect(l1.rangeIncludingLineBreak.end.line).toBe(1); // нет переноса
        expect(l1.rangeIncludingLineBreak.end.character).toBe(2);
    });

    it("firstNonWhitespaceCharacterIndex / isEmptyOrWhitespace", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "  x\n   \nq" });
        expect(doc.lineAt(0).firstNonWhitespaceCharacterIndex).toBe(2);
        expect(doc.lineAt(0).isEmptyOrWhitespace).toBe(false);
        expect(doc.lineAt(1).firstNonWhitespaceCharacterIndex).toBe(3); // вся whitespace → длина
        expect(doc.lineAt(1).isEmptyOrWhitespace).toBe(true);
        expect(doc.lineAt(2).firstNonWhitespaceCharacterIndex).toBe(0);
    });

    it("lineAt вне диапазона бросает", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\nb" });
        expect(() => doc.lineAt(5)).toThrow(RangeError);
    });

    it("getText(range) режет по диапазону", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "hello\nworld" });
        expect(doc.getText(new Range(0, 1, 0, 4))).toBe("ell");
        expect(doc.getText(new Range(0, 3, 1, 2))).toBe("lo\nwo");
    });

    it("getText(range) через несколько строк включает промежуточные целиком", () => {
        const doc = new DocumentRegistry().upsertFull({
            uri: Uri.file("/a.ts").toString(),
            text: "one\ntwo\nthree\nfour",
        });
        expect(doc.getText(new Range(0, 1, 3, 2))).toBe("ne\ntwo\nthree\nfo");
    });
});

describe("ExtHostDocuments — DocumentSyncTracker", () => {
    function makeTracker() {
        const registry = new DocumentRegistry();
        const tracker = new DocumentSyncTracker(registry);
        const log: string[] = [];
        const changes: IDocumentChangeEvent[] = [];
        tracker.onDidOpenEmitter.event((doc) => log.push(`open:${doc.getText()}`));
        tracker.onDidChangeEmitter.event((e) => {
            log.push(`change:${e.contentChanges[0].text}`);
            changes.push(e);
        });
        return { registry, tracker, log, changes };
    }
    const URI = Uri.file("/a.ts").toString();

    it("неизвестный ресурс — didOpen с полным текстом", () => {
        const { tracker, log } = makeTracker();
        const doc = tracker.sync({ uri: URI, languageId: "typescript", text: "a" });
        expect(log).toEqual(["open:a"]);
        expect(doc.languageId).toBe("typescript");
    });

    it("ресурс в реестре (getOrCreate/meta), но didOpen ещё не фаерился — didOpen, не didChange", () => {
        const { registry, tracker, log } = makeTracker();
        registry.getOrCreate(Uri.parse(URI)); // мета-путь active-editor-change
        tracker.sync({ uri: URI, text: "a" });
        expect(log).toEqual(["open:a"]);
    });

    it("тот же текст — тихо: мета обновляется, версия и события не трогаются", () => {
        const { tracker, log } = makeTracker();
        const doc = tracker.sync({ uri: URI, text: "a", version: 7 });
        tracker.sync({ uri: URI, text: "a", isDirty: true });
        expect(log).toEqual(["open:a"]);
        expect(doc.isDirty).toBe(true);
        expect(doc.version).toBe(7);
    });

    it("изменившийся текст — didChange одной full-range правкой от СТАРОГО текста", () => {
        const { tracker, log, changes } = makeTracker();
        const doc = tracker.sync({ uri: URI, text: "ab\ncd" });
        const same = tracker.sync({ uri: URI, text: "x" });
        expect(same).toBe(doc); // стабильная идентичность документа
        expect(log).toEqual(["open:ab\ncd", "change:x"]);
        const change = changes[0].contentChanges[0];
        // Диапазон посчитан ДО мутации реестра — по тексту "ab\ncd".
        expect(change.range.start).toMatchObject({ line: 0, character: 0 });
        expect(change.range.end).toMatchObject({ line: 1, character: 2 });
        expect(change.rangeOffset).toBe(0);
        expect(change.rangeLength).toBe(5);
        expect(changes[0].document.getText()).toBe("x");
    });
});
