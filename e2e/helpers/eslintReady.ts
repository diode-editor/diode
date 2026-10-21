/**
 * An undercurl in .js is a FALSE eslint readiness signal: the builtin TS client diagnoses
 * javascript too (flake: a quick fix menu with only tsserver refactorings). The unique eslint sign is
 * "Unnecessary semicolon." (no-extra-semi from LINT_JS) in Problems. The panel is toggled via the
 * command palette (no default binding); closing it returns focus to the editor.
 */

interface IEslintReadyUi {
    key(name: string): Promise<void>;
    text(value: string): Promise<void>;
    waitForText(
        predicate: (text: string) => boolean,
        opts?: { timeoutMs?: number; intervalMs?: number },
    ): Promise<unknown>;
}

/** The bottom panel header — the "panel is open" marker in the frame. */
const PANEL_TABS = "PROBLEMS  OUTPUT";

async function toggleProblems(ui: IEslintReadyUi): Promise<void> {
    await ui.key("Ctrl+P");
    await ui.text(">problems");
    await ui.waitForText((t) => t.includes("Toggle Problems"), { timeoutMs: 30_000 });
    await ui.key("Enter");
}

/** Waits for a diagnostic from the real eslintServer on a LINT_JS-like fixture. */
export async function waitForEslintDiagnostics(ui: IEslintReadyUi, timeoutMs = 180_000): Promise<void> {
    await toggleProblems(ui);
    await ui.waitForText((t) => t.includes(PANEL_TABS), { timeoutMs: 30_000 });
    await ui.waitForText((t) => t.includes("Unnecessary semicolon."), { timeoutMs, intervalMs: 500 });
    await toggleProblems(ui);
    await ui.waitForText((t) => !t.includes(PANEL_TABS), { timeoutMs: 30_000 });
}
