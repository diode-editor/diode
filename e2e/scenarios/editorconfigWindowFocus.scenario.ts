import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock EditorConfig re-reads `.editorconfig` when the window regains focus: the user switches to another tmux pane,
// changes `indent_size` there and comes back — the tab width in the editor follows at once. The terminal reports
// the switch with mode 1004 (`CSI O` / `CSI I`); the extension hears it as `window.onDidChangeWindowState`.

const projectDir = mkdtempSync(join(tmpdir(), "diode-editorconfig-focus-"));
const tabbed = join(projectDir, "indent.tabbed");
const config = join(projectDir, ".editorconfig");

const editorconfig = (size: number): string =>
    `root = true\n\n[*.tabbed]\nindent_style = tab\nindent_size = ${String(size)}\n`;

/** Columns a leading tab takes: both lines share the gutter, so the difference is the tab alone. */
function tabWidth(frame: GridSnapshot): number | null {
    const indented = findTextCell(frame, "indented");
    const end = findTextCell(frame, "end");
    return indented !== null && end !== null ? indented.x - end.x : null;
}

export default defineScenario({
    name: "editorconfig-window-focus",
    title: "EditorConfig re-reads .editorconfig when you come back to the window (terminal focus reports)",
    open: [projectDir, tabbed],
    installVsix: ["EditorConfig.EditorConfig"],
    network: true,
    cols: 80,
    rows: 14,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    prepare() {
        writeFileSync(config, editorconfig(2));
        writeFileSync(tabbed, "\tindented\nend\n");
        return Promise.resolve();
    },
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => tabWidth(frame) === 2,
            { describe: "tab width 2 from .editorconfig", timeoutMs: 60_000, intervalMs: 200 },
        );
        await editor.capture("indent-2");

        // Away in another pane: the file changes there.
        await editor.setWindowFocus(false);
        writeFileSync(config, editorconfig(8));
        await editor.setWindowFocus(true);
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => tabWidth(frame) === 8,
            { describe: "tab width 8 after coming back", timeoutMs: 20_000, intervalMs: 200 },
        );
        await editor.capture("indent-8");
    },
});
