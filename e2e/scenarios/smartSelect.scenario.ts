import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// Expand / Shrink Selection (Shift+Alt+→ / Shift+Alt+←). У Go в поставке нет
// language server'а, поэтому ступени — встроенные, как у VS Code без
// провайдера: подслово → слово → внутри скобок → со скобками → строка без
// отступа → строка → внутри фигурных → с ними → с заголовком `func` →
// документ. Ступени от language server'а (TypeScript) закрывает тест на
// стоковом сервере — `smartSelectService.typescriptLsp.test.ts`.
//
// Кадр здесь — свидетель: выделенный текст читается с экрана по фону
// выделения, а не из модели.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "smartSelect.go");

/** Текст ячеек строки каретки с фоном `bg` — то, что человек видит выделенным. */
function highlightedOnCaretRow(frame: GridSnapshot, bg: number): string {
    const row = frame.cursor?.y ?? 0;
    const cells = frame.cells.slice(row * frame.cols, (row + 1) * frame.cols);
    return cells
        .filter((cell) => cell.bg === bg)
        .map((cell) => cell.char)
        .join("");
}

/** Выделенный текст строки экрана, на которой написано `marker`. */
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
        // Каретка внутри `Name` в `userName`: строка 4, символ 12.
        await editor.sendKey("Ctrl+Home");
        for (let i = 0; i < 3; i++) await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        for (let i = 0; i < 13; i++) await editor.sendKey("ArrowLeft");
        const before = await editor.waitForText((t) => t.includes("Ln 4, Col 16"));

        // Первый шаг — подслово `Name`. Каретка встаёт в конец выделения, так что
        // ячейка перед ней — последний выделенный символ: её фон и есть фон выделения.
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

        // Дальше — блок: внутренность фигурных, они сами, затем с заголовком `func`.
        for (let i = 0; i < 4; i++) await editor.sendKey("Shift+Alt+ArrowRight");
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => highlightedOnRowWith(frame, selectionBg, "func main()").startsWith("func main() {"),
            { describe: "выделен блок вместе с заголовком func" },
        );
        await editor.capture("block");

        // Shrink идёт обратно по тем же ступеням.
        for (let i = 0; i < 5; i++) await editor.sendKey("Shift+Alt+ArrowLeft");
        await expectOnRow('(userName, "world")');
        await editor.capture("shrink");
    },
});
