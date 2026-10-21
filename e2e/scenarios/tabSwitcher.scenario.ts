import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The headless inspector does not send keyup for a lone modifier (kitty event type 3) — the end of a series is
// signalled with Ctrl+PgDn: it ends the series the same way releasing Ctrl does.

const fileA = resolve(repoRoot, "e2e", "fixtures", "sample.ts");
const fileB = resolve(repoRoot, "e2e", "fixtures", "folding.ts");
const fileC = resolve(repoRoot, "e2e", "fixtures", "wordWrap.ts");

export default defineScenario({
    name: "tab-switcher",
    title: "Ctrl+Tab: видимый MRU-список вкладок и шаг по нему стрелками; Ctrl+PgDn/PgUp: цикл по порядку табов",
    open: [repoRoot, fileA, fileB, fileC],
    cols: 120,
    rows: 32,
    async run(editor) {
        // Wait for each series step by the content under the overlay (the names are always in the frame); markers come
        // from the files' first line, which is above the overlay (~10% of the screen height).
        const underOverlay = { "folding.ts": "folding-chevron hover", "sample.ts": "used by SEA e2e" } as const;
        const stepTo = async (file: keyof typeof underOverlay): Promise<void> => {
            await editor.waitForText((t) => t.includes("╭") && t.includes(underOverlay[file]));
        };

        await editor.waitForText(
            (t) => t.includes("sample.ts") && t.includes("folding.ts") && t.includes("wordWrap.ts"),
        );

        // An edit in the active tab (wordWrap.ts): the overlay shows a ● marker for it.
        await editor.sendText("// touched\n");
        await editor.waitForText((t) => t.includes("●"));

        await editor.sendKey("Ctrl+Tab");
        await stepTo("folding.ts");
        await editor.capture("mru-list");

        await editor.sendKey("Ctrl+Tab");
        await stepTo("sample.ts");
        await editor.capture("mru-deeper");

        await editor.sendKey("Ctrl+ArrowUp");
        await stepTo("folding.ts");
        await editor.capture("arrow-up");

        await editor.sendKey("Ctrl+ArrowDown");
        await stepTo("sample.ts");
        await editor.capture("arrow-down");

        // Ctrl+PgDn follows tab order, not MRU.
        await editor.sendKey("Ctrl+PageDown");
        await editor.waitForText((t) => !t.includes("╭"));
        await editor.capture("visual-cycle");
    },
});
