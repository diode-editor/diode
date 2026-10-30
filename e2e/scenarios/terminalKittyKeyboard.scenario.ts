import { explorerTitle } from "../helpers/explorerTitle.ts";
import { defineScenario, repoRoot } from "./framework.ts";

// #857: a program in the terminal switches on the kitty keyboard protocol (`CSI > 1 u`) and gets unambiguous key
// codes, like in VS Code's terminal: Shift+Enter is CSI 13;2u instead of CR. `CSI ? u` is answered with the
// current flags; `CSI < u` brings the legacy encoding back. Under the protocol Ctrl+D is CSI u too, so the shell
// reads exactly the sequence's 7 bytes with `read -n` and pops the flags itself; `od -c` shows the bytes.

export default defineScenario({
    name: "terminal-kitty-keyboard",
    title: "Terminal: a program switches on the kitty keyboard protocol and tells Shift+Enter from Enter",
    open: [repoRoot],
    cols: 120,
    rows: 32,
    env: {
        SHELL: "/bin/bash",
        PS1: "diode$ ",
        PROMPT_COMMAND: "",
    },
    // node-pty spawns a real PTY — Linux only on CI for now.
    skipOn: ["win32", "darwin"],
    async run(editor) {
        await editor.waitForText((t) => t.includes(explorerTitle(repoRoot)));
        // Ctrl+K T: a chord, reachable on every tier.
        await editor.sendKey("Ctrl+K");
        await editor.sendKey("t");
        await editor.waitForText((t) => t.includes("TERMINAL"));
        await editor.waitForText((t) => t.includes("$") || t.includes("❯"));

        // The reply lands in the PTY input: `read` takes it up to the `u`.
        await editor.sendText(`printf '\\e[?u'; read -rsd u r; printf '%s' "$r" | od -c`);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("033   [   ?   0"));
        await editor.capture("query-reply");

        await editor.sendText(`printf '\\e[>1u'; echo kitty""-on; IFS= read -rsn7 k; printf '\\e[<u'; printf '%s' "$k" | od -c`);
        await editor.sendKey("Enter");
        // The marker comes after the push in the output: the emulator has the flags by now.
        await editor.waitForText((t) => t.includes("kitty-on"));
        await editor.sendKey("Shift+Enter");
        await editor.waitForText((t) => t.includes("033   [   1   3   ;   2   u"));
        await editor.capture("shift-enter-csi-u");

        // Popped: Shift+Enter is a CR again (the tty shows it as a newline).
        await editor.sendText(`echo legacy""-on; IFS= read -rsn1 -d '' k; printf '%s' "$k" | od -c`);
        await editor.sendKey("Enter");
        await editor.waitForText((t) => t.includes("legacy-on"));
        await editor.sendKey("Shift+Enter");
        await editor.waitForText((t) => t.includes("0000000  \\n"));
        await editor.capture("legacy-again");
    },
});
