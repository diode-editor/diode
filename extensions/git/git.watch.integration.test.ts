import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
    createExtensionTestHarness,
    type IExtensionHarness,
    registerAndActivate,
} from "../../src/TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../src/TestUtils/timing.ts";
import { ChokidarTreeWatcher } from "../../src/vs/platform/files/node/chokidarTreeWatcher.ts";
import { FileWatcherAdapter } from "../../src/vs/workbench/api/browser/fileWatcherAdapter.ts";
import { PUBLISH_CHANGES_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/changesService.ts";
import { PUBLISH_REPO_STATE_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/repoStateService.ts";
import type { IExtensionRegistration } from "../../src/vs/workbench/services/extensions/node/iExtensionEntry.ts";

/**
 * Живость git-состояния: изменения приезжают в ядро **без участия редактора** —
 * так, как их делает пользователь в терминале рядом или чужой инструмент.
 *
 * Тест намеренно берёт настоящий файловый watcher ядра и настоящий git: до
 * этой работы расширение узнавало о правках только из своих же сохранений, и
 * такой сценарий (правка снаружи, `git add` из терминала, checkout, работа в
 * linked worktree) молча не работал.
 */

const GIT_MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));

function git(cwd: string, ...args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeRepo(dir: string): void {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "a\nb\nc\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
}

function gitRegistration(): IExtensionRegistration {
    return {
        id: "diode.git",
        manifest: { name: "git", publisher: "diode", version: "0.1.0" },
        mainPath: GIT_MAIN,
        configDefaults: {
            "git.enabled": true,
            "git.decorations.enabled": true,
            "git.refreshDebounce": 0,
        },
    };
}

/** Настоящий watcher ядра — как в проде (`extensionHostModule`). */
function realWatcher(): FileWatcherAdapter {
    return new FileWatcherAdapter(new ChokidarTreeWatcher(), () => []);
}

interface IPublishedChange {
    readonly path: string;
    readonly status: string;
    readonly group: string;
}

interface IPublishedRepoState {
    readonly branch: string | null;
    readonly upstream: string | null;
    readonly behind: number;
}

async function waitFor<T>(pick: () => T | undefined, timeoutMs = 8000): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = pick();
        if (value !== undefined) return value;
        await settle(50);
    }
    return pick();
}

describe("builtin git plugin — живое слежение", () => {
    let harness: IExtensionHarness | undefined;
    let workDir: string | undefined;
    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
        if (workDir !== undefined) fs.rmSync(workDir, { recursive: true, force: true });
        workDir = undefined;
    });

    /**
     * Готовит репозиторий и поднимает харнесс с настоящим watcher'ом. Каталог
     * заводим сами (а не берём `harness.tmpDir`): корень воркспейса должен
     * существовать до старта — в worktree-сценарии он вложенный.
     */
    async function startOver(
        makeWorkspace: (dir: string) => string,
    ): Promise<{ changes: IPublishedChange[][]; repoStates: IPublishedRepoState[]; root: string }> {
        const changes: IPublishedChange[][] = [];
        const repoStates: IPublishedRepoState[] = [];
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-git-watch-"));
        const root = makeWorkspace(workDir);
        harness = await createExtensionTestHarness({ fileWatcher: realWatcher(), workspaceFolders: [root] });
        harness.commandRegistry.register(PUBLISH_CHANGES_COMMAND, (payload) => {
            changes.push(payload as IPublishedChange[]);
        });
        harness.commandRegistry.register(PUBLISH_REPO_STATE_COMMAND, (payload) => {
            repoStates.push(payload as IPublishedRepoState);
        });
        await registerAndActivate(harness.host, gitRegistration());
        // Даём chokidar доскан­ировать дерево: до `ready` он считает всё
        // найденное начальным состоянием и с ignoreInitial глотает.
        await settle(400);
        return { changes, repoStates, root };
    }

    it("правка файла мимо редактора приезжает в Changes", async () => {
        const { changes, root } = await startOver((dir) => {
            makeRepo(dir);
            return dir;
        });

        fs.writeFileSync(path.join(root, "tracked.txt"), "a\nИЗМЕНЕНО\nc\n");

        const seen = await waitFor(() =>
            changes.at(-1)?.some((c) => c.path === "tracked.txt" && c.group === "worktree") === true
                ? changes.at(-1)
                : undefined,
        );
        expect(seen?.map((c) => `${c.path} ${c.status} ${c.group}`)).toContain("tracked.txt M worktree");
    }, 30000);

    it("`git add` из терминала переводит файл в индекс", async () => {
        const { changes, root } = await startOver((dir) => {
            makeRepo(dir);
            fs.writeFileSync(path.join(dir, "tracked.txt"), "a\nИЗМЕНЕНО\nc\n");
            return dir;
        });

        git(root, "add", "tracked.txt");

        const seen = await waitFor(() =>
            changes.at(-1)?.some((c) => c.group === "index") === true ? changes.at(-1) : undefined,
        );
        expect(seen?.map((c) => `${c.path} ${c.group}`)).toContain("tracked.txt index");
    }, 30000);

    it("checkout ветки снаружи обновляет состояние репозитория", async () => {
        const { repoStates, root } = await startOver((dir) => {
            makeRepo(dir);
            return dir;
        });

        git(root, "checkout", "-q", "-b", "feature");

        const seen = await waitFor(() =>
            repoStates.some((s) => s.branch === "feature") ? repoStates.at(-1) : undefined,
        );
        expect(seen?.branch).toBe("feature");
    }, 30000);

    it("обновление ref'а upstream'а снаружи двигает ahead/behind", async () => {
        // `refs/remotes/origin/main` лежит НЕ в первом уровне `.git`, поэтому
        // watcher служебного каталога его не видит — за ним следит отдельный
        // transient-watcher, пересаживаемый вместе с веткой. Двигаем ref
        // напрямую (`update-ref`), чтобы в тесте не сработал никакой другой путь.
        const { repoStates, root } = await startOver((dir) => {
            const bare = path.join(dir, "remote.git");
            const work = path.join(dir, "work");
            fs.mkdirSync(work);
            git(dir, "init", "-q", "--bare", bare);
            makeRepo(work);
            git(work, "remote", "add", "origin", bare);
            git(work, "push", "-q", "-u", "origin", "HEAD:refs/heads/main");
            return work;
        });
        // Коммит, которого нет в HEAD, — им и «уедет вперёд» удалённая ветка.
        git(root, "checkout", "-q", "-b", "side");
        git(root, "commit", "-q", "--allow-empty", "-m", "ahead");
        const aheadSha = git(root, "rev-parse", "HEAD").trim();
        git(root, "checkout", "-q", "-");
        git(root, "branch", "-qD", "side");
        expect(await waitFor(() => repoStates.find((s) => s.upstream === "origin/main"))).toBeDefined();
        // Ждём тишины: рефреши от подготовки (checkout/commit/branch -D) должны
        // отработать ДО правки ref'а — иначе «behind» мог бы приехать с ними, и
        // тест проходил бы без watcher'а ref'а вовсе.
        await settle(800);
        const quiet = repoStates.length;

        git(root, "update-ref", "refs/remotes/origin/main", aheadSha);

        const seen = await waitFor(() => repoStates.slice(quiet).find((s) => s.behind > 0));
        expect(seen?.behind).toBe(1);
    }, 30000);

    it("в linked worktree (`.git` — файл) слежение работает так же", async () => {
        const { changes, root } = await startOver((dir) => {
            const main = path.join(dir, "main");
            fs.mkdirSync(main);
            makeRepo(main);
            const linked = path.join(dir, "linked");
            git(main, "worktree", "add", "-q", linked, "-b", "feature");
            return linked;
        });
        // Предусловие сценария: тут `.git` действительно файл-указатель.
        expect(fs.statSync(path.join(root, ".git")).isFile()).toBe(true);

        fs.writeFileSync(path.join(root, "tracked.txt"), "a\nИЗМЕНЕНО\nc\n");

        const seen = await waitFor(() =>
            changes.at(-1)?.some((c) => c.path === "tracked.txt") === true ? changes.at(-1) : undefined,
        );
        expect(seen?.map((c) => `${c.path} ${c.status} ${c.group}`)).toContain("tracked.txt M worktree");
    }, 30000);
});
