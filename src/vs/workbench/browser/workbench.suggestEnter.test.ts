import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import type { ICoreCompletionItem } from "../../editor/common/languages/iCompletionSource.ts";
import { EditorServiceDIToken } from "../../workbench/services/editor/browser/editorService.ts";

/**
 * Регрессия: попап автодополнения, переживший несловесный символ, крал Enter.
 *
 * Enter привязан к `acceptSelectedSuggestion` под `when: suggestWidgetVisible`,
 * а список при доборе непопадающего символа оставался видимым (`refineFilter`
 * держит последний непустой набор). В результате `cons{` + Enter не переносили
 * строку, а молча заменяли набранное на `console` — пользователь видел, что
 * «часть текста стирается». Тест смотрит туда же, куда пользователь: настоящие
 * клавиши через диспатчер, проверка — текст буфера.
 */
describe("Workbench — Enter после несловесного символа при открытом попапе", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    /** Пункты в форме tsserver: общий range у всех — граница префикса «от провайдера». */
    const ITEMS: ICoreCompletionItem[] = [
        {
            label: "console",
            insertText: "console",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
        {
            label: "const",
            insertText: "const",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
        },
    ];

    function editor(): EditorElement {
        return h.testApp.querySelector("EditorElement") as EditorElement;
    }

    /** Ждёт debounce авто-suggest'а (120 мс) и ответ источника. */
    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 300));
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-suggest-enter-", files: { "a.ts": "\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.ts") });
        h.container.get(EditorServiceDIToken).completionSource = () =>
            Promise.resolve({ items: ITEMS, isIncomplete: false });
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("`{` закрывает попап, и Enter снова переносит строку", async () => {
        for (const char of "cons") h.testApp.sendKey(char);
        await settle();
        h.testApp.sendKey("{");
        await settle();

        h.testApp.sendKey("Enter");

        // До починки Enter уходил в acceptSelectedSuggestion и давал "console\n".
        // Теперь это обычный перевод строки — с отступом на уровень глубже после `{`.
        expect(editor().viewState.document.getText()).toBe("cons{\n\t\n");
    });

    it("добор буквами попап не гасит — Enter всё ещё принимает пункт", async () => {
        for (const char of "cons") h.testApp.sendKey(char);
        await settle();
        h.testApp.sendKey("o");
        await settle();

        h.testApp.sendKey("Enter");

        expect(editor().viewState.document.getText()).toBe("console\n");
    });
});
