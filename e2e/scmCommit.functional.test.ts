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

    it("US-13: input box с плейсхолдером внутри секции Source Control, над списком", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        const input = await session.waitForNode("#scmCommitInput");
        expect((input.state as InputState).showsPlaceholder).toBe(true);
        // Плейсхолдер клипуется шириной сайдбара — проверяем начало.
        expect(frameToText(await session.captureFrame())).toContain("Message (Ctrl");

        // Контролы — в теле секции: ниже её заголовка, но выше списка изменений.
        const changesHeader = await session.waitForNode("#paneHeader-workbench-scm-changes");
        const list = await session.waitForNode("#changesView");
        expect(input.box.y).toBeGreaterThan(changesHeader.box.y);
        expect(input.box.y).toBeLessThan(list.box.y);

        // Кнопка действия — под полем, с пустой строкой между ними.
        const button = await session.waitForNode("#scmActionButton");
        expect(button.box.y - input.box.y).toBe(2);
    }, 120_000);

    it("US-14: workbench.scm.focus фокусит input; Down уводит в список", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M"); // workbench.scm.focus из Explorer
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.waitForFocus("ScmCommitInputElement");

        await session.key("ArrowDown");
        await session.waitForFocus("ListViewElement");

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
    }, 120_000);

    it("US-16/US-18: Ctrl+Enter коммитит staged и очищает input; пустое сообщение — отказ", async () => {
        const repo = makeRepo();
        gitQ(repo, "add", "-A"); // правка app.ts — в индекс
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        // Расширение активируется асинхронно: ждём публикации staged-группы,
        // иначе Ctrl+Enter упадёт в no-op (transport-команды ещё нет).
        await session.waitForNode("#scmGroup-index");
        // Пустое сообщение: notice, git log не вырос.
        await session.key("Ctrl+Enter");
        await session.waitForText((t) => t.includes("commit message is empty"));
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("1");

        await session.text("feat: change");
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "feat: change");
        await session.key("Ctrl+Enter");

        // Input очистился, staged-группа ушла; git подтверждает.
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "");
        await session.waitForNoNode("#scmGroup-index");
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe(
            "feat: change",
        );
        expect(execFileSync("git", ["status", "--porcelain=v1"], { cwd: repo }).toString()).toBe("");
    }, 120_000);

    it("US-17: пустой индекс — smart commit спрашивает и коммитит всё tracked", async () => {
        const repo = makeRepo(); // app.ts modified, не staged
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        await session.waitForNode("#scmGroup-worktree"); // расширение активно
        await session.text("feat: smart");
        await session.key("Ctrl+Enter");

        await session.waitForText((t) => t.includes("There are no staged changes to commit."));
        // Дефолтный фокус на Cancel, стрелка — на Commit All.
        await session.key("ArrowLeft");
        await session.key("Enter");

        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "");
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe("feat: smart");
    }, 120_000);

    it("US-19/US-20: amend меняет последний коммит; undoCommit возвращает сообщение в input", async () => {
        const repo = makeRepo();
        gitQ(repo, "add", "-A");
        gitQ(repo, "commit", "-qm", "feat: second");
        app = await useHeadlessApp({
            open: [repo],
            keybindings: [...SWITCH_KEYS, { key: "alt+d", command: "git.undoCommit" }, { key: "alt+n", command: "git.commitStagedAmend" }],
            cols: 100,
            rows: 30,
        });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        // Расширение активно, когда GRAPH показал последний коммит.
        await session.waitForText((t) => t.includes("feat: second"));

        // Amend с новым сообщением (индекс пуст — allowEmpty не нужен: --amend разрешает).
        await session.text("feat: amended");
        await session.key("Alt+N");
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "");
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe(
            "feat: amended",
        );
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("2");

        // Undo: HEAD откатился, сообщение вернулось в input.
        await session.key("Alt+D");
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "feat: amended");
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo }).toString().trim()).toBe("1");
    }, 120_000);

    it("US-15: черновик сообщения переживает рестарт", async () => {
        const repo = makeRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30, keepRoot: true });
        const root = app.env.root;
        {
            const { session } = app;
            await session.key("Alt+M");
            await session.waitForFocus("ScmCommitInputElement");
            await session.text("fix: typo");
            await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "fix: typo");
            await app.dispose();
            app = null;
        }

        // Тот же root: user-data-dir (и workspace-стор с черновиком) переживают рестарт.
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30, root });
        const { session } = app;
        await session.key("Alt+C");
        await session.waitForText((t) => t.includes("SOURCE CONTROL"));
        await session.waitForState("#scmCommitInput", (s) => (s as InputState)?.value === "fix: typo");
    }, 120_000);
});
