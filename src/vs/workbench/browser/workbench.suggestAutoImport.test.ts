import { packRgb } from "@tuidom/core/common/colorUtils";
import { Point } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../TestUtils/TempWorkspace.ts";
import type { EditorElement } from "../../editor/browser/editorElement.ts";
import type { ICoreCompletionItem } from "../../editor/common/languages/iCompletionSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../editor/common/services/languageFeatures.ts";

/** Дефолт `editorCursor.foreground` в Dark+: так красится ВТОРИЧНАЯ каретка (первичную рисует терминал). */
const SECONDARY_CARET_BG = packRgb(0xae, 0xaf, 0xad);

/**
 * Регрессия догфудинга: вставка пункта и правки-спутники (`import`) идут одной
 * транзакцией, и батч ставил каретку в конец каждой правки — вторая каретка
 * вставала в строку импорта. Как в эталоне (`suggestController`), каретку
 * ставит только основная вставка.
 */
describe("Workbench — accept автодополнения с авто-импортом", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    const ITEMS: ICoreCompletionItem[] = [{ label: "greet", insertText: "greet", id: "greet", kind: 2 }];
    const IMPORT = 'import { greet } from "./defs";\n';

    function editor(): EditorElement {
        return h.testApp.querySelector("EditorElement") as EditorElement;
    }

    /** Ждёт debounce авто-suggest'а (120 мс), ответ источника и resolve на accept. */
    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 300));
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-suggest-import-", files: { "a.ts": "\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.ts") });
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: () => Promise.resolve({ items: ITEMS, isIncomplete: false }),
            resolveCompletionItem: () =>
                Promise.resolve({
                    additionalEdits: [
                        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: IMPORT },
                    ],
                }),
        });
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("каретка одна — за вставленным словом на сдвинутой строке, и набор идёт только туда", async () => {
        for (const char of "gre") h.testApp.sendKey(char);
        await settle();
        h.testApp.sendKey("Enter");
        await settle();

        expect(editor().viewState.document.getText()).toBe(`${IMPORT}greet\n`);
        expect(editor().viewState.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([[1, 5]]);

        h.testApp.render();
        const size = h.testApp.backend.size;
        for (let y = 0; y < size.height; y++) {
            for (let x = 0; x < size.width; x++) {
                expect(h.testApp.backend.getBgAt(new Point(x, y))).not.toBe(SECONDARY_CARET_BG);
            }
        }

        h.testApp.sendKey("x");
        expect(editor().viewState.document.getText()).toBe(`${IMPORT}greetx\n`);
    });
});

/**
 * Каретку ставит основная вставка, а не сдвиг за правкой: при диапазоне правее
 * каретки сдвиг оставил бы её на месте набранного префикса.
 */
describe("Workbench — accept пункта с диапазоном замены правее каретки", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    function editor(): EditorElement {
        return h.testApp.querySelector("EditorElement") as EditorElement;
    }

    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 300));
    }

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-suggest-replace-", files: { "a.ts": "Xyz\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.ts") });
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            // Диапазон — от начала строки по «Xyz» за кареткой включительно.
            provideCompletionItems: (request) =>
                Promise.resolve({
                    items: [
                        {
                            label: "greet",
                            insertText: "greet",
                            kind: 2,
                            range: {
                                start: { line: request.line, character: 0 },
                                end: { line: request.line, character: request.character + 3 },
                            },
                        },
                    ],
                    isIncomplete: false,
                }),
        });
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it("каретка встаёт в конец вставки, а не на место префикса", async () => {
        for (const char of "gre") h.testApp.sendKey(char);
        // Каретка посреди слова «greXyz» — quick suggest молчит (как в эталоне), зовём явно.
        h.commands.execute("editor.action.triggerSuggest");
        await settle();
        h.testApp.sendKey("Enter");
        await settle();

        expect(editor().viewState.document.getText()).toBe("greet\n");
        expect(editor().viewState.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([[0, 5]]);
    });
});

/**
 * Спутники приходят сразу в списке (у gopls нет `resolveProvider`); как в эталоне
 * («sync additional edits»), accept применяет их без resolve.
 */
describe("Workbench — accept пункта с правками-спутниками из самого списка", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let resolveCalls: number;

    const IMPORT = 'import "strings"\n';
    const ITEMS: ICoreCompletionItem[] = [
        {
            label: "ToLower",
            insertText: "ToLower",
            id: "6.0",
            kind: 2,
            additionalEdits: [
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: IMPORT },
            ],
        },
    ];

    function editor(): EditorElement {
        return h.testApp.querySelector("EditorElement") as EditorElement;
    }

    function settle(): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, 300));
    }

    function open(withResolve: boolean): void {
        ws = createTempWorkspace({ prefix: "diode-suggest-eager-", files: { "a.go": "\n" } });
        h = createAppTestHarness({ workspaceFolder: ws.dir, openFile: ws.path("a.go") });
        resolveCalls = 0;
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: () => Promise.resolve({ items: ITEMS, isIncomplete: false }),
            // Молчащий resolve: ожидание его на accept упёрлось бы в таймаут без правок.
            ...(withResolve
                ? {
                      resolveCompletionItem: () => {
                          resolveCalls++;
                          return new Promise<null>(() => undefined);
                      },
                  }
                : {}),
        });
        h.workbench.focusEditor();
    }

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    it.each([
        ["без resolve у провайдера", false],
        ["resolve есть, но молчит", true],
    ])("импорт попадает в буфер вместе со вставкой — %s", async (_name, withResolve) => {
        open(withResolve);
        for (const char of "ToLo") h.testApp.sendKey(char);
        await settle();
        h.testApp.sendKey("Enter");

        // Синхронно, без ожидания resolve: правки уже в пункте.
        expect(editor().viewState.document.getText()).toBe(`${IMPORT}ToLower\n`);
        expect(editor().viewState.selections.map((sel) => [sel.active.line, sel.active.character])).toEqual([[1, 7]]);
        expect(resolveCalls).toBe(0);
    });
});
