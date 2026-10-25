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
import { Uri } from "../../src/vs/base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../src/vs/editor/common/model/iGutterChangeDecoration.ts";
import type { IEditorDecorationsService } from "../../src/vs/workbench/api/common/iEditorDecorationsService.ts";
import type { IFileDecorationsService } from "../../src/vs/workbench/api/common/iFileDecorationsService.ts";
import type { IThemeColorResolver } from "../../src/vs/workbench/api/common/iThemeColorResolver.ts";
import { ColorThemeKind } from "../../src/vs/workbench/api/common/vscodeTypes.ts";
import { PUBLISH_CHANGES_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/changesService.ts";
import { GRAPH_ENABLED_COMMAND, PUBLISH_LOG_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/graphService.ts";
import type { IExtensionRegistration } from "../../src/vs/workbench/services/extensions/node/iExtensionEntry.ts";

const GIT_MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));

const STAGE_COMMAND = "diode.git.stage";
const UNSTAGE_COMMAND = "diode.git.unstage";
const CLEAN_COMMAND = "diode.git.clean";

const COLORS: Record<string, number> = {
    "editorGutter.addedBackground": 0x00ff00,
    "editorGutter.modifiedBackground": 0x0000ff,
    "editorGutter.deletedBackground": 0xff0000,
    "gitDecoration.modifiedResourceForeground": 0x11aabb,
    "gitDecoration.addedResourceForeground": 0x22cc33,
    "gitDecoration.deletedResourceForeground": 0xcc2211,
    "gitDecoration.untrackedResourceForeground": 0x33bb77,
};

function makeThemeResolver(): IThemeColorResolver {
    return {
        resolve: (id) => COLORS[id],
        kind: () => ColorThemeKind.Dark,
        onDidChange: () => ({ dispose: () => undefined }),
    };
}

function makeEditorSpy(): {
    service: IEditorDecorationsService;
    latestFor(suffix: string): readonly IGutterChangeDecoration[] | undefined;
} {
    const calls: { uri: string; decorations: readonly IGutterChangeDecoration[] }[] = [];
    return {
        service: { setGutterChangeDecorations: (uri, decorations) => calls.push({ uri, decorations }) },
        latestFor: (suffix) => calls.filter((c) => c.uri.endsWith(suffix)).at(-1)?.decorations,
    };
}

function makeFileSpy(): {
    service: IFileDecorationsService;
    latest(): { path: string; color?: number; badge?: string; propagate?: boolean }[] | undefined;
} {
    const calls: { path: string; color?: number; badge?: string; propagate?: boolean }[][] = [];
    return {
        service: { setFileDecorations: (entries) => calls.push([...entries]) },
        latest: () => calls.at(-1),
    };
}

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

const TRACKED_AT_HEAD = "a\nb\nc\n";

function makeRepo(dir: string): void {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, "tracked.txt"), TRACKED_AT_HEAD);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    fs.writeFileSync(path.join(dir, "tracked.txt"), "a\nB\nc\n");
    fs.writeFileSync(path.join(dir, "untracked.txt"), "x\n");
}

function gitRegistration(): IExtensionRegistration {
    return {
        id: "diode.git",
        manifest: manifestWithDefaults(
            { name: "git", publisher: "diode", version: "0.1.0" },
            {
                "git.enabled": true,
                "git.decorations.enabled": true,
                "git.gutter.enabled": true,
                "git.refreshDebounce": 0,
            },
        ),
        mainPath: GIT_MAIN,
    };
}

async function waitFor(predicate: () => boolean, timeoutMs = 4000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) return true;
        await settle(50);
    }
    return predicate();
}

describe("builtin git plugin (integration)", () => {
    let harness: IExtensionHarness | undefined;
    afterEach(async () => {
        await harness?.dispose();
        harness = undefined;
    });

    it("colours changed files in the tree and serves the HEAD version over git:", async () => {
        const editorSpy = makeEditorSpy();
        const fileSpy = makeFileSpy();
        harness = await createExtensionTestHarness({
            editorDecorations: editorSpy.service,
            fileDecorations: fileSpy.service,
            themeColorResolver: makeThemeResolver(),
        });
        makeRepo(harness.tmpDir);
        // A deleted file is decorated but doesn't propagate to folders (as upstream).
        fs.writeFileSync(path.join(harness.tmpDir, "gone.txt"), "g\n");
        git(harness.tmpDir, "add", "gone.txt");
        git(harness.tmpDir, "commit", "-qm", "gone");
        fs.rmSync(path.join(harness.tmpDir, "gone.txt"));
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));

        await registerAndActivate(harness.host, gitRegistration());

        const gotFiles = await waitFor(() => {
            const entries = fileSpy.latest();
            return entries?.some((e) => e.path.endsWith("tracked.txt") && e.badge === "M") ?? false;
        });
        expect(gotFiles).toBe(true);
        const entries = fileSpy.latest()!;
        const tracked = entries.find((e) => e.path.endsWith("tracked.txt"));
        const untracked = entries.find((e) => e.path.endsWith("untracked.txt"));
        expect(tracked).toMatchObject({
            badge: "M",
            color: COLORS["gitDecoration.modifiedResourceForeground"],
            propagate: true,
        });
        expect(untracked).toMatchObject({
            badge: "U",
            color: COLORS["gitDecoration.untrackedResourceForeground"],
            propagate: true,
        });
        expect(entries.find((e) => e.path.endsWith("gone.txt"))).toMatchObject({ badge: "D", propagate: false });

        const trackedPath = path.join(harness.tmpDir, "tracked.txt");
        const originalUri = (await harness.commandRegistry.execute(
            "diode.scm.originalResource",
            Uri.file(trackedPath).toString(),
        )) as string | null;
        expect(originalUri).toMatch(/^git:/);

        const bytes = await harness.host.readProvidedFile(Uri.parse(originalUri!));
        expect(new TextDecoder().decode(bytes)).toBe(TRACKED_AT_HEAD);

        expect(editorSpy.latestFor("tracked.txt")).toBeUndefined();
    });

    it("publishes the full set of changed files to the core (Changes tab)", async () => {
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        harness.commandRegistry.register(PUBLISH_CHANGES_COMMAND, (payload) => {
            published.push(payload);
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));

        await registerAndActivate(harness.host, gitRegistration());

        interface Change {
            uri: string;
            status: string;
            colorId: string;
            path: string;
        }
        const latest = (): Change[] | undefined => published.at(-1) as Change[] | undefined;
        const got = await waitFor(
            () => latest()?.some((r) => r.uri.endsWith("tracked.txt") && r.status === "M") ?? false,
        );
        expect(got).toBe(true);

        const set = latest()!;
        expect(set.find((r) => r.uri.endsWith("tracked.txt"))).toMatchObject({
            status: "M",
            colorId: "gitDecoration.modifiedResourceForeground",
            path: "tracked.txt",
            group: "worktree",
        });
        expect(set.find((r) => r.uri.endsWith("untracked.txt"))).toMatchObject({
            status: "U",
            colorId: "gitDecoration.untrackedResourceForeground",
            path: "untracked.txt",
            group: "untracked",
        });
    });

    it("publishes recent commits to the core (Graph view); the refresh op republishes", async () => {
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        harness.commandRegistry.register(PUBLISH_LOG_COMMAND, (payload) => {
            published.push(payload);
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));

        await registerAndActivate(harness.host, gitRegistration());

        interface Commit {
            sha: string;
            shortSha: string;
            parents: string[];
            refs: { name: string; kind: string; current: boolean }[];
            author: string;
            timestamp: number;
            subject: string;
        }
        interface LogPayload {
            commits: Commit[];
            hasMore: boolean;
        }
        const latest = (): LogPayload | undefined => published.at(-1) as LogPayload | undefined;
        const got = await waitFor(() => latest()?.commits.some((c) => c.subject === "init") ?? false);
        expect(got).toBe(true);
        const initial = latest()!;
        expect(initial.commits).toHaveLength(1);
        expect(initial.hasMore).toBe(false);
        expect(initial.commits[0].sha).toMatch(/^[0-9a-f]{40}$/);
        expect(initial.commits[0].shortSha).toMatch(/^[0-9a-f]{4,}$/);
        expect(initial.commits[0].parents).toEqual([]);
        expect(initial.commits[0].refs).toContainEqual(expect.objectContaining({ kind: "head", current: true }));
        expect(initial.commits[0].author).not.toBe("");
        expect(initial.commits[0].timestamp).toBeGreaterThan(0);

        git(harness.tmpDir, "add", "-A");
        git(harness.tmpDir, "commit", "-qm", "second");
        await harness.commandRegistry.execute("diode.git.op", { op: "refresh" });
        expect(latest()?.commits.some((c) => c.subject === "second")).toBe(true);
        expect(latest()!.commits.map((c) => c.subject)).toEqual(["second", "init"]);
        expect(latest()!.commits[0].parents).toEqual([latest()!.commits[1].sha]);
    });

    it("the history page is limited; logLoadMore loads the next one", async () => {
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
            configuration: { scm: { graph: { pageSize: 2 } } },
        });
        harness.commandRegistry.register(PUBLISH_LOG_COMMAND, (payload) => {
            published.push(payload);
        });
        makeRepo(harness.tmpDir);
        for (const subject of ["c2", "c3", "c4"]) {
            fs.writeFileSync(path.join(harness.tmpDir, "tracked.txt"), `${subject}\n`);
            git(harness.tmpDir, "commit", "-aqm", subject);
        }
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        interface LogPayload {
            commits: { subject: string }[];
            hasMore: boolean;
        }
        const latest = (): LogPayload | undefined => published.at(-1) as LogPayload | undefined;

        const paged = await waitFor(() => latest()?.commits.length === 2);
        expect(paged).toBe(true);
        expect(latest()!.commits.map((c) => c.subject)).toEqual(["c4", "c3"]);
        expect(latest()!.hasMore).toBe(true);

        await harness.commandRegistry.execute("diode.git.op", { op: "logLoadMore" });
        const loaded = await waitFor(() => latest()?.commits.length === 4);
        expect(loaded).toBe(true);
        expect(latest()!.commits.map((c) => c.subject)).toEqual(["c4", "c3", "c2", "init"]);
        expect(latest()!.hasMore).toBe(false);
    });

    it("diode.git.stage/unstage move files between index and tree; clean reverts and deletes", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        const dir = harness.tmpDir;
        const uriOf = (rel: string): string => Uri.file(path.join(dir, rel)).toString();
        const porcelain = (): string => execFileSync("git", ["status", "--porcelain=v1"], { cwd: dir }).toString();

        const staged = (await harness.commandRegistry.execute(STAGE_COMMAND, [
            uriOf("tracked.txt"),
            uriOf("untracked.txt"),
        ])) as { ok: boolean };
        expect(staged.ok).toBe(true);
        expect(porcelain()).toBe("M  tracked.txt\nA  untracked.txt\n");

        const unstaged = (await harness.commandRegistry.execute(UNSTAGE_COMMAND, [
            uriOf("tracked.txt"),
            uriOf("untracked.txt"),
        ])) as { ok: boolean };
        expect(unstaged.ok).toBe(true);
        expect(porcelain()).toBe(" M tracked.txt\n?? untracked.txt\n");

        // By now the extension's status map knows both files (refresh after unstage).
        const cleaned = (await harness.commandRegistry.execute(CLEAN_COMMAND, [
            uriOf("tracked.txt"),
            uriOf("untracked.txt"),
        ])) as { ok: boolean };
        expect(cleaned.ok).toBe(true);
        expect(porcelain()).toBe("");
        expect(fs.readFileSync(path.join(dir, "tracked.txt"), "utf8")).toBe(TRACKED_AT_HEAD);
        expect(fs.existsSync(path.join(dir, "untracked.txt"))).toBe(false);
    });

    it("unstage in an empty repository (unborn HEAD) unstages via rm --cached", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        const dir = harness.tmpDir;
        // A repo without a single commit: the file goes straight into the index.
        git(dir, "init", "-q");
        git(dir, "config", "user.email", "t@example.com");
        git(dir, "config", "user.name", "Test");
        fs.writeFileSync(path.join(dir, "first.txt"), "hello\n");
        git(dir, "add", "-A");
        harness.group.openFile(path.join(dir, "first.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        const result = (await harness.commandRegistry.execute(UNSTAGE_COMMAND, [
            Uri.file(path.join(dir, "first.txt")).toString(),
        ])) as { ok: boolean };
        expect(result.ok).toBe(true);
        const porcelain = execFileSync("git", ["status", "--porcelain=v1"], { cwd: dir }).toString();
        expect(porcelain).toBe("?? first.txt\n");
    });

    it("an unexpanded GRAPH costs the extension no `git log` call", async () => {
        const changes: unknown[] = [];
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        // The core answers as it does for a collapsed or hidden GRAPH section.
        harness.commandRegistry.register(GRAPH_ENABLED_COMMAND, () => false);
        harness.commandRegistry.register(PUBLISH_CHANGES_COMMAND, (payload) => {
            changes.push(payload);
        });
        harness.commandRegistry.register(PUBLISH_LOG_COMMAND, (payload) => {
            published.push(payload);
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        // The change list arrived, so refreshAll ran to completion, and the
        // missing history is not because we didn't wait long enough.
        expect(await waitFor(() => changes.length > 0)).toBe(true);
        expect(published).toEqual([]);

        await harness.commandRegistry.execute("diode.git.op", {
            op: "logSetEnabled",
            params: { enabled: true },
        });
        expect(await waitFor(() => published.length > 0)).toBe(true);
    });

    it("Load More with an unexpanded GRAPH accumulates and arrives as a bigger page", async () => {
        const changes: unknown[] = [];
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
            configuration: { scm: { graph: { pageSize: 2 } } },
        });
        harness.commandRegistry.register(GRAPH_ENABLED_COMMAND, () => false);
        harness.commandRegistry.register(PUBLISH_CHANGES_COMMAND, (payload) => {
            changes.push(payload);
        });
        harness.commandRegistry.register(PUBLISH_LOG_COMMAND, (payload) => {
            published.push(payload);
        });
        makeRepo(harness.tmpDir);
        for (const subject of ["c2", "c3", "c4"]) {
            fs.writeFileSync(path.join(harness.tmpDir, "tracked.txt"), `${subject}\n`);
            git(harness.tmpDir, "commit", "-aqm", subject);
        }
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());
        expect(await waitFor(() => changes.length > 0)).toBe(true);

        await harness.commandRegistry.execute("diode.git.op", { op: "logLoadMore" });
        expect(published).toEqual([]);

        await harness.commandRegistry.execute("diode.git.op", {
            op: "logSetEnabled",
            params: { enabled: true },
        });
        const loaded = await waitFor(
            () => ((published.at(-1) as { commits: unknown[] } | undefined)?.commits.length ?? 0) === 4,
        );
        expect(loaded).toBe(true);
    });

    it("diode.git.op commit: a staged file is committed with a message; amend changes the last commit", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        const dir = harness.tmpDir;
        makeRepo(dir);
        harness.group.openFile(path.join(dir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        git(dir, "add", "-A");
        const committed = (await harness.commandRegistry.execute("diode.git.op", {
            op: "commit",
            params: { message: "feat: change" },
        })) as { ok: boolean };
        expect(committed.ok).toBe(true);
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: dir }).toString().trim()).toBe("feat: change");
        expect(execFileSync("git", ["status", "--porcelain=v1"], { cwd: dir }).toString()).toBe("");

        const amended = (await harness.commandRegistry.execute("diode.git.op", {
            op: "commit",
            params: { message: "feat: amended", amend: true, allowEmpty: true },
        })) as { ok: boolean };
        expect(amended.ok).toBe(true);
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: dir }).toString().trim()).toBe("feat: amended");
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir }).toString().trim()).toBe("2");
    });

    it("diode.git.op: empty message without amend, garbage request and unknown op give {ok: false}", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        const empty = (await harness.commandRegistry.execute("diode.git.op", {
            op: "commit",
            params: {},
        })) as { ok: boolean; message?: string };
        expect(empty.ok).toBe(false);
        expect(empty.message).toContain("empty");

        const malformed = (await harness.commandRegistry.execute("diode.git.op", 42)) as { ok: boolean };
        expect(malformed.ok).toBe(false);
        const unknown = (await harness.commandRegistry.execute("diode.git.op", { op: "fly-to-moon" })) as {
            ok: boolean;
            message?: string;
        };
        expect(unknown.ok).toBe(false);
        expect(unknown.message).toContain("unknown git op");
    });

    it("diode.git.op undoCommit: reset --soft + message; the root commit is not undone", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        const dir = harness.tmpDir;
        makeRepo(dir);
        harness.group.openFile(path.join(dir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        git(dir, "add", "-A");
        git(dir, "commit", "-qm", "feat: second");

        const undone = (await harness.commandRegistry.execute("diode.git.op", { op: "undoCommit" })) as {
            ok: boolean;
            data?: { message?: string };
        };
        expect(undone.ok).toBe(true);
        expect(undone.data?.message).toBe("feat: second");
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir }).toString().trim()).toBe("1");
        expect(execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: dir }).toString().trim()).not.toBe("");

        const root = (await harness.commandRegistry.execute("diode.git.op", { op: "undoCommit" })) as {
            ok: boolean;
            message?: string;
        };
        expect(root.ok).toBe(false);
        expect(root.message).toContain("initial commit");
    });

    it("diode.git.op reset/revert: hard reset moves HEAD, revert adds an inverse commit", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        const dir = harness.tmpDir;
        makeRepo(dir);
        harness.group.openFile(path.join(dir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        const root = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim();
        fs.writeFileSync(path.join(dir, "tracked.txt"), "second\n");
        git(dir, "commit", "-aqm", "feat: second");

        const reverted = (await harness.commandRegistry.execute("diode.git.op", {
            op: "revert",
            params: { ref: "HEAD" },
        })) as { ok: boolean };
        expect(reverted.ok).toBe(true);
        expect(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: dir }).toString().trim()).toBe("3");
        expect(fs.readFileSync(path.join(dir, "tracked.txt"), "utf8")).toBe(TRACKED_AT_HEAD);

        const reset = (await harness.commandRegistry.execute("diode.git.op", {
            op: "reset",
            params: { ref: root, mode: "hard" },
        })) as { ok: boolean };
        expect(reset.ok).toBe(true);
        expect(execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString().trim()).toBe(root);
        // `--hard` leaves the repository's untracked file alone, so check tracked content only.
        expect(
            execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: dir }).toString().trim(),
        ).toBe("");

        const bogus = (await harness.commandRegistry.execute("diode.git.op", {
            op: "reset",
            params: { ref: root, mode: "--force" },
        })) as { ok: boolean; message?: string };
        expect(bogus.ok).toBe(false);
        expect(bogus.message).toContain("invalid git op parameters");
    });

    it("diode.git.op push/pull against a local bare remote; diode.git.query returns refs/remotes", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        const dir = harness.tmpDir;
        makeRepo(dir);
        // A local bare remote (file protocol, no auth) + upstream.
        const remoteDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-bare-"));
        git(remoteDir, "init", "-q", "--bare");
        git(dir, "remote", "add", "origin", remoteDir);
        const branch = execFileSync("git", ["branch", "--show-current"], { cwd: dir }).toString().trim();
        git(dir, "push", "-qu", "origin", branch);
        harness.group.openFile(path.join(dir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        git(dir, "add", "-A");
        git(dir, "commit", "-qm", "feat: second");
        const pushed = (await harness.commandRegistry.execute("diode.git.op", { op: "push" })) as { ok: boolean };
        expect(pushed.ok).toBe(true);
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: remoteDir }).toString().trim()).toBe(
            "feat: second",
        );

        const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), "diode-clone-"));
        execFileSync("git", ["clone", "-q", remoteDir, cloneDir]);
        git(cloneDir, "config", "user.email", "t@example.com");
        git(cloneDir, "config", "user.name", "Test");
        fs.writeFileSync(path.join(cloneDir, "third.txt"), "x\n");
        git(cloneDir, "add", "-A");
        git(cloneDir, "commit", "-qm", "feat: third");
        git(cloneDir, "push", "-q");

        const pulled = (await harness.commandRegistry.execute("diode.git.op", { op: "pull" })) as { ok: boolean };
        expect(pulled.ok).toBe(true);
        expect(execFileSync("git", ["log", "-1", "--format=%s"], { cwd: dir }).toString().trim()).toBe("feat: third");

        const refs = (await harness.commandRegistry.execute("diode.git.query", { kind: "refs" })) as {
            refs: { name: string; kind: string }[];
        };
        expect(refs.refs.some((r) => r.kind === "head" && r.name === branch)).toBe(true);
        expect(refs.refs.some((r) => r.kind === "remote" && r.name === `origin/${branch}`)).toBe(true);
        const remotes = (await harness.commandRegistry.execute("diode.git.query", { kind: "remotes" })) as {
            remotes: string[];
        };
        expect(remotes.remotes).toEqual(["origin"]);
        expect(await harness.commandRegistry.execute("diode.git.query", { kind: "flying" })).toBeNull();
    });

    it("mutations drop garbage targets; an empty result is a no-op {ok: true}", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        for (const payload of [
            "not-an-array",
            [42, null, {}],
            ["untitled:Untitled-1"],
            [Uri.file("/definitely/outside/repo.txt").toString()],
        ]) {
            const result = (await harness.commandRegistry.execute(STAGE_COMMAND, payload)) as { ok: boolean };
            expect(result.ok).toBe(true);
        }
        const porcelain = execFileSync("git", ["status", "--porcelain=v1"], { cwd: harness.tmpDir }).toString();
        expect(porcelain).toBe(" M tracked.txt\n?? untracked.txt\n");
    });

    it("returns no original for an untracked file or a file outside the repository", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        // Wait for the first refreshStatus: untracked is detected from the porcelain status.
        const untrackedUri = Uri.file(path.join(harness.tmpDir, "untracked.txt")).toString();
        let untrackedOriginal: string | null | undefined;
        await waitFor(() => {
            void (
                harness!.commandRegistry.execute("diode.scm.originalResource", untrackedUri) as Promise<string | null>
            ).then((value) => {
                untrackedOriginal = value;
            });
            return untrackedOriginal === null;
        });
        expect(untrackedOriginal).toBeNull();

        expect(
            await harness.commandRegistry.execute(
                "diode.scm.originalResource",
                Uri.file("/definitely/outside/repo.txt").toString(),
            ),
        ).toBeNull();
        expect(await harness.commandRegistry.execute("diode.scm.originalResource", "untitled:Untitled-1")).toBeNull();
        expect(await harness.commandRegistry.execute("diode.scm.originalResource", 42)).toBeNull();
    });

    it("a file renamed in the index is compared to HEAD by its old path (git mv + edit)", async () => {
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        harness.commandRegistry.register(PUBLISH_CHANGES_COMMAND, (payload) => {
            published.push(payload);
        });
        makeRepo(harness.tmpDir);
        git(harness.tmpDir, "checkout", "-q", "--", "tracked.txt");
        git(harness.tmpDir, "mv", "tracked.txt", "moved.txt");
        fs.appendFileSync(path.join(harness.tmpDir, "moved.txt"), "d\n");
        harness.group.openFile(path.join(harness.tmpDir, "moved.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        interface Change {
            uri: string;
            status: string;
            path: string;
            group: string;
        }
        const latest = (): Change[] | undefined => published.at(-1) as Change[] | undefined;
        expect(await waitFor(() => latest()?.some((r) => r.status === "R") ?? false)).toBe(true);
        // As in VS Code: one R entry in the index and one M in the working tree, both under
        // the NEW path; the old path never shows up as a separate entry (let alone M).
        expect(latest()!.filter((r) => r.path !== "untracked.txt")).toEqual([
            expect.objectContaining({ path: "moved.txt", status: "R", group: "index" }),
            expect.objectContaining({ path: "moved.txt", status: "M", group: "worktree" }),
        ]);

        // The left side of the diff and gutter is HEAD:tracked.txt, not the emptiness of
        // the nonexistent HEAD:moved.txt (otherwise the whole file would look new).
        const movedUri = Uri.file(path.join(harness.tmpDir, "moved.txt")).toString();
        const originalUri = (await harness.commandRegistry.execute("diode.scm.originalResource", movedUri)) as
            | string
            | null;
        expect(originalUri).toMatch(/^git:/);
        const bytes = await harness.host.readProvidedFile(Uri.parse(originalUri!));
        expect(new TextDecoder().decode(bytes)).toBe(TRACKED_AT_HEAD);

        // An explicitly chosen ref is not HEAD: the working tree status knows nothing
        // about it, so the path stays new.
        const atRef = (await harness.commandRegistry.execute("diode.scm.originalResource", movedUri, "main")) as string;
        expect(Uri.parse(atRef).query).toContain("moved.txt");

        // The index (`~`) is read by the new path and holds the staged rename without the
        // working tree edit: Open Changes on the Changes row diffs exactly that edit.
        const atIndex = (await harness.commandRegistry.execute("diode.scm.originalResource", movedUri, "~")) as string;
        const indexBytes = await harness.host.readProvidedFile(Uri.parse(atIndex));
        expect(new TextDecoder().decode(indexBytes)).toBe(TRACKED_AT_HEAD);
        expect(JSON.parse(Uri.parse(atIndex).query)).toMatchObject({ ref: "" });
    });

    it("stays inert (no throw, no decorations) outside a git repository", async () => {
        const editorSpy = makeEditorSpy();
        const fileSpy = makeFileSpy();
        harness = await createExtensionTestHarness({
            initialFile: { name: "plain.txt", content: "hello\n" },
            editorDecorations: editorSpy.service,
            fileDecorations: fileSpy.service,
            themeColorResolver: makeThemeResolver(),
        });

        // tmpDir is NOT a git repo — activate must resolve without throwing or decorating.
        await registerAndActivate(harness.host, gitRegistration());
        await settle(300);
        expect(fileSpy.latest()).toBeUndefined();
        expect(editorSpy.latestFor("plain.txt")).toBeUndefined();
    });
});
