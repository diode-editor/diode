import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const searchConfiguration = {
    id: "search",
    title: "Search",
    properties: {
        // Upstream's set, verbatim. Build output, virtualenvs and agent worktrees are left to
        // `.gitignore` (`search.useIgnoreFiles`), as upstream does: a hard-coded `**/build` hid
        // hand-written sources wherever `build/` is not generated.
        "search.exclude": {
            scope: "resource",
            type: "object",
            default: {
                "**/node_modules": true,
                "**/bower_components": true,
                "**/*.code-search": true,
            },
            description:
                "Glob patterns to exclude from search, in addition to files.exclude. Matched relative to the folder.",
        },
        // Verbatim from upstream (`markdownDescription` → `description`, `{0}` substituted). Applies to
        // both file name and content search: a single `rgIgnoreFilesArgs` builds the rg flags.
        "search.useIgnoreFiles": {
            scope: "resource",
            type: "boolean",
            default: true,
            description: "Controls whether to use `.gitignore` and `.ignore` files when searching for files.",
        },
        "search.useGlobalIgnoreFiles": {
            scope: "resource",
            type: "boolean",
            default: false,
            description:
                "Controls whether to use your global gitignore file (for example, from `$HOME/.config/git/ignore`) when searching for files. Requires `#search.useIgnoreFiles#` to be enabled.",
        },
        "search.useParentIgnoreFiles": {
            scope: "resource",
            type: "boolean",
            default: false,
            description:
                "Controls whether to use `.gitignore` and `.ignore` files in parent directories when searching for files. Requires `#search.useIgnoreFiles#` to be enabled.",
        },
        // Verbatim from upstream (`search.contribution.ts`); window scope, as there.
        "search.quickOpen.includeSymbols": {
            scope: "window",
            type: "boolean",
            default: false,
            description: "Whether to include results from a global symbol search in the file results for Quick Open.",
        },
        "search.quickOpen.includeHistory": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Whether to include results from recently opened files in the file results for Quick Open.",
        },
        "search.quickOpen.history.filterSortOrder": {
            scope: "window",
            type: "string",
            enum: ["default", "recency"],
            enumDescriptions: [
                "History entries are sorted by relevance based on the filter value used. More relevant entries appear first.",
                "History entries are sorted by recency. More recently opened entries appear first.",
            ],
            default: "default",
            description: "Controls sorting order of editor history in quick open when filtering.",
        },
    },
} as const satisfies IConfigurationNode;
