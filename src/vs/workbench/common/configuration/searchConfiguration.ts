import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const searchConfiguration = {
    id: "search",
    title: "Search",
    properties: {
        // Форма `**/<имя>`: обход индекса и ripgrep режут ветку целиком, не читая её.
        // К набору эталона добавлены: зависимости Python, результат сборки (найти свою
        // функцию ещё и в бандле — шум) и полные копии репозитория (множат каждый
        // результат). Не весь `.claude`: настройки и скиллы как раз ищут.
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
        // Дословно эталон (`markdownDescription` → `description`, `{0}` подставлен). Действуют на
        // оба поиска — по именам и по содержимому: флаги rg собирает один `rgIgnoreFilesArgs`.
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
    },
} as const satisfies IConfigurationNode;
