import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const filesConfiguration: IConfigurationNode = {
    id: "files",
    title: "Files",
    properties: {
        "files.enableTrash": {
            type: "boolean",
            default: true,
            description: "Move files to the OS trash when available; when disabled, delete permanently.",
        },
        // Глобы, в которые файловый watcher не заходит. Шаблон матчится против
        // пути ОТНОСИТЕЛЬНО корня watch'а (`isExcluded` в
        // `platform/files/node/chokidarTreeWatcher.ts`), поэтому дефолты пишем
        // в форме `**/<имя>` — она работает и на любой глубине, и от корня.
        //
        // От набора VS Code этот отличается двумя вещами, и обе — следствие
        // того, что под нами chokidar с отдельным inotify-watch'ем НА КАЖДЫЙ
        // каталог, а не нативный рекурсивный watcher ОС:
        //
        // 1. Исключаем САМ каталог, а не только его содержимое. Шаблон
        //    `**/node_modules/**` каталог `node_modules` не матчит — chokidar
        //    в него заходит, делает readdir, stat'ит каждый вход и вешает на
        //    него watch, и только детей отбрасывает. `**/node_modules` режет
        //    ветку целиком, до обхода.
        // 2. Список длиннее. Бюджет inotify конечный
        //    (`fs.inotify.max_user_watches`), а упёршись в него, watcher
        //    получает ENOSPC и умирает целиком — вместе со слежением за теми
        //    каталогами, которые пользователю как раз нужны. Дешевле не
        //    заходить, чем ловить отказ.
        //
        // Критерий отбора: каталог порождается машиной, меняется пачками и
        // руками в нём не правят. Настройка пользовательская, а слои
        // конфигурации сливаются по ключам: свой шаблон добавляется рядом с
        // дефолтными, ненужный дефолт гасится значением `false`.
        "files.watcherExclude": {
            type: "object",
            default: {
                // Служебные каталоги VCS целиком, а не только `objects`:
                // checkout, fetch и gc переписывают их пачками. Расширение git
                // следит за `.git` собственным watcher'ом, у которого `.git` —
                // корень, а корень watch'а исключения не задевают.
                "**/.git": true,
                "**/.hg": true,
                "**/.svn": true,
                // Зависимости и виртуальные окружения — обычно самое большое
                // дерево в проекте и самое неинтересное.
                "**/node_modules": true,
                "**/.venv": true,
                // Результат сборки и отчёты инструментов: пишутся пачками,
                // читаются в лучшем случае глазами. Именно их VS Code
                // предлагает исключить, когда захлёбывается на событиях.
                "**/dist": true,
                "**/out": true,
                "**/build": true,
                "**/target": true,
                "**/coverage": true,
                // Кеши инструментов.
                "**/.cache": true,
                "**/.gradle": true,
                "**/.next": true,
                "**/.turbo": true,
                "**/__pycache__": true,
                "**/.mypy_cache": true,
                "**/.pytest_cache": true,
                "**/.ruff_cache": true,
                // Sandbox мутационного тестирования (Stryker) — копия репозитория.
                "**/.stryker-tmp": true,
                // Worktree агентов Claude Code: дефолтная раскладка —
                // `.claude/worktrees/<имя>`, и каждый worktree это ПОЛНАЯ копия
                // репозитория со своим `node_modules`. Дерево множится на их
                // число; у тех, кто агентами не пользуется, каталога просто нет.
                // Исключаем только `worktrees`, а не весь `.claude`: рядом
                // лежат настройки и скиллы, которые правят руками.
                "**/.claude/worktrees": true,
            },
            description:
                "Glob patterns to exclude from file watching. Patterns are matched relative to the watched folder.",
        },
    },
};
