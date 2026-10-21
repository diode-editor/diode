import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";

import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";

export const InputWidgetServiceDIToken = token<InputWidgetService>("InputWidgetService");

/**
 * Has no keys of its own (`inputWidgetFocus` is central), but picks up the active input in the same
 * IContextKeyContributor poll — before each binding is resolved and on focus change.
 */
export class InputWidgetService implements IContextKeyContributor {
    public static dependencies = [] as const;

    private activeInput: InputElement | null = null;

    public setActive(input: InputElement | null): void {
        this.activeInput = input;
    }

    public updateContextKeys(_contextKeys: unknown, active: TUIElement | null): void {
        this.setActive(active instanceof InputElement ? active : null);
    }

    public cursorLeft(): void {
        this.activeInput?.inputState.moveCursorLeft();
        this.activeInput?.markDirty();
    }

    public cursorRight(): void {
        this.activeInput?.inputState.moveCursorRight();
        this.activeInput?.markDirty();
    }

    public cursorHome(): void {
        this.activeInput?.inputState.moveCursorToStart();
        this.activeInput?.markDirty();
    }

    public cursorEnd(): void {
        this.activeInput?.inputState.moveCursorToEnd();
        this.activeInput?.markDirty();
    }

    public cursorWordLeft(): void {
        this.activeInput?.inputState.moveCursorWordLeft();
        this.activeInput?.markDirty();
    }

    public cursorWordRight(): void {
        this.activeInput?.inputState.moveCursorWordRight();
        this.activeInput?.markDirty();
    }

    public deleteLeft(): void {
        if (!this.activeInput) return;
        this.activeInput.inputState.deleteLeft();
        this.activeInput.onChange?.(this.activeInput.inputState.value);
        this.activeInput.markDirty();
    }

    public deleteRight(): void {
        if (!this.activeInput) return;
        this.activeInput.inputState.deleteRight();
        this.activeInput.onChange?.(this.activeInput.inputState.value);
        this.activeInput.markDirty();
    }

    public deleteWordLeft(): void {
        if (!this.activeInput) return;
        this.activeInput.inputState.deleteWordLeft();
        this.activeInput.onChange?.(this.activeInput.inputState.value);
        this.activeInput.markDirty();
    }

    public deleteWordRight(): void {
        if (!this.activeInput) return;
        this.activeInput.inputState.deleteWordRight();
        this.activeInput.onChange?.(this.activeInput.inputState.value);
        this.activeInput.markDirty();
    }

    public undo(): void {
        if (!this.activeInput) return;
        this.activeInput.inputState.undo();
        this.activeInput.onChange?.(this.activeInput.inputState.value);
        this.activeInput.markDirty();
    }

    public redo(): void {
        if (!this.activeInput) return;
        this.activeInput.inputState.redo();
        this.activeInput.onChange?.(this.activeInput.inputState.value);
        this.activeInput.markDirty();
    }

    public selectLeft(): void {
        this.activeInput?.inputState.selectLeft();
        this.activeInput?.markDirty();
    }

    public selectRight(): void {
        this.activeInput?.inputState.selectRight();
        this.activeInput?.markDirty();
    }

    public selectToHome(): void {
        this.activeInput?.inputState.selectToStart();
        this.activeInput?.markDirty();
    }

    public selectToEnd(): void {
        this.activeInput?.inputState.selectToEnd();
        this.activeInput?.markDirty();
    }

    public selectWordLeft(): void {
        this.activeInput?.inputState.selectWordLeft();
        this.activeInput?.markDirty();
    }

    public selectWordRight(): void {
        this.activeInput?.inputState.selectWordRight();
        this.activeInput?.markDirty();
    }

    public selectAll(): void {
        this.activeInput?.inputState.selectAll();
        this.activeInput?.markDirty();
    }

    public async copy(clipboard: IClipboard): Promise<void> {
        const input = this.activeInput;
        if (!input) return;
        const text = input.inputState.selectedText;
        if (text !== "") {
            await clipboard.writeText(text);
        }
    }

    public async cut(clipboard: IClipboard): Promise<void> {
        const input = this.activeInput;
        if (!input) return;
        const text = input.inputState.selectedText;
        if (text === "") return;
        await clipboard.writeText(text);
        // Focus may have moved (or the overlay closed) during the async clipboard write —
        // don't mutate an input the user is no longer editing.
        if (this.activeInput !== input) return;
        input.inputState.deleteLeft();
        input.onChange?.(input.inputState.value);
        input.markDirty();
    }

    public async paste(clipboard: IClipboard): Promise<void> {
        const input = this.activeInput;
        if (!input) return;
        const text = await clipboard.readText();
        // readText resolves immediately, but it's still async — bail defensively if focus
        // changed while the microtask was queued.
        if (text === "" || this.activeInput !== input) return;
        input.inputState.insert(text);
        input.onChange?.(input.inputState.value);
        input.markDirty();
    }
}
