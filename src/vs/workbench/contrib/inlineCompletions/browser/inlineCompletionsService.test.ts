import { describe, expect, it, vi } from "vitest";

import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { IGhostText } from "../../../../editor/common/model/iGhostText.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import type { CompletionService } from "../../suggest/browser/completionService.ts";

import { computeIndentationLessThanTabSize, InlineCompletionsService } from "./inlineCompletionsService.ts";

/** Пауза больше нулевого дебаунса — авто-запрос успевает уйти и вернуться. */
async function tick(ms = 5): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface FakeEditor {
    editor: TextEditorPane;
    applyExternalEdits: ReturnType<typeof vi.fn<(edits: ITextEdit[], label: string) => void>>;
    setGhostText: ReturnType<typeof vi.fn<(ghost: IGhostText | null) => void>>;
    /** Печать: обновляет строку/каретку и шлёт content+cursor (как typing). */
    type: (line: string, character: number) => void;
    /** Чистое движение каретки: шлёт только cursor (без content-маркера). */
    move: (lineNo: number, character: number) => void;
    setSelection: (anchorChar: number, activeChar: number) => void;
    setCursorCount: (count: number) => void;
    setReadOnly: (value: boolean) => void;
}

function makeEditor(lineContent: string, character: number): FakeEditor {
    const state = { line: lineContent, lineNo: 0, anchorChar: character, activeChar: character, versionId: 1 };
    let cursorCount = 1;
    let readOnly = false;
    const contentListeners: (() => void)[] = [];
    const cursorListeners: (() => void)[] = [];
    const applyExternalEdits = vi.fn<(edits: ITextEdit[], label: string) => void>();
    const setGhostText = vi.fn<(ghost: IGhostText | null) => void>();

    const editor = {
        get viewState() {
            return {
                selections: Array.from({ length: cursorCount }, (_, i) => ({
                    anchor: { line: state.lineNo + i, character: state.anchorChar },
                    active: { line: state.lineNo + i, character: state.activeChar },
                })),
                document: {
                    getLineContent: (_line: number) => state.line,
                    versionId: state.versionId,
                },
                tabSize: 4,
            };
        },
        get readOnly() {
            return readOnly;
        },
        getText: () => state.line,
        uri: Uri.file("/proj/sample.ts"),
        languageId: "typescript",
        applyExternalEdits,
        setGhostText,
        onDidChangeContent: (l: () => void) => {
            contentListeners.push(l);
            return { dispose: () => contentListeners.splice(contentListeners.indexOf(l), 1) };
        },
        onDidChangeCursorPosition: (l: () => void) => {
            cursorListeners.push(l);
            return { dispose: () => cursorListeners.splice(cursorListeners.indexOf(l), 1) };
        },
    } as unknown as TextEditorPane;

    const fireContent = (): void => {
        for (const l of [...contentListeners]) l();
    };
    const fireCursor = (): void => {
        for (const l of [...cursorListeners]) l();
    };

    return {
        editor,
        applyExternalEdits,
        setGhostText,
        type: (line, ch) => {
            state.line = line;
            state.anchorChar = ch;
            state.activeChar = ch;
            state.versionId++;
            fireContent();
            fireCursor();
        },
        move: (lineNo, ch) => {
            state.lineNo = lineNo;
            state.anchorChar = ch;
            state.activeChar = ch;
            fireCursor();
        },
        setSelection: (anchorChar, activeChar) => {
            state.anchorChar = anchorChar;
            state.activeChar = activeChar;
            fireCursor();
        },
        setCursorCount: (count) => {
            cursorCount = count;
            fireCursor();
        },
        setReadOnly: (value) => {
            readOnly = value;
        },
    };
}

interface FakeGroup {
    group: EditorService;
    setActiveEditor: (editor: TextEditorPane | null) => void;
    /** Смена активного БЕЗ события — окно между закрытием вкладки и событием. */
    setActiveEditorSilently: (editor: TextEditorPane | null) => void;
}

function makeGroup(editor: TextEditorPane | null, source: EditorService["inlineCompletionSource"]): FakeGroup {
    let active = editor;
    const listeners: ((editor: TextEditorPane | null) => void)[] = [];
    const group = {
        getActiveEditor: () => active,
        onActiveEditorChanged: (l: (editor: TextEditorPane | null) => void) => {
            listeners.push(l);
            return { dispose: () => listeners.splice(listeners.indexOf(l), 1) };
        },
        inlineCompletionSource: source,
    } as unknown as EditorService;
    return {
        group,
        setActiveEditor: (next) => {
            active = next;
            for (const l of [...listeners]) l(next);
        },
        setActiveEditorSilently: (next) => {
            active = next;
        },
    };
}

function makeService(
    group: EditorService,
    options: { popupOpen?: () => boolean; enabled?: boolean } = {},
): InlineCompletionsService & { firePopupClose: () => void } {
    const closeListeners: (() => void)[] = [];
    const completion = {
        isOpen: options.popupOpen ?? (() => false),
        onDidClose: (l: () => void) => {
            closeListeners.push(l);
            return { dispose: () => closeListeners.splice(closeListeners.indexOf(l), 1) };
        },
    } as unknown as CompletionService;
    const configuration = {
        get: (key: string) => (key === "editor.inlineSuggest.enabled" ? (options.enabled ?? true) : undefined),
    } as unknown as IConfigurationService;
    const service = new InlineCompletionsService(group, completion, configuration) as InlineCompletionsService & {
        firePopupClose: () => void;
    };
    service.autoTriggerDelayMs = 0; // детерминированный авто-запрос в тестах
    service.firePopupClose = () => {
        for (const l of [...closeListeners]) l();
    };
    return service;
}

function items(...list: ICoreInlineCompletionItem[]): () => Promise<readonly ICoreInlineCompletionItem[]> {
    return () => Promise.resolve(list);
}

describe("InlineCompletionsService — показ", () => {
    it("набор символа авто-запрашивает источник и показывает хвост подсказки", async () => {
        const fake = makeEditor("const x", 7);
        const requests: IInlineCompletionRequest[] = [];
        const source = (req: IInlineCompletionRequest): Promise<readonly ICoreInlineCompletionItem[]> => {
            requests.push(req);
            return Promise.resolve([{ insertText: " = 42;" }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        fake.type("const x ", 8);
        await tick();

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            languageId: "typescript",
            line: 0,
            character: 8,
            triggerKind: InlineCompletionTriggerKind.Automatic,
        });
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 8, lines: [" = 42;"] });
        expect(service.isOpen()).toBe(true);
    });

    it("многострочный insertText режется на строки ghost-а", async () => {
        const fake = makeEditor("function fib", 12);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "(n) {\n    return n;\n}" })).group);

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({
            line: 0,
            character: 12,
            lines: ["(n) {", "    return n;", "}"],
        });
        expect(service.isOpen()).toBe(true);
    });

    it("ручной триггер шлёт Invoke и работает без эвристики набора", async () => {
        const fake = makeEditor("abc", 3);
        const requests: IInlineCompletionRequest[] = [];
        const source = (req: IInlineCompletionRequest): Promise<readonly ICoreInlineCompletionItem[]> => {
            requests.push(req);
            return Promise.resolve([{ insertText: "def" }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        await service.trigger(InlineCompletionTriggerKind.Invoke);

        expect(requests[0].triggerKind).toBe(InlineCompletionTriggerKind.Invoke);
        expect(service.isOpen()).toBe(true);
    });

    it("range провайдера: набранное — префикс filterText, ghost — хвост insertText", async () => {
        const fake = makeEditor("con", 3);
        const item: ICoreInlineCompletionItem = {
            insertText: "console.log()",
            filterText: "console",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        };
        const service = makeService(makeGroup(fake.editor, items(item)).group);

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["sole.log()"] });
        expect(service.isOpen()).toBe(true);
    });

    it("неподошедшие пункты пропускаются — берётся первый подходящий", async () => {
        const fake = makeEditor("con", 3);
        const service = makeService(
            makeGroup(
                fake.editor,
                items(
                    // insertText не начинается с набранного в range.
                    { insertText: "log()", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
                    // range на другой строке.
                    { insertText: "confuse", range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } },
                    // start на другой строке (end — на строке каретки).
                    { insertText: "con-BAD1", range: { start: { line: 1, character: 0 }, end: { line: 0, character: 3 } } },
                    // end на другой строке (start — на строке каретки).
                    { insertText: "con-BAD2", range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } } },
                    // range начинается ПРАВЕЕ каретки.
                    { insertText: "-BAD3", range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } } },
                    // range не покрывает каретку.
                    { insertText: "control", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } },
                    // filterText совпал, а insertText с набранным не начинается.
                    {
                        insertText: "xyz",
                        filterText: "console",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // insertText длиннее typed, filterText совпал — но insertText не начинается с typed.
                    {
                        insertText: "xyzabc",
                        filterText: "console",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // filterText НЕ совпал — insertText совпадает, но гейт по filterText отбрасывает.
                    {
                        insertText: "con-BAD4",
                        filterText: "nope",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // полностью набранный текст — хвоста нет.
                    { insertText: "con", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
                    { insertText: "st y = 1;" },
                ),
            ).group,
        );

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["st y = 1;"] });
    });

    it("range, начинающийся ровно в каретке, — валидная вставка", async () => {
        const fake = makeEditor("con", 3);
        const item: ICoreInlineCompletionItem = {
            insertText: "tinue;",
            range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
        };
        const service = makeService(makeGroup(fake.editor, items(item)).group);

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["tinue;"] });
    });

    it("повторный запрос с пустым ответом гасит показанную подсказку", async () => {
        const fake = makeEditor("ab", 2);
        let empty = false;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> =>
            Promise.resolve(empty ? [] : [{ insertText: "cde" }]);
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        empty = true;
        await service.trigger();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("пустой ответ и ошибка источника не показывают ничего", async () => {
        const fake = makeEditor("abc", 3);
        const service = makeService(makeGroup(fake.editor, items()).group);
        await service.trigger();
        expect(service.isOpen()).toBe(false);

        const failing = makeService(makeGroup(fake.editor, () => Promise.reject(new Error("boom"))).group);
        await failing.trigger();
        expect(failing.isOpen()).toBe(false);
        expect(fake.setGhostText).not.toHaveBeenCalled();
    });
});

describe("InlineCompletionsService — гейты", () => {
    it("не запрашивает: выделение, мультикурсор, каретка не в конце строки, read-only, настройка, попап", async () => {
        const source = vi.fn(items({ insertText: "x" }));

        const withSelection = makeEditor("abc", 3);
        withSelection.setSelection(1, 3);
        await makeService(makeGroup(withSelection.editor, source).group).trigger();

        const multiCursor = makeEditor("abc", 3);
        multiCursor.setCursorCount(2);
        await makeService(makeGroup(multiCursor.editor, source).group).trigger();

        const midLine = makeEditor("abc", 1);
        await makeService(makeGroup(midLine.editor, source).group).trigger();

        const readOnly = makeEditor("abc", 3);
        readOnly.setReadOnly(true);
        await makeService(makeGroup(readOnly.editor, source).group).trigger();

        const disabled = makeEditor("abc", 3);
        await makeService(makeGroup(disabled.editor, source).group, { enabled: false }).trigger();

        const popup = makeEditor("abc", 3);
        await makeService(makeGroup(popup.editor, source).group, { popupOpen: () => true }).trigger();

        expect(source).not.toHaveBeenCalled();
    });

    it("без активного редактора и без источника — no-op", async () => {
        const noEditor = makeService(makeGroup(null, items({ insertText: "x" })).group);
        await noEditor.trigger();
        expect(noEditor.isOpen()).toBe(false);

        const fake = makeEditor("abc", 3);
        const noSource = makeService(makeGroup(fake.editor, undefined).group);
        await noSource.trigger();
        expect(noSource.isOpen()).toBe(false);
    });

    it("устаревший ответ отброшен: новый запрос обгоняет старый", async () => {
        const fake = makeEditor("a", 1);
        let resolveFirst!: (v: readonly ICoreInlineCompletionItem[]) => void;
        let calls = 0;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> => {
            calls++;
            if (calls === 1) {
                return new Promise((resolve) => {
                    resolveFirst = resolve;
                });
            }
            return Promise.resolve([{ insertText: "-second" }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        const first = service.trigger();
        await service.trigger();
        resolveFirst([{ insertText: "-first" }]);
        await first;

        expect(fake.setGhostText).toHaveBeenLastCalledWith(expect.objectContaining({ lines: ["-second"] }));
        expect(fake.setGhostText).not.toHaveBeenCalledWith(expect.objectContaining({ lines: ["-first"] }));
    });

    it("ревалидация после await: смена редактора / versionId / мультикурсор / каретка / попап", async () => {
        const deferred = (): {
            source: () => Promise<readonly ICoreInlineCompletionItem[]>;
            resolvers: ((v: readonly ICoreInlineCompletionItem[]) => void)[];
        } => {
            const resolvers: ((v: readonly ICoreInlineCompletionItem[]) => void)[] = [];
            return {
                resolvers,
                source: () =>
                    new Promise<readonly ICoreInlineCompletionItem[]>((resolve) => {
                        resolvers.push(resolve);
                    }),
            };
        };
        const ITEM = [{ insertText: "-tail" }];

        // Активный редактор тихо сменился, пока ждали ответ.
        const switched = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const d1 = deferred();
        const g1 = makeGroup(switched.editor, d1.source);
        const s1 = makeService(g1.group);
        const p1 = s1.trigger();
        g1.setActiveEditorSilently(other.editor);
        d1.resolvers[0](ITEM);
        await p1;
        expect(s1.isOpen()).toBe(false);

        // Правка сдвинула versionId (ответ резолвится ДО дебаунс-перезапроса).
        const edited = makeEditor("ab", 2);
        const d2 = deferred();
        const s2 = makeService(makeGroup(edited.editor, d2.source).group);
        const p2 = s2.trigger();
        edited.type("ab", 2); // содержимое то же, versionId другой
        d2.resolvers[0](ITEM);
        await p2;
        expect(s2.isOpen()).toBe(false);

        // Мультикурсор появился за время запроса.
        const multi = makeEditor("ab", 2);
        const d3 = deferred();
        const s3 = makeService(makeGroup(multi.editor, d3.source).group);
        const p3 = s3.trigger();
        multi.setCursorCount(2);
        d3.resolvers[0](ITEM);
        await p3;
        expect(s3.isOpen()).toBe(false);

        // Каретка ушла (без правки).
        const moved = makeEditor("ab", 2);
        const d4 = deferred();
        const s4 = makeService(makeGroup(moved.editor, d4.source).group);
        const p4 = s4.trigger();
        moved.move(0, 1);
        d4.resolvers[0](ITEM);
        await p4;
        expect(s4.isOpen()).toBe(false);

        // Suggest-попап открылся за время запроса.
        const popup = makeEditor("ab", 2);
        const d5 = deferred();
        let popupOpen = false;
        const s5 = makeService(makeGroup(popup.editor, d5.source).group, { popupOpen: () => popupOpen });
        const p5 = s5.trigger();
        popupOpen = true;
        d5.resolvers[0](ITEM);
        await p5;
        expect(s5.isOpen()).toBe(false);

        // Каретка ушла на другую строку (та же колонка — ловит именно строка).
        const movedLine = makeEditor("ab", 2);
        const d6 = deferred();
        const s6 = makeService(makeGroup(movedLine.editor, d6.source).group);
        const p6 = s6.trigger();
        movedLine.move(1, 2);
        d6.resolvers[0](ITEM);
        await p6;
        expect(s6.isOpen()).toBe(false);
    });

    it("ответ, пережитый правкой документа, не показывается", async () => {
        const fake = makeEditor("a", 1);
        const resolvers: ((v: readonly ICoreInlineCompletionItem[]) => void)[] = [];
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> =>
            new Promise((resolve) => {
                resolvers.push(resolve);
            });
        const service = makeService(makeGroup(fake.editor, source).group);

        const pending = service.trigger();
        // Правка + возврат каретки в ту же позицию: versionId уже другой (правка
        // заодно планирует свой авто-запрос — его резолвер второй в массиве).
        fake.type("a", 1);
        await tick();
        resolvers[0]([{ insertText: "-stale" }]);
        await pending;

        expect(fake.setGhostText).not.toHaveBeenCalledWith(expect.objectContaining({ lines: ["-stale"] }));
        expect(service.isOpen()).toBe(false);
    });
});

describe("InlineCompletionsService — жизнь сессии", () => {
    it("набор совпадающего символа сжимает ghost локально, без нового запроса", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 2, lines: ["cde"] });

        fake.type("abc", 3);
        await tick();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["de"] });
        expect(source).toHaveBeenCalledTimes(1);
        expect(service.isOpen()).toBe(true);
    });

    it("Backspace растит ghost обратно (набранное всё ещё префикс)", async () => {
        const fake = makeEditor("abc", 3);
        const source = vi.fn(items({ insertText: "cde", range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } }));
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["de"] });

        fake.type("ab", 2);
        await tick();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 2, lines: ["cde"] });
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("расходящийся набор гасит подсказку и перезапрашивает", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();

        fake.type("abx", 3);
        await tick();

        expect(fake.setGhostText).toHaveBeenCalledWith(null);
        expect(source).toHaveBeenCalledTimes(2); // авто-перезапрос после расхождения
    });

    it("допечатанная целиком подсказка гаснет (перезапрос после — легитимен)", async () => {
        const fake = makeEditor("ab", 2);
        let calls = 0;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> => {
            calls++;
            return Promise.resolve(calls === 1 ? [{ insertText: "c" }] : []);
        };
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.type("abc", 3);
        await tick();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        expect(calls).toBe(2); // после допечатки уходит новый авто-запрос
    });

    it("движение каретки без правки гасит подсказку", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();

        fake.move(0, 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("каретка ушла с конца строки — подсказка гаснет", async () => {
        const fake = makeEditor("abc", 3);
        const source = items({ insertText: "cde", range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } });
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Каретка внутри заменяемого диапазона, но не в конце строки.
        fake.move(0, 2);

        expect(service.isOpen()).toBe(false);
    });

    it("каретка на другой строке (та же колонка) гасит подсказку", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Колонка совпадает с прежней — расхождение видит только проверка строки.
        fake.move(1, 2);

        expect(service.isOpen()).toBe(false);
    });

    it("строка укоротилась ниже начала сессии — подсказка гаснет, а не съезжает", async () => {
        const fake = makeEditor("ab", 2);
        let calls = 0;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> => {
            calls++;
            return Promise.resolve(calls === 1 ? [{ insertText: "cde" }] : []);
        };
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Backspace за начало сессии: каретка в конце строки, но ЛЕВЕЕ start.
        fake.type("a", 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("закрытие suggest-попапа перезапрашивает подсказку без правки (Esc → призрак)", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(items({ insertText: "sole.log();" }));
        let popupOpen = true;
        const service = makeService(makeGroup(fake.editor, source).group, { popupOpen: () => popupOpen });

        // Пока попап открыт — запросов нет.
        fake.type("con", 3);
        await tick();
        expect(source).not.toHaveBeenCalled();

        // Esc закрыл попап: подписка обязана перезапросить и показать призрака.
        popupOpen = false;
        service.firePopupClose();
        await tick();

        expect(source).toHaveBeenCalledTimes(1);
        expect(service.isOpen()).toBe(true);
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["sole.log();"] });
    });

    it("закрытие попапа без активного редактора — no-op (trigger сам гейтит)", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(items({ insertText: "x" }));
        const g = makeGroup(fake.editor, source);
        const service = makeService(g.group);
        g.setActiveEditor(null);

        service.firePopupClose();
        await tick();

        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("первое событие каретки без правки ничего не запрашивает", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        makeService(makeGroup(fake.editor, source).group);

        fake.move(0, 2); // чистое движение сразу после создания сервиса
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("две правки подряд — два авто-запроса (подавление не липнет)", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items());
        const service = makeService(makeGroup(fake.editor, source).group);

        fake.type("ab ", 3);
        await tick();
        fake.type("ab x", 4);
        await tick();

        expect(source).toHaveBeenCalledTimes(2);
        expect(service.isOpen()).toBe(false);
    });

    it("правка поверх отложенного запроса перезапускает дебаунс, а не копит таймеры", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items());
        const service = makeService(makeGroup(fake.editor, source).group);
        service.autoTriggerDelayMs = 5;

        fake.type("ab ", 3); // планирует t1
        fake.type("ab x", 4); // планирует t2, t1 обязан быть снят
        await tick(30);

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("ручной триггер отменяет отложенный авто-запрос (не два RPC)", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);

        fake.type("ab ", 3); // планирует авто-запрос
        await service.trigger(); // ручной — должен снять таймер
        await tick();

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("чистое движение каретки отменяет отложенный авто-запрос", async () => {
        const fake = makeEditor("ab\ncd", 2);
        const source = vi.fn(items({ insertText: "xyz" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        expect(service.isOpen()).toBe(false);

        fake.type("ab ", 3); // планирует авто-запрос
        fake.move(1, 3); // движение без правки — отложенный запрос снимается
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("мультикурсор при живой сессии гасит подсказку", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.setCursorCount(2);

        expect(service.isOpen()).toBe(false);
    });

    it("активный редактор тихо сменился на другой — cursor-событие старого гасит подсказку", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const fakeGroup = makeGroup(fake.editor, items({ insertText: "cde" }));
        const service = makeService(fakeGroup.group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fakeGroup.setActiveEditorSilently(other.editor);
        fake.move(0, 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("каретка дёрнулась, когда активного редактора уже нет — подсказка гаснет", async () => {
        const fake = makeEditor("ab", 2);
        const fakeGroup = makeGroup(fake.editor, items({ insertText: "cde" }));
        const service = makeService(fakeGroup.group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Окно между закрытием вкладки и событием onActiveEditorChanged:
        // cursor-событие старого редактора приходит при active === null.
        fakeGroup.setActiveEditorSilently(null);
        fake.move(0, 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("смена активного редактора гасит подсказку", async () => {
        const fake = makeEditor("ab", 2);
        const fakeGroup = makeGroup(fake.editor, items({ insertText: "cde" }));
        const service = makeService(fakeGroup.group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fakeGroup.setActiveEditor(null);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("после смены редактора события старого не запускают запросов (подписки сняты)", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        const service = makeService(g.group);

        g.setActiveEditor(other.editor);
        // Правка в СТАРОМ редакторе: его подписки сняты — запросов нет.
        fake.type("ab ", 3);
        await tick();

        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("смена редактора снимает отложенный авто-запрос старого", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        makeService(g.group);

        fake.type("ab ", 3); // планирует авто-запрос на старом
        g.setActiveEditor(other.editor); // bindEditor обязан снять таймер
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("смена редактора не тащит «была правка» на новый: чистое движение не запрашивает", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        makeService(g.group);

        g.setActiveEditor(other.editor);
        other.move(0, 2); // движение без правки на новом редакторе
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("hide() гасит подсказку (Escape)", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();

        service.hide();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        // Повторный hide — no-op, второго setGhostText(null) нет.
        const calls = fake.setGhostText.mock.calls.length;
        service.hide();
        expect(fake.setGhostText.mock.calls.length).toBe(calls);
    });

    it("dispose гасит видимую подсказку", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 2, lines: ["cde"] });

        service.dispose();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("dispose гасит подсказку и снимает подписки", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        const service = makeService(g.group);
        await service.trigger();

        fake.type("ab ", 3); // отложенный авто-запрос…
        service.dispose(); // …dispose обязан снять и его
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        await tick();
        expect(source).toHaveBeenCalledTimes(1); // только исходный trigger

        fake.type("ab x", 4);
        await tick();
        expect(source).toHaveBeenCalledTimes(1); // после dispose набор не запрашивает

        // И смена активного редактора больше не перевешивает подписки.
        g.setActiveEditor(other.editor);
        other.type("zz ", 3);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        // Подписка на закрытие попапа тоже снята.
        service.firePopupClose();
        await tick();
        expect(source).toHaveBeenCalledTimes(1);
    });
});

describe("InlineCompletionsService — принятие", () => {
    it("acceptCurrent заменяет диапазон целым insertText одной правкой и не перезапрашивает", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(
            items({
                insertText: "console.log()",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            }),
        );
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();

        service.acceptCurrent();

        expect(service.isOpen()).toBe(false);
        expect(fake.applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [
                {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    text: "console.log()",
                },
            ],
            "Accept Inline Suggestion",
        );

        // Правка accept шлёт content+cursor — подавленный авто-запрос не уходит.
        fake.type("console.log()", 13);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("acceptCurrent без показанной подсказки — no-op", () => {
        const fake = makeEditor("con", 3);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "x" })).group);
        service.acceptCurrent();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();
    });
});

describe("InlineCompletionsService — гейт Tab против отступа", () => {
    it("подсказка с ≥ таба отступа при каретке в отступе выключает ключ", async () => {
        const fake = makeEditor("    ", 4);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "    return n;" })).group);
        expect(service.hasIndentationLessThanTabSize()).toBe(true); // дефолт без сессии

        await service.trigger();

        expect(service.isOpen()).toBe(true);
        expect(service.hasIndentationLessThanTabSize()).toBe(false);
    });

    it("подсказка после текста строки ключ не трогает", async () => {
        const fake = makeEditor("if (x) {", 8);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "    }" })).group);
        await service.trigger();

        expect(service.hasIndentationLessThanTabSize()).toBe(true);
    });
});

describe("computeIndentationLessThanTabSize", () => {
    it("считает видимую ширину пробелов и табов против tabSize", () => {
        // Каретка в отступе, подсказка с 4 пробелами (= tabSize) → false.
        expect(computeIndentationLessThanTabSize("  ", 2, "    x", 4)).toBe(false);
        // Таб добивает до границы tabSize → false.
        expect(computeIndentationLessThanTabSize("", 0, "\tx", 4)).toBe(false);
        // Отступ подсказки меньше таба → true.
        expect(computeIndentationLessThanTabSize("  ", 2, "  x", 4)).toBe(true);
        // Каретка не в отступе — всегда true.
        expect(computeIndentationLessThanTabSize("ab  ", 4, "    x", 4)).toBe(true);
        // Подсказка без отступа → true.
        expect(computeIndentationLessThanTabSize("    ", 4, "x", 4)).toBe(true);
        // Скан отступа подсказки останавливается на первом непробельном
        // символе — длинный непробельный хвост ширину не набирает.
        expect(computeIndentationLessThanTabSize("    ", 4, "xxxx", 4)).toBe(true);
        // «В отступе» — про текст ДО каретки: непробельный хвост правее каретки
        // не выводит её из отступа.
        expect(computeIndentationLessThanTabSize("  xx", 2, "    y", 4)).toBe(false);
    });
});
