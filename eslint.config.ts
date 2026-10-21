import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import overrides from "./eslint.overrides.ts";

export default tseslint.config(
    {
        ignores: [
            "dist/",
            "node_modules/",
            "*.config.*",
            "src/vscode-dts/vscode.d.ts",
            "src/vs/workbench/services/extensions/node/__fixtures__/*.cjs",
            "extensions/*/out/",
            // Vendored copy of upstream: by definition its findings must not be fixed.
            // Explicit paths: our tests in the same directories are linted as usual.
            "src/vs/editor/common/diff/linesDiffComputer.ts",
            "src/vs/editor/common/diff/rangeMapping.ts",
            "src/vs/editor/common/diff/defaultLinesDiffComputer/**",
            "src/vs/editor/common/core/{position,range,editOperation}.ts",
            "src/vs/editor/common/core/{ranges,text,edits}/**",
            "src/vs/base/common/charCode.ts",
            "src/vs/base/common/stopwatch.ts",
            "src/vs/editor/common/model/{textModelTokens,fixedArray}.ts",
            "src/vs/editor/common/core/misc/eolCounter.ts",
            "src/vs/editor/common/encodedTokenAttributes.ts",
            "src/vs/editor/common/tokens/{lineTokens,contiguousMultilineTokens,contiguousMultilineTokensBuilder,contiguousTokensEditing}.ts",
            "src/vs/editor/common/languages/nullTokenize.ts",
            "src/vs/editor/common/model/pieceTreeTextBuffer/**",
            "src/vs/editor/common/model/textModelSearch.ts",
            "src/vs/editor/common/core/{textChange,wordCharacterClassifier,characterClassifier}.ts",
            "src/vs/base/common/uint.ts",
            // Upstream PieceTree tests are a vendored copy too (mocha style, tabs).
            "src/vs/editor/test/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer.test.ts",
            // Corpus test DATA: foreign sources, not our code.
            "**/__fixtures__/**",
        ],
    },

    eslint.configs.recommended,

    ...tseslint.configs.strictTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

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

    eslintPluginPrettier,

    ...overrides,
);
