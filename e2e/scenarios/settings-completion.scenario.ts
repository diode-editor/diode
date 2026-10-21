import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `editor.` does not occur in the file itself — its appearance in the popup proves diode-settings completion,
// not the word-based fallback. The key is typed inside the object: outside it there is no key position and no
// suggestions.

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "settings.json");

export default defineScenario({
    name: "settings-completion",
    title: "Settings autocomplete (keys with quotes, values from schema)",
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 24,
    // Linux only: the extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("files.enableTrash"));
        await editor.capture("editor");

        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey(",");
        await editor.sendKey("Enter");

        await editor.sendKey('"');
        await editor.sendKey("e");
        await editor.sendKey("d");
        await editor.sendKey("i");

        await editor.waitForText((t) => t.includes("editor."), { timeoutMs: 4000 });
        await editor.capture("suggest-key");

        // An unambiguous prefix, not "the Nth from the top": the order depends on the number of `editor.*` keys in the
        // schema. Wait for the typed prefix, not the label: a narrow popup truncates it to `editor.…`. insertSpaces is
        // for its boolean values.
        await editor.sendText("tor.ins");
        await editor.waitForText((t) => t.includes('"editor.ins'), { timeoutMs: 4000 });
        await editor.sendKey("Enter");

        // The key is inserted quoted: the range covers the already typed quote, so it is not doubled.
        await editor.waitForText((t) => t.includes('"editor.insertSpaces"'), { timeoutMs: 4000 });
        await editor.capture("accepted-key");

        // The file has no `false` — its appearance proves the values come from the schema.
        await editor.sendKey(":");
        await editor.sendKey(" ");
        await editor.sendKey("f");
        await editor.waitForText((t) => t.includes("false"), { timeoutMs: 4000 });
        await editor.capture("suggest-value");
    },
});
