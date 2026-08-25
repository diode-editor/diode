import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Функциональный e2e прогресса git-операций: спиннер в заголовке секции CHANGES
// и в подписи кнопки, пока идёт коммит. Медленным делаем не наш код, а сам
// `git commit` — настоящим pre-commit-хуком со `sleep` (husky/lint-staged
// ровно так и выглядят). Всё остальное — настоящее: extension host, диспетчер
// diode.git.op, очередь мутаций расширения.

const SWITCH_KEYS = [
    { key: "alt+c", command: "workbench.view.scm" },
    { key: "alt+m", command: "workbench.scm.focus" },
];

function gitQ(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Репозиторий со staged-правкой и медленным pre-commit-хуком. */
function makeSlowRepo(): string {
    const repoDir = mkdtempSync(join(tmpdir(), "diode-scm-progress-"));
    gitQ(repoDir, "init", "-q");
    gitQ(repoDir, "config", "user.email", "t@example.com");
    gitQ(repoDir, "config", "user.name", "Test");
    gitQ(repoDir, "config", "commit.gpgsign", "false");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "one";\n');
    gitQ(repoDir, "add", "-A");
    gitQ(repoDir, "commit", "-qm", "init");
    writeFileSync(join(repoDir, "app.ts"), 'export const a = "two";\n');
    gitQ(repoDir, "add", "-A");

    const hook = join(repoDir, ".git", "hooks", "pre-commit");
    writeFileSync(hook, "#!/bin/sh\nsleep 3\n");
    chmodSync(hook, 0o755);
    return repoDir;
}

interface ButtonState {
    label?: string;
    disabled?: boolean;
}

describe("SCM: прогресс git-операции (functional e2e)", () => {
    let app: HeadlessApp | null = null;

    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    afterEach(async () => {
        await app?.dispose();
        app = null;
    });

    it("коммит с медленным хуком крутит спиннер в заголовке и в кнопке", async () => {
        const repo = makeSlowRepo();
        app = await useHeadlessApp({ open: [repo], keybindings: SWITCH_KEYS, cols: 100, rows: 30 });
        const { session } = app;

        await session.key("Alt+M");
        await session.waitForFocus("ScmCommitInputElement");
        // Расширение активируется асинхронно: без опубликованной staged-группы
        // Ctrl+Enter упал бы в no-op — transport-команды ещё нет.
        await session.waitForNode("#scmGroup-index");

        await session.text("feat: slow");
        await session.key("Ctrl+Enter");

        // Пока хук спит: заголовок секции занят, кнопка погашена и говорит, чем.
        // Во время анимации шлём только ожидания и снимки — settling-ввод не
        // дождался бы «тихого» кадра, пока спиннер тикает.
        await session.waitForState("#paneHeader-workbench-scm-changes", (s) => (s as { busy?: boolean })?.busy === true);
        await session.waitForState("#scmActionButton", (s) => {
            const state = (s ?? {}) as ButtonState;
            return state.disabled === true && (state.label ?? "").includes("Committing");
        });

        // Хук отработал: спиннер снят, кнопка вернулась, коммит на месте.
        await session.waitForState(
            "#paneHeader-workbench-scm-changes",
            (s) => (s as { busy?: boolean })?.busy === false,
            { timeoutMs: 30_000 },
        );
        await session.waitForState("#scmActionButton", (s) => (s as ButtonState)?.disabled === false, {
            timeoutMs: 30_000,
        });
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()).toBe("feat: slow");
    }, 180_000);
});
