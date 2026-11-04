import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// #1049: diode keeps legacy keys unless `terminal.tier` asks for more, and only says in the status bar
// what the terminal could do. Under tmux the availability comes from tmux itself: a fake `tmux` on PATH
// answers `extended-keys on` and a client with the `extkeys` feature.

const fakeBin = mkdtempSync(join(tmpdir(), "diode-fake-tmux-"));
writeFileSync(
    join(fakeBin, "tmux"),
    [
        "#!/bin/sh",
        'case "$*" in',
        '  "show-options -sv extended-keys") echo on ;;',
        '  *client_termfeatures*) echo "bpaste,extkeys,title" ;;',
        '  *client_termtype*) echo "xterm-256color" ;;',
        "  *) exit 1 ;;",
        "esac",
        "",
    ].join("\n"),
    { mode: 0o755 },
);

export default defineScenario({
    name: "extended-keys-available",
    title: "Legacy keys by default; the status bar says tmux could pass extended keys",
    open: [join(repoRoot, "AGENTS.md")],
    cols: 120,
    rows: 24,
    env: { PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}` },
    terminalIdentity: { TMUX: "/tmp/diode-fake-tmux,1,0" },
    // The fake tmux is a shell script.
    skipOn: ["win32"],
    async run(editor) {
        await editor.waitForText((t) => t.includes("legacy · tmux · csi-u available"), { timeoutMs: 20_000 });
        await editor.capture("status-bar");
    },
});
