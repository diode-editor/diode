import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


// A file of unknown language and no workspace folder: don't wake tsserver, whose spinner shifts the bar's segments
// (same reason as in statusBarExtension).
const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.hello");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-theme-selection");

export default defineScenario({
    name: "theme-selection-api",
    title: "window.activeColorTheme и onDidChangeTextEditorSelection",
    seedUserData: userData,
    open: [sampleFile],
    cols: 120,
    rows: 24,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Theme Dark"), { timeoutMs: 20_000 });
        await editor.capture("activated");

        // The arrow is a keybinding command, but for the extension it is Keyboard, as in VS Code.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowRight");
        await editor.waitForText((t) => t.includes("Sel 2:2 Keyboard"), { timeoutMs: 5000 });
        await editor.capture("keyboard");

        // The coordinate is from the left edge of the screen: the sidebar exists even without a folder and the text
        // starts around column 36; a click past the end of line 4 clamps to `Sel 4:12`. 5 s limit, same as for the
        // keyboard: the missed click was an engine bug (tuidom#22, the frame was not drawn), not a slow runner; after
        // the fix it takes 51–75 ms.
        await editor.click(50, 5);
        await editor.waitForText((t) => t.includes("Sel 4:12 Mouse"), { timeoutMs: 5000 });
        await editor.capture("mouse");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+T");
        await editor.waitForText((t) => t.includes("Light+"));
        await editor.sendText("Light+");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("Theme Light"), { timeoutMs: 5000 });
        await editor.capture("light-theme");
    },
});
