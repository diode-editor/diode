import { TUIKeyboardEvent } from "@tuidom/core/dom/events/tuiKeyboardEvent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import {
    type ILanguageConfigurationService,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
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

describe("EditorComponent: auto-closing from the language configuration", () => {
    let ws: ITempWorkspace;

    const TS_LIKE: IResolvedLanguageConfiguration = {
        ...EMPTY_LANGUAGE_CONFIGURATION,
        autoClosingPairs: [{ open: "{", close: "}", notIn: [] }],
    };

    const tsOnlyLanguages: ILanguageService = {
        getLanguageIdForResource: (filePath) => (filePath.endsWith(".ts") ? "typescript" : undefined),
        getLanguageDisplayName: () => undefined,
        getRegisteredLanguageIds: () => [],
        getExtensionForLanguage: () => undefined,
        requestLanguageFeatures: () => undefined,
        onDidRequestLanguageFeatures: () => ({ dispose: () => undefined }),
    };

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-component-autoclose-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function createComponent(name: string, content: string, service: ILanguageConfigurationService) {
        const model = new TextFileModel(tsOnlyLanguages, new UndoRedoService(), diskFileService());
        model.openFile(Uri.file(ws.writeFile(name, content)));
        const component = new EditorComponent(new TokenizationRegistry(), NULL_TOKEN_STYLE_RESOLVER, model, service);
        return { model, component };
    }

    function stubService(configurations: Record<string, IResolvedLanguageConfiguration>) {
        const warmed: string[] = [];
        const service: ILanguageConfigurationService = {
            ...NULL_LANGUAGE_CONFIGURATION_SERVICE,
            get: (languageId) => configurations[languageId],
            ensureLoaded: (languageId) => {
                warmed.push(languageId);
                return Promise.resolve(configurations[languageId] ?? EMPTY_LANGUAGE_CONFIGURATION);
            },
        };
        return { service, warmed };
    }

    /** Types the same way the keyboard does: an event on the view's REAL EditorElement. */
    function press(component: EditorComponent, key: string): void {
        component.view.getChild().dispatchEvent(new TUIKeyboardEvent("keypress", { key }));
    }

    it("a bracket in a ts file is closed with the pair from the language configuration", () => {
        const { service, warmed } = stubService({ typescript: TS_LIKE });
        const { model, component } = createComponent("a.ts", "", service);

        expect(warmed).toContain("typescript");
        press(component, "{");
        expect(model.document.getText()).toBe("{}");
    });

    it("a language without a configuration types the bracket as a plain character", () => {
        const { service } = stubService({});
        const { model, component } = createComponent("a.txt", "", service);

        press(component, "{");
        expect(model.document.getText()).toBe("{");
    });

    it("auto-closing keeps working after a file reload from disk", () => {
        // A reload recreates the document, the view state and the EditorElement itself —
        // the configuration source must move to the new widget along with them.
        const { service } = stubService({ typescript: TS_LIKE });
        const { model, component } = createComponent("a.ts", "", service);

        model.revertToDisk();

        press(component, "{");
        expect(model.document.getText()).toBe("{}");
    });

    it("a language change warms up the new language's configuration and changes typing behavior", () => {
        const { service, warmed } = stubService({ typescript: TS_LIKE });
        const { model, component } = createComponent("a.txt", "", service);

        press(component, "{");
        expect(model.document.getText()).toBe("{"); // plaintext: no pairs

        model.setLanguage("typescript");
        expect(warmed).toContain("typescript");
        press(component, "{");
        expect(model.document.getText()).toBe("{{}"); // the source reads the CURRENT language
    });
});
