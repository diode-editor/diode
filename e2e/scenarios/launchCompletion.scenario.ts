import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// IntelliSense in launch.json by the debuggers' schema: the Debug Demo extension contributes the `demo` debugger with
// `configurationAttributes` and `configurationSnippets`; diode-settings reads them from its manifest. Neither
// `stopOnEntry` nor `Debug Demo: Launch` occurs in the file — their appearance proves the completion comes from the
// debugger's contribution, not the word-based fallback.

const folder = resolve(repoRoot, "e2e", "fixtures", "launch-completion");
const launchJson = resolve(folder, ".diode", "launch.json");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-debug-demo");

export default defineScenario({
    name: "launch-completion",
    title: "launch.json IntelliSense: the debugger's attributes, their values and its configuration snippets",
    seedUserData: userData,
    open: [folder, launchJson],
    cols: 100,
    rows: 28,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes('"request": "launch"'));
        await editor.waitForReady();
        await editor.capture("editor");

        // After `"request": "launch"` of the `demo` configuration: a new attribute.
        await editor.sendKey("Ctrl+End");
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowUp");
        await editor.sendKey("End");
        await editor.sendKey(",");
        await editor.sendKey("Enter");
        await editor.sendKey('"');
        await editor.waitForText((t) => t.includes("stopOnEntry") && t.includes("program"), { timeoutMs: 4000 });
        await editor.capture("suggest-attribute");

        await editor.sendText("sto");
        await editor.waitForText((t) => t.includes('"sto'), { timeoutMs: 4000 });
        await editor.sendKey("Enter");
        // The key is inserted quoted: the range covers the typed quote, so it is not doubled.
        await editor.waitForText((t) => t.includes('"stopOnEntry"'), { timeoutMs: 4000 });

        // Its boolean values; the file has no `false`. Key by key: `sendText` goes in as one paste, which opens no popup.
        await editor.sendKey(":");
        await editor.sendKey(" ");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("false"), { timeoutMs: 4000 });
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('"stopOnEntry": false'), { timeoutMs: 4000 });
        await editor.capture("accepted-value");

        // After the configuration: the debugger's snippet, indented like the configuration above it.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey(",");
        await editor.sendKey("Enter");
        await editor.sendKey("Ctrl+Space");
        await editor.waitForText((t) => t.includes("Debug Demo: Launch"), { timeoutMs: 4000 });
        await editor.capture("suggest-snippet");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('"program": "./hello"'), { timeoutMs: 4000 });
        await editor.capture("accepted-snippet");
    },
});
