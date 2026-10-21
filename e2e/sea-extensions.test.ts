import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { packRgb } from "@tuidom/core/common/colorUtils";

import type { AnsiScreen } from "./helpers/AnsiScreen.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { findNode } from "./helpers/inspectorClient.ts";
import { usePtyApp } from "./helpers/useApp.ts";

const here = fileURLToPath(new URL(".", import.meta.url));
const fixturePath = resolve(here, "fixtures", "sample.hello");
const userDataPath = resolve(here, "fixtures", "user-data-with-hello");
const tabbedFixturePath = resolve(here, "fixtures", "tabbed.txt");
const tabSetterUserDataPath = resolve(here, "fixtures", "user-data-with-tab-setter");
const willSaveUserDataPath = resolve(here, "fixtures", "user-data-with-will-save");

const KEYWORD_FG = packRgb(0xc5, 0x86, 0xc0); // keyword.control — Dark Modern / Dark+ purple
const STRING_FG = packRgb(0xce, 0x91, 0x78); // string — Dark+ orange
const COMMENT_FG = packRgb(0x6a, 0x99, 0x55); // comment — Dark+ green
const NUMBER_FG = packRgb(0xb5, 0xce, 0xa8); // constant.numeric — Dark+ light green

// ConPTY interaction makes colour assertions unreliable on non-Linux (docs/TODO/E2E.md).
const itLinuxOnly = process.platform === "linux" ? it : it.skip;

describe("SEA binary — user extensions", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 180_000);

    it("boots with --user-data-dir and renders hello-lang fixture", async () => {
        const { session } = await usePtyApp({ seedUserData: userDataPath, open: [fixturePath] });
        const screen = await session.waitFor((s) => s.findText("hello") !== null);
        expect(screen.findText("hello")).not.toBeNull();
    });

    itLinuxOnly("user extension grammar applies syntax highlighting with --user-data-dir", async () => {
        const { session } = await usePtyApp({ seedUserData: userDataPath, open: [fixturePath] });
        const screen = await session.waitFor(
            (s) => s.findText("hello world") !== null && rowHasFg(s, locateRow(s, "hello world"), KEYWORD_FG),
        );

        const helloPos = screen.findText("hello world");
        expect(helloPos).not.toBeNull();
        const helloCell = screen.cellAt(helloPos!.x, helloPos!.y);
        expect(helloCell.fg).toBe(KEYWORD_FG);

        const worldX = helloPos!.x + "hello ".length;
        const worldCell = screen.cellAt(worldX, helloPos!.y);
        expect(worldCell.fg).toBe(STRING_FG);

        const commentRow = locateRow(screen, "// greeting");
        expect(rowHasFg(screen, commentRow, COMMENT_FG)).toBe(true);

        const numPos = screen.findText("score 42");
        expect(numPos).not.toBeNull();
        const numCell = screen.cellAt(numPos!.x + "score ".length, numPos!.y);
        expect(numCell.fg).toBe(NUMBER_FG);
    });

    itLinuxOnly("without --user-data-dir hello-lang grammar is not applied", async () => {
        const { session } = await usePtyApp({ open: [fixturePath] });
        // The frame with text arrives before highlighting — wait for the language mode in the status bar.
        const screen = await session.waitFor((s) => s.findText("hello") !== null && s.findText("Plain Text") !== null);

        const helloPos = screen.findText("hello");
        expect(helloPos).not.toBeNull();
        const helloCell = screen.cellAt(helloPos!.x, helloPos!.y);
        expect(helloCell.fg).not.toBe(KEYWORD_FG);
    });

    itLinuxOnly("user extension с main self-spawn'ит subprocess и проставляет tabSize", async () => {
        // tab-setter sets tabSize=7 / insertSpaces=false via `activeTextEditor.options`;
        // with tabSize=7, "indented" after the tab is at column 7.
        const { session } = await usePtyApp({
            seedUserData: tabSetterUserDataPath,
            open: [tabbedFixturePath],
            inspect: true,
        });
        // A predicate on inspectState, not on text appearing: under load the frame
        // is captured before the RPC arrives.
        await session.waitForDocument(
            (root) => findNode(root, (n) => n.type === "EditorElement")?.state?.tabSize === 7,
            { timeoutMs: 20_000 },
        );
        // State and frame are independent channels (WebSocket and PTY). Waiting for the word "indented"
        // does not work: it is there with ANY tabSize, and on a starved runner the frame was captured
        // before the RPC (CI 37195942480: expected 4 to be 7). Wait for the indent itself.
        const screen = await session.waitFor((s) => tabIndentOf(s) === 7, { timeoutMs: 20_000 });
        const indentedRow = locateRow(screen, "indented");
        const indentedPos = screen.findText("indented")!;
        const endPos = screen.findText("end");
        expect(endPos).not.toBeNull();
        const indent = indentedPos.x - endPos!.x;
        expect(indent).toBe(7);
        expect(indentedRow).toBe(indentedPos.y);
    });

    itLinuxOnly(
        "will-save участник user extension трансформирует байты при Ctrl+S (проводка saveParticipant)",
        async () => {
            // Hermetic wiring gate: `group.saveParticipant` must be bound to
            // `host.willSaveTextDocument`; before it, the only gate was the networked editorconfig suite.
            const { session, env } = await usePtyApp({
                seedUserData: willSaveUserDataPath,
                files: { "trim.txt": "one  \ntwo\t" },
                open: ["trim.txt"],
                inspect: true,
            });
            await session.waitForDocument((root) => findNode(root, (n) => n.type === "EditorElement") !== null, {
                timeoutMs: 20_000,
            });

            // Ctrl+S is resent until the bytes are transformed: save() runs the
            // participant unconditionally, so the retry self-synchronizes with the async
            // extension activation (same trick as in editorconfig-stock).
            const fp = join(env.workspaceDir, "trim.txt");
            const deadline = Date.now() + 25_000;
            let bytes = readFileSync(fp, "utf8");
            while (Date.now() < deadline && bytes !== "one\ntwo\n") {
                session.write("\x13"); // Ctrl+S → workbench.action.files.save
                await new Promise((r) => setTimeout(r, 400));
                bytes = readFileSync(fp, "utf8");
            }
            expect(bytes).toBe("one\ntwo\n");
        },
    );
});

function locateRow(screen: AnsiScreen, text: string): number {
    const pos = screen.findText(text);
    if (!pos) throw new Error(`text not found on screen: ${JSON.stringify(text)}`);
    return pos.y;
}

/**
 * Rendered tab width on the `tabbed.txt` fixture: `indented` follows a tab
 * at column 0, `end` is at column 0 with no indent, so the difference of their screen `x`
 * is the tabSize the line was laid out with. `null` — one of the lines is not
 * in the frame yet.
 */
function tabIndentOf(screen: AnsiScreen): number | null {
    const indented = screen.findText("indented");
    const end = screen.findText("end");
    if (indented === null || end === null) return null;
    return indented.x - end.x;
}

function rowHasFg(screen: AnsiScreen, y: number, fg: number): boolean {
    for (let x = 0; x < screen.width; x++) {
        if (screen.cellAt(x, y).fg === fg) return true;
    }
    return false;
}
