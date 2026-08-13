import type { StoryContext, StoryMeta } from "../StoryTypes.ts";
import { registerAction } from "../../vs/platform/actions/common/commandAction.ts";
import { InMemoryClipboard } from "../../vs/platform/clipboard/common/inMemoryClipboard.ts";
import { CommandRegistry } from "../../vs/platform/commands/common/commandRegistry.ts";
import { ContextKeyService } from "../../vs/platform/contextkey/common/contextKeyService.ts";
import type { Token } from "../../vs/platform/instantiation/common/diContainer.ts";
import type { ServiceAccessor } from "../../vs/platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../vs/platform/keybinding/common/keybindingRegistry.ts";
import {
    inputCopyAction,
    inputCursorEndAction,
    inputCursorHomeAction,
    inputCursorLeftAction,
    inputCursorRightAction,
    inputCursorWordLeftAction,
    inputCursorWordRightAction,
    inputCutAction,
    inputDeleteLeftAction,
    inputDeleteRightAction,
    inputDeleteWordLeftAction,
    inputDeleteWordRightAction,
    inputPasteAction,
    inputSelectAllAction,
    inputSelectLeftAction,
    inputSelectRightAction,
    inputSelectToEndAction,
    inputSelectToHomeAction,
    inputSelectWordLeftAction,
    inputSelectWordRightAction,
} from "../../vs/workbench/browser/actions/inputActions.ts";
import { ClipboardDIToken } from "../../vs/workbench/common/coreTokens.ts";
import {
    InputWidgetService,
    InputWidgetServiceDIToken,
} from "../../vs/workbench/contrib/files/browser/inputWidgetService.ts";
import type { TUIKeyboardEvent } from "@tuidom/all/dom/events/tuiKeyboardEvent";
import { VStackElement } from "@tuidom/all/ui/layout/vStackElement";

import { InputElement } from "@tuidom/all/ui/inputbox/inputElement";

/** Wires up a minimal keybinding stack for a single InputElement. */
function mountInputKeybindings(ctx: StoryContext, input: InputElement): void {
    const commands = new CommandRegistry();
    const keybindings = new KeybindingRegistry();
    const contextKeys = new ContextKeyService();
    const inputCtrl = new InputWidgetService();
    const clipboard = new InMemoryClipboard();

    const accessor: ServiceAccessor = {
        get<T>(tok: Token<T>): T {
            if (tok === InputWidgetServiceDIToken) return inputCtrl as T;
            if (tok === ClipboardDIToken) return clipboard as T;
            throw new Error(`Unknown token: ${tok.id}`);
        },
    };

    const inputActions = [
        inputCursorLeftAction,
        inputCursorRightAction,
        inputCursorHomeAction,
        inputCursorEndAction,
        inputCursorWordLeftAction,
        inputCursorWordRightAction,
        inputDeleteLeftAction,
        inputDeleteRightAction,
        inputDeleteWordLeftAction,
        inputDeleteWordRightAction,
        inputSelectLeftAction,
        inputSelectRightAction,
        inputSelectToHomeAction,
        inputSelectToEndAction,
        inputSelectWordLeftAction,
        inputSelectWordRightAction,
        inputSelectAllAction,
        inputCopyAction,
        inputCutAction,
        inputPasteAction,
    ];
    for (const action of inputActions) {
        registerAction(commands, keybindings, accessor, action);
    }

    function updateContext(): void {
        const active = ctx.body.focusManager?.activeElement ?? null;
        const isInput = active instanceof InputElement;
        contextKeys.set("inputWidgetFocus", isInput);
        inputCtrl.setActive(isInput ? active : null);
    }

    ctx.body.addEventListener("focus", updateContext, { capture: true });
    ctx.body.addEventListener("blur", updateContext, { capture: true });

    ctx.body.addEventListener("keydown", (e: TUIKeyboardEvent) => {
        const res = keybindings.resolveKey(e, contextKeys);
        if (res.kind === "chord") {
            e.preventDefault();
            return;
        }
        if (res.kind === "command" && commands.has(res.commandId)) {
            e.preventDefault();
            commands.execute(res.commandId);
        }
    });
}

export const meta: StoryMeta = {
    title: "InputElement",
};

/** Plain input without border. Type text, use arrow keys, Backspace. */
export function basicInput(ctx: StoryContext): void {
    ctx.body.title = "InputElement — basic (no border)";
    const input = new InputElement();
    ctx.body.setContent(input);

    ctx.afterRun(() => {
        input.focus();
    });
}

/** Input with Unicode box-drawing border. Border colour changes on focus. */
export function withBorder(ctx: StoryContext): void {
    ctx.body.title = "InputElement — showBorder = true";
    const input = new InputElement();
    input.showBorder = true;

    const stack = new VStackElement();
    stack.addChild(input, { width: "fill", height: 3 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        input.focus();
    });
}

/** Input with placeholder text shown when empty. */
export function withPlaceholder(ctx: StoryContext): void {
    ctx.body.title = "InputElement — placeholder";
    const input = new InputElement();
    input.placeholder = "Type to search…";

    ctx.body.setContent(input);

    ctx.afterRun(() => {
        input.focus();
    });
}

/** Input with border and placeholder — both focused and unfocused variants in a stack. */
export function focusCycling(ctx: StoryContext): void {
    ctx.body.title = "InputElement — Tab to cycle focus (see border colour change)";
    const stack = new VStackElement();

    const first = new InputElement();
    first.showBorder = true;
    first.placeholder = "First input…";

    const second = new InputElement();
    second.showBorder = true;
    second.placeholder = "Second input…";

    stack.addChild(first, { width: "fill", height: 3 });
    stack.addChild(second, { width: "fill", height: 3 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        first.focus();
    });
}

/** Input pre-filled with long text to test horizontal scrolling. */
export function longText(ctx: StoryContext): void {
    ctx.body.title = "InputElement — long text / horizontal scroll";
    const input = new InputElement();
    input.inputState.value =
        "The quick brown fox jumps over the lazy dog — a very long sentence to test scrolling behaviour.";
    input.placeholder = "Type something long…";

    ctx.body.setContent(input);

    ctx.afterRun(() => {
        input.focus();
    });
}

/**
 * Input with full keybinding support via InputWidgetService.
 *
 * Keys:
 *   ← / →                — move by character
 *   Ctrl+← / Ctrl+→      — move by word
 *   Home / End            — line start / end
 *   Shift+← / Shift+→    — select by character
 *   Ctrl+Shift+← / →     — select by word
 *   Shift+Home / Shift+End — select to line start / end
 *   Ctrl+A                — select all
 *   Backspace             — delete left
 *   Delete                — delete right
 *   Ctrl+Backspace        — delete word left
 *   Ctrl+Delete           — delete word right
 *   Ctrl+C                — copy selection
 *   Ctrl+X                — cut selection
 *   Ctrl+V                — paste
 */
export function withKeybindings(ctx: StoryContext): void {
    ctx.body.title = "InputElement — full keybindings (Shift+←/→, Ctrl+A, Ctrl+C/X/V)";

    const input = new InputElement();
    input.showBorder = true;
    input.placeholder = "Type then try Ctrl+← / Ctrl+→ / Ctrl+Backspace…";
    input.inputState.value = "hello world foo bar";

    mountInputKeybindings(ctx, input);

    const stack = new VStackElement();
    stack.addChild(input, { width: "fill", height: 3 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        input.focus();
    });
}

/**
 * Two inputs — Tab to switch, keybindings active only for the focused one.
 */
export function twoInputsWithKeybindings(ctx: StoryContext): void {
    ctx.body.title = "InputElement — two inputs, Tab to switch, keybindings follow focus";

    const first = new InputElement();
    first.showBorder = true;
    first.placeholder = "First field…";
    first.inputState.value = "hello world";

    const second = new InputElement();
    second.showBorder = true;
    second.placeholder = "Second field…";
    second.inputState.value = "foo bar baz";

    mountInputKeybindings(ctx, first);

    const stack = new VStackElement();
    stack.addChild(first, { width: "fill", height: 3 });
    stack.addChild(second, { width: "fill", height: 3 });
    ctx.body.setContent(stack);

    ctx.afterRun(() => {
        first.focus();
    });
}
