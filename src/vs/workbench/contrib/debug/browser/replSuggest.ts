// The completion of the Debug Console's input: upstream's `Repl` registers a completion provider for its input editor
// (DAP `completions` plus the history, `debug.console.historySuggestions`) and the editor's suggest widget shows it.
// The input here is a plain field, so this is the provider and a small widget in one: the popup of the editor's
// suggestions (`CompletionListElement`) over the cursor, opened as upstream's quick suggestions open — on typing — and
// by Ctrl+Space; Up/Down/PageUp/PageDown pick, Tab accepts, Escape closes, Enter accepts with
// `debug.console.acceptSuggestionOnEnter` on. Upstream's provider exists only for a session that supports `completions`;
// so does the popup. Deviations: an item's range is its `length` before the cursor, as upstream's, and it is filtered by
// the text in it with a case-insensitive "contains" (the editor's fuzzy score is not here); `selectionStart` puts the
// cursor there instead of a snippet's selection; no details pane.

import { DisplayLine } from "@tuidom/core/common/displayLine";
import type { OverlayLayer } from "@tuidom/core/dom/overlayLayer";
import { CompletionListElement, type CompletionListItem } from "@tuidom/elements/completionlist/completionListElement";
import type { InputElement } from "@tuidom/elements/inputbox/inputElement";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import { Position } from "../../../../editor/common/core/position.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import type { IDebugSession } from "../common/debug.ts";

/** The extension API's `CompletionItemKind` the popup draws icons by, for DAP's `CompletionItemType`. */
const KIND_OF: Readonly<Record<string, number>> = {
    method: 1,
    function: 2,
    constructor: 3,
    field: 4,
    variable: 5,
    class: 6,
    interface: 7,
    module: 8,
    property: 9,
    unit: 10,
    value: 11,
    enum: 12,
    keyword: 13,
    snippet: 14,
    text: 0,
    color: 15,
    file: 16,
    reference: 17,
    customcolor: 15,
};
const KIND_PROPERTY = 9;
const KIND_TEXT = 0;

interface IReplSuggestion {
    /** Code units before the cursor the insertion replaces. */
    readonly replace: number;
    readonly insertText: string;
    /** Where the cursor goes in the inserted text; its end when absent. */
    readonly cursor: number | undefined;
}

/** What the input's completion asks of the console. */
export interface IReplSuggestHost {
    /** The session whose console is shown, if any: an ended one has no capabilities. */
    session(): IDebugSession | undefined;
    /** The focused stack frame's ids, upstream's `frameId` and `threadId` of the request. */
    frame(): { readonly frameId: number | undefined; readonly threadId: number };
    /** The history, oldest first. */
    history(): readonly string[];
    historySuggestions(): boolean;
    acceptOnEnter(): boolean;
}

export class ReplSuggest extends Disposable {
    public readonly list = new CompletionListElement();
    private overlay: CaretAnchoredOverlay | undefined;
    private request: CancellationTokenSource | undefined;

    public constructor(
        private readonly input: InputElement,
        private readonly host: IReplSuggestHost,
        private readonly overlayHost: () => { readonly overlayLayer: OverlayLayer },
    ) {
        super();
        this.list.id = "replSuggest";
        this.list.onAccept = (item) => {
            this.accept(item);
        };
        this.register({
            dispose: () => {
                this.request?.cancel();
            },
        });
    }

    public get isOpen(): boolean {
        return this.overlay?.isOpen() === true;
    }

    /**
     * The input's keys while the popup is open: true when the key was the popup's. Enter is the popup's only with
     * `acceptSuggestionOnEnter`; otherwise it closes the popup and goes on to evaluate, as upstream's accept action
     * cancels the suggest widget.
     */
    public handleKey(key: string): boolean {
        if (!this.isOpen) return false;
        switch (key) {
            case "ArrowDown":
                this.list.selectNext();
                return true;
            case "ArrowUp":
                this.list.selectPrevious();
                return true;
            case "PageDown":
                this.list.selectNextPage();
                return true;
            case "PageUp":
                this.list.selectPreviousPage();
                return true;
            case "Tab":
                this.acceptSelected();
                return true;
            case "Escape":
                this.close();
                return true;
            case "Enter":
                if (this.host.acceptOnEnter()) {
                    this.acceptSelected();
                    return true;
                }
                this.close();
                return false;
            default:
                return false;
        }
    }

    /** Asks for the suggestions at the cursor and shows them; `explicit` (Ctrl+Space) shows them for an empty input too. */
    public trigger(explicit: boolean): void {
        const session = this.host.session();
        const text = this.input.inputState.value;
        if (session?.capabilities.supportsCompletionsRequest !== true || (!explicit && text.trim() === "")) {
            this.close();
            return;
        }
        this.request?.cancel();
        const request = new CancellationTokenSource();
        this.request = request;
        const cursor = this.input.inputState.cursorOffset;
        this.provide(session, text, cursor, request).then((items) => {
            if (request.token.isCancellationRequested) return;
            this.show(items);
        }, onUnexpectedError);
    }

    public close(): void {
        this.request?.cancel();
        this.request = undefined;
        this.overlay?.close();
    }

    /** Upstream's provider: the adapter's targets, then the history (most recent first, after the targets). */
    private async provide(
        session: IDebugSession,
        text: string,
        cursor: number,
        request: CancellationTokenSource,
    ): Promise<CompletionListItem[]> {
        const before = text.slice(0, cursor);
        const position = new Position(before.split("\n").length, before.length - before.lastIndexOf("\n"));
        const { frameId, threadId } = this.host.frame();
        const response = await session.completions(frameId, threadId, text, position, request.token);
        const items: CompletionListItem[] = [];
        // The editor sorts by the lower-cased `sortText` (its `sortTextLow`): the history's `ZZZ` goes last.
        const add = (
            label: string,
            detail: string | undefined,
            kind: number,
            suggestion: IReplSuggestion,
            sortText: string,
        ): void => {
            const word = before.slice(Math.max(0, cursor - suggestion.replace)).toLowerCase();
            if (!label.toLowerCase().includes(word)) return;
            items.push({
                label,
                kind,
                data: suggestion,
                sortText: sortText.toLowerCase(),
                ...(detail === undefined ? {} : { detail }),
            });
        };
        if (response !== undefined) {
            for (const target of response.body.targets) {
                if (!target.label) continue;
                const insertText = target.text ?? target.label;
                add(
                    target.label,
                    target.detail,
                    // No type, or one DAP does not know: a property, as upstream's default.
                    KIND_OF[String(target.type)] ?? KIND_PROPERTY,
                    {
                        replace: target.length ?? 0,
                        insertText,
                        cursor: target.selectionStart,
                    },
                    target.sortText ?? target.label,
                );
            }
        }
        if (this.host.historySuggestions()) {
            const history = this.host.history();
            const idxLength = String(history.length).length;
            history.forEach((entry, i) => {
                const sortText = `ZZZ${String(history.length - i).padStart(idxLength, "0")}`;
                add(
                    entry,
                    undefined,
                    KIND_TEXT,
                    { replace: entry.length, insertText: entry, cursor: undefined },
                    sortText,
                );
            });
        }
        return items;
    }

    private show(items: readonly CompletionListItem[]): void {
        if (items.length === 0) {
            this.close();
            return;
        }
        this.list.setItems(items);
        this.overlay ??= this.register(new CaretAnchoredOverlay(this.overlayHost(), this.list));
        this.overlay.openAt(this.caret(), "aboveElseBelow");
    }

    /** The screen cell of the input's cursor: the field's scroll is its own, so a long line is clamped to the field. */
    private caret(): { screenX: number; screenY: number } {
        const state = this.input.inputState;
        const lineStart = state.value.lastIndexOf("\n", state.cursorOffset - 1) + 1;
        const column = new DisplayLine(state.value.slice(lineStart, state.cursorOffset)).displayWidth;
        const { x, y } = this.input.globalPosition;
        return {
            screenX: x + Math.min(column, Math.max(0, this.input.layoutSize.width - 1)),
            screenY: y + Math.min(this.input.cursorLine, Math.max(0, this.input.layoutSize.height - 1)),
        };
    }

    private acceptSelected(): void {
        // The popup is open only with items, one of them selected.
        this.accept(this.list.items[this.list.selectedIndex]);
    }

    private accept(item: CompletionListItem): void {
        const suggestion = item.data as IReplSuggestion;
        const state = this.input.inputState;
        const cursor = state.cursorOffset;
        const start = Math.max(0, cursor - suggestion.replace);
        const value = state.value;
        state.value = value.slice(0, start) + suggestion.insertText + value.slice(cursor);
        state.moveCursorTo(start + (suggestion.cursor ?? suggestion.insertText.length));
        // Stryker disable next-line CallExpression: the popup is open here, and closing it repaints the field too
        this.input.markDirty();
        this.close();
    }
}
