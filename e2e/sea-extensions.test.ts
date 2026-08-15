import { resolve } from "node:path";
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

const KEYWORD_FG = packRgb(0xc5, 0x86, 0xc0); // keyword.control — Dark Modern / Dark+ purple
const STRING_FG = packRgb(0xce, 0x91, 0x78); // string — Dark+ orange
const COMMENT_FG = packRgb(0x6a, 0x99, 0x55); // comment — Dark+ green
const NUMBER_FG = packRgb(0xb5, 0xce, 0xa8); // constant.numeric — Dark+ light green

// ConPTY interaction makes colour assertions unreliable on non-Linux.
// See docs/TODO/E2E.md.
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

    itLinuxOnly(
        "user extension grammar applies syntax highlighting with --user-data-dir",
        async () => {
            const { session } = await usePtyApp({ seedUserData: userDataPath, open: [fixturePath] });
            const screen = await session.waitFor(
                (s) =>
                    s.findText("hello world") !== null &&
                    rowHasFg(s, locateRow(s, "hello world"), KEYWORD_FG),
            );

            // `hello` — keyword.control → синий
            const helloPos = screen.findText("hello world");
            expect(helloPos).not.toBeNull();
            const helloCell = screen.cellAt(helloPos!.x, helloPos!.y);
            expect(helloCell.fg).toBe(KEYWORD_FG);

            // `world` — string.quoted → оранжевый
            const worldX = helloPos!.x + "hello ".length;
            const worldCell = screen.cellAt(worldX, helloPos!.y);
            expect(worldCell.fg).toBe(STRING_FG);

            // Комментарий → зелёный
            const commentRow = locateRow(screen, "// greeting");
            expect(rowHasFg(screen, commentRow, COMMENT_FG)).toBe(true);

            // Число 42 (не внутри комментария) → светло-зелёный
            const numPos = screen.findText("score 42");
            expect(numPos).not.toBeNull();
            const numCell = screen.cellAt(numPos!.x + "score ".length, numPos!.y);
            expect(numCell.fg).toBe(NUMBER_FG);
        },
    );

    itLinuxOnly(
        "without --user-data-dir hello-lang grammar is not applied",
        async () => {
            const { session } = await usePtyApp({ open: [fixturePath] });
            const screen = await session.waitFor((s) => s.findText("hello") !== null);

            // Без расширения .hello — plain text, ни одна ячейка не должна быть покрашена
            // в KEYWORD_FG через нашу грамматику.
            const helloPos = screen.findText("hello");
            expect(helloPos).not.toBeNull();
            const helloCell = screen.cellAt(helloPos!.x, helloPos!.y);
            expect(helloCell.fg).not.toBe(KEYWORD_FG);
        },
    );

    itLinuxOnly(
        "user extension с main self-spawn'ит subprocess и проставляет tabSize",
        async () => {
            // tab-setter ставит tabSize=7 / insertSpaces=false на активный
            // редактор через `vscode.window.activeTextEditor.options`. RPC от
            // subprocess'а до host'а должен сработать в течение boot'а.
            //
            // Открываем файл с tab-символом в строке "\tindented". При
            // tabSize=7 видимая позиция "indented" — столбец 7 (после
            // gutter'а с line numbers).
            const { session } = await usePtyApp({ seedUserData: tabSetterUserDataPath, open: [tabbedFixturePath], inspect: true });
            // Ждём, пока RPC субпроцесса реально проставит tabSize=7 на редактор —
            // предикатом по inspectState, а не по факту появления текста (иначе под
            // нагрузкой кадр снимается раньше, чем RPC долетит: pre-existing гонка).
            await session.waitForDocument(
                (root) => findNode(root, (n) => n.type === "EditorElement")?.state?.tabSize === 7,
                { timeoutMs: 20_000 },
            );
            const screen = await session.waitFor((s) => s.findText("indented") !== null);
            const indentedRow = locateRow(screen, "indented");
            const indentedPos = screen.findText("indented")!;
            const endPos = screen.findText("end");
            expect(endPos).not.toBeNull();
            const indent = indentedPos.x - endPos!.x;
            // tab at column 0 with tabSize=7 → 'indented' starts at column 7
            expect(indent).toBe(7);
            expect(indentedRow).toBe(indentedPos.y);
        },
    );
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
