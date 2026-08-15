import { describe, expect, it } from "vitest";

import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";

import { InputWidgetService } from "./inputWidgetService.ts";

/** A real (in-memory) clipboard — not a spy. */
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

/**
 * Builds an InputElement seeded with `text`, with the cursor at the end,
 * plus a controller already pointed at it. `changes` records every onChange
 * payload so tests can assert the change notification fires.
 */
function setup(text = ""): {
    controller: InputWidgetService;
    input: InputElement;
    changes: string[];
} {
    const input = new InputElement();
    input.inputState.value = text; // cursor lands at end
    const changes: string[] = [];
    input.onChange = (v) => {
        changes.push(v);
    };
    const controller = new InputWidgetService();
    controller.setActive(input);
    return { controller, input, changes };
}

describe("InputWidgetService — editing (delete)", () => {
    it("deleteRight removes the grapheme to the right of the cursor and notifies", () => {
        const { controller, input, changes } = setup("hello");
        input.inputState.moveCursorToStart();

        controller.deleteRight();

        expect(input.inputState.value).toBe("ello");
        expect(changes).toEqual(["ello"]);
    });

    it("deleteRight at end of text is a no-op (still notifies onChange)", () => {
        const { controller, input, changes } = setup("hi");
        // cursor already at end

        controller.deleteRight();

        expect(input.inputState.value).toBe("hi");
        expect(changes).toEqual(["hi"]);
    });

    it("deleteWordLeft removes the previous word", () => {
        const { controller, input, changes } = setup("foo bar");
        // cursor at end

        controller.deleteWordLeft();

        expect(input.inputState.value).toBe("foo ");
        expect(changes).toEqual(["foo "]);
    });

    it("deleteWordRight removes the next word", () => {
        const { controller, input, changes } = setup("foo bar");
        input.inputState.moveCursorToStart();

        controller.deleteWordRight();

        expect(input.inputState.value).toBe(" bar");
        expect(changes).toEqual([" bar"]);
    });

    it("delete methods are safe no-ops when no input is active", () => {
        const controller = new InputWidgetService();
        controller.setActive(null);
        expect(() => {
            controller.deleteRight();
            controller.deleteWordLeft();
            controller.deleteWordRight();
        }).not.toThrow();
    });
});

describe("InputWidgetService — selection", () => {
    it("selectLeft extends a selection one grapheme to the left", () => {
        const { controller, input } = setup("abc");
        controller.selectLeft();
        expect(input.inputState.hasSelection).toBe(true);
        expect(input.inputState.selectedText).toBe("c");
    });

    it("selectRight extends a selection one grapheme to the right", () => {
        const { controller, input } = setup("abc");
        input.inputState.moveCursorToStart();
        controller.selectRight();
        expect(input.inputState.selectedText).toBe("a");
    });

    it("selectToHome selects from the cursor to the start", () => {
        const { controller, input } = setup("abc");
        controller.selectToHome();
        expect(input.inputState.selectedText).toBe("abc");
        expect(input.inputState.selectionStart).toBe(0);
    });

    it("selectToEnd selects from the cursor to the end", () => {
        const { controller, input } = setup("abc");
        input.inputState.moveCursorToStart();
        controller.selectToEnd();
        expect(input.inputState.selectedText).toBe("abc");
    });

    it("selectWordLeft selects the previous word", () => {
        const { controller, input } = setup("foo bar");
        controller.selectWordLeft();
        expect(input.inputState.selectedText).toBe("bar");
    });

    it("selectWordRight selects the next word", () => {
        const { controller, input } = setup("foo bar");
        input.inputState.moveCursorToStart();
        controller.selectWordRight();
        expect(input.inputState.selectedText).toBe("foo");
    });

    it("selectAll selects the whole value", () => {
        const { controller, input } = setup("hello");
        controller.selectAll();
        expect(input.inputState.selectedText).toBe("hello");
    });

    it("selection methods are safe no-ops when no input is active", () => {
        const controller = new InputWidgetService();
        controller.setActive(null);
        expect(() => {
            controller.selectLeft();
            controller.selectRight();
            controller.selectToHome();
            controller.selectToEnd();
            controller.selectWordLeft();
            controller.selectWordRight();
            controller.selectAll();
        }).not.toThrow();
    });
});

describe("InputWidgetService — clipboard", () => {
    it("copy writes the selected text to the clipboard without mutating value", async () => {
        const { controller, input } = setup("hello");
        const clipboard = memoryClipboard();
        controller.selectAll();

        await controller.copy(clipboard);

        expect(await clipboard.readText()).toBe("hello");
        expect(input.inputState.value).toBe("hello");
    });

    it("copy with no selection writes nothing", async () => {
        const { controller } = setup("hello");
        const clipboard = memoryClipboard("PREEXISTING");
        // no selection

        await controller.copy(clipboard);

        expect(await clipboard.readText()).toBe("PREEXISTING");
    });

    it("cut writes selection to clipboard, deletes it, and notifies", async () => {
        const { controller, input, changes } = setup("hello");
        const clipboard = memoryClipboard();
        controller.selectAll();

        await controller.cut(clipboard);

        expect(await clipboard.readText()).toBe("hello");
        expect(input.inputState.value).toBe("");
        expect(changes).toEqual([""]);
    });

    it("cut with no selection leaves value and clipboard untouched", async () => {
        const { controller, input, changes } = setup("hello");
        const clipboard = memoryClipboard("PREEXISTING");

        await controller.cut(clipboard);

        expect(await clipboard.readText()).toBe("PREEXISTING");
        expect(input.inputState.value).toBe("hello");
        expect(changes).toEqual([]);
    });

    it("paste inserts clipboard text at the cursor and notifies", async () => {
        const { controller, input, changes } = setup("ac");
        const clipboard = memoryClipboard("b");
        input.inputState.moveCursorToStart();
        input.inputState.moveCursorRight(); // cursor between a and c

        await controller.paste(clipboard);

        expect(input.inputState.value).toBe("abc");
        expect(changes).toEqual(["abc"]);
    });

    it("paste replaces the current selection", async () => {
        const { controller, input } = setup("hello");
        const clipboard = memoryClipboard("XYZ");
        controller.selectAll();

        await controller.paste(clipboard);

        expect(input.inputState.value).toBe("XYZ");
    });

    it("paste of empty clipboard text does nothing", async () => {
        const { controller, input, changes } = setup("keep");
        const clipboard = memoryClipboard("");

        await controller.paste(clipboard);

        expect(input.inputState.value).toBe("keep");
        expect(changes).toEqual([]);
    });

    it("clipboard methods are safe no-ops when no input is active", async () => {
        const controller = new InputWidgetService();
        controller.setActive(null);
        const clipboard = memoryClipboard("data");
        await expect(controller.copy(clipboard)).resolves.toBeUndefined();
        await expect(controller.cut(clipboard)).resolves.toBeUndefined();
        await expect(controller.paste(clipboard)).resolves.toBeUndefined();
    });
});

/**
 * A clipboard whose read/write promises stay pending until manually resolved — lets us
 * change the active input mid-await to reproduce the focus race that crashed the editor.
 */
function deferredClipboard(text = ""): { clipboard: IClipboard; resolveRead(): void; resolveWrite(): void } {
    const holder: { read?: () => void; write?: () => void } = {};
    const clipboard: IClipboard = {
        readText: () =>
            new Promise<string>((res) => {
                holder.read = () => {
                    res(text);
                };
            }),
        writeText: () =>
            new Promise<void>((res) => {
                holder.write = () => {
                    res();
                };
            }),
    };
    return {
        clipboard,
        resolveRead: () => holder.read?.(),
        resolveWrite: () => holder.write?.(),
    };
}

describe("InputWidgetService — undo/redo", () => {
    it("undo reverts the last edit group and notifies via onChange", () => {
        const { controller, input, changes } = setup();
        input.inputState.insert("a");
        input.inputState.insert("b"); // coalesced into one undo group

        controller.undo();
        expect(input.inputState.value).toBe("");
        expect(changes).toContain("");
    });

    it("redo re-applies an undone edit", () => {
        const { controller, input } = setup();
        input.inputState.insert("a");
        input.inputState.insert("b");
        controller.undo();

        controller.redo();
        expect(input.inputState.value).toBe("ab");
    });

    it("undo/redo work on an input without an onChange handler", () => {
        const input = new InputElement(); // no onChange wired
        input.inputState.insert("x");
        const controller = new InputWidgetService();
        controller.setActive(input);

        expect(() => {
            controller.undo();
            controller.redo();
        }).not.toThrow();
        expect(input.inputState.value).toBe("x");
    });

    it("undo/redo are safe no-ops when no input is active", () => {
        const controller = new InputWidgetService();
        controller.setActive(null);
        expect(() => {
            controller.undo();
            controller.redo();
        }).not.toThrow();
    });
});

describe("InputWidgetService — focus changes during async clipboard ops", () => {
    it("paste does not crash or insert when the input is unfocused during the read", async () => {
        const { controller, input, changes } = setup("ab");
        const cb = deferredClipboard("X");

        const p = controller.paste(cb.clipboard);
        controller.setActive(null); // focus lost while the OSC 52 read is in flight
        cb.resolveRead();
        await expect(p).resolves.toBeUndefined();

        expect(input.inputState.value).toBe("ab");
        expect(changes).toEqual([]);
    });

    it("paste targets only the input that was focused when it started", async () => {
        const { controller, input } = setup("ab");
        const other = new InputElement();
        other.inputState.value = "zz";
        const cb = deferredClipboard("X");

        const p = controller.paste(cb.clipboard);
        controller.setActive(other); // focus moved to a different input mid-read
        cb.resolveRead();
        await p;

        expect(input.inputState.value).toBe("ab"); // original untouched
        expect(other.inputState.value).toBe("zz"); // not pasted into the new one either
    });

    it("cut does not mutate the input when focus is lost during the write", async () => {
        const { controller, input, changes } = setup("hello");
        controller.selectAll();
        const cb = deferredClipboard();

        const p = controller.cut(cb.clipboard);
        controller.setActive(null);
        cb.resolveWrite();
        await expect(p).resolves.toBeUndefined();

        expect(input.inputState.value).toBe("hello");
        expect(changes).toEqual([]);
    });
});
