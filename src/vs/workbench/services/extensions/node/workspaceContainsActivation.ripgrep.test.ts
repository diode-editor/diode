import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type IFakeRipgrep, isProcessAlive, writeFakeRipgrep } from "../../../../../TestUtils/fakeRipgrep.ts";
import { waitUntil } from "../../../../../TestUtils/timing.ts";
import { CancellationTokenNone, CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { IExcludeConfigReader } from "../../../common/configuration/excludeSettings.ts";

import { createRipgrepWorkspaceScanner, matchWorkspaceContains } from "./workspaceContainsActivation.ts";

/** The upstream defaults that matter here; production reads them from the configuration service. */
const UPSTREAM_DEFAULTS: Readonly<Record<string, unknown>> = {
    "files.exclude": { "**/.git": true },
    "search.exclude": { "**/node_modules": true, "**/bower_components": true, "**/*.code-search": true },
};

function config(overrides: Readonly<Record<string, unknown>> = {}): IExcludeConfigReader {
    const values = { ...UPSTREAM_DEFAULTS, ...overrides };
    return { get: (key) => values[key] };
}

describe("createRipgrepWorkspaceScanner — real rg on fixtures", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wsc-"));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    function write(relativePath: string, content = ""): void {
        const file = path.join(root, ...relativePath.split("/"));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
    }

    function find(globs: readonly string[], reader: IExcludeConfigReader = config()): Promise<string | null> {
        return createRipgrepWorkspaceScanner(reader).findFile(root, globs, CancellationTokenNone);
    }

    it("exists: file, directory, missing path", async () => {
        const scanner = createRipgrepWorkspaceScanner(config());
        write("pom.xml");
        fs.mkdirSync(path.join(root, "src"));
        await expect(scanner.exists(path.join(root, "pom.xml"))).resolves.toBe(true);
        await expect(scanner.exists(path.join(root, "src"))).resolves.toBe(true);
        await expect(scanner.exists(path.join(root, "nope"))).resolves.toBe(false);
    });

    it("`**/*.tf` four levels deep is found, as a relative posix path", async () => {
        write("deep/a/b/c/main.tf");
        await expect(find(["**/*.tf"])).resolves.toBe("deep/a/b/c/main.tf");
    });

    it("nothing matches → null", async () => {
        write("README.md");
        await expect(find(["**/*.tf", "*/pom.xml"])).resolves.toBeNull();
    });

    it("a glob without `**` is anchored to the folder root: `*/pom.xml` is one level, `*.py` the root only", async () => {
        write("a/b/pom.xml");
        write("sub/x.py");
        await expect(find(["*/pom.xml"])).resolves.toBeNull();
        await expect(find(["*.py"])).resolves.toBeNull();
        write("a/pom.xml");
        write("x.py");
        await expect(find(["*/pom.xml"])).resolves.toBe("a/pom.xml");
        await expect(find(["*.py"])).resolves.toBe("x.py");
    });

    it("a file under `.gitignore` does not count, even outside a git repository", async () => {
        write(".gitignore", "build/\n");
        write("build/generated/main.tf");
        await expect(find(["**/*.tf"])).resolves.toBeNull();
    });

    it("`search.useIgnoreFiles: false` lets the ignored file count", async () => {
        write(".gitignore", "build/\n");
        write("build/generated/main.tf");
        await expect(find(["**/*.tf"], config({ "search.useIgnoreFiles": false }))).resolves.toBe(
            "build/generated/main.tf",
        );
    });

    it("a file under `node_modules` does not count: `search.exclude`", async () => {
        write("node_modules/dep/pyproject.toml");
        await expect(find(["**/pyproject.toml"])).resolves.toBeNull();
        // The exclusion comes from the setting, not from rg itself.
        await expect(find(["**/pyproject.toml"], { get: () => undefined })).resolves.toBe(
            "node_modules/dep/pyproject.toml",
        );
    });

    it("a user `files.exclude` glob is honored", async () => {
        write("vendor/lib/main.tf");
        await expect(find(["**/*.tf"], config({ "files.exclude": { "**/vendor": true } }))).resolves.toBeNull();
        await expect(find(["**/*.tf"], config({ "files.exclude": { "**/vendor": false } }))).resolves.toBe(
            "vendor/lib/main.tf",
        );
    });

    it("dotfiles count: `.tf` files in a hidden directory", async () => {
        write(".infra/main.tf");
        await expect(find(["**/*.tf"])).resolves.toBe(".infra/main.tf");
    });

    it("settings are read per search: a changed value applies to the next one", async () => {
        write("vendor/main.tf");
        let excluded = true;
        const scanner = createRipgrepWorkspaceScanner({
            get: (key) => (key === "files.exclude" ? { "**/vendor": excluded } : undefined),
        });
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).resolves.toBeNull();
        excluded = false;
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).resolves.toBe("vendor/main.tf");
    });

    it("spaces and unicode in the folder path need no quoting", async () => {
        // "my project" in Cyrillic.
        const folder = path.join(root, "\u043c\u043e\u0439 \u043f\u0440\u043e\u0435\u043a\u0442 (copy)");
        fs.mkdirSync(path.join(folder, "infra"), { recursive: true });
        fs.writeFileSync(path.join(folder, "infra", "main.tf"), "");
        await expect(
            createRipgrepWorkspaceScanner(config()).findFile(folder, ["**/*.tf"], CancellationTokenNone),
        ).resolves.toBe("infra/main.tf");
    });

    it.skipIf(process.platform === "win32")("a symlink loop is not followed: the search ends", async () => {
        write("real/pom.xml");
        fs.symlinkSync(root, path.join(root, "real", "loop"), "dir");
        await expect(find(["**/nothing.xml"])).resolves.toBeNull();
    });

    it("end to end with matchWorkspaceContains: the reason is the glob the file fits", async () => {
        write("module-a/pom.xml");
        await expect(
            matchWorkspaceContains(createRipgrepWorkspaceScanner(config()), [root], {
                paths: ["pom.xml"],
                globs: ["**/*.gradle", "*/pom.xml"],
            }),
        ).resolves.toBe("*/pom.xml");
    });

    it("a vanished folder is a failure, not a silent miss", async () => {
        await expect(
            createRipgrepWorkspaceScanner(config()).findFile(
                path.join(root, "gone"),
                ["**/*.tf"],
                CancellationTokenNone,
            ),
        ).rejects.toThrow(/ENOENT/);
    });

    it("rg that cannot start (broken asset) is a failure", async () => {
        const scanner = createRipgrepWorkspaceScanner(config(), () => path.join(root, "no-such-rg"));
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).rejects.toThrow(/ENOENT/);
    });

    it("a path resolver that throws (asset failed to load) rejects the search", async () => {
        const scanner = createRipgrepWorkspaceScanner(config(), () => {
            throw new Error("rg.bundle is corrupt");
        });
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).rejects.toThrow(
            "rg.bundle is corrupt",
        );
    });
});

describe.skipIf(process.platform === "win32")("createRipgrepWorkspaceScanner — against a fake rg", () => {
    let root: string;
    let fake: IFakeRipgrep | null = null;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-wsc-fake-"));
    });

    afterEach(() => {
        for (const pid of fake?.pids() ?? []) if (isProcessAlive(pid)) process.kill(pid, "SIGKILL");
        fake?.dispose();
        fake = null;
        fs.rmSync(root, { recursive: true, force: true });
    });

    function scannerOver(
        options: Parameters<typeof writeFakeRipgrep>[0],
    ): ReturnType<typeof createRipgrepWorkspaceScanner> {
        const rg = writeFakeRipgrep(options);
        fake = rg;
        return createRipgrepWorkspaceScanner(config(), () => rg.path);
    }

    it("runs in the folder with Quick Open's flags plus the globs as includes", async () => {
        const scanner = scannerOver({});
        await scanner.findFile(root, ["**/*.tf", "*/pom.xml"], CancellationTokenNone);
        expect(fs.realpathSync(fake?.lastCwd() ?? "")).toBe(fs.realpathSync(root));
        expect(fake?.lastArgs()).toEqual([
            "--files",
            "--hidden",
            "--glob",
            "**/*.tf",
            "--glob",
            "/*/pom.xml",
            "--glob",
            "!**/.git",
            "--glob",
            "!**/node_modules",
            "--glob",
            "!**/bower_components",
            "--glob",
            "!**/*.code-search",
            "--no-require-git",
            "--no-config",
            "--no-ignore-parent",
            "--no-ignore-global",
        ]);
    });

    it("the first line is the answer: rg is killed without waiting for the rest of the walk", async () => {
        const scanner = scannerOver({ stdoutLines: ["a/b/main.tf", "c/other.tf"], hang: true });
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).resolves.toBe("a/b/main.tf");
        const pid = fake?.onlyPid() ?? 0;
        await waitUntil("the fake rg is killed", () => !isProcessAlive(pid), 2000);
    });

    it("cancellation answers null at once and kills the hung rg", async () => {
        const scanner = scannerOver({ hang: true });
        const source = new CancellationTokenSource();
        const search = scanner.findFile(root, ["**/*.tf"], source.token);
        await waitUntil("the fake rg starts", () => (fake?.pids().length ?? 0) === 1);
        const pid = fake?.onlyPid() ?? 0;
        expect(isProcessAlive(pid)).toBe(true);

        source.cancel();

        await expect(search).resolves.toBeNull();
        await waitUntil("the fake rg is killed", () => !isProcessAlive(pid), 2000);
    });

    it("an already cancelled token starts no rg", async () => {
        const scanner = scannerOver({ stdoutLines: ["main.tf"] });
        const source = new CancellationTokenSource();
        source.cancel();
        await expect(scanner.findFile(root, ["**/*.tf"], source.token)).resolves.toBeNull();
        expect(fake?.pids()).toEqual([]);
    });

    it("exit code 2 without output (unreadable directories) is a miss, not a failure", async () => {
        const scanner = scannerOver({ code: 2 });
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).resolves.toBeNull();
    });

    it("exit code 1 (nothing) is a miss", async () => {
        const scanner = scannerOver({ code: 1 });
        await expect(scanner.findFile(root, ["**/*.tf"], CancellationTokenNone)).resolves.toBeNull();
    });

    it("cancelling after the answer changes nothing", async () => {
        const scanner = scannerOver({ stdoutLines: ["main.tf"] });
        const source = new CancellationTokenSource();
        await expect(scanner.findFile(root, ["**/*.tf"], source.token)).resolves.toBe("main.tf");
        expect(() => {
            source.cancel();
        }).not.toThrow();
    });
});
