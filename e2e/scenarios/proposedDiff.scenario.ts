import { resolve } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { dumpFrame, findTextCell } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// Mirrors the stock Claude Code extension (`openDiff` in terminal mode); the ✓/↺ buttons follow the side's visibility
// in `visibleTextEditors`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "proposed-diff", "sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-proposed-diff");

/** codicon `check` — the "accept" button. */
const CHECK = "\u{eab2}";
/** codicon `discard` — the "reject" button. */
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

/** Throws with a frame dump when there is no match. */
function locate(frame: GridSnapshot, needle: string): { x: number; y: number } {
    const cell = findTextCell(frame, needle);
    if (cell === null) throw new Error(`нет «${needle}» в кадре:\n${dumpFrame(frame)}`);
    return cell;
}

/** Proposes an edit and waits for the diff tab with the ✓/↺ buttons. */
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

        // Diff tab: the extension's proposal on the right, ✓ and ↺ in the group toolbar.
        const proposed = await propose(editor);
        await editor.capture("proposed");

        // Editing the right side in the diff and pressing Ctrl+S accepts the edited text.
        const right = locate(proposed, "HELLO");
        await editor.click(right.x, right.y);
        await editor.sendKey("End");
        await editor.sendText(" (edited)");
        await editor.sendKey("Ctrl+S");
        await editor.waitForText((t) => t.includes("diff:FILE_SAVED:(edited)"));
        await editor.capture("saved");

        // The CLI closes the tab itself: save the side + tabGroups.close.
        await runCommand(editor, "Proposed Diff Demo: Close Diff Tab");
        await editor.waitForText(diffClosed);

        // ↺ rejects.
        const again = await propose(editor);
        const discard = locate(again, DISCARD);
        await editor.click(discard.x, discard.y);
        await editor.waitForText((t) => t.includes("diff:DIFF_REJECTED"));
        await editor.capture("rejected");
        await runCommand(editor, "Proposed Diff Demo: Close Diff Tab");
        await editor.waitForText(diffClosed);

        // Closing the tab rejects too; the context key resets and the buttons go away.
        await propose(editor);
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => t.includes("diff:TAB_CLOSED") && diffClosed(t));
        await editor.capture("closed");
    },
});
