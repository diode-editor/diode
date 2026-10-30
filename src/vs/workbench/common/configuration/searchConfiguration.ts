import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const searchConfiguration = {
    id: "search",
    title: "Search",
    properties: {
        // `**/<name>` form: the index walk and ripgrep prune the whole branch without reading it.
        // Added to upstream's set: Python dependencies, build output (finding your function in the
        // bundle too is noise) and full repository copies (they multiply every result).
        // Not all of `.claude`: settings and skills are exactly what people search for.
        "search.exclude": {
            scope: "resource",
            type: "object",
            default: {
                "**/node_modules": true,
                "**/bower_components": true,
                "**/.venv": true,
                "**/dist": true,
                "**/out": true,
                "**/build": true,
                "**/target": true,
                "**/coverage": true,
                "**/.next": true,
                "**/.gradle": true,
                "**/.cache": true,
                "**/.turbo": true,
                "**/.stryker-tmp": true,
                "**/.claude/worktrees": true,
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
