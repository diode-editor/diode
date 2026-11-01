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
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    DocumentHighlightKind,
    DocumentLink,
    DocumentSymbol,
    Hover,
    InlayHint,
    Location,
    LogLevel,
    MarkdownString,
    ParameterInformation,
    Position,
    ProgressLocation,
    Range,
    SignatureHelp,
    SignatureHelpTriggerKind,
    SignatureInformation,
    SnippetString,
    SnippetTextEdit,
    SymbolInformation,
    SymbolKind,
    SymbolTag,
    TextEdit,
    TypeHierarchyItem,
    Uri,
    WorkspaceEdit,
} from "./vscodeTypes.ts";

const RANGE = new Range(1, 2, 3, 4);
const URI = Uri.file("/proj/a.ts");

describe("vscodeTypes — LSP value classes", () => {
    it("SignatureHelp: a constructor without arguments gives empty fields", () => {
        // The client converter calls `new code.SignatureHelp()`, assigns fields and immediately iterates `signatures`.
        const help = new SignatureHelp();
        expect(help.signatures).toEqual([]);
        expect(help.activeSignature).toBe(0);
        expect(help.activeParameter).toBe(0);
    });

    it("SignatureInformation / ParameterInformation: labels and documentation", () => {
        const signature = new SignatureInformation("greet(name: string): void");
        expect(signature.label).toBe("greet(name: string): void");
        expect(signature.parameters).toEqual([]);
        expect(signature.documentation).toBeUndefined();
        expect(signature.activeParameter).toBeUndefined();

        const withDocs = new SignatureInformation("f()", new MarkdownString("**doc**"));
        expect((withDocs.documentation as MarkdownString).value).toBe("**doc**");

        expect(new ParameterInformation("name: string").label).toBe("name: string");
        expect(new ParameterInformation([6, 18]).label).toEqual([6, 18]);
        expect(new ParameterInformation("name", "whom").documentation).toBe("whom");
    });

    it("SignatureHelpTriggerKind: protocol values", () => {
        expect(SignatureHelpTriggerKind.Invoke).toBe(1);
        expect(SignatureHelpTriggerKind.TriggerCharacter).toBe(2);
        expect(SignatureHelpTriggerKind.ContentChange).toBe(3);
    });

    it("Location: Range as is, Position collapses to an empty Range", () => {
        expect(new Location(URI, RANGE).range).toBe(RANGE);
        const fromPosition = new Location(URI, new Position(5, 7));
        expect(fromPosition.uri).toBe(URI);
        expect(fromPosition.range.start.line).toBe(5);
        expect(fromPosition.range.isEmpty).toBe(true);
    });

    it("Diagnostic: severity defaults to Error, fields are stored", () => {
        const diag = new Diagnostic(RANGE, "boom");
        expect(diag.severity).toBe(DiagnosticSeverity.Error);
        expect(diag.range).toBe(RANGE);
        expect(diag.message).toBe("boom");
        expect(new Diagnostic(RANGE, "warn", DiagnosticSeverity.Warning).severity).toBe(DiagnosticSeverity.Warning);
    });

    it("DiagnosticRelatedInformation: stores location and message, fits into Diagnostic", () => {
        const location = new Location(URI, RANGE);
        const related = new DiagnosticRelatedInformation(location, "'retries' is declared here");

        expect(related.location).toBe(location);
        expect(related.message).toBe("'retries' is declared here");

        const diag = new Diagnostic(RANGE, "Property 'retries' is missing");
        diag.relatedInformation = [related];
        expect(diag.relatedInformation).toEqual([related]);
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

    it("CodeLens: isResolved by presence of command", () => {
        expect(new CodeLens(RANGE).isResolved).toBe(false);
        expect(new CodeLens(RANGE, { command: "x", title: "X" }).isResolved).toBe(true);
    });

    it("CodeAction/DocumentLink/InlayHint/SymbolInformation/hierarchies — constructors store fields", () => {
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

    it("CancellationError is an Error named Canceled", () => {
        const err = new CancellationError();
        expect(err).toBeInstanceOf(Error);
        expect(err.name).toBe("Canceled");
        expect(err.message).toBe("Canceled");
    });

    it("CancellationTokenSource: cancel fires the event and sets isCancellationRequested", () => {
        const source = new CancellationTokenSource();
        expect(source.token.isCancellationRequested).toBe(false);
        let fired = 0;
        source.token.onCancellationRequested(() => fired++);
        source.cancel();
        expect(fired).toBe(1);
        expect(source.token.isCancellationRequested).toBe(true);
        // A repeated cancel is idempotent.
        source.cancel();
        expect(fired).toBe(1);
        source.dispose();
    });

    it("MarkdownString: append* concatenate and return this", () => {
        const md = new MarkdownString("a");
        expect(md.appendText("b").appendMarkdown("c").appendCodeblock("d", "ts")).toBe(md);
        expect(md.value).toBe("abc\n```ts\nd\n```\n");
        expect(new MarkdownString().appendCodeblock("x").value).toBe("\n```\nx\n```\n");
        expect(new MarkdownString().value).toBe("");
    });

    it("Hover: contents are normalized to an array", () => {
        expect(new Hover("text").contents).toEqual(["text"]);
        expect(new Hover(["a", "b"], RANGE).contents).toEqual(["a", "b"]);
        expect(new Hover("x", RANGE).range).toBe(RANGE);
    });

    it("WorkspaceEdit: replace/insert/delete accumulate per uri", () => {
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
        expect(edits[0]).toBeInstanceOf(TextEdit);
        expect(edits[0].newText).toBe("new");
        expect(edits[1].range.isEmpty).toBe(true);
        expect(edit.get(Uri.file("/proj/b.ts"))[0].newText).toBe("");
    });

    it("WorkspaceEdit.set: both converter forms (flat and pairs with metadata), null/[] clears", () => {
        const edit = new WorkspaceEdit();
        edit.set(URI, [new TextEdit(RANGE, "a")]);
        expect(edit.get(URI).map((e) => e.newText)).toEqual(["a"]);

        // set REPLACES the previous list.
        edit.set(URI, [
            [new TextEdit(RANGE, "b"), { needsConfirmation: false, label: "l" }],
            [new TextEdit(RANGE, "c"), undefined],
        ]);
        expect(edit.get(URI).map((e) => e.newText)).toEqual(["b", "c"]);

        edit.set(URI, [new TextEdit(RANGE, "d"), {} as never]);
        expect(edit.get(URI).map((e) => e.newText)).toEqual(["d"]);
        expect(edit.resourceEdits()[0].edits).toHaveLength(1);

        edit.set(URI, null);
        expect(edit.has(URI)).toBe(false);
        edit.set(URI, [new TextEdit(RANGE, "e")]);
        edit.set(URI, []);
        expect(edit.has(URI)).toBe(false);
        edit.set(URI, [new TextEdit(RANGE, "f")]);
        edit.set(URI, undefined);
        expect(edit.has(URI)).toBe(false);
    });

    it("WorkspaceEdit: entries/get return only TextEdit, resourceEdits include snippet edits too", () => {
        const edit = new WorkspaceEdit();
        const snippet = new SnippetTextEdit(RANGE, new SnippetString("x$1"));
        edit.set(URI, [new TextEdit(RANGE, "t"), snippet]);

        expect(edit.get(URI).map((e) => e.newText)).toEqual(["t"]);
        const entries = edit.entries();
        expect(entries).toHaveLength(1);
        expect(entries[0][0]).toBe(URI);
        expect(entries[0][1].map((e) => e.newText)).toEqual(["t"]);

        const resources = edit.resourceEdits();
        expect(resources).toHaveLength(1);
        expect(resources[0].uri).toBe(URI);
        expect(resources[0].edits).toEqual([expect.any(TextEdit), snippet]);
    });

    it("WorkspaceEdit: file operations are stored separately from text edits", () => {
        const other = Uri.file("/proj/other.ts");
        const edit = new WorkspaceEdit();
        expect(edit.hasFileOperations).toBe(false);
        edit.replace(URI, RANGE, "x");
        expect(edit.hasFileOperations).toBe(false);
        edit.set(URI, null);
        edit.createFile(other);
        edit.deleteFile(other);
        edit.renameFile(other, URI);
        expect(edit.hasFileOperations).toBe(true);
        edit.replace(URI, RANGE, "x");
        expect(edit.size).toBe(4);
        expect(edit.entries()).toHaveLength(1);
        expect(edit.has(other)).toBe(false);
    });

    it("WorkspaceEdit: set(uri, []) on a resource without edits breaks nothing", () => {
        const edit = new WorkspaceEdit();
        edit.set(URI, []);
        expect(edit.size).toBe(0);
        expect(edit.has(URI)).toBe(false);
        edit.createFile(Uri.file("/proj/other.ts"));
        edit.set(URI, []);
        expect(edit.operations().map((op) => op.kind)).toEqual(["create"]);
        edit.replace(URI, RANGE, "x");
        edit.set(URI, null);
        expect(edit.operations().map((op) => op.kind)).toEqual(["create"]);
    });

    it("WorkspaceEdit: ignoreIfExists is kept separately from overwrite", () => {
        const other = Uri.file("/proj/other.ts");
        const edit = new WorkspaceEdit();
        edit.createFile(other, { ignoreIfExists: true });
        edit.renameFile(URI, other, { ignoreIfExists: true });

        const create = edit.operations()[0];
        expect(create.kind === "create" && create.options).toEqual({ ignoreIfExists: true });
        const rename = edit.operations()[1];
        expect(rename.kind === "rename" && rename.options).toEqual({ ignoreIfExists: true });
    });

    it("WorkspaceEdit: operation order is kept verbatim (create → write)", () => {
        const created = Uri.file("/proj/created.ts");
        const edit = new WorkspaceEdit();
        edit.createFile(created, { contents: new TextEncoder().encode("seed") });
        edit.insert(created, new Position(0, 4), "!");
        edit.renameFile(URI, created, { overwrite: true });

        edit.deleteFile(created);
        expect(edit.operations().map((op) => op.kind)).toEqual(["create", "text", "rename", "delete"]);
        const create = edit.operations()[0];
        expect(create.kind === "create" && create.options.contents).toBe("seed");
        const rename = edit.operations()[2];
        expect(rename.kind === "rename" && rename.options.overwrite).toBe(true);
    });

    it("SnippetTextEdit: constructor and static replace/insert (converter trap class)", () => {
        const snippet = new SnippetString("s");
        const direct = new SnippetTextEdit(RANGE, snippet);
        expect(direct.range).toBe(RANGE);
        expect(direct.snippet).toBe(snippet);

        expect(SnippetTextEdit.replace(RANGE, snippet).range).toBe(RANGE);
        const inserted = SnippetTextEdit.insert(new Position(1, 2), snippet);
        expect(inserted.range.isEmpty).toBe(true);
        expect(inserted.range.start).toEqual(new Position(1, 2));
        expect(inserted.snippet).toBe(snippet);
    });

    it("CompletionList: items/isIncomplete as is, defaults are an empty complete list", () => {
        const item = new CompletionItem("greet");
        const list = new CompletionList([item], true);
        expect(list.items).toEqual([item]);
        expect(list.isIncomplete).toBe(true);

        const empty = new CompletionList();
        expect(empty.items).toEqual([]);
        expect(empty.isIncomplete).toBe(false);
    });

    it("SnippetString: stores the value, appendText concatenates and returns this", () => {
        const snippet = new SnippetString("foo(");
        expect(snippet.appendText("$1)")).toBe(snippet);
        expect(snippet.value).toBe("foo($1)");
        expect(new SnippetString().value).toBe("");
    });

    it("enums match VS Code numeric values", () => {
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

    describe("DocumentSymbol — per upstream", () => {
        const full = new Range(0, 0, 4, 1);
        const name = new Range(0, 5, 0, 10);

        it("carries what is passed, no children", () => {
            const symbol = new DocumentSymbol("TestA", "func()", SymbolKind.Function, full, name);
            expect(symbol).toMatchObject({
                name: "TestA",
                detail: "func()",
                kind: 11,
                range: full,
                selectionRange: name,
            });
            expect(symbol.children).toEqual([]);
            expect(symbol.tags).toBeUndefined();
        });

        it("empty name and selectionRange outside range — upstream errors", () => {
            expect(() => new DocumentSymbol("", "", SymbolKind.Function, full, name)).toThrow("name must not be falsy");
            expect(() => new DocumentSymbol("f", "", SymbolKind.Function, name, full)).toThrow(
                "selectionRange must be contained in fullRange",
            );
        });

        it("validate walks the children; overwritten children do not interfere", () => {
            const parent = new DocumentSymbol("p", "", SymbolKind.Module, full, name);
            const child = new DocumentSymbol("c", "", SymbolKind.Function, full, name);
            parent.children.push(child);
            child.name = "";
            expect(() => {
                DocumentSymbol.validate(parent);
            }).toThrow("name must not be falsy");
            (parent as { children: unknown }).children = undefined;
            expect(() => {
                DocumentSymbol.validate(parent);
            }).not.toThrow();
        });
    });
});
