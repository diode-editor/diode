import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `TextEditor.insertSnippet` (#967): an extension's Enter between brackets, the shape of KevinRose.vsc-python-indent.
// The snippet opens a hanging indent with the caret inside, and undo takes it back in one step.

const textFile = resolve(repoRoot, "e2e", "fixtures", "insert-snippet.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-insert-snippet");

export default defineScenario({
    name: "extension-insert-snippet",
    title: "TextEditor.insertSnippet: a hanging indent with the caret inside, one undo step",
    seedUserData: userData,
    open: [repoRoot, textFile],
    cols: 100,
    rows: 20,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    userKeybindings: [{ key: "f6", command: "insertSnippetDemo.hang" }],
    async run(editor) {
        await editor.waitForText((text) => text.includes("foo()"));
        await editor.waitForReady();
        await editor.sendKey("End");
        await editor.sendKey("ArrowLeft");
        await editor.waitForText((text) => text.includes("Ln 1, Col 9"));
        await editor.capture("caret-between-brackets");

        await editor.sendKey("F6");
        await editor.waitForText((text) => text.includes("foo(") && !text.includes("foo()") && text.includes("Ln 2, Col 9"));
        await editor.capture("hanging-indent");

        await editor.sendKey("Ctrl+Z");
        await editor.waitForText((text) => text.includes("foo()"));
        await editor.capture("one-undo-step");
    },
});
