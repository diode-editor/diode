import { describe, expect, it } from "vitest";

import { DocumentRegistry, DocumentSyncTracker, type IDocumentChangeEvent } from "./extHostDocuments.ts";
import { EndOfLine, Position, Range, Uri } from "./vscodeTypes.ts";

describe("ExtHostDocuments — DocumentRegistry identity", () => {
    it("getOrCreate returns THE SAME reference for the same resource", () => {
        const reg = new DocumentRegistry();
        const a = reg.getOrCreate(Uri.file("/a.ts"));
        const b = reg.getOrCreate(Uri.file("/a.ts"));
        expect(a).toBe(b);
        expect(reg.getOrCreate(Uri.file("/other.ts"))).not.toBe(a);
    });

    it("upsertMeta/upsertFull mutate the same object (identity is preserved)", () => {
        const reg = new DocumentRegistry();
        const first = reg.upsertMeta({ uri: Uri.file("/a.ts").toString() });
        const second = reg.upsertMeta({ uri: Uri.file("/a.ts").toString(), languageId: "typescript", isDirty: true });
        expect(second).toBe(first);
        expect(first.languageId).toBe("typescript");
        expect(first.isDirty).toBe(true);
        const third = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "x\n" });
        expect(third).toBe(first);
    });

    it("all() returns all known documents", () => {
        const reg = new DocumentRegistry();
        reg.getOrCreate(Uri.file("/a.ts"));
        reg.getOrCreate(Uri.file("/b.ts"));
        expect(reg.all()).toHaveLength(2);
    });

    it("forget() drops the resource: the next getOrCreate is a new object, the old one keeps working", () => {
        const reg = new DocumentRegistry();
        const held = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "held" });
        const other = reg.getOrCreate(Uri.file("/b.ts"));

        reg.forget(Uri.file("/a.ts"));

        expect(reg.get(Uri.file("/a.ts"))).toBeUndefined();
        expect(reg.get(Uri.file("/b.ts"))).toBe(other);
        expect(reg.getOrCreate(Uri.file("/a.ts"))).not.toBe(held);
        expect(held.getText()).toBe("held");
    });

    it("get() returns the document or undefined", () => {
        const reg = new DocumentRegistry();
        const doc = reg.getOrCreate(Uri.file("/a.ts"));
        expect(reg.get(Uri.file("/a.ts"))).toBe(doc);
        expect(reg.get(Uri.file("/missing.ts"))).toBeUndefined();
    });
});

describe("ExtHostDocuments — ExtHostTextDocument", () => {
    it("empty document defaults", () => {
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

    it("fileName is derived from uri (shorthand for uri.fsPath, as vscode.d.ts requires)", () => {
        const doc = new DocumentRegistry().getOrCreate(Uri.file("/dir/file.ts"));
        expect(doc.uri.scheme).toBe("file");
        expect(doc.uri.fsPath).toBe("/dir/file.ts");
        expect(doc.fileName).toBe(doc.uri.fsPath);
        expect(doc.isUntitled).toBe(false);
    });

    it("isUntitled is derived from the untitled: scheme", () => {
        const doc = new DocumentRegistry().getOrCreate(Uri.parse("untitled:Untitled-1"));
        expect(doc.isUntitled).toBe(true);
        expect(doc.fileName).toBe("Untitled-1");
    });

    it("documents with the same path but different schemes are different objects", () => {
        const reg = new DocumentRegistry();
        const file = reg.getOrCreate(Uri.file("/a.ts"));
        const untitled = reg.getOrCreate(Uri.parse("untitled:/a.ts"));
        expect(untitled).not.toBe(file);
    });

    it("version grows only on upsertFull, not on applyMeta", () => {
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

    it("an explicit snapshot version (document sync) wins over the local increment", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\n", version: 7 });
        expect(doc.version).toBe(7);
        reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "b\n" });
        expect(doc.version).toBe(8);
    });

    it("getText/lineCount reflect the snapshot", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "line0\nline1\nline2" });
        expect(doc.getText()).toBe("line0\nline1\nline2");
        expect(doc.lineCount).toBe(3);
        expect(doc.lineAt(1).text).toBe("line1");
    });

    it("upsertFull with eol updates doc.eol, without eol keeps the previous one", () => {
        const reg = new DocumentRegistry();
        const doc = reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\n", eol: EndOfLine.CRLF });
        expect(doc.eol).toBe(EndOfLine.CRLF);
        reg.upsertFull({ uri: Uri.file("/a.ts").toString(), text: "b\n" });
        expect(doc.eol).toBe(EndOfLine.CRLF);
    });

    it("a trailing \\n yields an empty last line", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\nb\n" });
        expect(doc.lineCount).toBe(3);
        expect(doc.lineAt(2).text).toBe("");
    });

    it("lineAt(number) and lineAt(Position) are equivalent", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\nbb\nccc" });
        expect(doc.lineAt(1)).toEqual(doc.lineAt(new Position(1, 99)));
    });

    it("TextLine: range/rangeIncludingLineBreak (last line has no line break)", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "ab\ncd" });
        const l0 = doc.lineAt(0);
        expect(l0.range.end.character).toBe(2);
        expect(l0.rangeIncludingLineBreak.end.line).toBe(1);
        expect(l0.rangeIncludingLineBreak.end.character).toBe(0);
        const l1 = doc.lineAt(1);
        expect(l1.rangeIncludingLineBreak.end.line).toBe(1);
        expect(l1.rangeIncludingLineBreak.end.character).toBe(2);
    });

    it("firstNonWhitespaceCharacterIndex / isEmptyOrWhitespace", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "  x\n   \nq" });
        expect(doc.lineAt(0).firstNonWhitespaceCharacterIndex).toBe(2);
        expect(doc.lineAt(0).isEmptyOrWhitespace).toBe(false);
        expect(doc.lineAt(1).firstNonWhitespaceCharacterIndex).toBe(3); // all whitespace → length
        expect(doc.lineAt(1).isEmptyOrWhitespace).toBe(true);
        expect(doc.lineAt(2).firstNonWhitespaceCharacterIndex).toBe(0);
    });

    it("lineAt out of range throws", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "a\nb" });
        expect(() => doc.lineAt(5)).toThrow(RangeError);
    });

    it("getText(range) slices by range", () => {
        const doc = new DocumentRegistry().upsertFull({ uri: Uri.file("/a.ts").toString(), text: "hello\nworld" });
        expect(doc.getText(new Range(0, 1, 0, 4))).toBe("ell");
        expect(doc.getText(new Range(0, 3, 1, 2))).toBe("lo\nwo");
    });

    it("getText(range) across several lines includes the middle lines whole", () => {
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

    it("an unknown resource fires didOpen with the full text", () => {
        const { tracker, log } = makeTracker();
        const doc = tracker.open({ uri: URI, languageId: "typescript", text: "a" });
        expect(log).toEqual(["open:a"]);
        expect(doc.languageId).toBe("typescript");
    });

    it("a resource in the registry (getOrCreate/meta) without a prior didOpen fires didOpen, not didChange", () => {
        const { registry, tracker, log } = makeTracker();
        registry.getOrCreate(Uri.parse(URI)); // meta path of active-editor-change
        tracker.open({ uri: URI, text: "a" });
        expect(log).toEqual(["open:a"]);
    });

    it("the same text is silent: meta updates, version and events are untouched", () => {
        const { tracker, log } = makeTracker();
        const doc = tracker.open({ uri: URI, text: "a", version: 7 });
        tracker.open({ uri: URI, text: "a", isDirty: true });
        expect(log).toEqual(["open:a"]);
        expect(doc.isDirty).toBe(true);
        expect(doc.version).toBe(7);
    });

    it("changed text fires didChange with one full-range edit over the OLD text", () => {
        const { tracker, log, changes } = makeTracker();
        const doc = tracker.open({ uri: URI, text: "ab\ncd" });
        const same = tracker.open({ uri: URI, text: "x" });
        expect(same).toBe(doc);
        expect(log).toEqual(["open:ab\ncd", "change:x"]);
        const change = changes[0].contentChanges[0];
        // The range is computed BEFORE the registry mutates, against the text "ab\ncd".
        expect(change.range.start).toMatchObject({ line: 0, character: 0 });
        expect(change.range.end).toMatchObject({ line: 1, character: 2 });
        expect(change.rangeOffset).toBe(0);
        expect(change.rangeLength).toBe(5);
        expect(changes[0].document.getText()).toBe("x");
    });

    it("close of an open document: isClosed, an event, the document stays in the registry", () => {
        const { registry, tracker } = makeTracker();
        const closed: string[] = [];
        tracker.onDidCloseEmitter.event((doc) => closed.push(doc.getText()));
        const doc = tracker.open({ uri: URI, text: "a" });

        const result = tracker.close(Uri.parse(URI));

        expect(result === doc).toBe(true);
        expect(doc.isClosed).toBe(true);
        expect(closed).toEqual(["a"]);
        expect(registry.get(Uri.parse(URI)) === doc).toBe(true);
    });

    it("close of a dirty document: a closed document has nothing left to save", () => {
        const { tracker } = makeTracker();
        const doc = tracker.open({ uri: URI, text: "a", isDirty: true });

        tracker.close(Uri.parse(URI));

        expect(doc.isDirty).toBe(false);
    });

    it("a state that differs only by encoding counts as a change, the same one does not", () => {
        const { tracker } = makeTracker();
        const doc = tracker.open({ uri: URI, text: "a", encoding: "utf8" });
        const state = { version: doc.version, isDirty: doc.isDirty, eol: doc.eol };

        expect(doc.acceptState({ ...state, encoding: "utf8" })).toBe(false);
        expect(doc.acceptState({ ...state, encoding: "windows1252" })).toBe(true);
    });

    it("close of an unknown resource returns null without an event", () => {
        const { tracker } = makeTracker();
        const closed: string[] = [];
        tracker.onDidCloseEmitter.event((doc) => closed.push(doc.getText()));

        expect(tracker.close(Uri.parse(URI))).toBeNull();
        expect(closed).toEqual([]);
    });

    it("close of a registry resource without didOpen (meta path) returns null", () => {
        const { registry, tracker } = makeTracker();
        registry.getOrCreate(Uri.parse(URI)); // meta path of active-editor-change, didOpen never fired

        expect(tracker.close(Uri.parse(URI))).toBeNull();
    });

    it("revival after close: didOpen again with the same object, isClosed cleared", () => {
        const { tracker, log } = makeTracker();
        const doc = tracker.open({ uri: URI, text: "a" });
        tracker.close(Uri.parse(URI));

        const revived = tracker.open({ uri: URI, text: "b" });

        expect(revived === doc).toBe(true);
        expect(doc.isClosed).toBe(false);
        expect(log).toEqual(["open:a", "open:b"]);
    });
});
