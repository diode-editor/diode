import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { frameToText } from "../helpers/frame.ts";

import type { ScenarioDriver } from "./framework.ts";
import { defineScenario } from "./framework.ts";

// The collapsed default stays a default: GRAPH expanded by the user remains expanded after a window reload.

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-collapsed-demo-"));
    git(repoDir, "init", "-q", "-b", "main");
    git(repoDir, "config", "user.email", "t@example.com");
    git(repoDir, "config", "user.name", "Test");
    git(repoDir, "config", "commit.gpgsign", "false");
    const appFile = join(repoDir, "app.ts");
    writeFileSync(appFile, "export const version = 1;\n");
    git(repoDir, "add", "-A");
    git(repoDir, "commit", "-qm", "feat: старт");
    writeFileSync(appFile, "export const version = 2;\n");
    git(repoDir, "commit", "-aqm", "fix: версия");
    // An on-disk edit keeps CHANGES non-empty in the frame.
    writeFileSync(appFile, "export const version = 3;\n");
    return repoDir;
}

const repoDir = makeRepo();

async function expectExpanded(editor: ScenarioDriver, viewId: string, expanded: boolean): Promise<void> {
    const header = await editor.waitForNode(`#paneHeader-${viewId.replaceAll(".", "-")}`);
    const state = header.state as { expanded?: boolean; collapsible?: boolean } | undefined;
    if (state?.expanded !== expanded) {
        throw new Error(`${viewId}: expanded=${String(state?.expanded)}, ожидалось ${String(expanded)}`);
    }
    // Collapsible is not the same as collapsed: a merged container (one visible section) would hold `expanded: true`
    // simply because it has no chevron.
    if (state.collapsible !== true) throw new Error(`${viewId}: секция не сворачиваемая`);
}

export default defineScenario({
    name: "view-collapsed-default",
    title: "Дефолт свёрнутости view: GRAPH открывается свёрнутым, выбор пользователя переживает перезагрузку",
    open: [repoDir],
    cols: 100,
    rows: 30,
    // GRAPH history is published by the git extension — needs an extension host; Reload Window from a scenario on
    // Windows brings the window up without a sidebar (docs/TODO/E2E.md).
    skipOn: ["win32", "darwin"],
    userKeybindings: [
        { key: "alt+c", command: "workbench.view.scm" },
        { key: "f9", command: "workbench.action.reloadWindow" },
    ],
    async run(editor) {
        // Readiness: Explorer shows files (folder open, extension starting).
        await editor.waitForText((t) => t.includes("app.ts"));

        // Source Control: both section headers are present but the history is not built — GRAPH is collapsed and the
        // extension never even ran `git log`.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("SOURCE CONTROL") && t.includes("GRAPH") && t.includes("app.ts"));
        await expectExpanded(editor, "workbench.scm.graph", false);
        await expectExpanded(editor, "workbench.scm.changes", true);
        const collapsed = await editor.captureFrame();
        await editor.capture("collapsed");

        // A collapsed section takes no empty space: CHANGES took the full container height, and there are no commit
        // subjects in the frame at all.
        if (frameToText(collapsed).includes("feat: старт")) {
            throw new Error("свёрнутый GRAPH показал историю");
        }

        // Click the GRAPH chevron — the history is collected, the extension gets logSetEnabled and returns the log.
        await editor.clickNode("#paneHeader-workbench-scm-graph", { dx: 3 });
        await editor.waitForText((t) => t.includes("feat: старт") && t.includes("fix: версия"));
        await expectExpanded(editor, "workbench.scm.graph", true);
        await editor.capture("expanded");

        // Window reload: the process restarts together with the inspector socket — the reply to this input may never
        // arrive. `reconnect` verifies the window actually restarted: it waits for the old socket to close, which a
        // live window never does — otherwise everything below would check the same session rather than a new one.
        await editor.sendKey("F9").catch(() => undefined);
        await editor.reconnect();
        await editor.waitForText((t) => t.includes("app.ts"), { timeoutMs: 60_000 });

        // The default did NOT override the saved choice: GRAPH is still expanded and full of history again.
        await editor.sendKey("Alt+C");
        await editor.waitForText((t) => t.includes("feat: старт") && t.includes("fix: версия"));
        await expectExpanded(editor, "workbench.scm.graph", true);
        await editor.capture("after-reload");
    },
});
