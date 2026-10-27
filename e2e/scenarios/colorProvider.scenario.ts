import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// `named-colors` registers `vscode.languages.registerColorProvider` for css and colors the words `red`,
// `green`, `blue`, `gold`, which the built-in detector does not see. With `editor.defaultColorDecorators:
// auto` the extension's answer silences the built-in detector: `#00ff00` has no square. Unregistering the
// provider (`named-colors.toggle`) takes its squares away and hands the file back to the built-in detector.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-color-provider-"));
const cssFile = join(sampleDir, "named.css");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-color-provider");

const CSS = `.alert {
  color: red;
  border-color: gold;
  background: #00ff00;
}

.link { color: blue; }
`;

export default defineScenario({
    name: "color-provider",
    title: "Extension color provider: squares before the colors an extension finds, the built-in detector as fallback",
    seedUserData: userData,
    open: [sampleDir, cssFile],
    cols: 80,
    rows: 16,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // J: F/E/S/V/G/H are menu bar mnemonics and O is the SS3 prefix.
    userKeybindings: [{ key: "alt+j", command: "named-colors.toggle" }],
    async prepare() {
        writeFileSync(cssFile, CSS);
    },
    async run(editor) {
        await editor.waitForText((t) => t.includes("color: ■ red;") && t.includes("color: ■ blue;"), {
            timeoutMs: 20_000,
        });
        await editor.capture("extension");

        await editor.waitForReady();
        await editor.sendKey("Alt+j");
        await editor.waitForText((t) => t.includes("background: ■ #00ff00;") && t.includes("color: red;"));
        await editor.capture("built-in");
    },
});
