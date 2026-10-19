import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import overrides from "./eslint.overrides.ts";

export default tseslint.config(
    // Глобальные игноры
    {
        ignores: [
            "dist/",
            "node_modules/",
            "*.config.*",
            "src/vscode-dts/vscode.d.ts",
            "src/vs/workbench/services/extensions/node/__fixtures__/*.cjs",
            "extensions/*/out/",
            // Дословный перенос upstream vscode (scripts/import-vscode-editor.mjs):
            // правится только сменой пина, поэтому замечания strictTypeChecked
            // по нему нечем закрыть — их нельзя исправлять по определению.
            // Пути перечислены точечно: наши тесты лежат в тех же каталогах и
            // линтуются на общих основаниях.
            "src/vs/editor/common/diff/linesDiffComputer.ts",
            "src/vs/editor/common/diff/rangeMapping.ts",
            "src/vs/editor/common/diff/defaultLinesDiffComputer/**",
            "src/vs/editor/common/core/{position,range,editOperation}.ts",
            "src/vs/editor/common/core/{ranges,text,edits}/**",
            "src/vs/base/common/charCode.ts",
            "src/vs/base/common/stopwatch.ts",
            "src/vs/editor/common/model/{textModelTokens,fixedArray}.ts",
            "src/vs/editor/common/core/misc/eolCounter.ts",
            // Тестовые ДАННЫЕ корпуса: чужие исходники, а не наш код.
            "**/__fixtures__/**",
        ],
    },

    // Базовые рекомендации ESLint для JS
    eslint.configs.recommended,

    // Самый злой typescript-eslint пресет с type-aware правилами
    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    // Настройки парсера для type-aware линтинга
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ["eslint.config.ts", "eslint.overrides.ts"],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },

    // Prettier — отключает конфликтующие ESLint-правила и репортит нарушения форматирования
    eslintPluginPrettier,

    // Пользовательские переопределения из eslint.overrides.ts
    ...overrides,
);
