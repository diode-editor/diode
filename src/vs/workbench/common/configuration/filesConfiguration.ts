import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const filesConfiguration = {
    id: "files",
    title: "Files",
    properties: {
        "files.enableTrash": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Move files to the OS trash when available; when disabled, delete permanently.",
        },
        // Verbatim from upstream (`files.contribution.ts`). We have no auto save, so only `off` is honored,
        // but extensions read the key: Claude Code treats saving a proposed diff as accepting the edit
        // only when it is `off`.
        "files.autoSave": {
            scope: "language-overridable",
            type: "string",
            enum: ["off", "afterDelay", "onFocusChange", "onWindowChange"],
            enumDescriptions: [
                "An editor with changes is never automatically saved.",
                "An editor with changes is automatically saved after the configured `#files.autoSaveDelay#`.",
                "An editor with changes is automatically saved when the editor loses focus.",
                "An editor with changes is automatically saved when the window loses focus.",
            ],
            default: "off",
            description:
                "Controls [auto save](https://code.visualstudio.com/docs/editor/codebasics#_save-auto-save) of editors that have unsaved changes.",
        },
        // Verbatim from upstream (`bulkEditService.ts`). Without it "Move to a new file" leaves the source
        // dirty in its buffer, and closing without saving duplicates the class.
        "files.refactoring.autoSave": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Controls if files that were part of a refactoring are saved automatically",
        },
        // `**/<name>` form, as upstream: `**/<name>/**` would leave the directory in the tree as empty.
        // Only Python tool caches are added to upstream's set: nobody ever reads them. Other generated
        // output (builds, build tool caches) does get opened, so it goes in `search.exclude`.
        "files.exclude": {
            scope: "resource",
            type: "object",
            default: {
                "**/.git": true,
                "**/.svn": true,
                "**/.hg": true,
                "**/.DS_Store": true,
                "**/Thumbs.db": true,
                "**/__pycache__": true,
                "**/.mypy_cache": true,
                "**/.pytest_cache": true,
                "**/.ruff_cache": true,
            },
            description: "Glob patterns to hide from the file tree and from search. Matched relative to the folder.",
        },
        // Differs from upstream because chokidar puts an inotify watch on every directory:
        // 1. `**/<name>`, not `**/<name>/**`: the latter doesn't match the directory, so chokidar
        //    enters it, stats every entry and adds a watch, dropping only the children;
        // 2. the list is longer: on hitting `fs.inotify.max_user_watches` the watcher gets
        //    ENOSPC and dies entirely. The criterion: the directory is generated and changes in bulk.
        "files.watcherExclude": {
            scope: "resource",
            type: "object",
            default: {
                // The git extension watches `.git` with its own watcher rooted there, and
                // exclusions never apply to the root.
                "**/.git": true,
                "**/.hg": true,
                "**/.svn": true,
                "**/node_modules": true,
                "**/.venv": true,
                "**/dist": true,
                "**/out": true,
                "**/build": true,
                "**/target": true,
                "**/coverage": true,
                "**/.cache": true,
                "**/.gradle": true,
                "**/.next": true,
                "**/.turbo": true,
                "**/__pycache__": true,
                "**/.mypy_cache": true,
                "**/.pytest_cache": true,
                "**/.ruff_cache": true,
                "**/.stryker-tmp": true,
                // Each agent worktree is a full repository copy with `node_modules`. Not all of
                // `.claude`: settings and skills next to it are edited by hand.
                "**/.claude/worktrees": true,
            },
            description:
                "Glob patterns to exclude from file watching. Patterns are matched relative to the watched folder.",
        },
        // Traversal doesn't follow directory symlinks, like upstream's parcel-watcher (otherwise `bazel-out`
        // drags the Bazel cache outside the workspace into watching). Our schema can't express upstream's
        // `items: string`.
        "files.watcherInclude": {
            scope: "resource",
            type: "array",
            default: [],
            description:
                "Configure extra paths to watch for changes inside the workspace. By default, all workspace folders will be watched recursively, except for folders that are symbolic links. You can explicitly add absolute or relative paths to support watching folders that are symbolic links. Relative paths will be resolved to an absolute path using the currently opened workspace.",
        },
    },
} as const satisfies IConfigurationNode;
