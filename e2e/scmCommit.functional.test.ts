import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { frameToText } from "./helpers/frame.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональные e2e commit input box (спека docs/TODO/SourceControl.md,
// US-13…US-20): поле над секциями, фокус-переходы, персист черновика; commit-
// сценарии добавляются вместе с фазой 6 (git.commit).

const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+m", command: "workbench.scm.focus" },
];

function gitQ(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

function makeRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "vexx-scm-commit-"));
    gitQ(repoDir, "init", "-q");
    gitQ(repoDir, "config", "user.email", "t@example.com");
    gitQ(repoDir, "config", "user.name", "Test");
    gitQ(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "one";\n');
    gitQ(repoDir, "add", "-A");
    gitQ(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "two";\n');
    return repoDir;
}

interface InputState {
    value?: string;
    showsPlaceholder?: boolean;
}

describe("SCM commit input box (functional e2e, спека SourceControl.md)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("US-13: input box с плейсхолдером над секцией CHANGES", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        const input = await session.waitForNode("#scmCommitInput");
        expect((input.state as InputState).showsPlaceholder).toBe(true);
        expect(frameToText(await session.captureFrame())).toContain("Message (Ctrl+Enter to commit)");

        // Input выше заголовка секции CHANGES.
        const changesHeader = await session.waitForNode("#paneHeader-workbench-scm-changes");
        expect(input.box.y).toBeLessThan(changesHeader.box.y);
    }, 120_000);

    it("US-14: workbench.scm.focus фокусит input; Down уводит в список", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M"); // workbench.scm.focus из Explorer
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.waitForFocus("ScmCommitInputElement");

        await session.key("Down");
        await session.waitForFocus("ListViewElement");

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
    }, 120_000);

    it("US-15: черновик сообщения переживает рестарт", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        {
            const { session } = app;
            await session.key("Alt+M");
            await session.waitForFocus("ScmCommitInputElement");
            await session.text("fix: typo");
            await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "fix: typo");
            await app.dispose();
            app = null;
        }

        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "fix: typo");
    }, 120_000);
});
