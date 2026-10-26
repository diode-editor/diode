import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { TerminalViewElement } from "@tuidom/elements/terminal/terminalViewElement";
import { describe, expect, it } from "vitest";

import { ExtensionPtySession } from "./extensionPtySession.ts";

// Kitty keyboard protocol over a real @xterm/headless: the program's `CSI = / ? / > / < u` drive the flags
// with upstream xterm.js 6.1 semantics, and the terminal widget encodes keys by them.

function make() {
    const input: string[] = [];
    const session = new ExtensionPtySession({
        cols: 20,
        rows: 4,
        name: "t",
        onInput: (data) => input.push(data),
        onResize: () => undefined,
    });
    return { session, input };
}

/** Output is parsed asynchronously: resolve on the update its write callback fires. */
async function feed(session: ExtensionPtySession, data: string): Promise<void> {
    await session.xtermReady;
    await new Promise<void>((resolve) => {
        const sub = session.onUpdate(() => {
            sub.dispose();
            resolve();
        });
        session.feed(data);
    });
}

async function flagsAfter(...sequences: string[]): Promise<number> {
    const { session } = make();
    for (const sequence of sequences) await feed(session, sequence);
    const flags = session.kittyKeyboardFlags;
    session.dispose();
    return flags;
}

describe("XtermSurface — kitty keyboard protocol state", () => {
    it("starts at 0", async () => {
        expect(await flagsAfter()).toBe(0);
    });

    it.each([
        ["\x1b[=5u", 5],
        ["\x1b[=5;1u", 5],
        ["\x1b[=5;u", 5], // empty mode — 1
        ["\x1b[=u", 0],
    ])("CSI = flags ; mode u assigns with mode 1 (%j → %i)", async (sequence, expected) => {
        expect(await flagsAfter("\x1b[=3u", sequence)).toBe(expected);
    });

    it("mode 2 sets the given bits, mode 3 clears them, other modes do nothing", async () => {
        expect(await flagsAfter("\x1b[=1u", "\x1b[=8;2u")).toBe(9);
        expect(await flagsAfter("\x1b[=11u", "\x1b[=2;3u")).toBe(9);
        expect(await flagsAfter("\x1b[=3u", "\x1b[=8;4u")).toBe(3);
    });

    it("answers CSI ? u with the current flags on the PTY input", async () => {
        const { session, input } = make();
        await feed(session, "\x1b[?u");
        await feed(session, "\x1b[>13u\x1b[?u");
        expect(input).toStrictEqual(["\x1b[?0u", "\x1b[?13u"]);
        session.dispose();
    });

    it("CSI > flags u pushes the current flags, CSI < u pops them back", async () => {
        expect(await flagsAfter("\x1b[>1u")).toBe(1);
        expect(await flagsAfter("\x1b[>u")).toBe(0);
        expect(await flagsAfter("\x1b[>1u", "\x1b[>3u", "\x1b[<u")).toBe(1);
        expect(await flagsAfter("\x1b[>1u", "\x1b[>3u", "\x1b[>8u", "\x1b[<2u")).toBe(1);
        expect(await flagsAfter("\x1b[>1u", "\x1b[>3u", "\x1b[>8u", "\x1b[<0u")).toBe(3);
    });

    it("an emptied stack leaves 0 even when the flags were set before the push", async () => {
        expect(await flagsAfter("\x1b[=5u", "\x1b[>1u", "\x1b[<u")).toBe(0);
        expect(await flagsAfter("\x1b[>1u", "\x1b[>3u", "\x1b[<5u")).toBe(0);
        expect(await flagsAfter("\x1b[=5u", "\x1b[<u")).toBe(0);
    });

    it("keeps at most 16 entries, evicting the oldest", async () => {
        const pushes = Array.from({ length: 17 }, (_, i) => `\x1b[>${i + 1}u`).join("");
        // Stack after 17 pushes: [1..16] — the initial 0 was evicted. Popping 15 leaves [1] and flags 2; popping
        // 16 empties it: 0.
        expect(await flagsAfter(pushes, "\x1b[<15u")).toBe(2);
        expect(await flagsAfter(pushes, "\x1b[<16u")).toBe(0);
        // 16 pushes still fit with the initial 0: popping 15 returns the first push.
        const sixteen = Array.from({ length: 16 }, (_, i) => `\x1b[>${i + 1}u`).join("");
        expect(await flagsAfter(sixteen, "\x1b[<15u")).toBe(1);
        expect(await flagsAfter(sixteen, "\x1b[<16u")).toBe(0);
    });

    it.each(["\x1b[?1049h", "\x1b[?1047h", "\x1b[?47h"])(
        "the alternate screen (%j) has its own flags and stack",
        async (enter) => {
            const leave = enter.replace("h", "l");
            const { session } = make();
            await feed(session, "\x1b[>1u");
            await feed(session, enter);
            expect(session.kittyKeyboardFlags).toBe(0);
            await feed(session, "\x1b[>3u\x1b[>5u");
            await feed(session, leave);
            expect(session.kittyKeyboardFlags).toBe(1);
            await feed(session, enter);
            expect(session.kittyKeyboardFlags).toBe(5);
            await feed(session, "\x1b[<u");
            expect(session.kittyKeyboardFlags).toBe(3);
            await feed(session, leave);
            // The main stack still holds the 0 under the 1.
            await feed(session, "\x1b[<u");
            expect(session.kittyKeyboardFlags).toBe(0);
            session.dispose();
        },
    );

    it("takes the value of a parameter with sub-parameters", async () => {
        expect(await flagsAfter("\x1b[>5:3u")).toBe(5);
        expect(await flagsAfter("\x1b[=1u", "\x1b[=8:1;2:4u")).toBe(9);
    });

    it.each([
        ["RIS", "\x1bc"],
        ["DECSTR", "\x1b[!p"],
    ])("%s still resets the emulator itself (application cursor keys off)", async (_name, reset) => {
        const { session } = make();
        await feed(session, "\x1b[?1h\x1b[>1u");
        expect(session.applicationCursorKeys).toBe(true);
        await feed(session, reset);
        expect(session.applicationCursorKeys).toBe(false);
        expect(session.kittyKeyboardFlags).toBe(0);
        session.dispose();
    });

    it.each([
        ["RIS", "\x1bc"],
        ["DECSTR", "\x1b[!p"],
    ])("%s resets the flags and both stacks", async (_name, reset) => {
        const { session } = make();
        await feed(session, "\x1b[>1u\x1b[>3u\x1b[?1049h\x1b[>5u");
        await feed(session, reset);
        expect(session.kittyKeyboardFlags).toBe(0);
        await feed(session, "\x1b[?1049h");
        expect(session.kittyKeyboardFlags).toBe(0);
        await feed(session, "\x1b[?1049l\x1b[>9u\x1b[<u");
        expect(session.kittyKeyboardFlags).toBe(0);
        session.dispose();
    });

    it("the program exiting without popping leaves the flags until a new CSI < u", async () => {
        const { session } = make();
        await feed(session, "\x1b[>1u");
        session.exit(0);
        expect(session.kittyKeyboardFlags).toBe(1);
        session.dispose();
    });
});

describe("XtermSurface — terminal.integrated.enableKittyKeyboardProtocol off", () => {
    it("ignores the four sequences: no reply, no flags", async () => {
        const { session, input } = make();
        session.setKittyKeyboardEnabled(false);
        await feed(session, "\x1b[>1u");
        await feed(session, "\x1b[=3u\x1b[?u");
        expect(session.kittyKeyboardFlags).toBe(0);
        session.setKittyKeyboardEnabled(true);
        await feed(session, "\x1b[<u");
        expect(session.kittyKeyboardFlags).toBe(0);
        expect(input).toStrictEqual([]);
        session.dispose();
    });

    it("switching it off on a live terminal drops the flags and stacks; on again starts from 0", async () => {
        const { session, input } = make();
        await feed(session, "\x1b[>1u\x1b[>3u\x1b[?1049h\x1b[>5u");
        session.setKittyKeyboardEnabled(false);
        expect(session.kittyKeyboardFlags).toBe(0);
        await feed(session, "\x1b[?1049l");
        expect(session.kittyKeyboardFlags).toBe(0);
        session.setKittyKeyboardEnabled(true);
        await feed(session, "\x1b[?1049h\x1b[?u\x1b[?1049l\x1b[?u");
        expect(input).toStrictEqual(["\x1b[?0u", "\x1b[?0u"]);
        session.dispose();
    });

    it("keeps track of the screen while off", async () => {
        const { session } = make();
        await feed(session, "\x1b[?1049h");
        session.setKittyKeyboardEnabled(false);
        await feed(session, "\x1b[?1049l");
        session.setKittyKeyboardEnabled(true);
        await feed(session, "\x1b[>7u");
        await feed(session, "\x1b[?1049h");
        expect(session.kittyKeyboardFlags).toBe(0);
        await feed(session, "\x1b[?1049l");
        expect(session.kittyKeyboardFlags).toBe(7);
        session.dispose();
    });

    it("re-enabling keeps it on: a second call with the same value changes nothing", async () => {
        const { session } = make();
        session.setKittyKeyboardEnabled(true);
        await feed(session, "\x1b[>1u");
        session.setKittyKeyboardEnabled(true);
        expect(session.kittyKeyboardFlags).toBe(1);
        session.dispose();
    });
});

describe("XtermSurface — keys under the kitty keyboard protocol", () => {
    function press(view: TerminalViewElement, type: "keydown" | "keyup", key: string, shiftKey = false): void {
        view.dispatchEvent(new TUIKeyboardEvent(type, { key, shiftKey }));
    }

    it("the widget sends Shift+Enter as CSI 13;2u after CSI > 1 u and as CR after CSI < u", async () => {
        const { session, input } = make();
        const view = new TerminalViewElement(session);
        view.layout(BoxConstraints.tight(new Size(20, 4)));
        press(view, "keydown", "Enter", true);
        await feed(session, "\x1b[>1u");
        press(view, "keydown", "Enter", true);
        press(view, "keyup", "Enter", true);
        await feed(session, "\x1b[=3u");
        press(view, "keydown", "a");
        press(view, "keyup", "a");
        await feed(session, "\x1b[<u");
        press(view, "keydown", "Enter", true);
        expect(input).toStrictEqual(["\r", "\x1b[13;2u", "a", "\x1b[97;1:3u", "\r"]);
        session.dispose();
    });
});
