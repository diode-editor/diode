import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PY_LANGUAGE_SERVICE, until } from "../../../../../TestUtils/basedpyrightFixture.ts";
import {
    createExtensionTestHarness,
    documentVersion,
    type IExtensionHarness,
    provideCodeActions,
} from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { type IInstalledRuff, installRuff, LINT_PY } from "../../../../../TestUtils/ruffFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { fixAllAction, organizeImportsAction } from "../../../contrib/codeAction/browser/codeActionActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

// The server returns exact kinds `source.organizeImports.ruff` / `source.fixAll.ruff`;
// the commands pick them by hierarchical `only` matching.

let installed: IInstalledRuff;

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — code actions from the stock ruff", () => {
    beforeAll(async () => {
        installed = await installRuff();
    }, 120_000);

    afterAll(() => {
        installed.dispose();
    });

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

    function bindAction(harness: IExtensionHarness, action: typeof organizeImportsAction): void {
        const statusBar = {
            addEntry: () => ({ dispose: () => undefined }),
        } as unknown as StatusBarService;
        const accessor = new Container();
        accessor.bind(EditorServiceDIToken, () => harness.group);
        accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
        accessor.bind(StatusBarServiceDIToken, () => statusBar);
        registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, action);
    }

    async function untilSourceAction(harness: IExtensionHarness, uri: string, only: string): Promise<void> {
        await until(`${only} action from ruff`, async () => {
            const actions = await provideCodeActions(harness, {
                uri,
                languageId: "python",
                versionId: documentVersion(harness, uri),
                range: createRange(0, 0, 4, 17),
                only,
            });
            return actions.length > 0 ? actions : null;
        });
    }

    it("editor.action.organizeImports re-sorts imports with ruff's edits", { timeout: 240_000 }, async () => {
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
            // Organize imports sorts (os < sys) but does NOT remove unused imports.
            expect(sysLine).toBeGreaterThan(osLine);
        } finally {
            await harness.dispose();
        }
    });

    it("editor.action.fixAll applies safe fixes: the unused import is removed", { timeout: 240_000 }, async () => {
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
        "quickfix for diagnostic F401: `Remove unused import` with isPreferred, apply edits the buffer",
        { timeout: 240_000 },
        async () => {
            const { harness, lintUri } = await openLintFile();
            try {
                // The subprocess collects context diagnostics itself from DiagnosticCollection.
                // Wait specifically for the quickfix set: the server may still be linting.
                const quickfixes = await until("quickfix set for F401", async () => {
                    const actions = await provideCodeActions(harness, {
                        uri: lintUri,
                        languageId: "python",
                        versionId: documentVersion(harness, lintUri),
                        range: createRange(0, 0, 0, 10),
                    });
                    const found = actions.filter((a) => a.kind === "quickfix");
                    return found.some((a) => a.title.includes("Remove unused import")) ? found : null;
                });

                const removeImport = quickfixes.find((a) => a.title.includes("Remove unused import"));
                expect(removeImport).toBeDefined();
                expect(removeImport?.isPreferred).toBe(true);

                const applied = await harness.host.applyCodeAction(removeImport!.id);
                expect(applied).toBe(true);
                await settle();
                expect(harness.group.getActiveEditor()?.getText() ?? "").not.toContain("import sys");
            } finally {
                await harness.dispose();
            }
        },
    );
});
