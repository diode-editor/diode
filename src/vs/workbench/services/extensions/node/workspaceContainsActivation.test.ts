import * as path from "node:path";

import { describe, expect, it, type Mock, vi } from "vitest";

import { CancellationTokenNone, CancellationTokenSource } from "../../../../base/common/cancellation.ts";

import { type IWorkspaceScanner, matchWorkspaceContains } from "./workspaceContainsActivation.ts";

/**
 * `files` are posix paths relative to `root`; `findFile` answers the first one any glob covers by the given
 * matcher — the real rg semantics are in `workspaceContainsActivation.ripgrep.test.ts`.
 */
function fakeScanner(
    root: string,
    files: readonly string[],
    found: (folder: string, globs: readonly string[]) => string | null = () => null,
): { exists: Mock<IWorkspaceScanner["exists"]>; findFile: Mock<IWorkspaceScanner["findFile"]> } {
    const relative = (absolutePath: string): string => path.relative(root, absolutePath).split(path.sep).join("/");
    return {
        exists: vi.fn<IWorkspaceScanner["exists"]>((absolutePath) =>
            Promise.resolve(files.includes(relative(absolutePath))),
        ),
        findFile: vi.fn<IWorkspaceScanner["findFile"]>((folder, globs) => Promise.resolve(found(folder, globs))),
    };
}

const ROOT = path.join(path.sep, "root");

describe("matchWorkspaceContains — path patterns (no glob characters)", () => {
    it("file at the root of a workspace folder", async () => {
        const scanner = fakeScanner(ROOT, ["pom.xml"]);
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] })).resolves.toBe(
            "pom.xml",
        );
    });

    it("a nested path is checked as a whole, without a search", async () => {
        const scanner = fakeScanner(ROOT, ["a/b/c.json"]);
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["a/b/c.json"], globs: [] })).resolves.toBe(
            "a/b/c.json",
        );
        expect(scanner.exists).toHaveBeenCalledWith(path.join(ROOT, "a", "b", "c.json"));
        expect(scanner.findFile).not.toHaveBeenCalled();
    });

    it("a missing path does not match", async () => {
        const scanner = fakeScanner(ROOT, ["build.gradle"]);
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] })).resolves.toBeNull();
    });

    it("several workspace folders: a hit in any of them is enough", async () => {
        const second = path.join(path.sep, "other");
        const scanner = fakeScanner(second, ["pom.xml"]);
        await expect(matchWorkspaceContains(scanner, [ROOT, second], { paths: ["pom.xml"], globs: [] })).resolves.toBe(
            "pom.xml",
        );
    });

    it("the FIRST matching pattern is returned: it is the activation reason", async () => {
        const scanner = fakeScanner(ROOT, ["pom.xml", "build.gradle"]);
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["build.gradle", "pom.xml"], globs: [] }),
        ).resolves.toBe("build.gradle");
    });

    it("path patterns are checked BEFORE the glob search: a cheap hit starts no search", async () => {
        const scanner = fakeScanner(ROOT, ["pom.xml"], () => "sub/pom.xml");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: ["*/pom.xml"] }),
        ).resolves.toBe("pom.xml");
        expect(scanner.findFile).not.toHaveBeenCalled();
    });
});

describe("matchWorkspaceContains — glob patterns (one search per folder)", () => {
    it("ALL globs of the extension go to one search, with the folder and the token", async () => {
        const scanner = fakeScanner(ROOT, [], () => "a/main.tf");
        const source = new CancellationTokenSource();
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/*.tf", "**/*.tfvars"] }, source.token),
        ).resolves.toBe("**/*.tf");
        expect(scanner.findFile).toHaveBeenCalledOnce();
        expect(scanner.findFile).toHaveBeenCalledWith(ROOT, ["**/*.tf", "**/*.tfvars"], source.token);
    });

    it("the reason is the glob the found path fits, not just the first declared one", async () => {
        const scanner = fakeScanner(ROOT, [], () => "terraform.tfvars");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/*.tf", "**/*.tfvars"] }),
        ).resolves.toBe("**/*.tfvars");
    });

    it("a path no glob fits by our dialect: the first declared glob stands in", async () => {
        const scanner = fakeScanner(ROOT, [], () => "weird/path");
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: ["**/*.tf", "**/*.tfvars"] }),
        ).resolves.toBe("**/*.tf");
    });

    it("nothing found in any folder → null; each folder is searched", async () => {
        const second = path.join(path.sep, "other");
        const scanner = fakeScanner(ROOT, []);
        await expect(matchWorkspaceContains(scanner, [ROOT, second], { paths: [], globs: ["*.py"] })).resolves.toBe(
            null,
        );
        expect(scanner.findFile.mock.calls.map(([folder]) => folder)).toEqual([ROOT, second]);
    });

    it("a hit in the first folder skips the rest", async () => {
        const second = path.join(path.sep, "other");
        const scanner = fakeScanner(ROOT, [], (folder) => (folder === ROOT ? "x.py" : null));
        await expect(matchWorkspaceContains(scanner, [ROOT, second], { paths: [], globs: ["*.py"] })).resolves.toBe(
            "*.py",
        );
        expect(scanner.findFile).toHaveBeenCalledOnce();
    });

    it("a hit in the second folder counts too", async () => {
        const second = path.join(path.sep, "other");
        const scanner = fakeScanner(ROOT, [], (folder) => (folder === second ? "x.py" : null));
        await expect(matchWorkspaceContains(scanner, [ROOT, second], { paths: [], globs: ["*.py"] })).resolves.toBe(
            "*.py",
        );
    });
});

describe("matchWorkspaceContains — cancellation and empty input", () => {
    it("a cancelled token checks no more paths", async () => {
        const source = new CancellationTokenSource();
        source.cancel();
        const scanner = fakeScanner(ROOT, ["pom.xml"]);
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: [] }, source.token),
        ).resolves.toBeNull();
        expect(scanner.exists).not.toHaveBeenCalled();
    });

    it("cancelled during the path checks → no glob search is started", async () => {
        const source = new CancellationTokenSource();
        const scanner = fakeScanner(ROOT, [], () => "x.py");
        scanner.exists.mockImplementation(() => {
            source.cancel();
            return Promise.resolve(false);
        });
        await expect(
            matchWorkspaceContains(scanner, [ROOT], { paths: ["pom.xml"], globs: ["*.py"] }, source.token),
        ).resolves.toBeNull();
        expect(scanner.findFile).not.toHaveBeenCalled();
    });

    it("cancelled during the first folder's search → the next folder is not searched", async () => {
        const source = new CancellationTokenSource();
        const scanner = fakeScanner(ROOT, []);
        scanner.findFile.mockImplementation(() => {
            source.cancel();
            return Promise.resolve(null);
        });
        await expect(
            matchWorkspaceContains(
                scanner,
                [ROOT, path.join(path.sep, "other")],
                { paths: [], globs: ["*.py"] },
                source.token,
            ),
        ).resolves.toBeNull();
        expect(scanner.findFile).toHaveBeenCalledOnce();
    });

    it("an empty pattern set makes no file system calls", async () => {
        const scanner = fakeScanner(ROOT, ["pom.xml"], () => "pom.xml");
        await expect(matchWorkspaceContains(scanner, [ROOT], { paths: [], globs: [] })).resolves.toBeNull();
        expect(scanner.exists).not.toHaveBeenCalled();
        expect(scanner.findFile).not.toHaveBeenCalled();
    });

    it("with no open folders there is nothing to search", async () => {
        const scanner = fakeScanner(ROOT, ["pom.xml"], () => "a.xml");
        await expect(
            matchWorkspaceContains(scanner, [], { paths: ["pom.xml"], globs: ["*.xml"] }, CancellationTokenNone),
        ).resolves.toBeNull();
        expect(scanner.findFile).not.toHaveBeenCalled();
    });
});
