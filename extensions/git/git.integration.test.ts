import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

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
import { PUBLISH_CHANGES_COMMAND } from "../../src/vs/workbench/contrib/scm/browser/changesService.ts";
import type { IExtensionRegistration } from "../../src/vs/workbench/services/extensions/node/iExtensionEntry.ts";

const GIT_MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));

// Any resolvable colour ids the plugin references (git status → tree, diff → gutter).
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
    return { resolve: (id) => COLORS[id], onDidChange: () => ({ dispose: () => undefined }) };
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
    latest(): { path: string; color?: number; badge?: string }[] | undefined;
} {
    const calls: { path: string; color?: number; badge?: string }[][] = [];
    return {
        service: { setFileDecorations: (entries) => calls.push([...entries]) },
        latest: () => calls.at(-1),
    };
}

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", args, { cwd, stdio: "ignore" });
}

/** Содержимое tracked.txt в HEAD — до правки второй строки. */
const TRACKED_AT_HEAD = "a\nb\nc\n";

function makeRepo(dir: string): void {
    git(dir, "init", "-q");
    git(dir, "config", "user.email", "t@example.com");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "commit.gpgsign", "false");
    fs.writeFileSync(path.join(dir, "tracked.txt"), TRACKED_AT_HEAD);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", "init");
    // Modify line 2 of the tracked file and add an untracked file.
    fs.writeFileSync(path.join(dir, "tracked.txt"), "a\nB\nc\n");
    fs.writeFileSync(path.join(dir, "untracked.txt"), "x\n");
}

function gitRegistration(): IExtensionRegistration {
    return {
        id: "vexx.git",
        manifest: { name: "git", publisher: "vexx", version: "0.1.0" },
        mainPath: GIT_MAIN,
        configDefaults: {
            "git.enabled": true,
            "git.decorations.enabled": true,
            "git.gutter.enabled": true,
            "git.refreshDebounce": 0,
        },
    };
}

/** Poll a condition across real-time settles (subprocess + real git are async). */
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
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));

        await registerAndActivate(harness.host, gitRegistration());

        // Tree: both changed files decorated (M for modified, U for untracked).
        const gotFiles = await waitFor(() => {
            const entries = fileSpy.latest();
            return entries?.some((e) => e.path.endsWith("tracked.txt") && e.badge === "M") ?? false;
        });
        expect(gotFiles).toBe(true);
        const entries = fileSpy.latest()!;
        const tracked = entries.find((e) => e.path.endsWith("tracked.txt"));
        const untracked = entries.find((e) => e.path.endsWith("untracked.txt"));
        expect(tracked).toMatchObject({ badge: "M", color: COLORS["gitDecoration.modifiedResourceForeground"] });
        expect(untracked).toMatchObject({ badge: "U", color: COLORS["gitDecoration.untrackedResourceForeground"] });

        // Гуттер расширение больше НЕ считает: оно отдаёт версию из HEAD по схеме
        // git:, а дифф против живого буфера делает ядро (QuickDiffService).
        const trackedPath = path.join(harness.tmpDir, "tracked.txt");
        const originalUri = (await harness.commandRegistry.execute(
            "vexx.scm.originalResource",
            Uri.file(trackedPath).toString(),
        )) as string | null;
        expect(originalUri).toMatch(/^git:/);

        const bytes = await harness.host.readProvidedFile(Uri.parse(originalUri!));
        // В HEAD лежит исходная версия — до правки второй строки.
        expect(new TextDecoder().decode(bytes)).toBe(TRACKED_AT_HEAD);

        expect(editorSpy.latestFor("tracked.txt")).toBeUndefined();
    });

    it("публикует ядру полный набор изменённых файлов (вкладка Changes)", async () => {
        const published: unknown[] = [];
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        // Спай хостовой команды: расширение вызовет её fall-through'ом.
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
        // path — путь относительно корня репо (из porcelain, через `/`), не basename.
        expect(set.find((r) => r.uri.endsWith("tracked.txt"))).toMatchObject({
            status: "M",
            colorId: "gitDecoration.modifiedResourceForeground",
            path: "tracked.txt",
        });
        expect(set.find((r) => r.uri.endsWith("untracked.txt"))).toMatchObject({
            status: "U",
            colorId: "gitDecoration.untrackedResourceForeground",
            path: "untracked.txt",
        });
    });

    it("не отдаёт оригинал для untracked-файла и для файла вне репозитория", async () => {
        harness = await createExtensionTestHarness({
            editorDecorations: makeEditorSpy().service,
            fileDecorations: makeFileSpy().service,
            themeColorResolver: makeThemeResolver(),
        });
        makeRepo(harness.tmpDir);
        harness.group.openFile(path.join(harness.tmpDir, "tracked.txt"));
        await registerAndActivate(harness.host, gitRegistration());

        // Ждём первого refreshStatus: untracked распознаётся по porcelain-статусу.
        const untrackedUri = Uri.file(path.join(harness.tmpDir, "untracked.txt")).toString();
        let untrackedOriginal: string | null | undefined;
        await waitFor(() => {
            void (
                harness!.commandRegistry.execute("vexx.scm.originalResource", untrackedUri) as Promise<string | null>
            ).then((value) => {
                untrackedOriginal = value;
            });
            return untrackedOriginal === null;
        });
        expect(untrackedOriginal).toBeNull();

        expect(
            await harness.commandRegistry.execute(
                "vexx.scm.originalResource",
                Uri.file("/definitely/outside/repo.txt").toString(),
            ),
        ).toBeNull();
        expect(await harness.commandRegistry.execute("vexx.scm.originalResource", "untitled:Untitled-1")).toBeNull();
        expect(await harness.commandRegistry.execute("vexx.scm.originalResource", 42)).toBeNull();
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
