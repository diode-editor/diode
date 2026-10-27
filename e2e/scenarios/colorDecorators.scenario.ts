import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineScenario } from "./framework.ts";

// The built-in detector needs no extension: a square of the color before every hex/rgb/hsl color. The workspace lives
// in a temp directory: the scenario rewrites its `.diode/settings.json` to turn `editor.colorDecorators` off live.

const sampleDir = mkdtempSync(join(tmpdir(), "diode-color-decorators-"));
const cssFile = join(sampleDir, "palette.css");
const settingsFile = join(sampleDir, ".diode", "settings.json");

const CSS = `.swatch {
  color: #ff0000;
  background: #0f08;
  border-color: rgb(0 128 255);
  outline-color: rgba(255, 128, 0, 0.5);
  fill: hsl(120, 100%, 50%);
  stroke: hsla(280, 100%, 50%, 0.6);
  caret-color: #ffcc00ff;
}
`;

export default defineScenario({
    name: "color-decorators",
    title: "Color decorators: a square of the color before hex, rgb and hsl colors in any file",
    open: [sampleDir, cssFile],
    cols: 100,
    rows: 20,
    async prepare() {
        mkdirSync(join(sampleDir, ".diode"), { recursive: true });
        writeFileSync(settingsFile, "{}\n");
        writeFileSync(cssFile, CSS);
    },
    async run(editor) {
        await editor.waitForText(
            (t) => t.includes("color: ■ #ff0000;") && t.includes("stroke: ■ hsla(280, 100%, 50%, 0.6);"),
            { timeoutMs: 15_000 },
        );
        await editor.capture("formats");

        // A typed color gets its square after the debounce.
        await editor.sendKey("Ctrl+End");
        await editor.sendText("/* accent: #00ff00 */");
        await editor.waitForText((t) => t.includes("/* accent: ■ #00ff00 */"));
        await editor.capture("typed");

        // Live off, without reopening the file.
        writeFileSync(settingsFile, '{ "editor.colorDecorators": false }\n');
        await editor.waitForText((t) => t.includes("color: #ff0000;") && !t.includes("■"));
        await editor.capture("off");
    },
});
