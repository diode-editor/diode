import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    ensureEslintLibrary,
    ESLINT_FLAT_CONFIG,
    type IInstalledEslint,
    installEslint,
    JS_LANGUAGE_SERVICE,
    linkEslintLibrary,
    LINT_JS,
} from "../../../../../TestUtils/eslintFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { fixAllAction } from "../../../browser/actions/codeActionActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

// Code actions поверх СТОКОВОГО стека (правило AGENTS): настоящий
// vscode-eslint.vsix + его bundled eslintServer. Сервер отдаёт
// `source.fixAll.eslint` (команда берёт его иерархическим матчем `only`), а
// quickfix «Fix this no-extra-semi problem» матчится по контекст-диагностикам,
// которые субпроцесс собирает из своих DiagnosticCollection.

let installed: IInstalledEslint;
let eslintNodeModules: string;

/** После safe-фикса no-extra-semi: `;;` схлопнулась, no-unused-vars остаётся. */
const FIXED_JS = "const unused = 1;\n";

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — code actions от стокового vscode-eslint", () => {
    beforeAll(async () => {
        installed = await installEslint();
        eslintNodeModules = ensureEslintLibrary();
    }, 300_000);

    afterAll(() => {
        installed.dispose();
    });

    /** Харнесс + воркспейс с eslint + открытый lint.js + активация; общая шапка кейсов. */
    async function openLintFile(): Promise<{ harness: IExtensionHarness; lintUri: string }> {
        const harness = await createExtensionTestHarness({
            languageService: JS_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        linkEslintLibrary(harness.tmpDir, eslintNodeModules);
        harness.writeFile("eslint.config.mjs", ESLINT_FLAT_CONFIG);
        const lintPath = harness.writeFile("lint.js", LINT_JS);
        harness.group.openFile(lintPath);
        await harness.host.activateByEvent("onStartupFinished");
        return { harness, lintUri: Uri.file(lintPath).toString() };
    }

    it(
        "editor.action.fixAll применяет source.fixAll.eslint: лишняя `;` ушла, no-unused-vars остался",
        { timeout: 240_000 },
        async () => {
            const { harness, lintUri } = await openLintFile();
            try {
                // Прогрев: дождаться, пока сервер начнёт отдавать fixAll-действия.
                await until("source.fixAll action от eslint", async () => {
                    const source = harness.group.codeActionSource;
                    if (source === undefined) return null;
                    const actions = await source.provide({
                        uri: lintUri,
                        languageId: "javascript",
                        text: LINT_JS,
                        range: createRange(0, 0, 0, 18),
                        only: "source.fixAll",
                    });
                    return actions !== null && actions.length > 0 ? actions : null;
                });

                const statusBar = { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService;
                const accessor = new Container();
                accessor.bind(EditorServiceDIToken, () => harness.group);
                accessor.bind(StatusBarServiceDIToken, () => statusBar);
                registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, fixAllAction);

                await harness.commandRegistry.execute("editor.action.fixAll");
                await settle();

                expect(harness.group.getActiveEditor()?.getText() ?? "").toBe(FIXED_JS);
            } finally {
                await harness.dispose();
            }
        },
    );

    it(
        "quickfix по диагностике no-extra-semi: фикс с isPreferred, apply правит буфер",
        { timeout: 240_000 },
        async () => {
            const { harness, lintUri } = await openLintFile();
            try {
                // Без `only`, диапазон — лишняя `;`: сервер матчит фиксы по
                // контекст-диагностикам. Ждём именно quickfix-набор с фиксом.
                const quickfixes = await until("quickfix-набор для no-extra-semi", async () => {
                    const source = harness.group.codeActionSource;
                    if (source === undefined) return null;
                    const actions = await source.provide({
                        uri: lintUri,
                        languageId: "javascript",
                        text: LINT_JS,
                        range: createRange(0, 17, 0, 18),
                    });
                    const found = actions?.filter((a) => a.kind?.startsWith("quickfix") ?? false) ?? [];
                    return found.some((a) => a.title.includes("no-extra-semi")) ? found : null;
                });

                const fix = quickfixes.find((a) => a.title.startsWith("Fix this no-extra-semi"));
                expect(fix).toBeDefined();
                // Единственный автофикс правила помечен предпочтительным — его
                // возьмёт Ctrl+. по умолчанию (мимо disable-rule/show-docs соседей).
                expect(fix?.isPreferred).toBe(true);

                const applied = await harness.group.codeActionSource!.apply(fix!.id);
                expect(applied).toBe(true);
                await settle();
                expect(harness.group.getActiveEditor()?.getText() ?? "").toBe(FIXED_JS);
            } finally {
                await harness.dispose();
            }
        },
    );
});
