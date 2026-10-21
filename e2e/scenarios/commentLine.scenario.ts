import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";


const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "comment-line",
    title: "Toggle Line Comment (Ctrl+/) и Block Comment по language-configuration",
    open: [repoRoot, sampleFile],
    // A legacy terminal does not pass Shift+Alt+A, so the same command is bound to the reachable F6.
    userKeybindings: [{ key: "f6", command: "editor.action.blockComment" }],
    cols: 100,
    rows: 24,
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("Ctrl+/");
        await editor.waitForText((t) => t.includes('// const greeting = "hello";'));
        await editor.capture("toggle-line");

        await editor.sendKey("Ctrl+/");
        await editor.waitForText((t) => t.includes('const greeting = "hello";') && !t.includes("// const greeting"));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Shift+ArrowDown");
        await editor.sendKey("Shift+ArrowDown");
        await editor.sendKey("Shift+End");
        await editor.sendKey("Ctrl+/");
        await editor.waitForText(
            (t) => t.includes("// export function greet") && t.includes("// }"),
        );
        await editor.capture("toggle-selection");
        await editor.sendKey("Ctrl+/");
        await editor.waitForText((t) => !t.includes("// export function"));

        await editor.sendKey("Home");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("ArrowUp");
        await editor.sendKey("Shift+End");
        await editor.sendKey("F6");
        await editor.waitForText((t) => t.includes("/* const answer = 42; */"));
        await editor.capture("block-comment");
    },
});
