import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createExtensionTestHarness } from "../../../../../TestUtils/ExtensionTestHarness.ts";
import { MARKETPLACE_OFFLINE } from "../../../../../TestUtils/marketplaceEnv.ts";
import {
    FORMATTED_JSON,
    FORMATTED_MD,
    type IInstalledPrettier,
    installPrettier,
    MESSY_JS,
    MESSY_JSON,
    MESSY_MD,
    PRETTIER_ID,
    PRETTIER_LANGUAGE_SERVICE,
} from "../../../../../TestUtils/prettierFixture.ts";
import { settle } from "../../../../../TestUtils/timing.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import {
    type ILanguageFeaturesService,
    LanguageFeaturesServiceDIToken,
} from "../../../../editor/common/services/languageFeatures.ts";
import { registerAction } from "../../../../platform/actions/common/commandAction.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { KeybindingRegistry } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import { formatDocumentAction, formatSelectionAction } from "../../../contrib/format/browser/formatActions.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

/**
 * Стоковый `esbenp.prettier-vscode` ИЗ МАГАЗИНА в настоящем extension host'е:
 * форматирование markdown и json — языков, которых не покрывает ни один наш LSP
 * (именно эту дыру запись в магазине и закрывает).
 *
 * Субпроцесс поднимается БЕЗ tsx (`subprocessLoader: "node"`): расширение —
 * ESM-модуль, а tsx своим хуком уводит `import … from "vscode"` в CJS-резолвер и
 * прячет настоящий путь загрузки. Здесь нужен ровно тот loader, что в приложении.
 *
 * Сетевой сьют не может быть единственным гейтом нашего контракта: ESM-загрузка
 * и `TextDocument.positionAt` закрыты герметично
 * (`extensionHost.esmExtension.test.ts`, `extHostDocuments.offsets.test.ts`).
 */

// Установка расширения ходит в сеть (магазин) — в оффлайне сьют пропускается.
let installed: IInstalledPrettier;

/** Регистрирует НАСТОЯЩИЕ формат-команды в реестре харнесса (как WORKBENCH_ACTIONS в проде). */
function registerFormatActions(harness: {
    commandRegistry: Parameters<typeof registerAction>[0];
    group: unknown;
    languageFeatures: ILanguageFeaturesService;
}): string[] {
    const notices: string[] = [];
    const statusBar = {
        addEntry: (entry: { text: string }) => {
            notices.push(entry.text);
            return { dispose: () => undefined };
        },
    } as unknown as StatusBarService;
    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => harness.group as never);
    accessor.bind(LanguageFeaturesServiceDIToken, () => harness.languageFeatures);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    const keybindings = new KeybindingRegistry();
    registerAction(harness.commandRegistry, keybindings, accessor, formatDocumentAction);
    registerAction(harness.commandRegistry, keybindings, accessor, formatSelectionAction);
    return notices;
}

async function harnessWith(file: {
    name: string;
    content: string;
}): Promise<Awaited<ReturnType<typeof createExtensionTestHarness>>> {
    return createExtensionTestHarness({
        subprocessLoader: "node",
        languageService: PRETTIER_LANGUAGE_SERVICE,
        initialFile: file,
        extensions: [installed.registration],
        activateEvents: ["onStartupFinished"],
    });
}

describe.skipIf(MARKETPLACE_OFFLINE)("ExtensionHost — стоковый prettier из магазина", () => {
    beforeAll(async () => {
        installed = await installPrettier();
        expect(installed.registration.id).toBe(PRETTIER_ID);
    }, 180_000);

    afterAll(() => {
        installed.dispose();
    });

    it("Format Document приводит markdown к формату prettier", { timeout: 120_000 }, async () => {
        const harness = await harnessWith({ name: "doc.md", content: MESSY_MD });
        try {
            registerFormatActions(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe(FORMATTED_MD);
        } finally {
            await harness.dispose();
        }
    });

    it("Format Document приводит json к формату prettier", { timeout: 120_000 }, async () => {
        const harness = await harnessWith({ name: "doc.json", content: MESSY_JSON });
        try {
            registerFormatActions(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe(FORMATTED_JSON);
        } finally {
            await harness.dispose();
        }
    });

    it("отформатированный документ повторным вызовом не трогается", { timeout: 120_000 }, async () => {
        const harness = await harnessWith({ name: "doc.md", content: FORMATTED_MD });
        try {
            registerFormatActions(harness);
            await settle();

            await harness.commandRegistry.execute("editor.action.formatDocument");
            await settle();

            expect(harness.group.getActiveEditor()?.getText()).toBe(FORMATTED_MD);
            // Нечего менять — значит и шага отмены быть не должно.
            harness.group.getActiveEditor()?.undo();
            expect(harness.group.getActiveEditor()?.getText()).toBe(FORMATTED_MD);
        } finally {
            await harness.dispose();
        }
    });

    it("Format Selection правит только выделенную строку", { timeout: 120_000 }, async () => {
        // Язык — javascript: range-формат prettier по-настоящему частичный только
        // там (markdown он игнорирует, json расширяет до всего документа).
        const harness = await harnessWith({ name: "doc.js", content: MESSY_JS });
        try {
            registerFormatActions(harness);
            await settle();

            // Выделена только вторая строка (`const  b   =  2`).
            harness.group.getActiveEditor()!.viewState.selections = [createSelection(1, 0, 1, 15)];
            await harness.commandRegistry.execute("editor.action.formatSelection");
            await settle();

            // Вторая строка приведена prettier (пробелы + `;`), первая — нет:
            // значит до провайдера доехали смещения именно выделения.
            expect(harness.group.getActiveEditor()?.getText()).toBe("const  a   =  1\nconst b = 2;\n");
        } finally {
            await harness.dispose();
        }
    });
});
