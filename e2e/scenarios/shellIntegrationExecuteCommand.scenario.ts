import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { ACTIVATION_LOG_KEYBINDINGS, openActivationLog } from "../helpers/activationLog.ts";

import { defineScenario, repoRoot } from "./framework.ts";

// `TerminalShellIntegration.executeCommand` through the shell integration probe (e2e/marketplace/shell-integration-probe):
// asked for right after a terminal opens, it waits for the prompt; text typed on the prompt is cleared with Ctrl+C
// first; `executeCommand(executable, args)` quotes an argument with whitespace.

const PROBE_ID = "test.shell-integration-probe";
const SHOW_PROBE_LOG = `workbench.action.output.show.extensions.${PROBE_ID}.shell-integration-probe`;
const EXECUTE = "shellIntegrationProbe.executeCommand";
const probeVsix = join(mkdtempSync(join(tmpdir(), "diode-probe-")), `${PROBE_ID}-0.0.1.vsix`);

/** The screen without the frame side lines `│` that open and close every row of the terminal editor. */
function unframed(text: string): string {
    return text
        .split("\n")
        .map((row) => row.replace(/^│/u, "").replace(/│\s*$/u, ""))
        .join("\n");
}

export default defineScenario({
    name: "shell-integration-execute-command",
    title: "executeCommand: waits for the prompt of a new terminal, clears typed text, quotes arguments",
    open: [],
    installVsix: [probeVsix],
    cols: 150,
    rows: 34,
    userKeybindings: [
        ...ACTIVATION_LOG_KEYBINDINGS,
        { key: "f7", command: "workbench.action.createTerminalEditor" },
        { key: "f8", command: SHOW_PROBE_LOG },
        { key: "f9", command: EXECUTE },
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
    // F8 and F9 are pressed with the focus in the terminal, which otherwise sends them to the shell.
    settings: { "terminal.integrated.commandsToSkipShell": [SHOW_PROBE_LOG, EXECUTE] },
    async run(editor) {
        await editor.waitForReady();
        // The Output panel open below the terminal: switching its channel does not open it.
        await openActivationLog(editor);

        // A new terminal and at once the probe's command: the command waits for the shell's prompt.
        await editor.sendKey("F7");
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("Command line to execute"), { timeoutMs: 30_000 });
        await editor.sendText("echo hi");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => /\$ echo hi\s*$/mu.test(unframed(t)) && /^hi\s*$/mu.test(unframed(t)), {
            timeoutMs: 30_000,
        });
        await editor.sendKey("F8");
        await editor.waitForText(
            (t) =>
                t.includes('start: "echo hi" (High, trusted)') && t.includes('end: "echo hi" (High, trusted) exit=0'),
            { timeoutMs: 15_000 },
        );
        await editor.capture("new-terminal");

        // Text left on the prompt: Ctrl+C clears it, only the command runs.
        await editor.sendText("abc");
        await editor.waitForText((t) => /\$ abc\s*$/mu.test(unframed(t)));
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("Command line to execute"));
        await editor.sendText("echo ok");
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('end: "echo ok" (High, trusted) exit=0'), { timeoutMs: 15_000 });
        await editor.waitForText((t) => /\$ abc\^C\s*$/mu.test(unframed(t)) && /^ok\s*$/mu.test(unframed(t)));
        await editor.capture("typed-text-cleared");

        // An executable and its arguments.
        await editor.sendKey("F9");
        await editor.waitForText((t) => t.includes("Command line to execute"));
        await editor.sendText('["echo", "a b", "c"]');
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes('end: "echo \\"a b\\" c" (High, trusted) exit=0'), {
            timeoutMs: 15_000,
        });
        await editor.waitForText((t) => t.includes('$ echo "a b" c') && /^a b c\s*$/mu.test(unframed(t)));
        await editor.capture("arguments");
    },
});
