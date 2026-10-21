import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Go ships without a language server — the steps are built in, as in VS Code without a provider (LSP steps are
// in `smartSelectService.typescriptLsp.test.ts`). The selection is read off the screen by background, not from the
// model.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "smartSelect.go");

function highlightedOnCaretRow(frame: GridSnapshot, bg: number): string {
    const row = frame.cursor?.y ?? 0;
    const cells = frame.cells.slice(row * frame.cols, (row + 1) * frame.cols);
    return cells
        .filter((cell) => cell.bg === bg)
        .map((cell) => cell.char)
        .join("");
}

function highlightedOnRowWith(frame: GridSnapshot, bg: number, marker: string): string {
    for (let y = 0; y < frame.rows; y++) {
        const cells = frame.cells.slice(y * frame.cols, (y + 1) * frame.cols);
        if (!cells.map((cell) => cell.char).join("").includes(marker)) continue;
        return cells
            .filter((cell) => cell.bg === bg)
            .map((cell) => cell.char)
            .join("");
    }
    return "";
}

export default defineScenario({
    name: "smart-select",
    title: "Expand / Shrink Selection: слово → скобки → строка → блок",
    open: [repoRoot, sampleFile],
    cols: 80,
    rows: 16,
    async run(editor) {
        await editor.waitForText((t) => t.includes("userName"));
        // Cursor inside `Name` in `userName`: line 4, character 12.
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        for (let i = 0; i < 13; i++) await editor.sendKey("ArrowLeft");
        const before = await editor.waitForText((t) => t.includes("Ln 4, Col 16"));

        // The cursor lands at the end of the selection — the cell right before it has the selection background.
        const beforeCaret = (frame: GridSnapshot): number =>
            (frame.cursor?.y ?? 0) * frame.cols + (frame.cursor?.x ?? 1) - 1;
        await editor.sendKey("Shift+Alt+ArrowRight");
        const first = await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells[beforeCaret(frame)].bg !== before.cells[beforeCaret(frame)].bg,
            { describe: "выделение подслова на кадре" },
        );
        const selectionBg = first.cells[beforeCaret(first)].bg;
        const expectOnRow = async (text: string): Promise<void> => {
            await waitUntil(
                () => editor.captureFrame(),
                (frame) => highlightedOnCaretRow(frame, selectionBg) === text,
                {
                    describe: `выделено «${text}»`,
                    diagnose: (frame) => `выделено: «${highlightedOnCaretRow(frame as GridSnapshot, selectionBg)}»`,
                },
            );
        };
        await expectOnRow("Name");
        await editor.capture("subword");

        await editor.sendKey("Shift+Alt+ArrowRight");
        await expectOnRow("userName");
        await editor.sendKey("Shift+Alt+ArrowRight");
        await expectOnRow('userName, "world"');
        await editor.sendKey("Shift+Alt+ArrowRight");
        await expectOnRow('(userName, "world")');
        await editor.capture("brackets");

        await editor.sendKey("Shift+Alt+ArrowRight");
        await expectOnRow('greet(userName, "world")');
        await editor.capture("line");

        // Then the block: the inside of the braces, the braces themselves, then with the `func` header.
        for (let i = 0; i < 4; i++) await editor.sendKey("Shift+Alt+ArrowRight");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => highlightedOnRowWith(frame, selectionBg, "func main()").startsWith("func main() {"),
            { describe: "выделен блок вместе с заголовком func" },
        );
        await editor.capture("block");

        // Shrink walks back through the same steps.
        for (let i = 0; i < 5; i++) await editor.sendKey("Shift+Alt+ArrowLeft");
        await expectOnRow('(userName, "world")');
        await editor.capture("shrink");
    },
});
