import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { CODICON_GLYPHS } from "../../src/vs/base/common/codicons.generated.ts";
import { dumpFrame, frameLine } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Значки `$(name)` в тексте от расширения подменяются глифом ВЕЗДЕ, где этот
// текст показывается. До этой работы подменщик был подключён в одном месте из
// десятка, и пользователь видел литерал («иконки через $ не показываются»).
//
// Фикстурное расширение `codicon-demo` пишет разметку во все раковины сразу:
// заголовок и категорию команды (манифест), заголовок/placeholder/метки/описания
// quick pick'а, заголовок и подсказку поля ввода, сообщение валидации, имя
// канала Output, текст пункта статус-бара и подпись прогресса.
//
// ЛОВУШКА КАДРА, из-за которой ассерты тут по ячейкам, а не по словам: глифы
// codicon'ов живут в приватной области Unicode, и в текстовом дампе они
// неотличимы друг от друга. Проверка «на кадре есть нужное слово» прошла бы и
// на неподменённом литерале, поэтому каждый шаг требует КОНКРЕТНЫЙ код-пойнт в
// ячейке ({@link expectGlyphs}) и отсутствие разметки ({@link expectNoMarkup}).
//
// Обратная половина решения проверяется тем же сценарием: начальное значение
// поля ввода и строки лога обязаны донести литерал `$(no-such-icon)` целиком —
// подменять их нельзя (value человек правит и отдаёт обратно расширению, лог
// не разметка), а неизвестное имя подменщик выбрасывает, так что ошибка была бы
// видна пропавшим куском строки.

const sampleFile = resolve(repoRoot, "AGENTS.md");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-codicon-demo");

/** Символ шрифта по имени codicon'а — тот же источник правды, что у подменщика. */
function glyph(name: string): string {
    const found = CODICON_GLYPHS[name];
    if (found === undefined) throw new Error(`codicon-labels: в таблице нет значка "${name}"`);
    return found;
}

/** Все код-пойнты приватной области, которые реально есть на кадре. */
function puaOnFrame(frame: GridSnapshot): Set<string> {
    const found = new Set<string>();
    for (let y = 0; y < frame.rows; y++) {
        for (let x = 0; x < frame.cols; x++) {
            const char = frame.cells[y * frame.cols + x].char;
            const code = char.codePointAt(0);
            if (code !== undefined && code >= 0xe000 && code <= 0xf8ff) found.add(char);
        }
    }
    return found;
}

/** Требует конкретные глифы в ячейках кадра — текстовый дамп их не различает. */
function expectGlyphs(frame: GridSnapshot, step: string, names: readonly string[]): void {
    const present = puaOnFrame(frame);
    const missing = names.filter((name) => !present.has(glyph(name)));
    if (missing.length > 0) {
        throw new Error(`codicon-labels/${step}: на кадре нет глифов ${missing.join(", ")}\n${dumpFrame(frame)}`);
    }
}

/** Разметки `$(` на кадре быть не должно: раз глиф есть, литерал — вторая копия. */
function expectNoMarkup(frame: GridSnapshot, step: string): void {
    for (let y = 0; y < frame.rows; y++) {
        if (frameLine(frame, y).includes("$(")) {
            throw new Error(`codicon-labels/${step}: на кадре остался литерал $(…)\n${dumpFrame(frame)}`);
        }
    }
}

/** Требует дословный текст в ячейках: подмена выбросила бы неизвестное имя. */
function expectVerbatim(frame: GridSnapshot, step: string, needle: string): void {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) lines.push(frameLine(frame, y));
    if (!lines.some((line) => line.includes(needle))) {
        throw new Error(`codicon-labels/${step}: на кадре нет дословного "${needle}"\n${dumpFrame(frame)}`);
    }
}

/** Открывает палитру и набирает запрос. */
async function openPalette(editor: ScenarioDriver, query: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(query);
}

export default defineScenario({
    name: "codicon-labels",
    title: "Значки $(name) от расширения во всех раковинах: палитра, quick pick, поле ввода, прогресс, Output, полоса",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Extension-host сценарий: CI-safety-net гоняем только на Linux.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // 1. Статус-бар. Пункт `$(check) Ready` — единственная раковина, которая
        //    работала и до этой работы; тут она держит регрессию.
        const ready = await editor.waitForText((t) => t.includes("Ready"), { timeoutMs: 30_000 });
        expectGlyphs(ready, "status-bar", ["check"]);
        expectNoMarkup(ready, "status-bar");
        await editor.capture("status-bar");

        // 2. Палитра: заголовок И категория команды приехали из манифеста.
        //    Подпись пункта — `категория: заголовок`, значки в обеих половинах.
        await openPalette(editor, "Pick a Target");
        const palette = await editor.waitForText((t) => t.includes("Codicon Demo: ") && t.includes("Pick a Target"));
        expectGlyphs(palette, "palette", ["beaker", "list-selection"]);
        expectNoMarkup(palette, "palette");
        await editor.capture("palette");

        // 3. Quick pick расширения: заголовок, placeholder, метки и описания.
        await editor.sendKey("Enter");
        const pick = await editor.waitForText((t) => t.includes("first target") && t.includes("release"), {
            timeoutMs: 30_000,
        });
        expectGlyphs(pick, "quick-pick", ["beaker", "search", "file", "git-branch"]);
        expectNoMarkup(pick, "quick-pick");
        await editor.capture("quick-pick");
        await editor.sendKey("Escape");

        // 4. Поле ввода: заголовок и подсказка — глифы, а НАЧАЛЬНОЕ ЗНАЧЕНИЕ
        //    дословно, вместе с неизвестным именем значка.
        await openPalette(editor, "Ask for a Port");
        await editor.sendKey("Enter");
        const input = await editor.waitForText((t) => t.includes("which port should the server use"), {
            timeoutMs: 30_000,
        });
        expectGlyphs(input, "input-box", ["edit", "info"]);
        expectVerbatim(input, "input-box", "$(no-such-icon) 8080");
        await editor.capture("input-box");
        await editor.sendKey("Escape");

        // Второй показ — placeholder и сообщение валидации. Отдельной командой,
        // потому что сообщение валидации ЗАМЕНЯЕТ строку подсказки: показать
        // prompt и validation на одном кадре нельзя.
        await openPalette(editor, "Ask with Validation");
        await editor.sendKey("Enter");
        const empty = await editor.waitForText((t) => t.includes("for example 8080"), { timeoutMs: 30_000 });
        expectGlyphs(empty, "input-placeholder", ["edit", "search"]);
        expectNoMarkup(empty, "input-placeholder");

        await editor.sendKey("x");
        const invalid = await editor.waitForText((t) => t.includes("digits only"), { timeoutMs: 30_000 });
        expectGlyphs(invalid, "validation", ["error"]);
        expectNoMarkup(invalid, "validation");
        await editor.capture("validation");
        await editor.sendKey("Escape");

        // 5. Прогресс: `withProgress` у нас всегда едет в полосу — это
        //    `ProgressLocation.Window`, чья подпись значки разворачивает.
        await openPalette(editor, "Codicon Demo: Reindex");
        await editor.sendKey("Enter");
        const progress = await editor.waitForText((t) => t.includes("Indexing") && t.includes("phase one"), {
            timeoutMs: 30_000,
        });
        expectGlyphs(progress, "progress", ["sync", "rocket"]);
        expectNoMarkup(progress, "progress");
        await editor.capture("progress");
        await openPalette(editor, "Codicon Demo: Stop");
        await editor.sendKey("Enter");

        // 6. Имя канала Output приезжает двумя путями сразу: заголовком команды
        //    `Output: Show <имя>` в палитре и подписью пункта в селекторе
        //    каналов. СТРОКИ канала при этом дословны — лог не разметка.
        await openPalette(editor, "Output: Show Codicon Demo");
        const channelCommand = await editor.waitForText((t) => t.includes("Output: Show"), { timeoutMs: 30_000 });
        expectGlyphs(channelCommand, "output-command", ["output"]);
        expectNoMarkup(channelCommand, "output-command");
        await editor.capture("output-command");
        await editor.sendKey("Escape");

        await openPalette(editor, "Codicon Demo: Show Log");
        await editor.sendKey("Enter");
        const log = await editor.waitForText((t) => t.includes("log lines stay verbatim"), { timeoutMs: 30_000 });
        expectGlyphs(log, "output-panel", ["output"]);
        expectVerbatim(log, "output-panel", "$(no-such-icon) still here");
        await editor.capture("output-panel");
    },
});
