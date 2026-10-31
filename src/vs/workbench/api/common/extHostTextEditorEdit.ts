import type * as vscode from "vscode";

import { Position, Range } from "./vscodeTypes.ts";
import type { IWireApplyEditParams, IWireEditorEdit } from "./wireTypes.ts";

/** Upstream `TextEditorEdit` (`extHostTextEditor.ts`): valid only while the callback of `TextEditor.edit` runs. */
export class TextEditorEdit implements vscode.TextEditorEdit {
    private readonly collected: { readonly range: vscode.Range; readonly text: string }[] = [];
    private eol: 1 | 2 | undefined;
    private finalized = false;

    public constructor(private readonly document: vscode.TextDocument) {}

    public finalize(): {
        readonly edits: readonly IWireEditorEdit[];
        readonly setEndOfLine: 1 | 2 | undefined;
    } | null {
        this.finalized = true;
        // Upstream sorts by end, then by start, and compares neighbours.
        const ranges = this.collected.map((edit) => edit.range);
        ranges.sort((a, b) => a.end.compareTo(b.end) || a.start.compareTo(b.start));
        for (let i = 0; i < ranges.length - 1; i++) {
            if (ranges[i + 1].start.isBefore(ranges[i].end)) return null;
        }
        return {
            edits: this.collected.map(({ range, text }) => ({
                range: {
                    start: { line: range.start.line, character: range.start.character },
                    end: { line: range.end.line, character: range.end.character },
                },
                text,
            })),
            setEndOfLine: this.eol,
        };
    }

    public replace(location: vscode.Position | vscode.Range | vscode.Selection, value: string): void {
        this.throwIfFinalized();
        if (location instanceof Position) this.push(new Range(location, location), value);
        else if (location instanceof Range) this.push(location, value);
        else throw new Error("Unrecognized location");
    }

    public insert(location: vscode.Position, value: string): void {
        this.throwIfFinalized();
        this.push(new Range(location, location), value);
    }

    public delete(location: vscode.Range | vscode.Selection): void {
        this.throwIfFinalized();
        if (!(location instanceof Range)) throw new Error("Unrecognized location");
        this.push(location, "");
    }

    public setEndOfLine(endOfLine: vscode.EndOfLine): void {
        this.throwIfFinalized();
        // From an extension's JS: the type is no guarantee.
        const value: number = endOfLine;
        if (value !== 1 && value !== 2) throw new Error("Illegal argument: endOfLine");
        this.eol = value;
    }

    private push(range: vscode.Range, text: string): void {
        this.collected.push({ range: this.document.validateRange(range), text });
    }

    private throwIfFinalized(): void {
        if (this.finalized) throw new Error("Edit is only valid while callback runs");
    }
}

/** Upstream `ExtHostTextEditor.edit` + `_applyEdit`. By the time the reply arrives the mirror is updated: the host sends `didChange` first. */
export function applyTextEditorEdit(
    document: vscode.TextDocument,
    isClosed: boolean,
    callback: (editBuilder: vscode.TextEditorEdit) => void,
    options: { undoStopBefore?: boolean; undoStopAfter?: boolean } | undefined,
    send: (params: IWireApplyEditParams) => Thenable<boolean>,
): Thenable<boolean> {
    if (isClosed) return Promise.reject(new Error("TextEditor#edit not possible on closed editors"));
    const builder = new TextEditorEdit(document);
    callback(builder);
    const data = builder.finalize();
    if (data === null) return Promise.reject(new Error("Overlapping ranges are not allowed!"));
    if (data.edits.length === 0 && data.setEndOfLine === undefined) return Promise.resolve(true);
    return send({
        uri: document.uri.toString(),
        edits: data.edits,
        version: document.version,
        ...(data.setEndOfLine === undefined ? {} : { setEndOfLine: data.setEndOfLine }),
        ...(options?.undoStopBefore === false ? { undoStopBefore: false } : {}),
        ...(options?.undoStopAfter === false ? { undoStopAfter: false } : {}),
    });
}
