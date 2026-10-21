import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// #401. Button coordinates come from inspectState: the panel row is shared with the tab controls,
// and computing them by hand has bitten before.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "panel-close",
    title: "Кнопка закрытия нижней панели",
    open: [repoRoot, sampleFile],
    cols: 120,
    rows: 32,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("Ctrl+J");
        const panel = await editor.waitForNode("#panel");
        await editor.capture("panel-open");

        const close = panel.state?.close as { centerX: number } | null | undefined;
        const tabRow = panel.state?.tabRow as number;
        if (close == null) throw new Error(`панель без кнопки закрытия: ${JSON.stringify(panel.state)}`);

        // Clicking `×` closes the panel and the editor takes its place.
        await editor.click(close.centerX, tabRow);
        await editor.waitForText((t) => !t.includes("PROBLEMS"));
        await editor.capture("panel-closed");
    },
});
