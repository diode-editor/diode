import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { describe, expect, it, vi } from "vitest";

import { ExtensionPtySession } from "./extensionPtySession.ts";

// Application cursor keys (DECCKM) over a real @xterm/headless: the program's `CSI ? 1 h` / `CSI ? 1 l`
// switch how the terminal widget encodes bare arrows for the PTY.

function make() {
    const input: string[] = [];
    const session = new ExtensionPtySession({
        cols: 20,
        rows: 4,
        name: "t",
        onInput: (data) => input.push(data),
        onResize: () => undefined,
    });
    const view = new TerminalViewElement(session);
    view.layout(BoxConstraints.tight(new Size(20, 4)));
    return { session, view, input };
}

function press(view: TerminalViewElement, key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean } = {}): void {
    view.dispatchEvent(new TUIKeyboardEvent("keydown", { key, ...mods }));
}

describe("XtermSurface — application cursor keys", () => {
    it("is off until the program sends CSI ? 1 h and off again after CSI ? 1 l", async () => {
        const { session } = make();
        expect(session.applicationCursorKeys).toBe(false);
        session.feed("\u001b[?1h");
        await vi.waitFor(() => {
            expect(session.applicationCursorKeys).toBe(true);
        });
        session.feed("\u001b[?1l");
        await vi.waitFor(() => {
            expect(session.applicationCursorKeys).toBe(false);
        });
        session.dispose();
    });

    it("the terminal widget sends bare arrows as SS3 in the mode, modified arrows as CSI 1;mod either way", async () => {
        const { session, view, input } = make();
        press(view, "ArrowUp");
        press(view, "Tab", { shiftKey: true });
        session.feed("\u001b[?1h");
        await vi.waitFor(() => {
            expect(session.applicationCursorKeys).toBe(true);
        });
        press(view, "ArrowUp");
        press(view, "ArrowLeft", { ctrlKey: true });
        expect(input).toStrictEqual(["\u001b[A", "\u001b[Z", "\u001bOA", "\u001b[1;5D"]);
        session.dispose();
    });
});
