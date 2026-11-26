import { resolve } from "node:path";

import { defineScenario, repoRoot, type ScenarioDriver } from "./framework.ts";

// The built-in HTML language features (upstream's html-language-features, ships with the binary): `<di` offers `div`,
// accepting it and typing `>` closes the tag with the caret between the tags, and the hover on `href` shows its
// documentation.

const htmlFile = resolve(repoRoot, "e2e", "fixtures", "htmlSample", "index.html");

async function palette(editor: ScenarioDriver, title: string): Promise<void> {
    await editor.sendKey("F1");
    await editor.waitForNode("#quickInput");
    await editor.sendText(title);
    await editor.waitForText((t) => t.includes(title), { timeoutMs: 20_000 });
    await editor.sendKey("Enter");
}

export default defineScenario({
    name: "html-language-features",
    title: "Built-in HTML: element completion, auto-closing tag, attribute hover",
    open: [htmlFile],
    cols: 110,
    rows: 24,
    // Extension host scenarios run a subprocess — Linux only.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        // The color swatch in `<style>` comes from the server: it is up.
        await editor.waitForText((t) => t.includes("color: ■ red"), { timeoutMs: 40_000 });
        // The empty line in <body>, indented.
        for (let i = 0; i < 8; i++) await editor.sendKey("ArrowDown");
        await editor.sendText("    ");
        for (const ch of "<di") await editor.sendKey(ch);
        await editor.waitForNode("#suggestWidget", { timeoutMs: 20_000 });
        await editor.waitForText((t) => t.includes("dialog"));
        await editor.capture("element-completion");

        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("<div") && !t.includes("dialog"));
        await editor.sendKey(">");
        await editor.waitForText((t) => t.includes("<div></div>"), { timeoutMs: 20_000 });
        await editor.waitForText((t) => t.includes("Ln 9, Col 10"));
        await editor.capture("closing-tag");

        // `href` on the next line.
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Home");
        for (let i = 0; i < 4; i++) await editor.sendKey("ArrowRight");
        await palette(editor, "Show Hover");
        await editor.waitForText((t) => t.includes("Contains a URL or a URL fragment"), { timeoutMs: 20_000 });
        await editor.capture("attribute-hover");
    },
});
