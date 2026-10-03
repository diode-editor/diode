import type { IConfigurationNode } from "../../../platform/configuration/common/configurationRegistry.ts";

export const searchConfiguration: IConfigurationNode = {
    id: "search",
    title: "Search",
    properties: {
        // Глобы, которых нет только В ПОИСКЕ — по именам файлов (Quick Open) и
        // по содержимому (ripgrep). Набор ДОБАВЛЯЕТСЯ к `files.exclude`, а не
        // заменяет его (см. `searchExcludeGlobs` в `excludeSettings.ts`), и в
        // дереве Explorer'а эти входы остаются видимыми.
        //
        // Форма шаблона — `**/<имя>`, то есть сам каталог: и наш обход индекса,
        // и ripgrep на таком шаблоне режут ветку целиком, не читая её.
        //
        // От набора эталона (`node_modules`, `bower_components`) список
        // длиннее, и каждая добавка — по одной из трёх причин:
        //
        // 1. Дерево ЗАВИСИМОСТЕЙ не этого проекта. `node_modules` у эталона
        //    здесь ровно за этим; `.venv` — он же в мире Python.
        // 2. РЕЗУЛЬТАТ СБОРКИ: дубликат собственного исходника. Найти свою
        //    функцию дважды — в `src/` и в бандле — хуже, чем не найти её в
        //    бандле вовсе; за правкой человек всё равно идёт в исходник.
        // 3. ПОЛНАЯ КОПИЯ репозитория. У `.stryker-tmp` (sandbox мутационного
        //    гейта) и `.claude/worktrees` (worktree агентов) каждый файл
        //    проекта лежит ещё по разу — поиск множит КАЖДЫЙ результат на их
        //    число. Исключаем только `worktrees`, а не весь `.claude`: рядом
        //    настройки и скиллы, которые как раз ищут.
        "search.exclude": {
            scope: "resource",
            type: "object",
            default: {
                // Набор эталона: зависимости.
                "**/node_modules": true,
                "**/bower_components": true,
                // Причина 1 — зависимости Python.
                "**/.venv": true,
                // Причина 2 — результат сборки и отчёты инструментов.
                "**/dist": true,
                "**/out": true,
                "**/build": true,
                "**/target": true,
                "**/coverage": true,
                "**/.next": true,
                "**/.gradle": true,
                "**/.cache": true,
                "**/.turbo": true,
                // Причина 3 — полные копии репозитория.
                "**/.stryker-tmp": true,
                "**/.claude/worktrees": true,
            },
            description:
                "Glob patterns to exclude from search, in addition to files.exclude. Matched relative to the folder.",
        },
    },
};
