import { describe, expect, it } from "vitest";

import {
    CallHierarchyItem,
    CancellationError,
    CancellationTokenSource,
    CodeAction,
    CodeActionKind,
    CodeLens,
    CompletionItem,
    CompletionItemTag,
    CompletionList,
    CompletionTriggerKind,
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
    ParameterInformation,
    Range,
    SignatureHelp,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SymbolInformation,
    SnippetString,
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
    it("SignatureHelp: конструктор без аргументов даёт пустые поля", () => {
        // Конвертер клиента делает `new code.SignatureHelp()` и заполняет поля
        // присваиванием — пустой конструктор обязан пережить это без падений,
        // а `signatures` обязан быть массивом (по нему сразу идёт обход).
        const help = new SignatureHelp();
        expect(help.signatures).toEqual([]);
        expect(help.activeSignature).toBe(0);
        expect(help.activeParameter).toBe(0);
    });

    it("SignatureInformation / ParameterInformation: метки и документация", () => {
        const signature = new SignatureInformation("greet(name: string): void");
        expect(signature.label).toBe("greet(name: string): void");
        expect(signature.parameters).toEqual([]);
        expect(signature.documentation).toBeUndefined();
        expect(signature.activeParameter).toBeUndefined();

        const withDocs = new SignatureInformation("f()", new MarkdownString("**док**"));
        expect((withDocs.documentation as MarkdownString).value).toBe("**док**");

        // Метка параметра — строка ИЛИ пара офсетов (клиент объявляет серверу
        // labelOffsetSupport, так что вторая форма приезжает как есть).
        expect(new ParameterInformation("name: string").label).toBe("name: string");
        expect(new ParameterInformation([6, 18]).label).toEqual([6, 18]);
        expect(new ParameterInformation("name", "кого").documentation).toBe("кого");
    });

    it("SignatureHelpTriggerKind: значения протокола", () => {
        // Их сравнивает codeConverter клиента на КАЖДОМ запросе — разъедься
        // они с протоколом, сервер получил бы чужой triggerKind.
        expect(SignatureHelpTriggerKind.Invoke).toBe(1);
        expect(SignatureHelpTriggerKind.TriggerCharacter).toBe(2);
        expect(SignatureHelpTriggerKind.ContentChange).toBe(3);
    });

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
        // appendCodeblock оборачивает в fenced-блок с языком (его читает
        // hover-путь: конвертер клиента собирает так legacy MarkedString).
        expect(md.value).toBe("abc\n```ts\nd\n```\n");
        expect(new MarkdownString().appendCodeblock("x").value).toBe("\n```\nx\n```\n");
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

    it("CompletionList: items/isIncomplete как есть, дефолты — пустой полный список", () => {
        const item = new CompletionItem("greet");
        const list = new CompletionList([item], true);
        expect(list.items).toEqual([item]);
        expect(list.isIncomplete).toBe(true);

        const empty = new CompletionList();
        expect(empty.items).toEqual([]);
        expect(empty.isIncomplete).toBe(false);
    });

    it("SnippetString: хранит значение, appendText конкатенирует и возвращает this", () => {
        const snippet = new SnippetString("foo(");
        expect(snippet.appendText("$1)")).toBe(snippet);
        expect(snippet.value).toBe("foo($1)");
        expect(new SnippetString().value).toBe("");
    });

    it("enum'ы совпадают с числовыми значениями VS Code", () => {
        expect(CompletionTriggerKind.Invoke).toBe(0);
        expect(CompletionTriggerKind.TriggerCharacter).toBe(1);
        expect(CompletionTriggerKind.TriggerForIncompleteCompletions).toBe(2);
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
