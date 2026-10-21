import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { dumpFrame, findTextCell } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Форма стокового Claude Code (`openDiff` терминального режима); кнопки ✓/↺ — по видимости стороны в `visibleTextEditors`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "proposed-diff", "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-proposed-diff");

/** codicon `check` — кнопка «принять». */
const CHECK = "\u{eab2}";
/** codicon `discard` — кнопка «отклонить». */
const DISCARD = "\u{eae2}";
const TAB_ROW = 1;
const TAB_TITLE = "[Proposed] sample.txt";

async function runCommand(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title));
    await editor.sendKey("Enter");
}

const tabRow = (text: string): string => text.split("\n")[TAB_ROW] ?? "";

/** Нет вхождения — падение с дампом кадра. */
function locate(frame: GridSnapshot, needle: string): { x: number; y: number } {
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`нет «${needle}» в кадре:\n${dumpFrame(frame)}`);
    return cell;
}

/** Предлагает правку и ждёт дифф-вкладку с кнопками ✓/↺. */
async function propose(editor: ScenarioDriver): Promise<string> {
    await runCommand(editor, "Proposed Diff Demo: Propose Changes");
    return editor.waitForText(
        (t) => tabRow(t).includes(TAB_TITLE) && tabRow(t).includes(CHECK) && tabRow(t).includes(DISCARD),
    );
}

const diffClosed = (t: string): boolean => !tabRow(t).includes(TAB_TITLE) && !tabRow(t).includes(CHECK);

export default defineScenario({
    name: "proposed-diff",
    title: "Предложенный дифф: правая сторона из провайдера расширения, accept/reject/сохранение",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 20,
    async run(editor) {
        await editor.waitForText((t) => t.includes("diff:-"), { timeoutMs: 20_000 });
        await editor.waitForReady();

        // Дифф-вкладка: справа предложение расширения, в панели группы — ✓ и ↺.
        const proposed = await propose(editor);
        await editor.capture("proposed");

        // Правка правой стороны прямо в диффе и Ctrl+S — принятие с правленым текстом.
        const right = locate(proposed, "HELLO");
        await editor.click(right.x, right.y);
        await editor.sendKey("End");
        await editor.sendText(" (edited)");
        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => t.includes("diff:FILE_SAVED:(edited)"));
        await editor.capture("saved");

        // CLI закрывает вкладку сам: сохранение стороны + tabGroups.close.
        await runCommand(editor, "Proposed Diff Demo: Close Diff Tab");
        await editor.waitForText(diffClosed);

        // ↺ — отклонение.
        const again = await propose(editor);
        const discard = locate(again, DISCARD);
        await editor.click(discard.x, discard.y);
        await editor.waitForText((t) => t.includes("diff:DIFF_REJECTED"));
        await editor.capture("rejected");
        await runCommand(editor, "Proposed Diff Demo: Close Diff Tab");
        await editor.waitForText(diffClosed);

        // Закрытие вкладки — тоже отклонение; ключ гаснет, кнопки уходят.
        await propose(editor);
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => t.includes("diff:TAB_CLOSED") && diffClosed(t));
        await editor.capture("closed");
    },
});
