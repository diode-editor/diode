import { describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
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
import { editorConfiguration } from "../../../common/configuration/editorConfiguration.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import type { CompletionService } from "../../suggest/browser/completionService.ts";

import {
    computeIndentationLessThanTabSize,
    DEFAULT_INLINE_SUGGEST_DELAY_MS,
    DEFAULT_INLINE_SUGGEST_REQUEST_TIMEOUT_MS,
    InlineCompletionsService,
    readMillisecondsSetting,
} from "./inlineCompletionsService.ts";

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

interface ServiceOptions {
    popupOpen?: () => boolean;
    /** `editor.inlineSuggest.enabled`; `undefined` — ключа в модели нет. */
    enabled?: boolean;
    /** `editor.inlineSuggest.delay`; по умолчанию 0 — детерминированный авто-запрос. */
    delay?: unknown;
    /** `editor.inlineSuggest.requestTimeout`; `undefined` — ключа в модели нет. */
    requestTimeout?: unknown;
}

function makeService(
    group: EditorService,
    options: ServiceOptions = {},
): InlineCompletionsService & { firePopupClose: () => void } {
    const closeListeners: (() => void)[] = [];
    const completion = {
        isOpen: options.popupOpen ?? (() => false),
        onDidClose: (l: () => void) => {
            closeListeners.push(l);
            return { dispose: () => closeListeners.splice(closeListeners.indexOf(l), 1) };
        },
    } as unknown as CompletionService;
    // Живой конфиг: читается на каждом обращении, значения берутся из `options`
    // в момент чтения — тест может подменить их по ходу (live-reload).
    const configuration = {
        get: (key: string): unknown => {
            if (key === "editor.inlineSuggest.enabled") return options.enabled ?? true;
            if (key === "editor.inlineSuggest.delay") return options.delay ?? 0;
            if (key === "editor.inlineSuggest.requestTimeout") return options.requestTimeout;
            return undefined;
        },
    } as unknown as IConfigurationService;
    const service = new InlineCompletionsService(group, completion, configuration) as InlineCompletionsService & {
        firePopupClose: () => void;
    };
    service.firePopupClose = () => {
        for (const l of [...closeListeners]) l();
    };
    return service;
}

function items(...list: ICoreInlineCompletionItem[]): () => Promise<readonly ICoreInlineCompletionItem[]> {
    return () => Promise.resolve(list);
}

/**
 * Источник, который складывает пришедшие запросы в `into` — тестам настроек
 * важны не только пункты, но и поля самого запроса (`triggerKind`, `timeoutMs`).
 */
function recordingItems(
    into: IInlineCompletionRequest[],
    ...list: ICoreInlineCompletionItem[]
): (req: IInlineCompletionRequest) => Promise<readonly ICoreInlineCompletionItem[]> {
    return (req) => {
        into.push(req);
        return Promise.resolve(list);
    };
}

/**
 * Источник, который держит ответ до `respond` и отдаёт наружу токены запросов —
 * на них и смотрят тесты отмены (провайдер за источником узнаёт об отмене
 * ровно через такой токен).
 */
function pendingSource(): {
    source: EditorService["inlineCompletionSource"];
    tokens: ICancellationToken[];
    respond: (index: number, list?: ICoreInlineCompletionItem[]) => void;
} {
    const tokens: ICancellationToken[] = [];
    const resolvers: ((list: readonly ICoreInlineCompletionItem[]) => void)[] = [];
    return {
        source: (_request, token) => {
            tokens.push(token);
            return new Promise<readonly ICoreInlineCompletionItem[]>((resolve) => resolvers.push(resolve));
        },
        tokens,
        respond: (index, list = []) => {
            resolvers[index](list);
        },
    };
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
                    {
                        insertText: "log()",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // range на другой строке.
                    {
                        insertText: "confuse",
                        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
                    },
                    // start на другой строке (end — на строке каретки).
                    {
                        insertText: "con-BAD1",
                        range: { start: { line: 1, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // end на другой строке (start — на строке каретки).
                    {
                        insertText: "con-BAD2",
                        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } },
                    },
                    // range начинается ПРАВЕЕ каретки.
                    {
                        insertText: "-BAD3",
                        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
                    },
                    // range не покрывает каретку.
                    {
                        insertText: "control",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    },
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
    it("не запрашивает: выделение, мультикурсор, read-only, попап", async () => {
        const source = vi.fn(items({ insertText: "x" }));

        const withSelection = makeEditor("abc", 3);
        withSelection.setSelection(1, 3);
        await makeService(makeGroup(withSelection.editor, source).group).trigger();

        const multiCursor = makeEditor("abc", 3);
        multiCursor.setCursorCount(2);
        await makeService(makeGroup(multiCursor.editor, source).group).trigger();

        const readOnly = makeEditor("abc", 3);
        readOnly.setReadOnly(true);
        await makeService(makeGroup(readOnly.editor, source).group).trigger();

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
        const source = vi.fn(
            items({ insertText: "cde", range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } }),
        );
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

    it("каретка ушла назад ВНУТРЬ подсказки без правки — подсказка гаснет", async () => {
        const fake = makeEditor("abc", 3);
        const source = items({
            insertText: "cde",
            range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } },
        });
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Каретка внутри заменяемого диапазона: набранное («») всё ещё префикс
        // подсказки, но правки не было — движение гасит (Backspace бы растил).
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
        makeService(makeGroup(fake.editor, source).group, { delay: 5 });

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

/**
 * Заявка n-4: подсказка нужна и когда каретка НЕ в конце строки (внутри
 * скобок, в середине объекта) — сегодня сервис её просто не показывает
 * (гейт `caret.character !== lineContent.length`), и значительная часть
 * подсказок провайдера до пользователя не доходит.
 */
describe("InlineCompletionsService — каретка в середине строки", () => {
    it("набор в середине строки запрашивает источник и показывает призрака перед хвостом", async () => {
        const fake = makeEditor(";", 0);
        const requests: IInlineCompletionRequest[] = [];
        const source = (req: IInlineCompletionRequest): Promise<readonly ICoreInlineCompletionItem[]> => {
            requests.push(req);
            return Promise.resolve([{ insertText: ' = "Hello"' }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        // Набрали «const greeting» перед уже стоявшим «;» — каретка на 14, хвост «;».
        fake.type("const greeting;", 14);
        await tick();

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ line: 0, character: 14 });
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 14, lines: [' = "Hello"'] });
        expect(service.isOpen()).toBe(true);
    });

    it("Tab вставляет подсказку в середину строки, не трогая хвост", async () => {
        const fake = makeEditor("const greeting;", 14);
        const service = makeService(makeGroup(fake.editor, items({ insertText: ' = "Hello"' })).group);

        await service.trigger();
        expect(service.isOpen()).toBe(true);

        service.acceptCurrent();

        // Правка — вставка в позицию каретки: хвост «;» остаётся за ней.
        expect(fake.applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [
                {
                    range: { start: { line: 0, character: 14 }, end: { line: 0, character: 14 } },
                    text: ' = "Hello"',
                },
            ],
            "Accept Inline Suggestion",
        );
        expect(service.isOpen()).toBe(false);
    });

    it("набор совпадающего символа в середине строки сжимает призрака, а не гасит", async () => {
        const fake = makeEditor("const greeting;", 14);
        const service = makeService(makeGroup(fake.editor, items({ insertText: ' = "Hello"' })).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Набрали пробел — первый символ подсказки: хвост подсказки сжимается.
        fake.type("const greeting ;", 15);

        expect(service.isOpen()).toBe(true);
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 15, lines: ['= "Hello"'] });
    });
});

describe("InlineCompletionsService — отмена запроса", () => {
    it("новый запрос отменяет предыдущий: доживает только последний", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();
        expect(pending.tokens).toHaveLength(1);
        expect(service.isRequestPending()).toBe(true);

        fake.type("const x =", 9);
        await tick();

        expect(pending.tokens).toHaveLength(2);
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(pending.tokens[1].isCancellationRequested).toBe(false);

        // Опоздавший ответ отменённого запроса не трогает чужое ожидание:
        // в полёте всё ещё последний запрос.
        pending.respond(0, [{ insertText: "= 42;" }]);
        await tick();
        expect(service.isRequestPending()).toBe(true);
        expect(service.isOpen()).toBe(false);
    });

    it("повторный trigger без правки тоже отменяет предыдущий запрос", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        // Два явных триггера подряд: правки нет, значит onCaretChanged не
        // сработает — отменить старый запрос обязан сам trigger.
        void service.trigger();
        void service.trigger();
        await tick();

        expect(pending.tokens).toHaveLength(2);
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(pending.tokens[1].isCancellationRequested).toBe(false);
    });

    it("hide (Escape) отменяет запрос, у которого призрака ещё нет, и поздний ответ не всплывает", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();
        expect(service.isRequestPending()).toBe(true);
        expect(service.isOpen()).toBe(false); // призрака ещё нет

        service.hide();
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(service.isRequestPending()).toBe(false);

        // Упрямый провайдер ответил вопреки отмене — на экран это не попадает.
        pending.respond(0, [{ insertText: "= 42;" }]);
        await tick();
        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).not.toHaveBeenCalledWith(expect.objectContaining({ lines: ["= 42;"] }));
    });

    it("hide снимает и отложенный авто-запрос — призрак не всплывёт следом за Escape", async () => {
        const fake = makeEditor("const x", 7);
        const source = vi.fn(items({ insertText: " = 42;" }));
        const service = makeService(makeGroup(fake.editor, source).group);

        // Правка планирует авто-запрос; Escape приходит ДО того, как дебаунс
        // успел выстрелить, — запроса не должно случиться вовсе.
        fake.type("const x ", 8);
        service.hide();
        await tick();

        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("уход каретки отменяет запрос", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();

        fake.move(0, 3);

        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(service.isRequestPending()).toBe(false);
    });

    it("смена активного редактора (переключение вкладки) отменяет запрос", async () => {
        const fake = makeEditor("const x", 7);
        const other = makeEditor("other", 5);
        const pending = pendingSource();
        const fakeGroup = makeGroup(fake.editor, pending.source);
        const service = makeService(fakeGroup.group);

        fake.type("const x ", 8);
        await tick();
        expect(service.isRequestPending()).toBe(true);

        fakeGroup.setActiveEditor(other.editor);

        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(service.isRequestPending()).toBe(false);
    });

    it("дождавшийся ответа запрос не отменяется — нормальный путь цел", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        const triggered = service.trigger();
        expect(service.isRequestPending()).toBe(true);
        pending.respond(0, [{ insertText: " = 42;" }]);
        await triggered;

        expect(pending.tokens[0].isCancellationRequested).toBe(false);
        expect(service.isRequestPending()).toBe(false);
        expect(service.isOpen()).toBe(true);
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 7, lines: [" = 42;"] });
    });

    it("dispose сервиса отменяет запрос в полёте", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();
        service.dispose();

        expect(pending.tokens[0].isCancellationRequested).toBe(true);
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

describe("InlineCompletionsService — настройки", () => {
    it("enabled:false гасит авто-запрос, но не явный триггер (ручной режим)", async () => {
        const fake = makeEditor("ab", 2);
        const requests: IInlineCompletionRequest[] = [];
        const service = makeService(makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group, {
            enabled: false,
        });

        // Набор при выключенной настройке провайдера не опрашивает вовсе.
        fake.type("ab ", 3);
        await tick();
        expect(requests).toHaveLength(0);
        expect(service.isOpen()).toBe(false);

        // Alt+\ (явный Invoke) — подсказка приходит несмотря на настройку.
        fake.type("ab", 2);
        await tick();
        expect(requests).toHaveLength(0);
        await service.trigger(InlineCompletionTriggerKind.Invoke);

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ triggerKind: InlineCompletionTriggerKind.Invoke });
        expect(service.isOpen()).toBe(true);
    });

    it("после явного триггера при enabled:false расхождение гасит призрака навсегда", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "abc" }));
        const service = makeService(makeGroup(fake.editor, source).group, { enabled: false });
        await service.trigger(InlineCompletionTriggerKind.Invoke);
        expect(service.isOpen()).toBe(true);

        // Символ мимо подсказки: сессия гаснет и сама НЕ возвращается —
        // авто-запрос выключен, второго обращения к источнику нет.
        fake.type("abX", 3);
        await tick();

        expect(service.isOpen()).toBe(false);
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("enabled читается на каждом запросе — правка настройки применяется без пересоздания сервиса", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "abc" }));
        const options: ServiceOptions = { enabled: true };
        const service = makeService(makeGroup(fake.editor, source).group, options);

        fake.type("ab ", 3);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        options.enabled = false; // как сохранение settings.json на живом редакторе
        fake.type("ab x", 4);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        options.enabled = true;
        fake.type("ab xy", 5);
        await tick();
        expect(source).toHaveBeenCalledTimes(2);
        expect(service.isOpen()).toBe(true);
    });

    it("delay задаёт паузу перед авто-запросом и читается на каждой правке", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items());
        const options: ServiceOptions = { delay: 40 };
        makeService(makeGroup(fake.editor, source).group, options);

        fake.type("ab ", 3);
        await tick(10);
        expect(source).not.toHaveBeenCalled(); // 40 мс ещё не прошли
        await tick(60);
        expect(source).toHaveBeenCalledTimes(1);

        options.delay = 0; // новая настройка — новая пауза, без пересоздания сервиса
        fake.type("ab x", 4);
        await tick(10);
        expect(source).toHaveBeenCalledTimes(2);
    });

    it("requestTimeout едет в источник с каждым запросом", async () => {
        const fake = makeEditor("ab", 2);
        const requests: IInlineCompletionRequest[] = [];
        const options: ServiceOptions = { requestTimeout: 20000 };
        const service = makeService(
            makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group,
            options,
        );

        await service.trigger();
        expect(requests[0]).toMatchObject({ timeoutMs: 20000 });

        options.requestTimeout = 1234;
        await service.trigger();
        expect(requests[1]).toMatchObject({ timeoutMs: 1234 });
    });

    it("негодные значения настроек откатываются на дефолты, а не ломают редактор", async () => {
        // `delay: -5` и `requestTimeout: "много"` — ровно то, что человек может
        // написать руками: редактор обязан вести себя как с дефолтами.
        const fake = makeEditor("ab", 2);
        const requests: IInlineCompletionRequest[] = [];
        const service = makeService(makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group, {
            delay: -5,
            requestTimeout: "много",
        });

        await service.trigger();
        expect(requests[0]).toMatchObject({ timeoutMs: DEFAULT_INLINE_SUGGEST_REQUEST_TIMEOUT_MS });
        expect(service.isOpen()).toBe(true);

        // Дефолтные 50 мс дебаунса: через 10 мс запроса ещё нет, через 70 — есть.
        fake.type("abc ", 4);
        await tick(10);
        expect(requests).toHaveLength(1);
        await tick(70);
        expect(requests).toHaveLength(2);
    });
});

describe("InlineCompletionsService — дефолты в лок-степе со схемой", () => {
    it("fallback-константы совпадают с `default` ключей editor.inlineSuggest.*", () => {
        // Разойдутся — и редактор с пустым settings.json поведёт себя иначе,
        // чем обещает автодополнение ключа.
        expect(DEFAULT_INLINE_SUGGEST_DELAY_MS).toBe(
            editorConfiguration.properties["editor.inlineSuggest.delay"].default,
        );
        expect(DEFAULT_INLINE_SUGGEST_REQUEST_TIMEOUT_MS).toBe(
            editorConfiguration.properties["editor.inlineSuggest.requestTimeout"].default,
        );
    });
});

describe("readMillisecondsSetting", () => {
    it("пропускает конечные числа не меньше min, остальное — fallback", () => {
        expect(readMillisecondsSetting(2000, 50, 0)).toBe(2000);
        expect(readMillisecondsSetting(0, 50, 0)).toBe(0); // ноль допустим для delay
        expect(readMillisecondsSetting(0, 5000, 1)).toBe(5000); // но не для timeout
        expect(readMillisecondsSetting(-5, 50, 0)).toBe(50);
        expect(readMillisecondsSetting("много", 5000, 1)).toBe(5000);
        expect(readMillisecondsSetting(Number.NaN, 50, 0)).toBe(50);
        expect(readMillisecondsSetting(Number.POSITIVE_INFINITY, 50, 0)).toBe(50);
        expect(readMillisecondsSetting(undefined, 50, 0)).toBe(50); // ключа нет в модели
        expect(readMillisecondsSetting(true, 50, 0)).toBe(50);
        expect(readMillisecondsSetting(null, 50, 0)).toBe(50);
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
