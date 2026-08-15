import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { installVsix } from "../../../../platform/extensionManagement/node/extensionInstaller.ts";
import type { IExtensionRegistration } from "./iExtensionEntry.ts";

/**
 * Сквозная проверка СТОКОВОГО (немодифицированного) расширения
 * `maptz.regionfolder@1.0.22` на реальном extension host'е Diode (#194).
 *
 * Расширение ставится из настоящего `.vsix` (тот же путь, что `--install-extension`),
 * грузится реальным кодом (`out/extension.js` + `require("./engine/...")`),
 * активируется по `onStartupFinished` и регистрирует folding-провайдер. Проверяем,
 * что `#region`-свёртки csharp-файла реально доезжают в редактор.
 */

const here = fileURLToPath(new URL(".", import.meta.url));
const VSIX_PATH = path.resolve(
    here,
    "../../../../../../e2e/fixtures/maptz-regionfolder/maptz.regionfolder-1.0.22.vsix",
);
const EXT_ID = "maptz.regionfolder";
const EXT_VERSION = "1.0.22";

/** Язык-сервис, размечающий всё как csharp (у maptz есть [csharp]-маркеры). */
const CSHARP_LANGUAGE_SERVICE: ILanguageService = {
    getLanguageIdForResource: () => "csharp",
    getLanguageDisplayName: () => "C#",
    getExtensionForLanguage: () => ".cs",
};

// C#-файл со стоковым C#-маркером региона (`/* #region */ … /* #endregion */`).
const CSHARP_TEXT = ["/* #region Helpers */", "int a = 1;", "int b = 2;", "/* #endregion */", "int c = 3;"].join("\n");

describe("ExtensionHost — стоковый maptz.regionfolder (#194)", () => {
    let tmpRoot: string;
    let mainPath: string;

    beforeAll(async () => {
        tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "diode-maptz-"));
        const extensionsDir = path.join(tmpRoot, "extensions");
        const installed = await installVsix(VSIX_PATH, extensionsDir);
        expect(installed.id).toBe(EXT_ID);
        expect(installed.version).toBe(EXT_VERSION);
        const extDir = path.join(extensionsDir, `${EXT_ID}-${EXT_VERSION}`);
        mainPath = path.join(extDir, "out", "extension.js");
        expect(fs.existsSync(mainPath)).toBe(true);
    });

    afterAll(() => {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
    });

    function maptzRegistration(): IExtensionRegistration {
        return {
            id: EXT_ID,
            manifest: { name: "regionfolder", publisher: "maptz", version: EXT_VERSION },
            mainPath,
            // contributes.configuration → maptz.regionfolder default {}
            configDefaults: { "maptz.regionfolder": {} },
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
            // Даём subprocess'у прогнать activate() (Engine регистрирует провайдер)
            // и фолдам пере-подъехать в уже открытый редактор.
            await harness.flushRpc(8);
            await settle();
            await harness.flushRpc(8);

            // Расширение активно и его команды видны (регистрация не упала).
            expect(harness.host.hasExtension(EXT_ID)).toBe(true);

            // Провайдерская область #region…#endregion (строки 0..3) доехала.
            const regions = harness.group.getActiveEditor()?.viewState.foldedRegions ?? [];
            expect(regions.some((r) => r.startLine === 0 && r.endLine === 3)).toBe(true);
        } finally {
            await harness.dispose();
        }
    });

    /**
     * Команда стокового расширения, а не только его folding-провайдер (#194).
     *
     * `RegionWrapperService.wrapCurrentWithRegion` читает `activeTextEditor.selection`
     * и выходит на `sel.isEmpty` — то есть проверяет ВЕСЬ путь editor-write API:
     * host доносит выделение в субпроцесс → расширение строит правки → они едут
     * назад через `editor.applyEdit` и ложатся в документ одним undoable-батчем.
     * Ровно этого теста не хватило в прошлый раз: без него «команды maptz
     * раскрыты» было утверждением, которое ничто не проверяло.
     */
    it("regionfolder.wrapWithRegion оборачивает выделение в #region-теги", async () => {
        const harness = await createExtensionTestHarness({
            initialFile: { name: "Program.cs", content: CSHARP_TEXT },
            languageService: CSHARP_LANGUAGE_SERVICE,
            extensions: [maptzRegistration()],
            activateEvents: ["onStartupFinished"],
        });
        try {
            await harness.flushRpc(8);
            await settle();

            const editor = harness.group.getActiveEditor()!;
            // Пользователь выделил строку "int c = 3;" (последнюю, вне региона).
            editor.viewState.selections = [createSelection(4, 0, 4, 10)];
            await harness.flushRpc(8);
            await settle();

            await harness.commandRegistry.execute("regionfolder.wrapWithRegion");
            await harness.flushRpc(8);
            await settle();

            const text = editor.getText();
            expect(text).not.toBe(CSHARP_TEXT); // документ реально изменился
            // Стоковые csharp-маркеры расширения легли вокруг выделенной строки.
            const lines = text.split("\n");
            const wrapped = lines.findIndex((l) => l.includes("int c = 3;"));
            expect(lines[wrapped - 1]).toContain("#region");
            expect(lines[wrapped + 1]).toContain("#endregion");

            // Правка undoable — откатывается штатным undo редактора одним шагом.
            editor.undo();
            expect(editor.getText()).toBe(CSHARP_TEXT);
        } finally {
            await harness.dispose();
        }
    });
});
