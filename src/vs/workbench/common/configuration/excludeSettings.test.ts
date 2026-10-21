import { describe, expect, it } from "vitest";

import { ConfigurationModel } from "../../../platform/configuration/common/configurationModel.ts";
import { ConfigurationRegistry } from "../../../platform/configuration/common/configurationRegistry.ts";

import { CONFIGURATION_CONTRIBUTIONS } from "./configurationContributions.ts";
import {
    FILES_EXCLUDE_SETTING,
    filesExcludeGlobs,
    type IExcludeConfigReader,
    isExcludedPath,
    parseExcludeSetting,
    readUseIgnoreFiles,
    SEARCH_EXCLUDE_SETTING,
    SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING,
    SEARCH_USE_IGNORE_FILES_SETTING,
    SEARCH_USE_PARENT_IGNORE_FILES_SETTING,
    searchExcludeGlobs,
    WATCHER_EXCLUDE_SETTING,
    watcherExcludeGlobs,
} from "./excludeSettings.ts";

function reader(values: Readonly<Record<string, unknown>>): IExcludeConfigReader {
    return { get: (key: string): unknown => values[key] };
}

describe("parseExcludeSetting", () => {
    it("takes only enabled patterns", () => {
        expect(parseExcludeSetting({ "a/**": true, "b/**": false, "c/**": true })).toEqual(["a/**", "c/**"]);
    });

    it("a non-map yields an empty set", () => {
        expect(parseExcludeSetting(undefined)).toEqual([]);
        expect(parseExcludeSetting(null)).toEqual([]);
        expect(parseExcludeSetting(["a/**"])).toEqual([]);
        expect(parseExcludeSetting("a/**")).toEqual([]);
    });

    it("values other than true do not enable a pattern", () => {
        expect(parseExcludeSetting({ "a/**": 1, "b/**": "yes" })).toEqual([]);
    });
});

describe("per-consumer set builders", () => {
    const config = reader({
        [FILES_EXCLUDE_SETTING]: { "**/.git": true, "**/off": false },
        [SEARCH_EXCLUDE_SETTING]: { "**/node_modules": true },
        [WATCHER_EXCLUDE_SETTING]: { "**/dist": true },
    });

    it("files.exclude uses only its own key", () => {
        expect(filesExcludeGlobs(config)).toEqual(["**/.git"]);
    });

    it("search combines files.exclude and search.exclude, in that order", () => {
        expect(searchExcludeGlobs(config)).toEqual(["**/.git", "**/node_modules"]);
    });

    it("the watcher uses its own set and does not see the others", () => {
        expect(watcherExcludeGlobs(config)).toEqual(["**/dist"]);
    });

    it("search.exclude adds to, not replaces: `files.exclude` stays in search", () => {
        const onlySearch = reader({ [SEARCH_EXCLUDE_SETTING]: { "**/node_modules": true } });
        expect(searchExcludeGlobs(onlySearch)).toEqual(["**/node_modules"]);
        const onlyFiles = reader({ [FILES_EXCLUDE_SETTING]: { "**/.git": true } });
        expect(searchExcludeGlobs(onlyFiles)).toEqual(["**/.git"]);
    });
});

describe("isExcludedPath", () => {
    it("`**/<name>` matches an entry both at the root and nested", () => {
        expect(isExcludedPath("__pycache__", ["**/__pycache__"])).toBe(true);
        expect(isExcludedPath("pkg/sub/__pycache__", ["**/__pycache__"])).toBe(true);
    });

    it("a pattern without `**/` is anchored at the root", () => {
        expect(isExcludedPath("out", ["out"])).toBe(true);
        expect(isExcludedPath("pkg/out", ["out"])).toBe(false);
    });

    it("the root itself is never excluded", () => {
        expect(isExcludedPath("", ["**/anything", "**"])).toBe(false);
    });

    it("an empty set excludes nothing", () => {
        expect(isExcludedPath("node_modules", [])).toBe(false);
    });

    it("a similar name is not affected", () => {
        expect(isExcludedPath("outline.ts", ["**/out"])).toBe(false);
        expect(isExcludedPath("node_modules_backup", ["**/node_modules"])).toBe(false);
    });
});

// Paths are listed explicitly rather than derived from the patterns; otherwise the test would be rewritten
// along with a typo in the default.
describe("files.exclude / search.exclude defaults", () => {
    function merged(userValue: Readonly<Record<string, unknown>> = {}): IExcludeConfigReader {
        const defaults = ConfigurationModel.fromRaw(
            new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getDefaultConfiguration(),
        );
        const user = ConfigurationModel.fromRaw(userValue);
        const model = ConfigurationModel.merge(defaults, user);
        return { get: (key: string): unknown => model.get(key) };
    }

    const hiddenEverywhere = [
        ".git",
        "sub/.git",
        ".svn",
        ".hg",
        ".DS_Store",
        "src/.DS_Store",
        "Thumbs.db",
        "__pycache__",
        "pkg/sub/__pycache__",
        ".mypy_cache",
        ".pytest_cache",
        ".ruff_cache",
    ];

    const hiddenInSearchOnly = [
        "node_modules",
        "packages/app/node_modules",
        "bower_components",
        ".venv",
        "dist",
        "out",
        "build",
        "target",
        "coverage",
        ".next",
        ".gradle",
        ".cache",
        ".turbo",
        ".stryker-tmp",
        ".claude/worktrees",
    ];

    const visibleAndSearchable = [
        "src",
        "src/main.ts",
        ".gitignore",
        "docs/build.md",
        "distribution",
        "outline.ts",
        "node_modules_backup",
        // `.claude` is not excluded entirely: settings and skills are exactly what people search for.
        ".claude",
        ".claude/settings.json",
    ];

    it.each(hiddenEverywhere)("hidden in both the tree and search: %s", (relative) => {
        const config = merged();
        expect(isExcludedPath(relative, filesExcludeGlobs(config))).toBe(true);
        expect(isExcludedPath(relative, searchExcludeGlobs(config))).toBe(true);
    });

    it.each(hiddenInSearchOnly)("visible in the tree, not in search: %s", (relative) => {
        const config = merged();
        expect(isExcludedPath(relative, filesExcludeGlobs(config))).toBe(false);
        expect(isExcludedPath(relative, searchExcludeGlobs(config))).toBe(true);
    });

    it.each(visibleAndSearchable)("visible and searchable: %s", (relative) => {
        const config = merged();
        expect(isExcludedPath(relative, searchExcludeGlobs(config))).toBe(false);
    });

    it("node_modules IS visible in the tree: a deliberate alignment with upstream", () => {
        const config = merged();
        expect(filesExcludeGlobs(config)).not.toContain("**/node_modules");
        expect(parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))).toContain("**/node_modules");
    });

    it("a custom pattern is added to the defaults, not replacing them", () => {
        const config = merged({ [FILES_EXCLUDE_SETTING]: { "**/vendor": true } });
        const globs = filesExcludeGlobs(config);
        expect(globs).toContain("**/vendor");
        expect(globs).toContain("**/.git");
    });

    it("an unwanted default is turned off with false", () => {
        const config = merged({ [FILES_EXCLUDE_SETTING]: { "**/__pycache__": false } });
        const globs = filesExcludeGlobs(config);
        expect(globs).not.toContain("**/__pycache__");
        expect(globs).toContain("**/.git");
        expect(isExcludedPath("pkg/__pycache__", globs)).toBe(false);
    });

    it("a turned-off `files.exclude` default does not come back through search", () => {
        // Otherwise `false` in one setting would be silently overridden by the other.
        const config = merged({ [FILES_EXCLUDE_SETTING]: { "**/.git": false } });
        expect(isExcludedPath(".git", searchExcludeGlobs(config))).toBe(false);
    });

    it("all default patterns are enabled: a `{ glob: true }` map, as upstream", () => {
        for (const key of [FILES_EXCLUDE_SETTING, SEARCH_EXCLUDE_SETTING]) {
            const value = merged().get(key) as Record<string, unknown>;
            expect(
                Object.values(value).every((enabled) => enabled === true),
                key,
            ).toBe(true);
        }
    });

    it("every default has the form `**/<name>`: the entry ITSELF is hidden", () => {
        // `**/<name>/**` doesn't match the directory: it would stay in the tree as empty, and traversal would enter it.
        const config = merged();
        for (const glob of [...filesExcludeGlobs(config), ...parseExcludeSetting(config.get(SEARCH_EXCLUDE_SETTING))]) {
            expect(glob.startsWith("**/"), glob).toBe(true);
            expect(glob.endsWith("/**"), glob).toBe(false);
        }
    });
});

describe("readUseIgnoreFiles", () => {
    it("without values, upstream defaults apply: own ignore files yes, parent and global no", () => {
        expect(readUseIgnoreFiles(reader({}))).toEqual({ local: true, parent: false, global: false });
    });

    it("the registered defaults give the same result", () => {
        const defaults = ConfigurationModel.fromRaw(
            new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getDefaultConfiguration(),
        );
        expect(readUseIgnoreFiles({ get: (key) => defaults.get(key) })).toEqual({
            local: true,
            parent: false,
            global: false,
        });
    });

    it("reads all three keys", () => {
        expect(
            readUseIgnoreFiles(
                reader({
                    [SEARCH_USE_IGNORE_FILES_SETTING]: false,
                    [SEARCH_USE_PARENT_IGNORE_FILES_SETTING]: true,
                    [SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING]: true,
                }),
            ),
        ).toEqual({ local: false, parent: true, global: true });
    });

    it("a malformed value falls back to the default, neither on nor off", () => {
        expect(
            readUseIgnoreFiles(
                reader({
                    [SEARCH_USE_IGNORE_FILES_SETTING]: "no",
                    [SEARCH_USE_PARENT_IGNORE_FILES_SETTING]: "yes",
                    [SEARCH_USE_GLOBAL_IGNORE_FILES_SETTING]: 1,
                }),
            ),
        ).toEqual({ local: true, parent: false, global: false });
    });
});
