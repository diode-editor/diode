import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ILanguageConfigurationService } from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../../../../editor/common/languages/languageConfiguration.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";

import { EditorComponent } from "./editorComponent.ts";

/**
 * Провод language configuration до редактирующей поверхности: компонент
 * подключает источник пар к `EditorElement`, греет ленивую загрузку при
 * открытии и при смене языка. Проверяем наблюдаемое: набранная скобка
 * закрывается парой, когда конфигурация языка это описывает.
 */
describe("EditorComponent: авто-закрытие из language configuration", () => {
    let ws: ITempWorkspace;

    const TS_LIKE: IResolvedLanguageConfiguration = {
        ...EMPTY_LANGUAGE_CONFIGURATION,
        autoClosingPairs: [{ open: "{", close: "}", notIn: [] }],
    };

    const tsOnlyLanguages: ILanguageService = {
        getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
        getLanguageDisplayName: () => undefined,
        getExtensionForLanguage: () => undefined,
    };

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-component-autoclose-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function createComponent(name: string, content: string, service: ILanguageConfigurationService) {
        const model = new TextFileModel(tsOnlyLanguages, new UndoRedoService());
        model.openFile(Uri.file(ws.writeFile(name, content)));
        const component = new EditorComponent(new TokenizationRegistry(), NULL_TOKEN_STYLE_RESOLVER, model, service);
        return { model, component };
    }

    function stubService(configurations: Record<string, IResolvedLanguageConfiguration>) {
        const warmed: string[] = [];
        const service: ILanguageConfigurationService = {
            get: (languageId) => configurations[languageId],
            ensureLoaded: (languageId) => {
                warmed.push(languageId);
                return Promise.resolve(configurations[languageId] ?? EMPTY_LANGUAGE_CONFIGURATION);
            },
        };
        return { service, warmed };
    }

    /** Печать тем же путём, что клавиатура: событие на РЕАЛЬНОМ EditorElement вью. */
    function press(component: EditorComponent, key: string): void {
        component.view.getChild().dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
    }

    it("скобка в ts-файле закрывается парой из конфигурации языка", () => {
        const { service, warmed } = stubService({ typescript: TS_LIKE });
        const { model, component } = createComponent("a.ts", "", service);

        expect(warmed).toContain("typescript"); // прогрев при открытии
        press(component, "{");
        expect(model.document.getText()).toBe("{}");
    });

    it("язык без конфигурации набирает скобку как обычный символ", () => {
        const { service } = stubService({});
        const { model, component } = createComponent("a.txt", "", service);

        press(component, "{");
        expect(model.document.getText()).toBe("{");
    });

    it("после перечитки файла с диска авто-закрытие продолжает работать", () => {
        // Перечитка пересоздаёт документ, view-state и сам EditorElement —
        // источник конфигурации обязан переехать на новый виджет вместе с ними.
        const { service } = stubService({ typescript: TS_LIKE });
        const { model, component } = createComponent("a.ts", "", service);

        model.revertToDisk();

        press(component, "{");
        expect(model.document.getText()).toBe("{}");
    });

    it("смена языка греет конфигурацию нового языка и меняет поведение набора", () => {
        const { service, warmed } = stubService({ typescript: TS_LIKE });
        const { model, component } = createComponent("a.txt", "", service);

        press(component, "{");
        expect(model.document.getText()).toBe("{"); // plaintext: пар нет

        model.setLanguage("typescript");
        expect(warmed).toContain("typescript");
        press(component, "{");
        expect(model.document.getText()).toBe("{{}"); // источник читает АКТУАЛЬНЫЙ язык
    });
});
