import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StyleFlags } from "@tuidom/core/common/styleFlags";

import { findTextCell } from "../helpers/frame.ts";
import { waitUntil } from "../helpers/waitFor.ts";

import { defineScenario } from "./framework.ts";

// Stock ShellCheck from the marketplace on its WebAssembly runtime: a squiggle with the rule code in Problems, the
// hover on the diagnostic, Apply fix through Ctrl+., and the disable comment with its wiki link.

const projectRoot = join(tmpdir(), "diode-scenario-shellcheck");
const script = join(projectRoot, "script.sh");

export default defineScenario({
    name: "shellcheck",
    title: "ShellCheck from the marketplace: diagnostics with a code, hover, quick fix, disable comment, wiki link",
    open: [projectRoot, script],
    installVsix: ["timonwong.shellcheck"],
    network: true,
    cols: 130,
    rows: 22,
    // Extension host scenarios run a subprocess: Linux only.
    skipOn: ["win32", "darwin"],
    // The hover's second block is the extension's own HTML (supportHtml), shown as text.
    settings: { "shellcheck.runtime": "wasm", "shellcheck.markdownDiagnostics": true },
    userKeybindings: [
        { key: "ctrl+alt+n", command: "notifications.clearAll" },
        { key: "ctrl+alt+m", command: "workbench.actions.view.problems" },
        { key: "ctrl+alt+e", command: "workbench.action.focusActiveEditorGroup" },
        { key: "ctrl+alt+h", command: "editor.action.showHover" },
        { key: "ctrl+alt+o", command: "editor.action.openLink" },
    ],
    // Keeps a browser from opening where the run happens to have a display.
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    prepare() {
        rmSync(projectRoot, { recursive: true, force: true });
        mkdirSync(projectRoot, { recursive: true });
        writeFileSync(script, "#!/bin/bash\necho $1\n");
        return Promise.resolve();
    },
    async run(editor) {
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => frame.cells.some((cell) => (cell.style & 8) !== 0),
            { describe: "undercurl squiggle from ShellCheck", timeoutMs: 60_000, intervalMs: 500 },
        );
        await editor.waitForText((t) => t.includes("has new features"), { timeoutMs: 20_000 });
        await editor.capture("whats-new-toast");
        await editor.sendKey("Ctrl+Alt+n");
        await editor.sendKey("Ctrl+Alt+m");
        await editor.waitForText((t) => t.includes("shellcheck(SC2086)"), { timeoutMs: 20_000 });
        await editor.sendKey("Ctrl+Alt+e");
        await editor.capture("diagnostic-with-code");

        await editor.sendKey("Ctrl+Home");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("End");
        await editor.sendKey("ArrowLeft");
        await editor.sendKey("Ctrl+Alt+h");
        await editor.waitForNode("#hoverWidget");
        // ShellCheck rates SC2086 as info: the header of its block is `Information (SC2086)`.
        await editor.waitForText((t) => t.includes("Information (SC2086)") && !/<span|codicon/.test(t), {
            timeoutMs: 20_000,
        });
        await editor.capture("hover-on-the-diagnostic");
        await editor.sendKey("Escape");

        await editor.sendKey("Ctrl+.");
        await editor.waitForText((t) => t.includes("Apply fix for SC2086"), { timeoutMs: 20_000 });
        await editor.capture("quick-fix-menu");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('echo "$1"') && !t.includes("shellcheck(SC2086)"), {
            timeoutMs: 20_000,
        });
        await editor.capture("fix-applied");

        await editor.sendKey("Ctrl+End");
        await editor.sendText("rm $2");
        await editor.waitForText((t) => t.includes("shellcheck(SC2086)  [Ln 3, Col 4]"), { timeoutMs: 20_000 });
        await editor.sendKey("End");
        await editor.sendKey("Ctrl+.");
        await editor.waitForText((t) => t.includes("Disable SC2086 for this line"), { timeoutMs: 20_000 });
        await editor.sendKey("ArrowDown");
        await editor.sendKey("ArrowDown");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("# shellcheck disable=SC2086"), { timeoutMs: 20_000 });
        // Links arrive after the text: Open Link before them finds nothing.
        await waitUntil(
            () => editor.captureFrame(),
            (frame) => {
                const at = findTextCell(frame, "SC2086");
                return at !== null && (frame.cells[at.y * frame.cols + at.x].style & StyleFlags.Underline) !== 0;
            },
            { describe: "the underline of the wiki link", timeoutMs: 20_000, intervalMs: 100 },
        );
        await editor.capture("disable-comment");

        await editor.sendKey("ArrowUp");
        await editor.sendKey("End");
        await editor.sendKey("ArrowLeft");
        await editor.sendKey("Ctrl+Alt+o");
        await editor.waitForText((t) => t.includes("https://www.shellcheck.net/wiki/SC2086"), { timeoutMs: 20_000 });
        await editor.capture("wiki-link-copied");
    },
});
