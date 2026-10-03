import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import {
    type ILanguageConfigurationService,
    LanguageConfigurationServiceDIToken,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ISignatureHelpRequest } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../../../../editor/common/languages/languageConfiguration.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

/** Язык с парой `()`: набранная `(` вставляет `()`, `)` перед `)` перешагивается. */
const PARENS: IResolvedLanguageConfiguration = {
    ...EMPTY_LANGUAGE_CONFIGURATION,
    autoClosingPairs: [{ open: "(", close: ")", notIn: [] }],
};

const withParens: ILanguageConfigurationService = {
    get: () => PARENS,
    ensureLoaded: () => Promise.resolve(PARENS),
};

/** Даёт setTimeout(…, 0) авто-триггера отработать. */
function flushTimers(): Promise<void> {
    return new Promise((res) => setTimeout(res, 5));
}

/**
 * Набор триггер-символа узнаётся по событию редактора `onDidType`, а не по
 * «строка выросла ровно на символ»: с авто-закрытием пары `(` вставляет `()`
 * (строка растёт на 2), а typeover `)` строку не меняет вовсе. Раньше в обоих
 * случаях подсказка параметров молчала.
 */
describe("ParameterHintsService — набор с авто-закрытием пары", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let requests: ISignatureHelpRequest[];

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-hints-pairs-", files: { "main.ts": "greet\n" } });
        h = createAppTestHarness({
            workspaceFolder: ws.dir,
            size: new Size(80, 24),
            containerOverrides: (container) => {
                container.bind(LanguageConfigurationServiceDIToken, () => withParens);
            },
        });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        h.container.get(ParameterHintsServiceDIToken).triggerDelayMs = 0;
        const group = h.container.get(EditorServiceDIToken);
        group.signatureHelpTriggerCharacters = ["(", ","];
        group.signatureHelpRetriggerCharacters = [")"];
        requests = [];
        group.signatureHelpSource = (request) => {
            requests.push(request);
            return Promise.resolve(
                request.triggerCharacter === ")"
                    ? null
                    : {
                          signatures: [{ label: "greet(name: string): void", parameters: [{ label: "name: string" }] }],
                          activeSignature: 0,
                          activeParameter: 0,
                      },
            );
        };
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("`(`, вставившая `()`, открывает подсказку как триггер-символ", async () => {
        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(h.activeEditor().getText()).toBe("greet()\n");
        expect(requests.at(-1)).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: "(",
        });
        expect(h.container.get(ParameterHintsServiceDIToken).isOpen()).toBe(true);
    });

    it("typeover `)` уходит серверу ретриггер-символом и закрывает подсказку", async () => {
        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        h.testApp.sendKey(")");
        await flushTimers();
        await flushMicrotasks();

        // Текст не изменился (каретка перешагнула `)`), а сервер всё равно
        // увидел набранный символ — и ответил пустой подсказкой.
        expect(h.activeEditor().getText()).toBe("greet()\n");
        expect(requests.at(-1)).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ")",
            isRetrigger: true,
        });
        expect(h.container.get(ParameterHintsServiceDIToken).isOpen()).toBe(false);
    });
});
