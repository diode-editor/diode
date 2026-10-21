import type { TSESLint } from "@typescript-eslint/utils";
import simpleImportSort from "eslint-plugin-simple-import-sort";

const overrides: TSESLint.FlatConfig.ConfigArray = [
    {
        files: ["**/*.test.ts"],
        rules: {
            "@typescript-eslint/no-non-null-assertion": "off",
            "@typescript-eslint/no-empty-function": "off",
            "@typescript-eslint/unbound-method": "off",
            // Mocks of async interfaces often have no await, which is fine in tests.
            "@typescript-eslint/require-await": "off",
        },
    },
    {
        plugins: {
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "@typescript-eslint/no-unused-vars": "off",
            "@typescript-eslint/explicit-member-accessibility": ["error", { accessibility: "explicit" }],
            "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
            "simple-import-sort/imports": [
                "error",
                {
                    groups: [["^node:"], ["^[^.]"], ["^\\.\\."], ["^\\./"]]
                },
            ],
            "simple-import-sort/exports": "warn",
            "no-restricted-syntax": [
                "error",
                {
                    selector: "TSImportType",
                    message: "Do not use inline import() for types. Add `import type { ... }` at the top of the file.",
                },
            ],
        },
    },
    {
        // A hand-rolled listener list lacks listener error isolation and differs in
        // unsubscribe-during-dispatch semantics. This rule overrides no-restricted-syntax above
        // entirely, so the inline import() selector is repeated.
        files: ["src/vs/**/*.ts"],
        ignores: [
            "**/*.test.ts",
            "**/*testUtils.ts",
            "src/vs/base/common/event.ts",
            // One-shot event that replays to a late subscriber: its own contract.
            "src/vs/base/common/cancellation.ts",
            // vscode.EventEmitter for extensions is a public API type, its own class.
            "src/vs/workbench/api/common/vscodeTypes.ts",
            // Shutdown participants: the synchronous farewell step is dispatched in reverse
            // subscription order (LIFO), and Emitter does not reverse the order.
            "src/vs/workbench/services/lifecycle/browser/lifecycleService.ts",
        ],
        rules: {
            "no-restricted-syntax": [
                "error",
                {
                    selector: "TSImportType",
                    message: "Do not use inline import() for types. Add `import type { ... }` at the top of the file.",
                },
                ...["listeners", "/Listeners$/"].map((name) => ({
                    selector: `PropertyDefinition[key.name=${name}][value.type=/^(ArrayExpression|NewExpression)$/]`,
                    message:
                        "Hand-rolled listener list: use `Emitter` from vs/base/common/event.ts (docs/arch/Common.md#события-eventts).",
                })),
            ],
        },
    },
];

export default overrides;
