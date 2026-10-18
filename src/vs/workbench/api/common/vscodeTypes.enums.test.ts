import { describe, expect, it } from "vitest";

import {
    CompletionItem,
    CompletionItemKind,
    DecorationRangeBehavior,
    EndOfLine,
    FileDecoration,
    FileType,
    FoldingRange,
    FoldingRangeKind,
    IndentAction,
    NotebookCellKind,
    OverviewRulerLane,
    QuickPickItemKind,
    SyntaxTokenType,
    TextDocumentSaveReason,
    ThemeColor,
} from "./vscodeTypes.ts";

describe("VscodeTypes — enums", () => {
    it("EndOfLine", () => {
        expect(EndOfLine.LF).toBe(1);
        expect(EndOfLine.CRLF).toBe(2);
    });

    it("TextDocumentSaveReason", () => {
        expect(TextDocumentSaveReason.Manual).toBe(1);
        expect(TextDocumentSaveReason.AfterDelay).toBe(2);
        expect(TextDocumentSaveReason.FocusOut).toBe(3);
    });

    it("FileType", () => {
        expect(FileType.Unknown).toBe(0);
        expect(FileType.File).toBe(1);
        expect(FileType.Directory).toBe(2);
        expect(FileType.SymbolicLink).toBe(64);
    });

    it("CompletionItemKind spot-check", () => {
        expect(CompletionItemKind.Text).toBe(0);
        expect(CompletionItemKind.Property).toBe(9);
        expect(CompletionItemKind.Issue).toBe(26);
    });

    it("FoldingRangeKind", () => {
        expect(FoldingRangeKind.Comment).toBe(1);
        expect(FoldingRangeKind.Imports).toBe(2);
        expect(FoldingRangeKind.Region).toBe(3);
    });

    it("FoldingRange хранит start/end/kind", () => {
        const withKind = new FoldingRange(0, 3, FoldingRangeKind.Region);
        expect(withKind.start).toBe(0);
        expect(withKind.end).toBe(3);
        expect(withKind.kind).toBe(FoldingRangeKind.Region);
        expect(new FoldingRange(5, 9).kind).toBeUndefined();
    });
});

describe("VscodeTypes — CompletionItem", () => {
    it("конструктор задаёт label и kind", () => {
        const item = new CompletionItem("indent_size", CompletionItemKind.Property);
        expect(item.label).toBe("indent_size");
        expect(item.kind).toBe(CompletionItemKind.Property);
        expect(item.insertText).toBeUndefined();
    });
});

describe("VscodeTypes — decoration value-types (Chunk 4)", () => {
    it("OverviewRulerLane", () => {
        expect(OverviewRulerLane.Left).toBe(1);
        expect(OverviewRulerLane.Center).toBe(2);
        expect(OverviewRulerLane.Right).toBe(4);
        expect(OverviewRulerLane.Full).toBe(7);
    });

    it("DecorationRangeBehavior", () => {
        expect(DecorationRangeBehavior.OpenOpen).toBe(0);
        expect(DecorationRangeBehavior.ClosedClosed).toBe(1);
        expect(DecorationRangeBehavior.OpenClosed).toBe(2);
        expect(DecorationRangeBehavior.ClosedOpen).toBe(3);
    });

    it("ThemeColor хранит id", () => {
        expect(new ThemeColor("editorGutter.modifiedBackground").id).toBe("editorGutter.modifiedBackground");
    });

    it("FileDecoration: конструктор задаёт badge/tooltip/color, propagate по умолчанию undefined", () => {
        const color = new ThemeColor("gitDecoration.modifiedResourceForeground");
        const decoration = new FileDecoration("M", "Modified", color);
        expect(decoration.badge).toBe("M");
        expect(decoration.tooltip).toBe("Modified");
        expect(decoration.color).toBe(color);
        expect(decoration.propagate).toBeUndefined();

        const bare = new FileDecoration();
        expect(bare.badge).toBeUndefined();
        expect(bare.color).toBeUndefined();
    });

    it("IndentAction, SyntaxTokenType, QuickPickItemKind, NotebookCellKind — значения эталона", () => {
        expect([IndentAction.None, IndentAction.Indent, IndentAction.IndentOutdent, IndentAction.Outdent]).toEqual([
            0, 1, 2, 3,
        ]);
        expect([SyntaxTokenType.Other, SyntaxTokenType.Comment, SyntaxTokenType.String, SyntaxTokenType.RegEx]).toEqual(
            [0, 1, 2, 3],
        );
        expect([QuickPickItemKind.Separator, QuickPickItemKind.Default]).toEqual([-1, 0]);
        expect([NotebookCellKind.Markup, NotebookCellKind.Code]).toEqual([1, 2]);
    });
});
