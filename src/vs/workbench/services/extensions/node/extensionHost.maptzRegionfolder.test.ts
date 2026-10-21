import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { manifestWithDefaults } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import { fetchStockVsix } from "../../../../../TestUtils/stockVsix.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { installVsix } from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction } from "../../../contrib/format/browser/formatActions.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";
import { EditorServiceDIToken } from "../../editor/common/editorService.ts";

import type { IExtensionRegistration } from "./iExtensionEntry.ts";

// Стоковый `maptz.regionfolder` из магазина на настоящем хосте (#194).

const EXT_ID = "maptz.regionfolder";

/** Язык-сервис, размечающий всё как csharp (у maptz есть [csharp]-маркеры). */
const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "csharp",
    getLanguageDisplayName: () => "C#",
    getExtensionForLanguage: () => ".cs",
    requestLanguageFeatures: () => undefined,
    onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
};

const CSHARP_TEXT = ["/* #region Helpers */", "int a = 1;", "int b = 2;", "/* #endregion */", "int c = 3;"].join("\n");

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый maptz.regionfolder (#194)", () => {
    let tmpRoot: string;
    let mainPath: string;
    let extVersion: string;

    beforeAll(async () => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "diode-maptz-"));
        const extensionsDir = path.join(tmpRoot, "extensions");
        const installed = await installVsix((await fetchStockVsix(EXT_ID)).vsixPath, extensionsDir);
        expect(installed.id).toBe(EXT_ID);
        extVersion = installed.version;
        const extDir = path.join(extensionsDir, `${EXT_ID}-${extVersion}`);
        mainPath = path.join(extDir, "out", "extension.js");
        expect(fs.existsSync(mainPath)).toBe(true);
    }, 120_000);

    afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function maptzRegistration(): IExtensionRegistration {
        return {
            id: EXT_ID,
            manifest: manifestWithDefaults(
                { name: "regionfolder", publisher: "maptz", version: extVersion },
                { "maptz.regionfolder": {} },
            ),
            mainPath,
            activationEvents: ["onStartupFinished"],
        };
    }

    it("активируется без падения и сворачивает #region в открытом csharp-файле", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [maptzRegistration()],
            activateEvents: ["onStartupFinished"],
        });
        try {
            // activate() регистрирует провайдер, фолды переподъезжают в открытый редактор.
            await harness.flushRpc(8);
            await settle();
            await harness.flushRpc(8);

            expect(harness.host.hasExtension(EXT_ID)).toBe(true);

            const regions = harness.group.getActiveEditor()?.viewState.foldedRegions ?? [];
            expect(regions.some((r) => r.startLine === 0 && r.endLine === 3)).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    // #194: команда проходит весь путь editor-write API — выделение в субпроцесс,
    // правки назад через `editor.applyEdit` одним undoable-батчем.
    it("regionfolder.wrapWithRegion оборачивает выделение в #region-теги", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [maptzRegistration()],
            activateEvents: ["onStartupFinished"],
        });
        try {
            // #196: после wrap расширение fire-and-forget зовёт formatDocument — нужна
            // НАСТОЯЩАЯ команда, иначе вызов отклонится «command not found».
            const notices: string[] = [];
            const statusBar = {
                addEntry: (entry: { text: string }) => {
                    notices.push(entry.text);
                    return { dispose: () => undefined };
                },
            } as unknown as StatusBarService;
            const accessor = new Container();
            accessor.bind(EditorServiceDIToken, () => harness.group);
            accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
            accessor.bind(StatusBarServiceDIToken, () => statusBar);
            registerAction(harness.commandRegistry, new KeybindingRegistry(), accessor, formatDocumentAction);

            await harness.flushRpc(8);
            await settle();

            const editor = harness.group.getActiveEditor()!;
            editor.viewState.selections = [createSelection(4, 0, 4, 10)];
            await harness.flushRpc(8);
            await settle();

            await harness.commandRegistry.execute("regionfolder.wrapWithRegion");
            await harness.flushRpc(8);
            await settle();

            const text = editor.getText();
            expect(text).not.toBe(CSHARP_TEXT);
            const lines = text.split("\n");
            const wrapped = lines.findIndex((l) => l.includes("int c = 3;"));
            expect(lines[wrapped - 1]).toContain("#region");
            expect(lines[wrapped + 1]).toContain("#endregion");

            // Для csharp форматтера нет — notice значит, что команда исполнилась.
            expect(notices).toEqual(["No formatter for 'csharp' installed"]);

            editor.undo();
            expect(editor.getText()).toBe(CSHARP_TEXT);
        } finally {
            await harness.dispose();
        }
    });
});
