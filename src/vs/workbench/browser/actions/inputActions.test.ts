import { describe, expect, it, vi } from "vitest";

import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { CommandAction } from "../../../platform/actions/common/commandAction.ts";
import { registerAction } from "../../../platform/actions/common/commandAction.ts";
import type { IClipboard } from "../../../platform/clipboard/common/iClipboard.ts";
import { CommandRegistry } from "../../../platform/commands/common/commandRegistry.ts";
import { Container } from "../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../platform/keybinding/common/keybindingRegistry.ts";
import { ClipboardDIToken } from "../../common/coreTokens.ts";
import { InputWidgetService } from "../../contrib/files/browser/inputWidgetService.ts";
import { InputWidgetServiceDIToken } from "../../contrib/files/browser/inputWidgetService.ts";

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
    inputRedoAction,
    inputSelectAllAction,
    inputSelectLeftAction,
    inputSelectRightAction,
    inputSelectToEndAction,
    inputSelectToHomeAction,
    inputSelectWordLeftAction,
    inputSelectWordRightAction,
    inputUndoAction,
} from "./inputActions.ts";

function memoryClipboard(initial = ""): IClipboard {
    let text = initial;
    return {
        readText: () => Promise.resolve(text),
        writeText: (value: string) => {
            text = value;
            return Promise.resolve();
        },
    };
}

/** Build a real InputElement + InputWidgetService wired through a DI accessor. */
function makeCtx(text: string, opts: { cursor?: "start" | "end"; select?: "all"; clipboard?: string } = {}) {
    const input = new InputElement();
    input.inputState.value = text; // cursor lands at the end
    if (opts.cursor === "start") input.inputState.moveCursorToStart();
    if (opts.select === "all") input.inputState.selectAll();
    const onChange = vi.fn();
    input.onChange = onChange;

    const controller = new InputWidgetService();
    controller.setActive(input);

    const clipboard = memoryClipboard(opts.clipboard ?? "");
    const accessor = new Container();
    accessor.bind(InputWidgetServiceDIToken, () => controller);
    accessor.bind(ClipboardDIToken, () => clipboard);

    const commands = new CommandRegistry();
    async function exec(action: CommandAction): Promise<void> {
        registerAction(commands, new KeybindingRegistry(), accessor, action);
        await commands.execute(action.id);
    }
    return { input, controller, clipboard, onChange, exec };
}

describe("InputActions — cursor movement on a real InputState", () => {
    const cases: { action: CommandAction; cursor: "start" | "end"; expected: number }[] = [
        { action: inputCursorLeftAction, cursor: "end", expected: 10 },
        { action: inputCursorRightAction, cursor: "start", expected: 1 },
        { action: inputCursorHomeAction, cursor: "end", expected: 0 },
        { action: inputCursorEndAction, cursor: "start", expected: 11 },
        { action: inputCursorWordLeftAction, cursor: "end", expected: 6 },
        { action: inputCursorWordRightAction, cursor: "start", expected: 5 },
    ];

    for (const { action, cursor, expected } of cases) {
        it(`${action.id} moves the cursor to offset ${String(expected)}`, async () => {
            const { input, exec } = makeCtx("hello world", { cursor });
            await exec(action);
            expect(input.inputState.cursorOffset).toBe(expected);
        });
    }
});

describe("InputActions — editing on a real InputState", () => {
    const cases: { action: CommandAction; cursor: "start" | "end"; result: string }[] = [
        { action: inputDeleteLeftAction, cursor: "end", result: "hello worl" },
        { action: inputDeleteRightAction, cursor: "start", result: "ello world" },
        { action: inputDeleteWordLeftAction, cursor: "end", result: "hello " },
        { action: inputDeleteWordRightAction, cursor: "start", result: " world" },
    ];

    for (const { action, cursor, result } of cases) {
        it(`${action.id} edits the text to "${result}" and fires onChange`, async () => {
            const { input, onChange, exec } = makeCtx("hello world", { cursor });
            await exec(action);
            expect(input.inputState.value).toBe(result);
            expect(onChange).toHaveBeenLastCalledWith(result);
        });
    }
});

describe("InputActions — selection on a real InputState", () => {
    const cases: { action: CommandAction; cursor: "start" | "end"; selected: string }[] = [
        { action: inputSelectLeftAction, cursor: "end", selected: "d" },
        { action: inputSelectRightAction, cursor: "start", selected: "h" },
        { action: inputSelectToHomeAction, cursor: "end", selected: "hello world" },
        { action: inputSelectToEndAction, cursor: "start", selected: "hello world" },
        { action: inputSelectWordLeftAction, cursor: "end", selected: "world" },
        { action: inputSelectWordRightAction, cursor: "start", selected: "hello" },
    ];

    for (const { action, cursor, selected } of cases) {
        it(`${action.id} selects "${selected}"`, async () => {
            const { input, exec } = makeCtx("hello world", { cursor });
            await exec(action);
            expect(input.inputState.hasSelection).toBe(true);
            expect(input.inputState.selectedText).toBe(selected);
        });
    }

    it("inputSelectAll selects the whole value", async () => {
        const { input, exec } = makeCtx("hello world");
        await exec(inputSelectAllAction);
        expect(input.inputState.selectedText).toBe("hello world");
    });
});

describe("InputActions — clipboard on a real InputState", () => {
    it("inputCopy writes the selection to the clipboard, leaving the text intact", async () => {
        const { input, clipboard, exec } = makeCtx("hello world", { select: "all" });
        await exec(inputCopyAction);
        expect(await clipboard.readText()).toBe("hello world");
        expect(input.inputState.value).toBe("hello world");
    });

    it("inputCut writes the selection and removes it", async () => {
        const { input, clipboard, onChange, exec } = makeCtx("hello world", { select: "all" });
        await exec(inputCutAction);
        expect(await clipboard.readText()).toBe("hello world");
        expect(input.inputState.value).toBe("");
        expect(onChange).toHaveBeenLastCalledWith("");
    });

    it("inputPaste inserts the clipboard text at the cursor", async () => {
        const { input, onChange, exec } = makeCtx("hello world", { cursor: "end", clipboard: "!!!" });
        await exec(inputPasteAction);
        expect(input.inputState.value).toBe("hello world!!!");
        expect(onChange).toHaveBeenLastCalledWith("hello world!!!");
    });
});

describe("InputActions — undo/redo on a real InputState", () => {
    it("inputUndo reverts the last edit and fires onChange", async () => {
        const { input, onChange, exec } = makeCtx("hello world", { cursor: "end" });
        await exec(inputDeleteLeftAction); // "hello worl"
        await exec(inputUndoAction);
        expect(input.inputState.value).toBe("hello world");
        expect(onChange).toHaveBeenLastCalledWith("hello world");
    });

    it("inputRedo re-applies an undone edit", async () => {
        const { input, exec } = makeCtx("hello world", { cursor: "end" });
        await exec(inputDeleteLeftAction); // "hello worl"
        await exec(inputUndoAction); // "hello world"
        await exec(inputRedoAction);
        expect(input.inputState.value).toBe("hello worl");
    });

    it("inputUndo is a safe no-op with no edit history", async () => {
        const { input, exec } = makeCtx("hello world", { cursor: "end" });
        await exec(inputUndoAction);
        expect(input.inputState.value).toBe("hello world");
    });
});

describe("InputActions — no active input", () => {
    it("are safe no-ops when nothing is focused", async () => {
        const controller = new InputWidgetService();
        controller.setActive(null);
        const accessor = new Container();
        accessor.bind(InputWidgetServiceDIToken, () => controller);
        accessor.bind(ClipboardDIToken, () => memoryClipboard("x"));
        const commands = new CommandRegistry();

        for (const action of [inputCursorLeftAction, inputDeleteLeftAction, inputSelectAllAction, inputPasteAction]) {
            registerAction(commands, new KeybindingRegistry(), accessor, action);
            // run() may be sync (returns undefined) or async — await both shapes uniformly
            await Promise.resolve(commands.execute(action.id));
        }

        // The service still works once a real input is attached (it survived the null-active calls).
        const input = new InputElement();
        input.inputState.value = "ab";
        controller.setActive(input);
        controller.cursorLeft();
        expect(input.inputState.cursorOffset).toBe(1);
    });
});
