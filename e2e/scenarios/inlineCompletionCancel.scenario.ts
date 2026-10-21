import { resolve } from "node:path";

import { defineScenario, repoRoot } from "./framework.ts";

// The `inline-ghost` fixture's OUTPUT channel logs one line per event (request `#<n>` started, cancelled, answered
// with `<k>` items, provider B polled): every request but the last is cancelled, and a cancelled one never reaches
// the second provider. The file is plaintext with no Latin letters on purpose: the word-based suggest popup has
// nothing to open on; otherwise it would preempt the ghost text (the core does not request it while the popup is open).

const sampleFile = resolve(repoRoot, "e2e", "fixtures", "ghost-cancel-sample.txt");
const userData = resolve(repoRoot, "e2e", "fixtures", "user-data-with-inline-ghost");

/** The fixture's trigger is a single word: the word being typed is not a candidate for the suggest popup. */
const TRIGGER = "greeting";

/** Normal typing pace (shorter than the provider's response time). */
const TYPING_PAUSE_MS = 120;

const sleep = (ms: number): Promise<void> => new Promise<void>((done) => setTimeout(done, ms));

export default defineScenario({
    name: "inline-completion-cancel",
    title: "Inline completions: stale provider requests are cancelled (OUTPUT log)",
    seedUserData: userData,
    settings: {
        // Otherwise a request finishes before the next keystroke and there is nothing to cancel.
        "inlineGhost.responseDelay": 900,
        // Quick suggest waits at most 750 ms for ghost text (as upstream `_waitForInlineCompletionsAndTrigger`);
        // 900 ms does not fit.
        "editor.quickSuggestions": "off",
    },
    open: [repoRoot, sampleFile],
    cols: 100,
    rows: 30,
    // The extension host subprocess is flaky on Windows.
    skipOn: ["win32"],
    // The channel is opened by a user keybinding since the command palette steals focus. F/E/S/V/G/H are menu bar
    // mnemonics and O is the SS3 prefix (`ESC O P` = F1), hence J.
    userKeybindings: [
        { key: "alt+j", command: "workbench.action.output.show.extensions.test.inline-ghost.inline-ghost" },
    ],
    async run(editor) {
        await editor.waitForText((t) => t.includes("Демо отмены"));

        await editor.sendKey("Ctrl+End");
        await editor.sendKey("End");
        await editor.sendKey("Enter");

        // Warm-up: a request before the provider registers (seconds on a cold runner) returns nothing; if no ghost
        // text shows, erase the line in a single edit and try again.
        let live = false;
        for (let attempt = 0; attempt < 10 && !live; attempt++) {
            await editor.sendText(TRIGGER);
            try {
                await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 3000 });
                live = true;
            } catch {
                await editor.sendKey("Home");
                await editor.sendKey("Shift+End");
                await editor.sendKey("Backspace");
            }
        }
        if (!live) throw new Error("inline-completion-cancel: призрак не появился за 10 попыток прогрева");

        // Let the warm-up request finish so the frame shows the chain from the typing itself, not the warm-up tail.
        await editor.sendKey("Escape");
        await editor.sendKey("Home");
        await editor.sendKey("Shift+End");
        await editor.sendKey("Backspace");
        await sleep(1500);

        for (const char of TRIGGER) {
            await editor.sendKey(char);
            await sleep(TYPING_PAUSE_MS);
        }

        await editor.waitForText((t) => t.includes("Hello from ghost text!"), { timeoutMs: 15_000 });
        await editor.capture("ghost");

        await editor.sendKey("Ctrl+K");
        await editor.sendKey("Ctrl+H");
        await editor.waitForText((t) => t.includes("OUTPUT"));
        await editor.sendKey("Alt+J");
        await editor.waitForText((t) => t.includes("Inline Ghost"));
        await editor.sendKey("Ctrl+End"); // the log tail holds the latest requests
        await editor.waitForText((t) => t.includes("отменён"), { timeoutMs: 10_000 });
        await editor.capture("cancelled");
    },
});
