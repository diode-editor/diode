import { describe, expect, it } from "vitest";

import {
    CallHierarchyItem,
    CancellationError,
    CancellationTokenSource,
    CodeAction,
    CodeActionKind,
    CodeLens,
    CompletionItemTag,
    Diagnostic,
    DiagnosticSeverity,
    DiagnosticTag,
    DocumentHighlightKind,
    DocumentLink,
    Hover,
    InlayHint,
    Location,
    LogLevel,
    MarkdownString,
    Position,
    ProgressLocation,
    Range,
    SymbolInformation,
    SymbolKind,
    SymbolTag,
    TypeHierarchyItem,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";

// Value-типы, которые vscode-languageclient extends-ит на require и конструирует
// на результатах. Семантика наивная — тесты фиксируют контракт хранения.

const RANGE = new Range(1, 2, 3, 4);
const URI = Uri.file("/proj/a.ts");

describe("vscodeTypes — LSP value-классы", () => {
    it("Location: Range как есть, Position сворачивается в пустой Range", () => {
        expect(new Location(URI, RANGE).range).toBe(RANGE);
        const fromPosition = new Location(URI, new Position(5, 7));
        expect(fromPosition.uri).toBe(URI);
        expect(fromPosition.range.start.line).toBe(5);
        expect(fromPosition.range.isEmpty).toBe(true);
    });

    it("Diagnostic: severity по умолчанию Error, поля хранятся", () => {
        const diag = new Diagnostic(RANGE, "boom");
        expect(diag.severity).toBe(DiagnosticSeverity.Error);
        expect(diag.range).toBe(RANGE);
        expect(diag.message).toBe("boom");
        expect(new Diagnostic(RANGE, "warn", DiagnosticSeverity.Warning).severity).toBe(DiagnosticSeverity.Warning);
    });

    it("CodeActionKind: contains/intersects/append", () => {
        const refactor = CodeActionKind.Refactor;
        expect(refactor.contains(CodeActionKind.RefactorExtract)).toBe(true);
        expect(CodeActionKind.RefactorExtract.contains(refactor)).toBe(false);
        expect(refactor.intersects(CodeActionKind.RefactorExtract)).toBe(true);
        expect(refactor.intersects(CodeActionKind.QuickFix)).toBe(false);
        expect(refactor.append("move").value).toBe("refactor.move");
        expect(CodeActionKind.Empty.append("custom").value).toBe("custom");
    });

    it("CodeLens: isResolved по наличию command", () => {
        expect(new CodeLens(RANGE).isResolved).toBe(false);
        expect(new CodeLens(RANGE, { command: "x" }).isResolved).toBe(true);
    });

    it("CodeAction/DocumentLink/InlayHint/SymbolInformation/иерархии — конструкторы хранят поля", () => {
        const action = new CodeAction("Fix it", CodeActionKind.QuickFix);
        expect(action.title).toBe("Fix it");
        expect(action.kind).toBe(CodeActionKind.QuickFix);

        const link = new DocumentLink(RANGE, URI);
        expect(link.target).toBe(URI);

        const hint = new InlayHint(new Position(0, 1), "label", 2);
        expect(hint.label).toBe("label");
        expect(hint.kind).toBe(2);

        const symbol = new SymbolInformation("fn", SymbolKind.Function, "container", new Location(URI, RANGE));
        expect(symbol.kind).toBe(SymbolKind.Function);
        expect(symbol.location.uri).toBe(URI);

        const call = new CallHierarchyItem(SymbolKind.Method, "m", "detail", URI, RANGE, RANGE);
        expect(call.name).toBe("m");
        const type = new TypeHierarchyItem(SymbolKind.Class, "C", "detail", URI, RANGE, RANGE);
        expect(type.kind).toBe(SymbolKind.Class);
    });

    it("CancellationError — Error с именем Canceled", () => {
        const err = new CancellationError();
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("Canceled");
        expect(err.message).toBe("Canceled");
    });

    it("CancellationTokenSource: cancel фаерит событие и взводит isCancellationRequested", () => {
        const source = new CancellationTokenSource();
        expect(source.token.isCancellationRequested).toBe(false);
        let fired = 0;
        source.token.onCancellationRequested(() => fired++);
        source.cancel();
        expect(fired).toBe(1);
        expect(source.token.isCancellationRequested).toBe(true);
        // Повторный cancel — идемпотентен.
        source.cancel();
        expect(fired).toBe(1);
        source.dispose();
    });

    it("MarkdownString: append* конкатенируют и возвращают this", () => {
        const md = new MarkdownString("a");
        expect(md.appendText("b").appendMarkdown("c").appendCodeblock("d", "ts")).toBe(md);
        expect(md.value).toBe("abcd");
        expect(new MarkdownString().value).toBe("");
    });

    it("Hover: contents нормализуется в массив", () => {
        expect(new Hover("text").contents).toEqual(["text"]);
        expect(new Hover(["a", "b"], RANGE).contents).toEqual(["a", "b"]);
        expect(new Hover("x", RANGE).range).toBe(RANGE);
    });

    it("WorkspaceEdit: replace/insert/delete аккумулируются per-uri", () => {
        const edit = new WorkspaceEdit();
        expect(edit.size).toBe(0);
        expect(edit.has(URI)).toBe(false);
        expect(edit.get(URI)).toEqual([]);

        edit.replace(URI, RANGE, "new");
        edit.insert(URI, new Position(0, 0), "ins");
        edit.delete(Uri.file("/proj/b.ts"), RANGE);

        expect(edit.size).toBe(2);
        expect(edit.has(URI)).toBe(true);
        const edits = edit.get(URI);
        expect(edits).toHaveLength(2);
        expect(edits[0].newText).toBe("new");
        expect(edits[1].range.isEmpty).toBe(true);
        expect(edit.get(Uri.file("/proj/b.ts"))[0].newText).toBe("");
    });

    it("enum'ы совпадают с числовыми значениями VS Code", () => {
        expect(DiagnosticSeverity.Hint).toBe(3);
        expect(DiagnosticTag.Deprecated).toBe(2);
        expect(CompletionItemTag.Deprecated).toBe(1);
        expect(DocumentHighlightKind.Write).toBe(2);
        expect(SymbolTag.Deprecated).toBe(1);
        expect(SymbolKind.TypeParameter).toBe(25);
        expect(LogLevel.Error).toBe(5);
        expect(ProgressLocation.Notification).toBe(15);
    });
});
