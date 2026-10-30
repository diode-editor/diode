import { defineScenario, repoRoot } from "./framework.ts";

// Quick Open without a query lists recently opened files (a closed tab included), Ctrl+E Ctrl+E Enter
// returns to the previous one, and the list survives a window reload.

const RECENT_ROW = /folding\.ts[\s\S]*main\.ts[\s\S]*sample\.ts/;

export default defineScenario({
    name: "quick-open-history",
    title: "Quick Open: recently opened files (Ctrl+P, Ctrl+E)",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    userKeybindings: [{ key: "ctrl+alt+r", command: "workbench.action.reloadWindow" }],
    async run(editor) {
        await editor.waitForReady();

        const openByName = async (query: string, marker: string): Promise<void> => {
            await editor.sendKey("Ctrl+P");
            await editor.waitForNode("#quickInput");
            await editor.sendText(query);
            await editor.waitForText((t) => t.includes(marker));
            await editor.sendKey("Enter");
            await editor.waitForText((t) => !t.includes("Go to File") && t.includes(marker));
        };
        await openByName("e2e/fixtures/sample.ts", "sample.ts");
        await openByName("e2e/fixtures/folding.ts", "folding.ts");
        await openByName("lspSample/main.ts", "lspSample");

        // Closing main.ts does not take it out of the history.
        await editor.sendKey("Ctrl+W");
        await editor.waitForText((t) => !t.includes("main.ts"));

        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => RECENT_ROW.test(t));
        await editor.capture("recent");

        await editor.sendKey("Escape");
        await editor.waitForText((t) => !t.includes("Go to File"));

        // Ctrl+E is the second Quick Open key; pressed again it steps down: Enter opens the previous file.
        await editor.sendKey("Ctrl+E");
        await editor.waitForText((t) => RECENT_ROW.test(t));
        await editor.sendKey("Ctrl+E");
        await editor.capture("second-row");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("main.ts") && !t.includes("Go to File"));
        await editor.capture("reopened");

        // The history is workspace state: after a reload the same files are listed.
        await editor.sendKey("Ctrl+Alt+R");
        await editor.reconnect();
        await editor.waitForReady();
        await editor.sendKey("Ctrl+P");
        await editor.waitForText((t) => /main\.ts[\s\S]*folding\.ts[\s\S]*sample\.ts/.test(t));
        await editor.capture("after-reload");
    },
});
