/**
 * The reason in the `activated extension "<id>" (<event>)` line of the "Extension Host" channel is the
 * assertion of the `workspaceContains:`/`onCommand:` scenarios. Two pitfalls:
 * - the stock ruff extension's Python environment toast covers the line tail — clear it with
 *   `notifications.clearAll` on EVERY attempt: it may arrive after the first clear too;
 * - with the sidebar open the tail of a long line doesn't fit (word wrap in Output is off) — hide it.
 *
 * Keys, not the command palette: the palette returns focus to whoever opened it. The letters avoid menu bar
 * mnemonics (F/E/S/V/G/H — flake: `Alt+H` opened Help) and SS3 (`ESC O` is F1, hence no "O").
 */

/** Keybindings the scenario must pass in `userKeybindings`. */
export const ACTIVATION_LOG_KEYBINDINGS: readonly { key: string; command: string }[] = [
    { key: "alt+u", command: "workbench.action.output.toggleOutput" },
    { key: "alt+j", command: "workbench.action.output.show.extensions.host" },
    { key: "alt+y", command: "notifications.clearAll" },
    { key: "alt+b", command: "workbench.action.toggleSidebarVisibility" },
];

interface IActivationLogUi {
    sendKey(name: string): Promise<void>;
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<unknown>;
}

export async function openActivationLog(ui: IActivationLogUi): Promise<void> {
    await ui.sendKey("Alt+B");
    await ui.sendKey("Alt+U");
    await waitPastToasts(ui, (t) => t.includes("OUTPUT"), "OUTPUT tab");
    await ui.sendKey("Alt+J");
    // The channel label is on the RIGHT of the header, right under the toast (CI flake: the log line was
    // in the frame, but ruff's toast covered "Extension Host").
    await waitPastToasts(ui, (t) => t.includes("Extension Host"), "Extension Host channel");
}

export async function waitForActivationLine(ui: IActivationLogUi, needle: string): Promise<void> {
    await waitPastToasts(ui, (t) => t.includes(needle), `log line "${needle}"`);
    // One more clear before the frame: the toast may return between the check and
    // the screenshot, and the demo would show it instead of the log.
    await ui.sendKey("Alt+Y");
}

/**
 * A loop of short caught attempts, not one long `waitForText`: the toast arrives asynchronously, both before
 * and after clearing — an uncaught wait would fail on the first such frame.
 */
async function waitPastToasts(
    ui: IActivationLogUi,
    predicate: (text: string) => boolean,
    what: string,
    attempts = 30,
): Promise<void> {
    for (let attempt = 0; attempt < attempts; attempt++) {
        await ui.sendKey("Alt+Y");
        try {
            await ui.waitForText(predicate, { timeoutMs: 4000 });
            return;
        } catch {
            // Not there yet (or the toast came back) — retry.
        }
    }
    throw new Error(`activation log: timed out waiting for ${what}`);
}
