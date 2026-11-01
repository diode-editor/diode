import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The `type` command goes the keyboard's way: a bracket auto-closes, a line break keeps the indent. A keybinding
// with `args` is the same call an extension makes with `executeCommand("type", { text })`.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "sample.ts");

export default defineScenario({
    name: "type-command",
    title: "The type command: text from a command behaves as typed",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    userKeybindings: [
        { key: "alt+k", command: "type", args: { text: "    typed({" } },
        { key: "alt+j", command: "default:type", args: { text: "\n" } },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("greeting"));

        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("Enter");
        await editor.sendKey("Alt+k");
        await editor.waitForText((t) => t.includes("typed({})"));
        await editor.capture("auto-close");

        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => /typed\(\{\s*\n[^\n]*\n[^\n]*\}\)/.test(t));
        await editor.capture("enter-expands-block");
    },
});
