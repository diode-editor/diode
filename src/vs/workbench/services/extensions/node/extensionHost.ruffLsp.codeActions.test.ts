import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import { createExtensionTestHarness, type IExtensionHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY } from "../../../../../TestUtils/ruffFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { fixAllAction, organizeImportsAction } from "../../../browser/actions/codeActionActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

// Code actions поверх СТОКОВОГО стека (правило AGENTS): настоящий ruff.vsix +
// настоящий bundled `ruff server`. Сервер отдаёт source-действия с точными
// видами `source.organizeImports.ruff` / `source.fixAll.ruff` — команды берут
// их иерархическим матчем `only`; quickfix «Remove unused import: sys» (F401)
// резолвится лениво и применяется через workspace.applyEdit до буфера.

let installed: IInstalledRuff;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — code actions от стокового ruff", () => {
    beforeAll(async () => {
        installed = await installRuff();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

    /** Харнесс + открытый lint.py + активация; общая шапка кейсов. */
    async function openLintFile(): Promise<{ harness: IExtensionHarness; lintUri: string }> {
        const harness = await createExtensionTestHarness({
            languageService: PY_LANGUAGE_SERVICE,
            activateEvents: [],
            extensions: [installed.registration],
        });
        const lintPath = harness.writeFile("lint.py", LINT_PY);
        harness.group.openFile(lintPath);
        await harness.host.activateByEvent("onLanguage:python");
        return { harness, lintUri: Uri.file(lintPath).toString() };
    }

    /** Command-акция из продовой таблицы, привязанная к харнессу (образец TS-сьюта). */
    function bindAction(harness: IExtensionHarness, action: typeof organizeImportsAction): void {
        const statusBar = {
            addEntry: () => ({ dispose: () => undefined }),
        } as unknown as StatusBarService;
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => harness.group);
        accessor.bind(StatusBarServiceDIToken, () => statusBar);
        registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, action);
    }

    /** Дождаться непустого ответа сервера на source-вид (шов + готовность сервера). */
    async function untilSourceAction(harness: IExtensionHarness, uri: string, only: string): Promise<void> {
        await until(`${only} action от ruff`, async () => {
            const source = harness.group.codeActionSource;
            if (source === undefined) return null;
            const actions = await source.provide({
                uri,
                languageId: "python",
                text: LINT_PY,
                range: createRange(0, 0, 4, 17),
                only,
            });
            return actions !== null && actions.length > 0 ? actions : null;
        });
    }

    it("editor.action.organizeImports пересортировывает импорты правками ruff", { timeout: 240_000 }, async () => {
        const { harness, lintUri } = await openLintFile();
        try {
            await untilSourceAction(harness, lintUri, "source.organizeImports");
            bindAction(harness, organizeImportsAction);

            await harness.commandRegistry.execute("editor.action.organizeImports");
            await settle();

            const text = harness.group.getActiveEditor()?.getText() ?? "";
            const osLine = text.indexOf("import os");
            const sysLine = text.indexOf("import sys");
            expect(osLine).toBeGreaterThanOrEqual(0);
            // Organize imports сортирует (os < sys), но НЕ удаляет неиспользуемое.
            expect(sysLine).toBeGreaterThan(osLine);
        } finally {
            await harness.dispose();
        }
    });

    it("editor.action.fixAll применяет safe-фиксы: неиспользуемый импорт удалён", { timeout: 240_000 }, async () => {
        const { harness, lintUri } = await openLintFile();
        try {
            await untilSourceAction(harness, lintUri, "source.fixAll");
            bindAction(harness, fixAllAction);

            await harness.commandRegistry.execute("editor.action.fixAll");
            await settle();

            const text = harness.group.getActiveEditor()?.getText() ?? "";
            expect(text).not.toContain("import sys");
            expect(text).toContain("import os");
        } finally {
            await harness.dispose();
        }
    });

    it(
        "quickfix по диагностике F401: «Remove unused import» с isPreferred, apply правит буфер",
        { timeout: 240_000 },
        async () => {
            const { harness, lintUri } = await openLintFile();
            try {
                // Без `only`, диапазон — строка `import sys`: контекст-диагностики
                // субпроцесс собирает сам из своих DiagnosticCollection, по ним ruff
                // матчит фиксы. Ждём именно quickfix-набор (сервер мог ещё линтить).
                const quickfixes = await until("quickfix-набор для F401", async () => {
                    const source = harness.group.codeActionSource;
                    if (source === undefined) return null;
                    const actions = await source.provide({
                        uri: lintUri,
                        languageId: "python",
                        text: LINT_PY,
                        range: createRange(0, 0, 0, 10),
                    });
                    const found = actions?.filter((a) => a.kind === "quickfix") ?? [];
                    return found.some((a) => a.title.includes("Remove unused import")) ? found : null;
                });

                const removeImport = quickfixes.find((a) => a.title.includes("Remove unused import"));
                expect(removeImport).toBeDefined();
                // Safe-фикс линтера помечен предпочтительным — его возьмёт Ctrl+. по умолчанию.
                expect(removeImport?.isPreferred).toBe(true);

                const applied = await harness.group.codeActionSource!.apply(removeImport!.id);
                expect(applied).toBe(true);
                await settle();
                expect(harness.group.getActiveEditor()?.getText() ?? "").not.toContain("import sys");
            } finally {
                await harness.dispose();
            }
        },
    );
});
