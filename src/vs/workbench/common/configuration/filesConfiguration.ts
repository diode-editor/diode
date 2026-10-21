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
        // Дословно эталон (`files.contribution.ts`). Автосохранения у нас нет — исполняется
        // только `off`, но ключ читают расширения: Claude Code считает сохранение
        // предложенного диффа принятием правки только при `off`.
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
        // Дословно эталон (`bulkEditService.ts`). Без него «Move to a new file» оставляет
        // исходник грязным в буфере, и закрытие без сохранения дублирует класс.
        "files.refactoring.autoSave": {
            scope: "window",
            type: "boolean",
            default: true,
            description: "Controls if files that were part of a refactoring are saved automatically",
        },
        // Форма `**/<имя>`, как у эталона: `**/<имя>/**` оставил бы каталог в дереве пустым.
        // К набору эталона добавлены только кеши Python-инструментов: их содержимое человек
        // не читает никогда. Прочее машинное (сборка, кеши сборщиков) открывают — оно в
        // `search.exclude`.
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
        // Отличия от эталона — из-за chokidar с inotify-watch'ем на каждый каталог:
        // 1. `**/<имя>`, а не `**/<имя>/**`: второй каталог не матчит, и chokidar в него
        //    заходит, stat'ит каждый вход и вешает watch, отбрасывая лишь детей;
        // 2. список длиннее: упёршись в `fs.inotify.max_user_watches`, watcher получает
        //    ENOSPC и умирает целиком. Критерий — каталог порождается машиной и меняется пачками.
        "files.watcherExclude": {
            scope: "resource",
            type: "object",
            default: {
                // Расширение git следит за `.git` своим watcher'ом с корнем в нём, а корень
                // исключения не задевают.
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
                // Каждый worktree агента — полная копия репозитория с `node_modules`. Не весь
                // `.claude`: рядом настройки и скиллы, которые правят руками.
                "**/.claude/worktrees": true,
            },
            description:
                "Glob patterns to exclude from file watching. Patterns are matched relative to the watched folder.",
        },
        // Каталоги-симлинки обход не обходит, как parcel-watcher эталона (иначе `bazel-out`
        // тащит в слежение кэш Bazel вне воркспейса). `items: string` эталона схема не выражает.
        "files.watcherInclude": {
            scope: "resource",
            type: "array",
            default: [],
            description:
                "Configure extra paths to watch for changes inside the workspace. By default, all workspace folders will be watched recursively, except for folders that are symbolic links. You can explicitly add absolute or relative paths to support watching folders that are symbolic links. Relative paths will be resolved to an absolute path using the currently opened workspace.",
        },
    },
} as const satisfies IConfigurationNode;
