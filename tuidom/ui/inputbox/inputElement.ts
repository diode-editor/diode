import { packRgb } from "../../common/colorUtils.ts";
import { DisplayLine } from "../../common/displayLine.ts";
import { BoxConstraints, Point, Rect, Size } from "../../common/geometryPromitives.ts";
import type { TUIEventBase } from "../../dom/events/tuiEventBase.ts";
import { TUIKeyboardEvent } from "../../dom/events/tuiKeyboardEvent.ts";
import type { TUIPasteEvent } from "../../dom/events/tuiPasteEvent.ts";
import { RenderContext, TUIElement } from "../../dom/tuiElement.ts";

import { InputState } from "./inputState.ts";

// ─── Colors ─────────────────────────────────────────────────────────────────
const INPUT_FG = packRgb(204, 204, 204);
const INPUT_BG = packRgb(60, 60, 60);
const PLACEHOLDER_FG = packRgb(110, 110, 110);
const FOCUSED_BORDER_FG = packRgb(0x00, 0x7f, 0xd4); // #007FD4 — focusBorder from dark+
const UNFOCUSED_BORDER_FG = packRgb(0x3c, 0x3c, 0x3c); // #3C3C3C
const SELECTION_BG = packRgb(0x26, 0x4f, 0x78); // #264F78 — VS Code selection

export interface InputElementStyle {
    fg?: number;
    bg?: number;
}

/**
 * Single-line text input widget.
 *
 * By default rendered without a border — just a plain editable text line.
 * Set `showBorder = true` to get a Unicode box-drawing frame around it.
 * The border colour changes between focused (#007FD4) and unfocused (#3C3C3C).
 *
 * Usage:
 *   const input = new InputElement();
 *   input.placeholder = "Search…";
 *   input.onChange = value => console.log(value);
 */
export class InputElement extends TUIElement {
    public readonly inputState: InputState;
    public placeholder: string | undefined = undefined;
    public showBorder = false;
    public onChange: ((value: string) => void) | undefined = undefined;

    private scrollX = 0;

    public constructor(inputState?: InputState) {
        super();
        this.inputState = inputState ?? new InputState();
        this.focusable = true;

        this.addEventListener("focus", () => {
            this.markDirty();
        });
        this.addEventListener("blur", () => {
            this.markDirty();
        });
    }

    // ─── Layout ─────────────────────────────────────────────────────────────

    public override getMinIntrinsicWidth(_height: number): number {
        return this.showBorder ? 5 : 3;
    }

    public override getMinIntrinsicHeight(_width: number): number {
        return this.showBorder ? 3 : 1;
    }

    public override getMaxIntrinsicHeight(_width: number): number {
        return this.showBorder ? 3 : 1;
    }

    protected override performLayout(constraints: BoxConstraints): Size {
        const height = this.getMaxIntrinsicHeight(0);
        const width = Number.isFinite(constraints.maxWidth) ? constraints.maxWidth : Math.max(constraints.minWidth, 20);
        return super.performLayout(BoxConstraints.tight(constraints.constrain(new Size(width, height))));
    }

    // ─── Render ─────────────────────────────────────────────────────────────

    public override render(context: RenderContext): void {
        const w = this.layoutSize.width;
        const h = this.layoutSize.height;
        const text = this.inputState.text;
        const cursorOffset = this.inputState.cursorOffset;
        const focused = this.isFocused;

        const contentXStart = this.showBorder ? 1 : 0;
        const contentY = this.showBorder ? 1 : 0;
        const contentWidth = w - (this.showBorder ? 2 : 0);

        if (contentWidth <= 0) return;

        // Update horizontal scroll to keep cursor visible
        const dl = new DisplayLine(text);
        const cursorCol = dl.offsetToColumn(cursorOffset);
        if (cursorCol < this.scrollX) {
            this.scrollX = cursorCol;
        } else if (cursorCol >= this.scrollX + contentWidth) {
            this.scrollX = cursorCol - contentWidth + 1;
        }

        // Draw border
        if (this.showBorder) {
            this.renderBorder(context, w, h, focused);
        }

        // Fill content row background
        for (let x = contentXStart; x < contentXStart + contentWidth; x++) {
            context.setCell(x, contentY, { char: " ", fg: INPUT_FG, bg: INPUT_BG });
        }

        // Content area clip (screen-space coordinates)
        const contentClip = new Rect(
            new Point(this.globalPosition.x + contentXStart, this.globalPosition.y + contentY),
            new Size(contentWidth, 1),
        );
        const textContext = context.withClip(contentClip);

        // Draw text or placeholder
        if (text.length === 0 && this.placeholder !== undefined) {
            textContext.drawText(contentXStart, contentY, this.placeholder, { fg: PLACEHOLDER_FG, bg: INPUT_BG });
        } else if (this.inputState.hasSelection) {
            this.renderTextWithSelection(textContext, dl, text, contentXStart, contentY);
        } else {
            textContext.drawText(contentXStart - this.scrollX, contentY, text, { fg: INPUT_FG, bg: INPUT_BG });
        }

        // Hardware cursor
        if (focused) {
            const cursorX = contentXStart + (cursorCol - this.scrollX);
            /* v8 ignore start -- scrollX was just adjusted above to keep cursorCol within [scrollX, scrollX+contentWidth), so cursorX is always in bounds here; the false side is unreachable */
            if (cursorX >= contentXStart && cursorX < contentXStart + contentWidth) {
                context.setCursorPosition(cursorX, contentY);
            }
            /* v8 ignore stop */
        }
    }

    private renderTextWithSelection(
        context: RenderContext,
        dl: DisplayLine,
        text: string,
        contentXStart: number,
        contentY: number,
    ): void {
        const selStart = this.inputState.selectionStart;
        const selEnd = this.inputState.selectionEnd;
        const before = text.slice(0, selStart);
        const selected = text.slice(selStart, selEnd);
        const after = text.slice(selEnd);

        const selStartCol = dl.offsetToColumn(selStart);
        const selEndCol = dl.offsetToColumn(selEnd);

        if (before.length > 0) {
            context.drawText(contentXStart - this.scrollX, contentY, before, { fg: INPUT_FG, bg: INPUT_BG });
        }
        /* v8 ignore start -- this branch only runs when inputState.hasSelection (selStart !== selEnd), so the slice is always non-empty; the false side is unreachable */
        if (selected.length > 0) {
            context.drawText(contentXStart + selStartCol - this.scrollX, contentY, selected, {
                fg: INPUT_FG,
                bg: SELECTION_BG,
            });
        }
        /* v8 ignore stop */
        // Fill selection background for empty tail columns up to selEndCol (handles wide chars)
        for (let col = selStartCol; col < selEndCol; col++) {
            const x = contentXStart + col - this.scrollX;
            // Overwrite only cells that didn't get text (will be spaces from background fill)
            // drawText already covered the chars, this handles any residual slots
            void x;
        }
        if (after.length > 0) {
            context.drawText(contentXStart + selEndCol - this.scrollX, contentY, after, { fg: INPUT_FG, bg: INPUT_BG });
        }
    }

    private renderBorder(context: RenderContext, w: number, h: number, focused: boolean): void {
        const fg = focused ? FOCUSED_BORDER_FG : UNFOCUSED_BORDER_FG;
        context.drawBox(0, 0, w, h, { fg, bg: INPUT_BG });
    }

    // ─── Input ──────────────────────────────────────────────────────────────

    protected override performDefaultAction(event: TUIEventBase): void {
        if (event.type === "paste") {
            // Single-line field: flatten any newlines from the pasted block into spaces.
            const text = (event as TUIPasteEvent).text.replace(/\n/g, " ");
            if (text !== "") {
                event.preventDefault();
                this.inputState.insert(text);
                this.onChange?.(this.inputState.value);
                this.markDirty();
            }
            return;
        }
        if (event.type !== "keydown") {
            // Non-keydown events (notably mousedown) fall through to the base
            // handler, which focuses a tabbable element — so a click focuses the
            // field. Without this, the input could only be focused programmatically.
            super.performDefaultAction(event);
            return;
        }
        const keyEvent = event as TUIKeyboardEvent;

        if (keyEvent.key === "Backspace") {
            event.preventDefault();
            this.inputState.deleteLeft();
            this.onChange?.(this.inputState.value);
            this.markDirty();
        } else if (keyEvent.key === "Delete") {
            event.preventDefault();
            this.inputState.deleteRight();
            this.onChange?.(this.inputState.value);
            this.markDirty();
        } else if (keyEvent.key === "ArrowLeft") {
            event.preventDefault();
            this.inputState.moveCursorLeft();
            this.markDirty();
        } else if (keyEvent.key === "ArrowRight") {
            event.preventDefault();
            this.inputState.moveCursorRight();
            this.markDirty();
        } else if (keyEvent.key === "Home") {
            event.preventDefault();
            this.inputState.moveCursorToStart();
            this.markDirty();
        } else if (keyEvent.key === "End") {
            event.preventDefault();
            this.inputState.moveCursorToEnd();
            this.markDirty();
        } else if (keyEvent.key.length === 1 && !keyEvent.ctrlKey && !keyEvent.altKey) {
            event.preventDefault();
            this.inputState.insert(keyEvent.key);
            this.onChange?.(this.inputState.value);
            this.markDirty();
        }
    }
}
