import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";

import {
    createNodeWorkspaceScanner,
    DEFAULT_WORKSPACE_CONTAINS_EXCLUDES,
    type IWorkspaceDirectoryEntry,
    type IWorkspaceScanner,
    matchWorkspaceContains,
} from "./workspaceContainsActivation.ts";

/** Paths from {@link matchWorkspaceContains} come via `path.join` in native form, so normalize to posix. */
function fakeScanner(root: string, tree: Readonly<Record<string, "dir" | "file">>): IWorkspaceScanner {
    const relative = (absolutePath: string): string => path.relative(root, absolutePath).split(path.sep).join("/");
    return {
        exists: (absolutePath) => Promise.resolve(Object.hasOwn(tree, relative(absolutePath))),
        readDirectory: (absolutePath): Promise<readonly IWorkspaceDirectoryEntry[]> => {
            const prefix = relative(absolutePath);
            const entries: IWorkspaceDirectoryEntry[] = [];
            for (const [entryPath, kind] of Object.entries(tree)) {
                const parent = entryPath.includes("/") ? entryPath.slice(0, entryPath.lastIndexOf("/")) : "";
                if (parent !== prefix) continue;
                entries.push({
                    name: entryPath.slice(parent === "" ? 0 : parent.length + 1),
                    isDirectory: kind === "dir",
                });
            }
            return Promise.resolve(entries);
        },
    };
}

const ROOT = path.join(path.sep, "root");

describe("matchWorkspaceContains — path patterns (no glob characters)", () => {
    it("file at the root of a workspace folder", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] })).resolves.toEqual({
            pattern: "pom.xml",
            truncated: false,
        });
    });

    it("a DIRECTORY counts as existing too (exists semantics, as upstream)", async () => {
        const scanner = fakeScanner(ROOT, { ".vscode": "dir" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [".vscode"], globs: [] })).resolves.toEqual({
            pattern: ".vscode",
            truncated: false,
        });
    });

    it("a nested path is checked as a whole, without a walk", async () => {
        const scanner = fakeScanner(ROOT, { "a/b/c.json": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["a/b/c.json"], globs: [] })).resolves.toEqual({
            pattern: "a/b/c.json",
            truncated: false,
        });
        expect(readDirectory).not.toHaveBeenCalled();
    });

    it("a missing path does not match, and the walk is not cut short", async () => {
        const scanner = fakeScanner(ROOT, { "build.gradle": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });

    it("several workspace folders: a hit in any of them is enough", async () => {
        const second = path.join(path.sep, "other");
        const first = fakeScanner(ROOT, {});
        const scanner: IWorkspaceScanner = {
            exists: (absolutePath) => Promise.resolve(absolutePath === path.join(second, "pom.xml")),
            readDirectory: first.readDirectory,
        };
        await expect(
            matchWorkspaceContains(scanner, [ROOT, second], { paths: ["pom.xml"], globs: [] }),
        ).resolves.toEqual({ pattern: "pom.xml", truncated: false });
    });

    it("the FIRST matching pattern is returned: it is the activation reason", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file", "build.gradle": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["build.gradle", "pom.xml"], globs: [] }),
        ).resolves.toEqual({ pattern: "build.gradle", truncated: false });
    });

    it("path patterns are checked BEFORE the walk: a cheap hit reads no directories", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file", sub: "dir", "sub/pom.xml": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: ["*/pom.xml"] }),
        ).resolves.toEqual({ pattern: "pom.xml", truncated: false });
        expect(readDirectory).not.toHaveBeenCalled();
    });
});

describe("matchWorkspaceContains — glob patterns (tree walk)", () => {
    it("`*/pom.xml` finds a file one level down", async () => {
        const scanner = fakeScanner(ROOT, { app: "dir", "app/pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*/pom.xml"] })).resolves.toEqual({
            pattern: "*/pom.xml",
            truncated: false,
        });
    });

    it("`*/pom.xml` does NOT find a file at the root: `*` is exactly one segment", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*/pom.xml"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });

    it("`*.py` matches only the root: the walk goes no deeper", async () => {
        const scanner = fakeScanner(ROOT, { src: "dir", "src/main.py": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*.py"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
        // Exactly one call, the root; `src/` wasn't read, depth is exhausted.
        expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    it("`**/pyproject.toml` reaches a file at any depth", async () => {
        const scanner = fakeScanner(ROOT, {
            a: "dir",
            "a/b": "dir",
            "a/b/c": "dir",
            "a/b/c/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }),
        ).resolves.toEqual({ pattern: "**/pyproject.toml", truncated: false });
    });

    it("`**/x` matches at the root too (a leading `**/` is zero segments)", async () => {
        const scanner = fakeScanner(ROOT, { "ruff.toml": "file" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/ruff.toml"] })).resolves.toEqual({
            pattern: "**/ruff.toml",
            truncated: false,
        });
    });

    it("a DIRECTORY does not match a glob: the event is about files", async () => {
        const scanner = fakeScanner(ROOT, { sub: "dir", "sub/pom.xml": "dir" });
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*/pom.xml"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });

    it("the walk does not enter node_modules/.git", async () => {
        const scanner = fakeScanner(ROOT, {
            node_modules: "dir",
            "node_modules/dep": "dir",
            "node_modules/dep/pyproject.toml": "file",
            ".git": "dir",
            ".git/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }),
        ).resolves.toEqual({ pattern: null, truncated: false });
        expect([...DEFAULT_WORKSPACE_CONTAINS_EXCLUDES]).toEqual([".git", "node_modules"]);
    });

    it("a custom exclude list overrides the default one", async () => {
        const scanner = fakeScanner(ROOT, {
            node_modules: "dir",
            "node_modules/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(
                scanner,
                [ROOT],
                { paths: [], globs: ["**/pyproject.toml"] },
                { excludeDirectories: new Set() },
            ),
        ).resolves.toEqual({ pattern: "**/pyproject.toml", truncated: false });
    });

    it("several workspace folders: each one is walked", async () => {
        const second = path.join(path.sep, "other");
        const empty = fakeScanner(ROOT, {});
        const withHit = fakeScanner(second, { app: "dir", "app/pom.xml": "file" });
        const scanner: IWorkspaceScanner = {
            exists: () => Promise.resolve(false),
            readDirectory: (absolutePath) =>
                absolutePath.startsWith(second)
                    ? withHit.readDirectory(absolutePath)
                    : empty.readDirectory(absolutePath),
        };
        await expect(
            matchWorkspaceContains(scanner, [ROOT, second], { paths: [], globs: ["*/pom.xml"] }),
        ).resolves.toEqual({ pattern: "*/pom.xml", truncated: false });
    });

    it("BREADTH-first walk: a shallow match is found without descending into a deep branch", async () => {
        const scanner = fakeScanner(ROOT, {
            deep: "dir",
            "deep/a": "dir",
            "deep/a/b": "dir",
            zzz: "dir",
            "zzz/pyproject.toml": "file",
        });
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }),
        ).resolves.toEqual({ pattern: "**/pyproject.toml", truncated: false });
        // Root plus two top-level directories; `deep/a` and `deep/a/b` are untouched.
        expect(readDirectory.mock.calls.map((call) => call[0])).toEqual([
            ROOT,
            path.join(ROOT, "deep"),
            path.join(ROOT, "zzz"),
        ]);
    });

    it("depth follows the most generous pattern of the set", async () => {
        const scanner = fakeScanner(ROOT, { a: "dir", "a/b": "dir", "a/b/pom.xml": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*.py", "*/*/pom.xml"] }),
        ).resolves.toEqual({ pattern: "*/*/pom.xml", truncated: false });
    });
});

describe("matchWorkspaceContains — budget and cancellation", () => {
    it("the budget is a BOUNDARY: directory number maxDirectories+1 is no longer read", async () => {
        // The match sits in exactly the directory the budget falls one step short of:
        // the root and `a` use up both slots, `b` stays unread.
        const scanner = fakeScanner(ROOT, { a: "dir", b: "dir", "b/pyproject.toml": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }, { maxDirectories: 2 }),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("the directory budget cuts the walk short and HONESTLY reports truncation", async () => {
        const scanner = fakeScanner(ROOT, {
            a: "dir",
            b: "dir",
            c: "dir",
            "c/pyproject.toml": "file",
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pyproject.toml"] }, { maxDirectories: 2 }),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("truncation in one folder is visible even when the other is read to the end", async () => {
        const second = path.join(path.sep, "other");
        const wide = fakeScanner(ROOT, { a: "dir", b: "dir", c: "dir" });
        const empty = fakeScanner(second, {});
        const scanner: IWorkspaceScanner = {
            exists: () => Promise.resolve(false),
            readDirectory: (absolutePath) =>
                absolutePath.startsWith(second) ? empty.readDirectory(absolutePath) : wide.readDirectory(absolutePath),
        };
        await expect(
            matchWorkspaceContains(
                scanner,
                [ROOT, second],
                { paths: [], globs: ["**/pyproject.toml"] },
                { maxDirectories: 2 },
            ),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("a cancelled token cuts the glob walk short", async () => {
        const source = new CancellationTokenSource();
        source.cancel();
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["*.xml"] }, { token: source.token }),
        ).resolves.toEqual({ pattern: null, truncated: true });
    });

    it("a cancelled token cuts the cheap path checks short too", async () => {
        const source = new CancellationTokenSource();
        source.cancel();
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        const exists = vi.spyOn(scanner, "exists");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] }, { token: source.token }),
        ).resolves.toEqual({ pattern: null, truncated: true });
        expect(exists).not.toHaveBeenCalled();
    });

    it("cancelling IN THE MIDDLE of the walk stops it", async () => {
        const source = new CancellationTokenSource();
        const scanner = fakeScanner(ROOT, { a: "dir", "a/deep": "dir", "a/deep/pom.xml": "file" });
        const readDirectory = vi.spyOn(scanner, "readDirectory").mockImplementation((absolutePath) => {
            if (absolutePath === ROOT) source.cancel();
            return Promise.resolve([{ name: "a", isDirectory: true }]);
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/pom.xml"] }, { token: source.token }),
        ).resolves.toEqual({ pattern: null, truncated: true });
        expect(readDirectory).toHaveBeenCalledTimes(1);
    });

    it("an empty pattern set makes no file system calls", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        const exists = vi.spyOn(scanner, "exists");
        const readDirectory = vi.spyOn(scanner, "readDirectory");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: [] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
        expect(exists).not.toHaveBeenCalled();
        expect(readDirectory).not.toHaveBeenCalled();
    });

    it("with no open folders there is nothing to count", async () => {
        const scanner = fakeScanner(ROOT, { "pom.xml": "file" });
        await expect(matchWorkspaceContains(scanner, [], { paths: ["pom.xml"], globs: ["*.xml"] })).resolves.toEqual({
            pattern: null,
            truncated: false,
        });
    });
});

describe("createNodeWorkspaceScanner — real file system", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wsc-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("exists: file, directory, missing path", async () => {
        const scanner = createNodeWorkspaceScanner();
        fs.writeFileSync(path.join(root, "pom.xml"), "<project/>");
        fs.mkdirSync(path.join(root, "src"));
        await expect(scanner.exists(path.join(root, "pom.xml"))).resolves.toBe(true);
        await expect(scanner.exists(path.join(root, "src"))).resolves.toBe(true);
        await expect(scanner.exists(path.join(root, "nope"))).resolves.toBe(false);
    });

    it("readDirectory tells files from directories", async () => {
        const scanner = createNodeWorkspaceScanner();
        fs.writeFileSync(path.join(root, "a.txt"), "a");
        fs.mkdirSync(path.join(root, "sub"));
        const entries = [...(await scanner.readDirectory(root))].sort((x, y) => x.name.localeCompare(y.name));
        expect(entries).toEqual([
            { name: "a.txt", isDirectory: false },
            { name: "sub", isDirectory: true },
        ]);
    });

    it("readDirectory of a missing directory gives an empty list, not an exception", async () => {
        const scanner = createNodeWorkspaceScanner();
        await expect(scanner.readDirectory(path.join(root, "nope"))).resolves.toEqual([]);
    });

    it("end to end: a maven layout triggers `*/pom.xml` on real files", async () => {
        fs.mkdirSync(path.join(root, "module-a"));
        fs.writeFileSync(path.join(root, "module-a", "pom.xml"), "<project/>");
        await expect(
            matchWorkspaceContains(createNodeWorkspaceScanner(), [root], {
                paths: ["pom.xml"],
                globs: ["*/pom.xml"],
            }),
        ).resolves.toEqual({ pattern: "*/pom.xml", truncated: false });
    });

    it("a symlink to a directory is not followed, so the walk does not loop", async () => {
        fs.mkdirSync(path.join(root, "real"));
        fs.writeFileSync(path.join(root, "real", "pom.xml"), "<project/>");
        fs.symlinkSync(root, path.join(root, "real", "loop"), "dir");
        await expect(
            matchWorkspaceContains(createNodeWorkspaceScanner(), [root], {
                paths: [],
                globs: ["**/nothing.xml"],
            }),
        ).resolves.toEqual({ pattern: null, truncated: false });
    });
});
