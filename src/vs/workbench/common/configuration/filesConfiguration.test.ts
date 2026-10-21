import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { FSWatcher } from "chokidar";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";
import type { ITreeFileWatchOptions } from "../../../platform/files/common/iTreeFileWatcher.ts";
import { ChokidarTreeWatcher, isExcluded } from "../../../platform/files/node/chokidarTreeWatcher.ts";

import { parseExcludeSetting } from "./excludeSettings.ts";
import { filesConfiguration } from "./filesConfiguration.ts";

const DEFAULT_EXCLUDES = parseExcludeSetting(filesConfiguration.properties["files.watcherExclude"].default);

describe("filesConfiguration: files.watcherExclude, schema", () => {
    it("object with a description of matching relative to the watch root", () => {
        const schema = filesConfiguration.properties["files.watcherExclude"];
        expect(schema.type).toBe("object");
        expect(schema.description).toContain("relative to the watched folder");
    });

    it("all default patterns are enabled: a `{ glob: true }` map, as in VS Code", () => {
        const value = filesConfiguration.properties["files.watcherExclude"].default as Record<string, unknown>;
        expect(Object.values(value).every((enabled) => enabled === true)).toBe(true);
        expect(DEFAULT_EXCLUDES.length).toBe(Object.keys(value).length);
    });
});

// Paths are listed explicitly rather than derived from the patterns; otherwise the test would be rewritten
// along with a typo in the default.
describe("filesConfiguration: files.watcherExclude, defaults on real paths", () => {
    const excluded = [
        ".git",
        "sub/.git",
        ".hg",
        ".svn",
        "node_modules",
        "packages/app/node_modules",
        ".venv",
        "dist",
        "out",
        "build",
        "target",
        "coverage",
        ".cache",
        ".gradle",
        ".next",
        ".turbo",
        "__pycache__",
        "src/pkg/__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
        ".stryker-tmp",
        ".claude/worktrees",
    ];

    const kept = [
        ".gitignore",
        ".gitattributes",
        "src",
        "src/main.ts",
        "docs/build.md",
        "distribution",
        "outline.ts",
        "node_modules_backup",
        // `.claude` is not excluded entirely: settings and skills are edited by hand.
        ".claude",
        ".claude/settings.json",
        ".claude/skills/run/SKILL.md",
    ];

    it.each(excluded)("excluded: %s", (relative) => {
        expect(isExcluded("/repo", path.join("/repo", relative), DEFAULT_EXCLUDES)).toBe(true);
    });

    it.each(kept)("stays watched: %s", (relative) => {
        expect(isExcluded("/repo", path.join("/repo", relative), DEFAULT_EXCLUDES)).toBe(false);
    });

    it("the directory itself is excluded, not just its contents", () => {
        expect(isExcluded("/repo", "/repo/node_modules", ["**/node_modules/**"])).toBe(false);
        expect(isExcluded("/repo", "/repo/node_modules", DEFAULT_EXCLUDES)).toBe(true);
    });

    it("`**/.git` does not affect the git extension's own watcher", () => {
        // Its watcher's root is `.git` itself (`startWatchers` in extensions/git/main.ts).
        expect(isExcluded("/repo/.git", "/repo/.git/HEAD", DEFAULT_EXCLUDES)).toBe(false);
        expect(isExcluded("/repo/.git", "/repo/.git/index", DEFAULT_EXCLUDES)).toBe(false);
        expect(isExcluded("/repo/.git", "/repo/.git/refs/heads/main", DEFAULT_EXCLUDES)).toBe(false);
    });
});

describe("filesConfiguration: files.watcherExclude, user edits", () => {
    function merged(userValue: Record<string, boolean>): string[] {
        const defaults = ConfigurationModel.fromRaw({
            "files.watcherExclude": filesConfiguration.properties["files.watcherExclude"].default,
        });
        const user = ConfigurationModel.fromRaw({ "files.watcherExclude": userValue });
        return parseExcludeSetting(ConfigurationModel.merge(defaults, user).get("files.watcherExclude"));
    }

    it("a custom pattern is added to the defaults, not replacing them", () => {
        const patterns = merged({ "**/vendor": true });
        expect(patterns).toContain("**/vendor");
        expect(patterns).toContain("**/node_modules");
    });

    it("an unwanted default is turned off with false", () => {
        const patterns = merged({ "**/dist": false });
        expect(patterns).not.toContain("**/dist");
        expect(patterns).toContain("**/node_modules");
        expect(isExcluded("/repo", "/repo/dist", patterns)).toBe(false);
    });
});

class CapturingTreeWatcher extends ChokidarTreeWatcher {
    public captured: FSWatcher | undefined;
    protected override createWatcher(rootPath: string, options: ITreeFileWatchOptions): FSWatcher {
        this.captured = super.createWatcher(rootPath, options);
        return this.captured;
    }
}

describe("filesConfiguration: files.watcherExclude on a real walk", () => {
    let root: string;

    beforeAll(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "diode-watcher-defaults-"));
        for (const dir of [
            "src/app",
            "node_modules/pkg/lib",
            ".git/objects/ab",
            ".claude/worktrees/feature/src",
            ".claude/skills",
            "dist/assets",
            "coverage/lcov-report",
        ]) {
            fs.mkdirSync(path.join(root, dir), { recursive: true });
        }
    });

    afterAll(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    async function watchedDirs(excludes: readonly string[]): Promise<string[]> {
        const watcher = new CapturingTreeWatcher();
        const subscription = watcher.watchTree(root, { recursive: true, excludes }, () => {
            /* this test needs no events: it checks the traversal itself */
        });
        try {
            await new Promise((resolve) => setTimeout(resolve, 600));
            return Object.keys(watcher.captured?.getWatched() ?? {})
                .map((dir) => path.relative(root, dir).split(path.sep).join("/"))
                .filter((relative) => relative !== "");
        } finally {
            subscription.dispose();
        }
    }

    it("the walk does not enter excluded directories at all", async () => {
        const watched = await watchedDirs(DEFAULT_EXCLUDES);
        expect(watched).toContain("src");
        expect(watched).toContain("src/app");
        expect(watched).toContain(".claude");
        expect(watched).toContain(".claude/skills");
        expect(watched.filter((dir) => dir.startsWith("node_modules"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith(".git"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith(".claude/worktrees"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith("dist"))).toEqual([]);
        expect(watched.filter((dir) => dir.startsWith("coverage"))).toEqual([]);
    }, 20000);

    it("a contents-only pattern would leave a watch on the directory itself", async () => {
        const watched = await watchedDirs(["**/node_modules/**"]);
        expect(watched).toContain("node_modules");
        expect(watched).not.toContain("node_modules/pkg");
    }, 20000);
});
