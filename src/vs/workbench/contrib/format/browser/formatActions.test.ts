import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { Container } from "../../../../platform/instantiation/common/diContainer.ts";
import { parseChord, parseKeybinding } from "../../../../platform/keybinding/common/keybindingRegistry.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { type StatusBarService, StatusBarServiceDIToken } from "../../../services/statusbar/common/statusBarService.ts";

import { formatDocumentAction, formatSelectionAction } from "./formatActions.ts";

// Команды форматирования: провайдерные правки применяются undoable-батчем,
// «нет форматтера» показывается в статус-баре, устаревший ответ отбрасывается.

interface ISelectionLike {
    anchor: { line: number; character: number };
    active: { line: number; character: number };
}

interface ISetup {
    accessor: Container;
    applied: { edits: readonly ITextEdit[]; label: string }[];
    notices: string[];
    requests: IFormattingRequest[];
    selections(): readonly ISelectionLike[];
    setText(next: string): void;
    /** Сколько подписок на правку документа висит сейчас. */
    contentListenerCount(): number;
    dropActiveEditor(): void;
    swapActiveEditor(): void;
}

/** Ответ форматтера на запрос (и документного, и range — у теста один). */
type FakeFormatter = (request: IFormattingRequest, token: ICancellationToken) => Promise<readonly ITextEdit[]>;

function makeSetup(
    source: FakeFormatter | undefined,
    options: { selection?: ISelectionLike; noSelections?: boolean; selector?: string } = {},
): ISetup {
    let text = "const  a=1;\nsecond line\nthird";
    const applied: { edits: readonly ITextEdit[]; label: string }[] = [];
    const requests: IFormattingRequest[] = [];
    // Правка документа — событие модели: по нему action узнаёт, что ответ устарел.
    const contentListeners = new Set<() => void>();
    // Версия модели: запрос несёт её вместо текста; правка документа её поднимает.
    const document = { versionId: 1 };
    const editor = {
        uri: Uri.file("/proj/a.py"),
        languageId: "python",
        getText: () => text,
        model: { document },
        onDidChangeContent: (listener: () => void) => {
            contentListeners.add(listener);
            return { dispose: () => contentListeners.delete(listener) };
        },
        viewState: {
            tabSize: 2,
            insertSpaces: true,
            selections: options.noSelections
                ? []
                : [options.selection ?? { anchor: { line: 0, character: 0 }, active: { line: 0, character: 0 } }],
        },
        applyExternalEdits: (edits: readonly ITextEdit[], label: string) => {
            applied.push({ edits, label });
        },
    };
    let active: unknown = editor;
    // Форматтер — документный и range-провайдер в реестре под селектором
    // `options.selector` (по умолчанию — любой документ).
    const languageFeatures = new LanguageFeaturesService();
    if (source !== undefined) {
        const selector = options.selector ?? "*";
        const format = (request: IFormattingRequest, token: ICancellationToken): Promise<readonly ITextEdit[]> => {
            requests.push(request);
            return source(request, token);
        };
        languageFeatures.documentFormattingEditProvider.register(selector, { provideDocumentFormattingEdits: format });
        languageFeatures.documentRangeFormattingEditProvider.register(selector, {
            provideDocumentRangeFormattingEdits: format,
        });
    }
    const group = {
        getActiveEditor: () => active,
    } as unknown as IEditorService;
    const notices: string[] = [];
    const statusBar = {
        addEntry: (entry: { id: string; text: string }) => {
            notices.push(`${entry.id}: ${entry.text}`);
            return { dispose: () => undefined };
        },
    } as unknown as StatusBarService;

    const accessor = new Container();
    accessor.bind(EditorServiceDIToken, () => group);
    accessor.bind(StatusBarServiceDIToken, () => statusBar);
    accessor.bind(LanguageFeaturesServiceDIToken, () => languageFeatures);
    return {
        accessor,
        applied,
        notices,
        requests,
        selections: () => editor.viewState.selections,
        setText: (next) => {
            text = next;
            document.versionId++;
            for (const listener of [...contentListeners]) listener();
        },
        contentListenerCount: () => contentListeners.size,
        dropActiveEditor: () => {
            active = null;
        },
        swapActiveEditor: () => {
            active = { ...editor };
        },
    };
}

const EDIT: ITextEdit = { range: createRange(0, 5, 0, 7), text: " " };

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("editor.action.formatDocument", () => {
    it("применяет правки провайдера одним батчем с меткой Format Document", async () => {
        const setup = makeSetup(() => Promise.resolve([EDIT]), {
            selection: { anchor: { line: 0, character: 7 }, active: { line: 0, character: 7 } },
        });
        // Правка до команды поднимает версию: запрос берёт текущую, а не начальную.
        setup.setText("const  a=1;\nsecond line\nthird");
        await formatDocumentAction.run(setup.accessor);
        expect(setup.applied).toEqual([{ edits: [EDIT], label: "Format Document" }]);
        expect(setup.notices).toEqual([]);
        // Слежка за правками на время запроса снята вместе с ответом.
        expect(setup.contentListenerCount()).toBe(0);
        // После применения — ОДНА каретка на прежнем месте, а не по каретке на
        // каждую правку (мультикурсорная семантика applyEdits форматтеру чужая).
        expect(setup.selections()).toEqual([createSelection(0, 7, 0, 7)]);
        // Запрос несёт версию модели (не текст) и настройки отступов активного
        // редактора, БЕЗ range (strict: даже `range: undefined` — лишний ключ).
        expect(setup.requests).toStrictEqual([
            {
                uri: Uri.file("/proj/a.py").toString(),
                languageId: "python",
                versionId: 2,
                tabSize: 2,
                insertSpaces: true,
            },
        ]);
    });

    it("без форматтера для документа показывает «нет форматтера» и ничего не меняет", async () => {
        const noSource = makeSetup(undefined);
        await formatDocumentAction.run(noSource.accessor);
        expect(noSource.applied).toEqual([]);
        expect(noSource.notices).toEqual(["formatting.notice: No formatter for 'python' installed"]);

        // Форматтер есть, но для чужого языка — к нему даже не ходят.
        const foreign = makeSetup(() => Promise.resolve([EDIT]), { selector: "typescript" });
        await formatDocumentAction.run(foreign.accessor);
        await formatSelectionAction.run(foreign.accessor);
        expect(foreign.requests).toEqual([]);
        expect(foreign.applied).toEqual([]);
        expect(foreign.notices).toEqual([
            "formatting.notice: No formatter for 'python' installed",
            "formatting.notice: No formatter for 'python' installed",
        ]);
    });

    it("пустой ответ — тихий no-op: ни правок, ни сообщения", async () => {
        const setup = makeSetup(() => Promise.resolve([]));
        await formatDocumentAction.run(setup.accessor);
        expect(setup.applied).toEqual([]);
        expect(setup.notices).toEqual([]);
    });

    it("устаревший ответ отбрасывается: текст изменился или вкладка сменилась, пока ждали", async () => {
        const changedText = makeSetup(() => Promise.resolve([EDIT]));
        const run = formatDocumentAction.run(changedText.accessor);
        changedText.setText("mutated while waiting");
        await run;
        expect(changedText.applied).toEqual([]);

        const swapped = makeSetup(() => Promise.resolve([EDIT]));
        const run2 = formatDocumentAction.run(swapped.accessor);
        swapped.swapActiveEditor();
        await run2;
        expect(swapped.applied).toEqual([]);
    });

    it("правка за время запроса отменяет и работу форматтера", async () => {
        let seen: ICancellationToken | null = null;
        const setup = makeSetup((_request, token) => {
            seen = token;
            return Promise.resolve([EDIT]);
        });
        const run = formatDocumentAction.run(setup.accessor);
        expect(seen!.isCancellationRequested).toBe(false);

        setup.setText("mutated while waiting");
        expect(seen!.isCancellationRequested).toBe(true);
        await run;
    });

    it("каретка после формата клампится к новому тексту; без выделений — (0,0)", async () => {
        const outOfRange = makeSetup(() => Promise.resolve([EDIT]), {
            selection: { anchor: { line: 99, character: 50 }, active: { line: 99, character: 50 } },
        });
        await formatDocumentAction.run(outOfRange.accessor);
        // Текст фейка не меняется: 3 строки, последняя "third" (5 символов).
        expect(outOfRange.selections()).toEqual([createSelection(2, 5, 2, 5)]);

        const noSelections = makeSetup(() => Promise.resolve([EDIT]), { noSelections: true });
        await formatDocumentAction.run(noSelections.accessor);
        expect(noSelections.selections()).toEqual([createSelection(0, 0, 0, 0)]);
    });

    it("без активного редактора — тихий выход, источник не спрашивается", async () => {
        const setup = makeSetup(() => Promise.resolve([EDIT]));
        setup.dropActiveEditor();
        await formatDocumentAction.run(setup.accessor);
        expect(setup.requests).toEqual([]);
        expect(setup.applied).toEqual([]);
        expect(setup.notices).toEqual([]);
    });
});

describe("метаданные формат-команд", () => {
    it("палитра/бинды/when запиннены: это пользовательский контракт, а не украшение", () => {
        expect(formatDocumentAction.id).toBe("editor.action.formatDocument");
        expect(formatDocumentAction.title).toBe("Format Document");
        expect(formatDocumentAction.when).toBe("textInputFocus && !editorReadonly");
        // Первичный — досягаемый везде аккорд: именно он идёт в подпись палитры и
        // меню там, где Shift+Alt+F не доезжает. Канонический — под tier-гейтом.
        expect(formatDocumentAction.keybinding).toEqual(parseChord("ctrl+k ctrl+e"));
        expect(formatDocumentAction.keybindings).toEqual([
            { keys: parseKeybinding("shift+alt+f"), when: "tier != 'legacy'" },
        ]);

        expect(formatSelectionAction.id).toBe("editor.action.formatSelection");
        expect(formatSelectionAction.title).toBe("Format Selection");
        expect(formatSelectionAction.when).toBe("textInputFocus && !editorReadonly");
        expect(formatSelectionAction.keybinding).toEqual(parseChord("mod+k mod+f"));
    });
});

describe("editor.action.formatSelection", () => {
    it("непустое выделение (в т.ч. перевёрнутое) едет нормализованным range", async () => {
        const forward = makeSetup(() => Promise.resolve([]), {
            selection: { anchor: { line: 1, character: 1 }, active: { line: 2, character: 3 } },
        });
        await formatSelectionAction.run(forward.accessor);
        expect(forward.requests[0].range).toEqual(createRange(1, 1, 2, 3));

        const setup = makeSetup(() => Promise.resolve([EDIT]), {
            // Перевёрнутое: каретка ВЫШЕ якоря — границы меняются местами.
            selection: { anchor: { line: 2, character: 3 }, active: { line: 1, character: 1 } },
        });
        await formatSelectionAction.run(setup.accessor);
        expect(setup.requests[0].range).toEqual(createRange(1, 1, 2, 3));
        expect(setup.applied).toEqual([{ edits: [EDIT], label: "Format Selection" }]);
    });

    it("пустое выделение — строка каретки целиком", async () => {
        const setup = makeSetup(() => Promise.resolve([]), {
            selection: { anchor: { line: 1, character: 4 }, active: { line: 1, character: 4 } },
        });
        await formatSelectionAction.run(setup.accessor);
        // Строка 1 — "second line" (11 символов).
        expect(setup.requests[0].range).toEqual(createRange(1, 0, 1, 11));
    });

    it("грани: вью без выделений — строка 0; каретка за пределами текста — пустой диапазон", async () => {
        // Пустой список выделений (в живом редакторе не бывает, защитная ветка):
        // дефолтная пустая позиция (0,0) — строка 0 ("const  a=1;", 11 символов).
        const noSelections = makeSetup(() => Promise.resolve([]), { noSelections: true });
        await formatSelectionAction.run(noSelections.accessor);
        expect(noSelections.requests[0].range).toEqual(createRange(0, 0, 0, 11));

        const outOfRange = makeSetup(() => Promise.resolve([]), {
            selection: { anchor: { line: 99, character: 0 }, active: { line: 99, character: 0 } },
        });
        await formatSelectionAction.run(outOfRange.accessor);
        expect(outOfRange.requests[0].range).toEqual(createRange(99, 0, 99, 0));
    });
});
