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
    };
}

function makeService(
    group: EditorService,
    options: { popupOpen?: () => boolean; enabled?: boolean } = {},
): InlineCompletionsService {
    const completion = { isOpen: options.popupOpen ?? (() => false) } as unknown as CompletionService;
    const configuration = {
        get: (key: string) => (key === "editor.inlineSuggest.enabled" ? (options.enabled ?? true) : undefined),
    } as unknown as IConfigurationService;
    const service = new InlineCompletionsService(group, completion, configuration);
    service.autoTriggerDelayMs = 0; // детерминированный авто-запрос в тестах
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
                    // полностью набранный текст — хвоста нет.
                    { insertText: "con", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
                    { insertText: "st y = 1;" },
                ),
            ).group,
        );

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["st y = 1;"] });
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

    it("dispose гасит подсказку и снимает подписки", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();

        service.dispose();
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);

        fake.type("ab ", 3);
        await tick();
        expect(source).toHaveBeenCalledTimes(1); // после dispose набор не запрашивает
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
    });
});
