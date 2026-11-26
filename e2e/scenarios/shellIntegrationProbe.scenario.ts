import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog, waitForActivationLine } from "../helpers/activationLog.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// The shell integration probe (e2e/marketplace/shell-integration-probe) logs what the terminal API tells extensions.
// It activates on `onTerminalShellIntegration:*`: nothing starts it until bash, injected with the shell integration
// script, draws its first prompt. Then each command is a start, its raw output (from the `633;C` sequence) and an end
// with the exit code; `cd` changes `shellIntegration.cwd`.

const PROBE_ID = "test.shell-integration-probe";
const SHOW_PROBE_LOG = `workbench.action.output.show.extensions.${PROBE_ID}.shell-integration-probe`;
const probeVsix = join(mkdtempSync(join(tmpdir(), "diode-probe-")), `${PROBE_ID}-0.0.1.vsix`);

export default defineScenario({
    name: "shell-integration-probe",
    title: "Shell integration API: an extension sees each terminal command start, stream its output and end",
    open: [],
    installVsix: [probeVsix],
    cols: 150,
    rows: 34,
    userKeybindings: [
        ...ACTIVATION_LOG_KEYBINDINGS,
        { key: "f7", command: "workbench.action.createTerminalEditor" },
        { key: "f8", command: SHOW_PROBE_LOG },
    ],
    // bash is the shell the script is injected into; Windows has none of it.
    skipOn: ["win32"],
    prepare() {
        const result = spawnSync(
            process.execPath,
            [
                join(repoRoot, "scripts", "pack-vsix.mjs"),
                resolve(repoRoot, "e2e", "marketplace", "shell-integration-probe"),
                probeVsix,
            ],
            { encoding: "utf8" },
        );
        if (result.status !== 0) throw new Error(`pack-vsix: ${result.stderr}`);
        return Promise.resolve();
    },
    env: { SHELL: "/bin/bash" },
    // F8 is pressed with the focus in the terminal, which otherwise sends it to the shell.
    settings: { "terminal.integrated.commandsToSkipShell": [SHOW_PROBE_LOG] },
    async run(editor) {
        await editor.waitForReady();
        await openActivationLog(editor);

        // The terminal in the editor area, the logs in the panel below it.
        await editor.sendKey("F7");
        // The system bashrc draws its own prompt: a line ending with `$` before the group frame's right line.
        await editor.waitForText((t) => /\$\s*│?$/mu.test(t), { timeoutMs: 30_000 });
        await waitForActivationLine(editor, `activated extension "${PROBE_ID}" (onTerminalShellIntegration:*)`);
        await editor.capture("activated");

        // The panel shows the tail of the log: each command is checked right after it ran.
        await editor.sendKey("F8");
        await editor.waitForText((t) => t.includes("Shell Integration Probe"));
        await editor.sendText("echo hi\r");
        await editor.waitForText(
            (t) =>
                t.includes('start: "echo hi" (High, trusted)') &&
                t.includes('data: "\\u001b]633;C\\u0007hi\\r\\n"') &&
                t.includes('end: "echo hi" (High, trusted) exit=0'),
            { timeoutMs: 15_000 },
        );
        await editor.capture("echo");
        await editor.sendText("false\r");
        await editor.waitForText((t) => t.includes('end: "false" (High, trusted) exit=1'), { timeoutMs: 15_000 });
        await editor.sendText("cd /tmp\r");
        await editor.waitForText((t) => t.includes('shellIntegration changed: terminal "bash", cwd=/tmp'), {
            timeoutMs: 15_000,
        });
        await editor.capture("probe-output");
    },
});
