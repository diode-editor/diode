import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";

import type { AnsiScreen } from "./helpers/AnsiScreen.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { usePtyApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.ts");

const KEYWORD_FG = packRgb(0x56, 0x9c, 0xd6); // "keyword" / "storage.type" from darkPlus
const COMMENT_FG = packRgb(0x6a, 0x99, 0x55); // "comment"
const NUMBER_FG = packRgb(0xb5, 0xce, 0xa8); // "constant.numeric"

// ConPTY / OS PTY clearing sequences make content assertions unreliable off Linux (docs/TODO/E2E.md).
// TODO(e2e-cross-platform): fix on Windows and macOS
const itLinuxOnly = process.platform === "linux" ? it : it.skip;

describe("SEA binary — startup", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("boots, draws a non-empty frame and exits on Ctrl+C", async () => {
        const { session } = await usePtyApp({ open: [fixturePath] });
        // The menu bar is stable everywhere; ConPTY clears the tab bar row after resize on Windows.
        const screen = await session.waitFor((s) => s.findText("Edit") !== null);
        expect(screen.toString().trim().length).toBeGreaterThan(0);

        await session.dispose();
        expect(session.isExited).toBe(true);
    });

    itLinuxOnly("renders fixture text on screen", async () => {
        const { session } = await usePtyApp({ open: [fixturePath] });
        const screen = await session.waitFor(
            (s) => s.findText("greeting") !== null && s.findText("fixture used") !== null,
        );

        expect(screen.findText("greeting")).not.toBeNull();
        expect(screen.findText("fixture used")).not.toBeNull();
        expect(screen.findText("greet")).not.toBeNull();
    });

    itLinuxOnly("applies syntax highlighting from the Dark+ theme", async () => {
        const { session } = await usePtyApp({ open: [fixturePath] });
        const screen = await session.waitFor(
            (s) => s.findText("const greeting") !== null && rowHasFg(s, locateRow(s, "fixture used"), COMMENT_FG),
        );

        const commentRow = locateRow(screen, "fixture used");
        expect(rowHasFg(screen, commentRow, COMMENT_FG)).toBe(true);

        const constRow = locateRow(screen, "const greeting");
        const constPos = screen.findText("const greeting");
        expect(constPos).not.toBeNull();
        const x = constPos!.x;
        const sample = screen.cellAt(x, constRow);
        expect(sample.fg).toBe(KEYWORD_FG);

        const numberRow = locateRow(screen, "= 42");
        const numberPos = screen.findText("= 42");
        expect(numberPos).not.toBeNull();
        const numberCell = screen.cellAt(numberPos!.x + 2, numberRow);
        expect(numberCell.fg).toBe(NUMBER_FG);
    });
});

function locateRow(screen: AnsiScreen, text: string): number {
    const pos = screen.findText(text);
    if (!pos) throw new Error(`text not found on screen: ${JSON.stringify(text)}`);
    return pos.y;
}

function rowHasFg(screen: AnsiScreen, y: number, fg: number): boolean {
    for (let x = 0; x < screen.width; x++) {
        if (screen.cellAt(x, y).fg === fg) return true;
    }
    return false;
}
