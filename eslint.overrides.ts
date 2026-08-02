/**
 * Переопределения правил ESLint.
 *
 * Добавляй сюда любые правила, которые хочешь отключить или ослабить.
 * Этот файл импортируется в eslint.config.ts и применяется последним,
 * поэтому всё, что здесь указано, перекрывает базовый конфиг.
 *
 * Пример:
 *
 *   export default [
 *       {
 *           rules: {
 *               "@typescript-eslint/no-unused-vars": "off",
 *               "@typescript-eslint/no-explicit-any": "warn",
 *           },
 *       },
 *   ];
 */

import type { TSESLint } from "@typescript-eslint/utils";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const overrides: TSESLint.FlatConfig.ConfigArray = [
    {
        files: ["**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/unbound-method": "off",
            // Мок-реализации async-интерфейсов часто не содержат await — это норма для тестов.
            "@typescript-eslint/require-await": "off",
        },
    },
    {
        files: ["tuidom/backend/**"],
        rules: {
            "no-control-regex": "off",
        },
    },
    {
        plugins: {
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            // Форсируем явный спецификатор видимости на всех членах класса
            "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
            // Разрешаем числа в template literals
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            // Сортировка импортов по группам:
            // 1. Node built-in модули (node:*)
            // 2. Внешние пакеты (npm)
            // 3. Относительные импорты, поднимающиеся вверх (../)
            // 4. Локальные импорты (./)
            "simple-import-sort/imports": [
                "error",
                {
                    groups: [["^node:"], ["^[^.]"], ["^\\.\\."], ["^\\./"]]
                },
            ],
            "simple-import-sort/exports": "warn",
            // Запрещаем inline import() в аннотациях типов — используй import type вместо этого
            "no-restricted-syntax": [
                "error",
                {
                    selector: "TSImportType",
                    message: "Не используй inline import() для типов. Добавь `import type { ... }` в начало файла.",
                },
            ],
        },
    },
];

export default overrides;
