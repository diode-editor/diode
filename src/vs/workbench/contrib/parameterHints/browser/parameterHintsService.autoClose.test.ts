import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import {
    type ILanguageConfigurationService,
    LanguageConfigurationServiceDIToken,
    NULL_LANGUAGE_CONFIGURATION_SERVICE,
} from "../../../../editor/common/languages/iLanguageConfigurationService.ts";
import type { ISignatureHelpRequest } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import {
    EMPTY_LANGUAGE_CONFIGURATION,
    type IResolvedLanguageConfiguration,
} from "../../../../editor/common/languages/languageConfiguration.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";

import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

/** A language with the `()` pair: typed `(` inserts `()`, `)` before `)` is typed over. */
const PARENS: IResolvedLanguageConfiguration = {
    ...EMPTY_LANGUAGE_CONFIGURATION,
    autoClosingPairs: [{ open: "(", close: ")", notIn: [] }],
};

const withParens: ILanguageConfigurationService = {
    ...NULL_LANGUAGE_CONFIGURATION_SERVICE,
    get: () => PARENS,
    ensureLoaded: () => Promise.resolve(PARENS),
};

function flushTimers(): Promise<void> {
    return new Promise((res) => setTimeout(res, 5));
}

/**
 * With auto-closing, `(` inserts `()` (line +2), while typeover of `)` does not change the line at all —
 * the typing is visible only through `onDidType`.
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
        requests = [];
        h.container.get(LanguageFeaturesServiceDIToken).signatureHelpProvider.register("*", {
            triggerCharacters: ["(", ","],
            retriggerCharacters: [")"],
            provideSignatureHelp: (request) => {
                requests.push(request);
                return Promise.resolve(
                    request.triggerCharacter === ")"
                        ? null
                        : {
                              signatures: [
                                  { label: "greet(name: string): void", parameters: [{ label: "name: string" }] },
                              ],
                              activeSignature: 0,
                              activeParameter: 0,
                          },
                );
            },
        });
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

        // The text did not change (the cursor stepped over `)`), yet the server still
        // saw the typed character — and answered with an empty hint.
        expect(h.activeEditor().getText()).toBe("greet()\n");
        expect(requests.at(-1)).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ")",
            isRetrigger: true,
        });
        expect(h.container.get(ParameterHintsServiceDIToken).isOpen()).toBe(false);
    });
});
