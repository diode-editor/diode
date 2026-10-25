import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { manifestWithDefaults } from "../../src/TestUtils/ExtensionTestHarness.ts";
import {
    createExtensionTestHarness,
    type IExtensionHarness,
    registerAndActivate,
} from "../../src/TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../src/TestUtils/timing.ts";
import type { ITreeFileChange } from "../../src/vs/platform/files/common/iTreeFileWatcher.ts";
import { ChokidarTreeWatcher } from "../../src/vs/platform/files/node/chokidarTreeWatcher.ts";
import { FileWatcherAdapter } from "../../src/vs/workbench/api/browser/fileWatcherAdapter.ts";
import type { IExtensionFileWatcher } from "../../src/vs/workbench/api/common/iExtensionFileWatcher.ts";
import { PUBLISH_CHANGES_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/changesService.ts";
import { PUBLISH_REPO_STATE_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/repoStateService.ts";
import { GIT_OP_COMMAND } from "../../src/vs/workbench/contrib/scm/common/gitProtocol.ts";
import type { IExtensionRegistration } from "../../src/vs/workbench/services/extensions/node/iExtensionEntry.ts";

/**
 * The real core watcher and real git: an extension that learned of edits only
 * from its own saves silently missed outside edits (terminal, checkout, worktree).
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
        manifest: manifestWithDefaults(
            { name: "git", publisher: "diode", version: "0.1.0" },
            {
                "git.enabled": true,
                "git.decorations.enabled": true,
                "git.refreshDebounce": 0,
            },
        ),
        mainPath: GIT_MAIN,
    };
}

function realWatcher(): FileWatcherAdapter {
    return new FileWatcherAdapter(new ChokidarTreeWatcher(), () => []);
}

/** Events only on demand: a debounce timer armed at a known moment, without chokidar's latency. */
function manualWatcher(): IExtensionFileWatcher & { fire(path: string): void } {
    const sinks: ((changes: readonly ITreeFileChange[]) => void)[] = [];
    return {
        fire: (changed) => {
            for (const sink of sinks) sink([{ type: "changed", path: changed }]);
        },
        watch: (_base, _recursive, onChanges) => {
            sinks.push(onChanges);
            return { dispose: () => undefined };
        },
    };
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

describe("builtin git plugin — live watching", () => {
    let harness: IExtensionHarness | undefined;
    let workDir: string | undefined;
    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
        if (workDir !== undefined) fs.rmSync(workDir, { recursive: true, force: true });
        workDir = undefined;
    });

    /** Not `harness.tmpDir`: the workspace root must exist before start, and in the worktree scenario it is nested. */
    async function startOver(
        makeWorkspace: (dir: string) => string,
        options: { git?: Readonly<Record<string, unknown>>; fileWatcher?: IExtensionFileWatcher } = {},
    ): Promise<{ changes: IPublishedChange[][]; repoStates: IPublishedRepoState[]; root: string }> {
        const changes: IPublishedChange[][] = [];
        const repoStates: IPublishedRepoState[] = [];
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-git-watch-"));
        const root = makeWorkspace(workDir);
        harness = await createExtensionTestHarness({
            fileWatcher: options.fileWatcher ?? realWatcher(),
            workspaceFolders: [root],
            ...(options.git === undefined ? {} : { configuration: { git: options.git } }),
        });
        harness.commandRegistry.register(PUBLISH_CHANGES_COMMAND, (payload) => {
            changes.push(payload as IPublishedChange[]);
        });
        harness.commandRegistry.register(PUBLISH_REPO_STATE_COMMAND, (payload) => {
            repoStates.push(payload as IPublishedRepoState);
        });
        await registerAndActivate(harness.host, gitRegistration());
        // Before `ready`, chokidar with ignoreInitial swallows everything it finds.
        await settle(400);
        return { changes, repoStates, root };
    }

    it("a file edit outside the editor reaches Changes", async () => {
        const { changes, root } = await startOver((dir) => {
            makeRepo(dir);
            return dir;
        });

        fs.writeFileSync(path.join(root, "tracked.txt"), "a\nCHANGED\nc\n");

        const seen = await waitFor(() =>
            changes.at(-1)?.some((c) => c.path === "tracked.txt" && c.group === "worktree") === true
                ? changes.at(-1)
                : undefined,
        );
        expect(seen?.map((c) => `${c.path} ${c.status} ${c.group}`)).toContain("tracked.txt M worktree");
    }, 30000);

    it("`git add` from a terminal moves the file into the index", async () => {
        const { changes, root } = await startOver((dir) => {
            makeRepo(dir);
            fs.writeFileSync(path.join(dir, "tracked.txt"), "a\nCHANGED\nc\n");
            return dir;
        });

        git(root, "add", "tracked.txt");

        const seen = await waitFor(() =>
            changes.at(-1)?.some((c) => c.group === "index") === true ? changes.at(-1) : undefined,
        );
        expect(seen?.map((c) => `${c.path} ${c.group}`)).toContain("tracked.txt index");
    }, 30000);

    it("an outside branch checkout updates the repository state", async () => {
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

    it("an outside update of the upstream ref moves ahead/behind", async () => {
        // `update-ref` directly: the ref is deeper than the top level of `.git`, and nothing
        // but the ref watcher should fire.
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
        git(root, "checkout", "-q", "-b", "side");
        git(root, "commit", "-q", "--allow-empty", "-m", "ahead");
        const aheadSha = git(root, "rev-parse", "HEAD").trim();
        git(root, "checkout", "-q", "-");
        git(root, "branch", "-qD", "side");
        expect(await waitFor(() => repoStates.find((s) => s.upstream === "origin/main"))).toBeDefined();
        // Quiet period: otherwise "behind" could arrive with the setup refreshes, and the test
        // would pass without the ref watcher at all.
        await settle(800);
        const quiet = repoStates.length;

        git(root, "update-ref", "refs/remotes/origin/main", aheadSha);

        const seen = await waitFor(() => repoStates.slice(quiet).find((s) => s.behind > 0));
        expect(seen?.behind).toBe(1);
    }, 30000);

    it("watching works the same in a linked worktree (`.git` is a file)", async () => {
        const { changes, root } = await startOver((dir) => {
            const main = path.join(dir, "main");
            fs.mkdirSync(main);
            makeRepo(main);
            const linked = path.join(dir, "linked");
            git(main, "worktree", "add", "-q", linked, "-b", "feature");
            return linked;
        });
        // Scenario precondition: here `.git` really is a pointer file.
        expect(fs.statSync(path.join(root, ".git")).isFile()).toBe(true);

        fs.writeFileSync(path.join(root, "tracked.txt"), "a\nCHANGED\nc\n");

        const seen = await waitFor(() =>
            changes.at(-1)?.some((c) => c.path === "tracked.txt") === true ? changes.at(-1) : undefined,
        );
        expect(seen?.map((c) => `${c.path} ${c.status} ${c.group}`)).toContain("tracked.txt M worktree");
    }, 30000);

    it("git.autorefresh: false — an outside edit stays unseen until git.refresh, which resolves after publishing", async () => {
        const { changes, root } = await startOver(
            (dir) => {
                makeRepo(dir);
                return dir;
            },
            { git: { autorefresh: false } },
        );
        expect(await waitFor(() => (changes.length > 0 ? changes.at(-1) : undefined))).toEqual([]);

        fs.writeFileSync(path.join(root, "tracked.txt"), "a\nCHANGED\nc\n");
        await settle(800);
        expect(changes.at(-1)).toEqual([]);

        const result = await harness!.commandRegistry.execute(GIT_OP_COMMAND, { op: "refresh" });
        expect(result).toEqual({ ok: true });
        // Already there when the promise settles: the core's spinner holds exactly this long.
        expect(changes.at(-1)?.map((c) => `${c.path} ${c.status} ${c.group}`)).toEqual(["tracked.txt M worktree"]);
    }, 30000);

    it("git.refresh drops a pending watcher debounce instead of running git status twice", async () => {
        const watcher = manualWatcher();
        const { changes, root } = await startOver(
            (dir) => {
                makeRepo(dir);
                return dir;
            },
            { git: { refreshDebounce: 1500 }, fileWatcher: watcher },
        );
        expect(await waitFor(() => (changes.length > 0 ? changes.at(-1) : undefined))).toEqual([]);

        fs.writeFileSync(path.join(root, "tracked.txt"), "a\nCHANGED\nc\n");
        watcher.fire(path.join(root, "tracked.txt"));
        await settle(100);
        const before = changes.length;
        await harness!.commandRegistry.execute(GIT_OP_COMMAND, { op: "refresh" });
        expect(changes.length).toBe(before + 1);

        await settle(2000);
        expect(changes.length).toBe(before + 1);
    }, 30000);
});
