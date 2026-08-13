import { describe, expect, it, vi } from "vitest";

import { Size } from "@tuidom/all/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/all/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/all/ui/body/bodyElement";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    ICoreCompletionItem,
    ICoreCompletionResult,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";

import { CompletionService } from "./completionService.ts";
import { SuggestComponent } from "./suggestComponent.ts";

interface FakeEditor {
    editor: TextEditorPane;
    applyExternalEdits: ReturnType<typeof vi.fn<(edits: ITextEdit[], label: string) => void>>;
    /** Печать: обновляет строку/каретку и шлёт content+cursor (как typing/удаление). */
    type: (line: string, character: number, lineNo?: number) => void;
    /** Чистое движение каретки: шлёт только cursor (без content-маркера). */
    move: (lineNo: number, character: number) => void;
    /** Непустое выделение: anchor != active. */
    setSelection: (anchorChar: number, activeChar: number) => void;
    setAnchorNull: (value: boolean) => void;
}

function makeEditor(lineContent: string, character: number, docText = lineContent, anchorChar = character): FakeEditor {
    const state = { line: lineContent, lineNo: 0, anchorChar, activeChar: character };
    let anchorNull = false;
    const contentListeners: (() => void)[] = [];
    const cursorListeners: (() => void)[] = [];
    const applyExternalEdits = vi.fn<(edits: ITextEdit[], label: string) => void>();

    const editor = {
        get viewState() {
            return {
                selections: [
                    {
                        anchor: { line: state.lineNo, character: state.anchorChar },
                        active: { line: state.lineNo, character: state.activeChar },
                    },
                ],
                document: { getLineContent: (_line: number) => state.line },
            };
        },
        getText: () => docText,
        uri: Uri.file("/proj/.editorconfig"),
        languageId: "editorconfig",
        getCaretAnchor: () => (anchorNull ? null : { screenX: 5, screenY: 5, preferBelow: true }),
        applyExternalEdits,
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
        type: (line, ch, lineNo = 0) => {
            state.line = line;
            state.lineNo = lineNo;
            state.anchorChar = ch;
            state.activeChar = ch;
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
        setAnchorNull: (value) => {
            anchorNull = value;
        },
    };
}

/** Ответ источника «полным списком» — форма {@link ICoreCompletionResult}. */
function completionResult(items: readonly ICoreCompletionItem[], isIncomplete = false): ICoreCompletionResult {
    return { items, isIncomplete };
}

function makeGroup(
    editor: TextEditorPane,
    source: EditorService["completionSource"],
    extraEditors: TextEditorPane[] = [],
): EditorService {
    const all = [editor, ...extraEditors];
    return {
        getActiveEditor: () => editor,
        onActiveEditorChanged: () => ({ dispose: () => {} }),
        completionSource: source,
        completionTriggerCharacters: [],
        editorCount: all.length,
        getEditor: (i: number) => all[i] ?? null,
    } as unknown as EditorService;
}

/**
 * Состояние в памяти: NULL_STATE_SERVICE всегда отдаёт дефолт и не годится там,
 * где проверяется «выбор пользователя переживает рестарт».
 */
function makeStateService(): IStateService {
    const store = new Map<string, unknown>();
    return {
        get: <T,>(descriptor: IStateDescriptor<T>): T => (store.get(descriptor.key) as T | undefined) ?? descriptor.default,
        store: <T,>(descriptor: IStateDescriptor<T>, value: T): void => {
            store.set(descriptor.key, value);
        },
        openWorkspace: () => undefined,
        flushSync: () => undefined,
    };
}

/** Пара component+service с фейковым CommandRegistry (шпион `execute`). */
function createService(
    group: EditorService,
    state: IStateService = makeStateService(),
): {
    service: CompletionService;
    component: SuggestComponent;
    execute: ReturnType<typeof vi.fn>;
} {
    const execute = vi.fn();
    const commands = { execute } as unknown as CommandRegistry;
    const component = new SuggestComponent();
    const service = new CompletionService(component, group, commands, state);
    return { service, component, execute };
}

function setup(items: readonly ICoreCompletionItem[], lineContent = "ind", character = 3, docText = lineContent) {
    const fake = makeEditor(lineContent, character, docText);
    const source = vi.fn(() => Promise.resolve(completionResult(items)));
    const group = makeGroup(fake.editor, source);

    const { service, component, execute } = createService(group);
    service.autoSuggestDelayMs = 0; // детерминированный авто-suggest в тестах
    const body = new BodyElement();
    const testApp = TestApp.create(body, new Size(80, 24));
    component.attachHost(body);
    return { service, component, body, testApp, fake, source, execute, editor: fake.editor };
}

/** Даёт setTimeout(…, 0) авто-suggest'а отработать. */
function flushTimers(): Promise<void> {
    return new Promise((res) => setTimeout(res, 5));
}

const ITEMS: ICoreCompletionItem[] = [
    {
        label: "indent_style",
        insertText: "indent_style",
        kind: 9,
        detail: "EditorConfig",
        command: { command: "ec._retrigger", arguments: [] },
    },
    { label: "indent_size", insertText: "indent_size", kind: 9 },
    { label: "root", insertText: "root" },
];

describe("CompletionService", () => {
    it("нет источника и пустой документ → trigger no-op (попап скрыт)", async () => {
        const fake = makeEditor("", 0);
        const { service, component } = createService(makeGroup(fake.editor, undefined));
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("пустой ответ провайдеров → попап не открывается", async () => {
        const { service, body } = setup([]);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("открывает попап и фильтрует по префиксу под курсором, не забирая фокус", async () => {
        const { service, component, body } = setup(ITEMS);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        expect(service.isOpen()).toBe(true);
        expect(component.view.isFocused).toBe(false); // редактор сохраняет фокус
        // Префикс "ind" отфильтровал "root".
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
    });

    it("передаёт корректный запрос источнику", async () => {
        const { service, source } = setup(ITEMS);
        await service.trigger();
        expect(source).toHaveBeenCalledWith({
            uri: Uri.file("/proj/.editorconfig").toString(),
            languageId: "editorconfig",
            text: "ind",
            line: 0,
            character: 3,
            triggerKind: CompletionTriggerKind.Invoke,
        });
    });

    describe("панель описания", () => {
        const RESOLVABLE: ICoreCompletionItem[] = [
            { label: "indent_style", insertText: "indent_style", id: "1.0", kind: 9 },
            { label: "indent_size", insertText: "indent_size", id: "1.1", kind: 9 },
        ];

        function setupWithResolver(
            resolver: EditorService["completionResolver"],
            state = makeStateService(),
        ): ReturnType<typeof createService> & { fake: FakeEditor; body: BodyElement } {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            (group as { completionResolver: EditorService["completionResolver"] }).completionResolver = resolver;
            const created = createService(group, state);
            const body = new BodyElement();
            TestApp.create(body, new Size(120, 24));
            created.component.attachHost(body);
            return { ...created, fake, body };
        }

        it("по умолчанию скрыта и описание не запрашивается", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "(property) indent_style" }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();

            expect(component.detailsVisible).toBe(false);
            expect(resolver).not.toHaveBeenCalled();
            expect(component.widget.showsDetails).toBe(false);
        });

        it("тумблер разворачивает панель и догружает описание выбранного пункта", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "(property) indent_style" }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(component.detailsVisible).toBe(true);
            expect(resolver).toHaveBeenCalledWith("1.0");
            expect(component.widget.showsDetails).toBe(true);
            expect(component.details.linesFor(40).join(" ")).toContain("(property) indent_style");
        });

        it("переход по списку показывает описание нового пункта", async () => {
            const resolver = vi.fn((id: string) => Promise.resolve({ detail: `detail for ${id}` }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            await flushTimers();

            expect(resolver).toHaveBeenCalledWith("1.1");
            expect(component.details.linesFor(40).join(" ")).toContain("detail for 1.1");
        });

        it("состояние тумблера переживает пересоздание сервиса", async () => {
            const state = makeStateService();
            const first = setupWithResolver(vi.fn(() => Promise.resolve(null)), state);
            await first.service.trigger();
            first.service.toggleDetails();
            expect(first.component.detailsVisible).toBe(true);

            const second = setupWithResolver(vi.fn(() => Promise.resolve(null)), state);
            expect(second.component.detailsVisible).toBe(true);
        });

        it("у края экрана панель уезжает влево от списка", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            (group as { completionResolver: EditorService["completionResolver"] }).completionResolver = () =>
                Promise.resolve({ detail: "(property) indent_style" });
            const { service, component } = createService(group);
            const body = new BodyElement();
            // Узкий экран: справа от каретки (screenX=5) виджет с панелью не влезает.
            TestApp.create(body, new Size(30, 24));
            component.attachHost(body);

            service.toggleDetails();
            await service.trigger();
            await flushTimers();

            expect(component.widget.detailsSide).toBe("left");
        });

        it("без прикреплённого хоста сторона панели не пересчитывается", () => {
            const fake = makeEditor("ind", 3, "ind");
            const { component } = createService(makeGroup(fake.editor, undefined));
            component.openAt({ screenX: 5, screenY: 5, preferBelow: true }); // хост не привязан
            expect(component.widget.detailsSide).toBe("right");
        });

        it("пустой выбор очищает панель", async () => {
            const { service, component } = setupWithResolver(() => Promise.resolve({ detail: "d" }));
            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            expect(component.details.isEmpty).toBe(false);

            // Фильтр, не совпавший ни с чем: выбранного пункта больше нет.
            component.view.setFilter("zzzz");
            expect(component.details.isEmpty).toBe(true);
        });

        it("повторный переход на пункт берёт описание из кэша, параллельные запросы склеиваются", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "cached" }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            await flushTimers();
            service.selectPrevious(); // назад на первый — уже в кэше
            await flushTimers();

            expect(resolver).toHaveBeenCalledTimes(2); // по одному разу на пункт
        });

        it("источник без резолвера панель не ломает", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            const { service, component } = createService(group); // completionResolver не задан
            const body = new BodyElement();
            TestApp.create(body, new Size(120, 24));
            component.attachHost(body);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(component.widget.showsDetails).toBe(false);
        });

        it("сигнатура из labelDetail показывается, пустая документация игнорируется", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const items: ICoreCompletionItem[] = [
                { label: "indent_style", insertText: "indent_style", labelDetail: "(property)", documentation: "" },
            ];
            const { service, component } = createService(
                makeGroup(
                    fake.editor,
                    vi.fn(() => Promise.resolve(completionResult(items))),
                ),
            );
            const body = new BodyElement();
            TestApp.create(body, new Size(120, 24));
            component.attachHost(body);

            service.toggleDetails();
            await service.trigger();

            // Пункт без id и без резолвера: описание берётся из самого пункта.
            expect(component.details.linesFor(40).join(" ")).toContain("(property)");
            expect(component.details.linesFor(40).join(" ")).not.toContain("undefined");
        });

        it("accept с уже догруженным описанием берёт правки из кэша, без повторного resolve", async () => {
            const resolver = vi.fn(() =>
                Promise.resolve({
                    detail: "(property) indent_style",
                    additionalEdits: [
                        {
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                            text: "# header\n",
                        },
                    ],
                }),
            );
            const { service, component, fake } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers(); // описание догрузилось и легло в кэш

            service.acceptSelected();
            await flushTimers();

            expect(resolver).toHaveBeenCalledTimes(1); // второй раз не ходили
            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(2);
            expect(edits[1].text).toBe("# header\n");
            expect(component.detailsVisible).toBe(true);
        });

        it("резолвер вернул null — в кэш ничего не кладём и панель пуста", async () => {
            const resolver = vi.fn(() => Promise.resolve(null));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            service.selectPrevious();
            await flushTimers();

            // Каждый показ пункта пробует резолв заново (кэшируем только успех).
            expect(resolver.mock.calls.length).toBeGreaterThan(1);
            expect(component.details.isEmpty).toBe(true);
        });

        it("сбойный резолвер не роняет попап", async () => {
            const { service, component } = setupWithResolver(() => Promise.reject(new Error("boom")));

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(service.isOpen()).toBe(true);
            expect(component.details.isEmpty).toBe(true);
        });

        it("ушли на другой пункт, пока грузилось описание — старое не показываем", async () => {
            let release: ((value: { detail: string }) => void) | null = null;
            const resolver = vi.fn((id: string) =>
                id === "1.0"
                    ? new Promise<{ detail: string }>((res) => {
                          release = res;
                      })
                    : Promise.resolve({ detail: "detail for 1.1" }),
            );
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext(); // ушли на второй пункт
            await flushTimers();
            expect(component.details.linesFor(40).join(" ")).toContain("detail for 1.1");

            release!({ detail: "detail for 1.0" });
            await flushTimers();

            // Запоздалый ответ по первому пункту не подменяет описание второго.
            expect(component.details.linesFor(40).join(" ")).toContain("detail for 1.1");
        });

        it("документация из самого пункта показывается без резолвера", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const items: ICoreCompletionItem[] = [
                {
                    label: "indent_style",
                    insertText: "indent_style",
                    detail: "EditorConfig",
                    documentation: "Отступы: tab или space.",
                },
            ];
            const { service, component } = createService(
                makeGroup(
                    fake.editor,
                    vi.fn(() => Promise.resolve(completionResult(items))),
                ),
            );
            const body = new BodyElement();
            TestApp.create(body, new Size(120, 24));
            component.attachHost(body);

            service.toggleDetails();
            await service.trigger();

            const text = component.details.linesFor(40).join(" ");
            expect(text).toContain("EditorConfig");
            expect(text).toContain("Отступы");
        });

        it("нет описания — панель не показывается даже при включённом тумблере", async () => {
            const { service, component } = setupWithResolver(vi.fn(() => Promise.resolve(null)));

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(component.detailsVisible).toBe(true);
            expect(component.widget.showsDetails).toBe(false);
        });
    });

    describe("вставка с правками-спутниками (авто-импорт)", () => {
        const IMPORTABLE: ICoreCompletionItem[] = [{ label: "greet", insertText: "greet", id: "1.0", kind: 2 }];
        const IMPORT_EDIT: ITextEdit = {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            text: 'import { greet } from "./defs";\n',
        };

        function setupImportable(resolver: EditorService["completionResolver"]): {
            service: CompletionService;
            fake: FakeEditor;
        } {
            const fake = makeEditor("gree", 4, "gree");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(IMPORTABLE))),
            );
            (group as { completionResolver: EditorService["completionResolver"] }).completionResolver = resolver;
            const { service, component } = createService(group);
            const body = new BodyElement();
            TestApp.create(body, new Size(120, 24));
            component.attachHost(body);
            return { service, fake };
        }

        it("accept ждёт resolve и применяет импорт одной транзакцией со вставкой", async () => {
            const { service, fake } = setupImportable(() =>
                Promise.resolve({ detail: "greet", additionalEdits: [IMPORT_EDIT] }),
            );

            await service.trigger();
            service.acceptSelected();
            await flushTimers();

            // Панель описания скрыта (дефолт), то есть resolve к моменту accept не
            // случился — вставка обязана дождаться его сама, иначе импорт теряется.
            expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
            const [edits, label] = fake.applyExternalEdits.mock.calls[0];
            expect(label).toBe("Accept Completion");
            expect(edits).toHaveLength(2);
            expect(edits[1].text).toContain("import { greet }");
        });

        it("молчащий resolve не блокирует вставку", async () => {
            const { service, fake } = setupImportable(() => new Promise(() => {}));

            await service.trigger();
            service.acceptSelected();
            await new Promise((res) => setTimeout(res, 350)); // дольше ACCEPT_RESOLVE_TIMEOUT_MS

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(1);
            expect(edits[0].text).toBe("greet");
        });
    });

    it("набор триггер-символа источника открывает попап как TriggerCharacter", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as { completionTriggerCharacters: readonly string[] }).completionTriggerCharacters = ["."];
        const { service, component } = createService(group);
        service.autoSuggestDelayMs = 0;
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);

        fake.type("d.", 2);
        await flushTimers();

        expect(source).toHaveBeenCalledWith(
            expect.objectContaining({
                triggerKind: CompletionTriggerKind.TriggerCharacter,
                triggerCharacter: ".",
            }),
        );
        expect(service.isOpen()).toBe(true);
    });

    it("триггер-символом считается только одиночная вставка нужного символа", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as { completionTriggerCharacters: readonly string[] }).completionTriggerCharacters = ["."];
        const { service, component } = createService(group);
        service.autoSuggestDelayMs = 0;
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);

        // Вставка блока (не одиночный символ) — не триггер.
        fake.type("d.foo.", 6);
        await flushTimers();
        expect(service.isOpen()).toBe(false);

        // Одиночный символ, но не из списка триггеров, и не word-символ.
        fake.type("d.foo.)", 7);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
        expect(source).not.toHaveBeenCalled();
    });

    it("расходящиеся range провайдеров → префикс считает ядро", async () => {
        // Два пункта с разными началами range: общей границы нет, значит
        // провайдеру верить нельзя и работает свой wordStart (иначе префикс
        // был бы случайным).
        const items: ICoreCompletionItem[] = [
            {
                label: "indent_style",
                insertText: "indent_style",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            },
            {
                label: "indent_size",
                insertText: "indent_size",
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
            },
        ];
        const { service, component, fake } = setup(items);
        await service.trigger();

        expect(service.isOpen()).toBe(true);
        service.acceptSelected();
        const [edits] = fake.applyExternalEdits.mock.calls[0];
        // Диапазон взят у самого пункта (он задан), а префикс — от wordStart.
        expect(edits[0].range.start).toEqual({ line: 0, character: 0 });
        expect(component.view.items).toHaveLength(2);
    });

    it("серверные filterText/sortText и единый range доезжают до виджета", async () => {
        // Форма ответа tsserver после точки: общий range у всех пунктов, лейбл
        // без точки, фильтрация и сортировка — по своим полям.
        const items: ICoreCompletionItem[] = [
            {
                label: "toISOString",
                insertText: ".toISOString",
                filterText: ".toISOString",
                sortText: "11",
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
            },
            {
                label: "getTime",
                insertText: ".getTime",
                filterText: ".getTime",
                sortText: "11",
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
            },
        ];
        const { service, component } = setup(items, "d.", 2, "d.");
        await service.trigger();

        expect(component.view.items[0].filterText).toBe(".toISOString");
        expect(component.view.items[0].sortText).toBe("11");
        // Префикс — от границы сервера (`.`), поэтому оба пункта видны, а
        // словами из буфера список не разбавлен. При равном sortText порядок
        // остаётся серверным (сервер уже отсортировал).
        expect(component.view.items.map((i) => i.label)).toEqual(["toISOString", "getTime"]);
    });

    it("триггер-символ при открытом попапе переоткрывает список, отменяя отложенный запрос", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as { completionTriggerCharacters: readonly string[] }).completionTriggerCharacters = ["."];
        const { service, component } = createService(group);
        service.autoSuggestDelayMs = 5;
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);

        await service.trigger(); // попап открыт
        expect(service.isOpen()).toBe(true);

        fake.type("di", 2); // запланировали авто-suggest…
        fake.type("di.", 3); // …и тут же набрали триггер-символ
        await flushTimers();

        expect(source).toHaveBeenLastCalledWith(
            expect.objectContaining({ triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: "." }),
        );
    });

    it("явный Ctrl+Space отменяет уже запланированный авто-запрос", async () => {
        const { service, source, fake } = setup(ITEMS);
        service.autoSuggestDelayMs = 50; // достаточно, чтобы успеть отменить

        fake.type("inde", 4); // запланировали авто-suggest
        await service.trigger(); // ручной триггер отменяет отложенный
        await flushTimers();

        expect(source).toHaveBeenCalledTimes(1); // отложенный не выстрелил вторым
    });

    it("range провайдера, начинающийся ПОСЛЕ каретки, отдаёт префикс ядру", async () => {
        // Такой range не описывает набранное слово (он правее каретки) — доверять
        // ему как границе префикса нельзя.
        const items: ICoreCompletionItem[] = [
            {
                label: "indent_style",
                insertText: "indent_style",
                range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } },
            },
        ];
        const { service, component } = setup(items);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        expect(component.view.items).toHaveLength(1);
    });

    it("неполный список перезапрашивается при доборе символа, а не сужается локально", async () => {
        const fake = makeEditor("ind", 3, "ind");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS, true)));
        const { service, component } = createService(makeGroup(fake.editor, source));
        service.autoSuggestDelayMs = 0;
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);

        await service.trigger();
        expect(source).toHaveBeenCalledTimes(1);

        fake.type("inde", 4);
        await flushTimers();

        // Сервер отфильтровал список под ПРЕЖНИЙ префикс — сужать его локально
        // нельзя, подходящих пунктов в нём может не быть вовсе.
        expect(source).toHaveBeenCalledTimes(2);
    });

    it("устаревший ответ источника не перекрывает свежий", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let resolveSlow: ((value: ICoreCompletionResult) => void) | null = null;
        const source = vi
            .fn<() => Promise<ICoreCompletionResult>>()
            .mockImplementationOnce(
                () =>
                    new Promise<ICoreCompletionResult>((res) => {
                        resolveSlow = res;
                    }),
            )
            .mockImplementation(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component } = createService(makeGroup(fake.editor, source));
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);

        const slow = service.trigger();
        await service.trigger(); // свежий запрос обгоняет медленный
        expect(service.isOpen()).toBe(true);

        service.hide();
        resolveSlow!(completionResult(ITEMS));
        await slow;

        // Медленный ответ пришёл последним — но он устарел и попап не поднимает.
        expect(service.isOpen()).toBe(false);
    });

    it("accept вставляет элемент, заменяя префикс, и исполняет item.command через CommandRegistry", async () => {
        const { service, fake, execute } = setup(ITEMS);
        await service.trigger();
        service.acceptSelected(); // принимает выбранный (indent_style)

        expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
        const [edits, label] = fake.applyExternalEdits.mock.calls[0];
        expect(label).toBe("Accept Completion");
        expect(edits).toHaveLength(1);
        expect(edits[0].text).toBe("indent_style");
        expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });

        await Promise.resolve();
        expect(execute).toHaveBeenCalledWith("ec._retrigger");
    });

    it("если префикс отфильтровал всё — показываем полный список", async () => {
        const { service, component } = setup(ITEMS, "zzz", 3);
        await service.trigger();
        expect(component.view.items).toHaveLength(3);
    });

    // Провайдер вправе прислать собственный range (vexx-settings накрывает им кавычки,
    // чтобы вставить `"editor.tabSize"` вместо голого ключа). Range — снапшот момента
    // триггера, а попап при доборе символов не перезапрашивается, поэтому его конец
    // обязан догонять каретку.
    describe("provider range", () => {
        /** Элемент с явным range на `"e` (кавычка + первая буква) в строке `{ "e`. */
        const QUOTED: ICoreCompletionItem[] = [
            {
                label: "editor.tabSize",
                insertText: '"editor.tabSize"',
                kind: 9,
                range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
            },
        ];

        it("уважает range провайдера, когда с триггера ничего не добрали", async () => {
            const { service, fake } = setup(QUOTED, '{ "e', 4);
            await service.trigger();
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].text).toBe('"editor.tabSize"');
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 4 } });
        });

        it("догоняет кареткой конец range, когда добрали символы после триггера", async () => {
            const { service, fake } = setup(QUOTED, '{ "e', 4);
            await service.trigger();
            expect(service.isOpen()).toBe(true);

            // Добираем `di` → `{ "edi`. Попап только ре-фильтруется, провайдера не
            // перезапрашиваем, поэтому его range всё ещё указывает на `"e`.
            fake.type('{ "edi', 6);
            expect(service.isOpen()).toBe(true);

            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].text).toBe('"editor.tabSize"');
            // Без сдвига заменилось бы только [2,4) и в буфере остался бы хвост `di`.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 6 } });
        });

        it("сдвигает конец range назад при удалении символа после триггера", async () => {
            const { service, fake } = setup(QUOTED, '{ "e', 4);
            await service.trigger();

            // Backspace → `{ "`. Каретка на границе префикса, попап остаётся открыт.
            fake.type('{ "', 3);
            expect(service.isOpen()).toBe(true);

            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            // Range сжался вслед за кареткой: заменяем `"`, а не `"e`.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 3 } });
        });

        it("многострочный range провайдера берётся как есть (посимвольный сдвиг неприменим)", async () => {
            const multiline: ICoreCompletionItem[] = [
                {
                    label: "editor.tabSize",
                    insertText: '"editor.tabSize"',
                    range: { start: { line: 0, character: 2 }, end: { line: 1, character: 4 } },
                },
            ];
            const { service, fake } = setup(multiline, '{ "e', 4);
            await service.trigger();
            fake.type('{ "edi', 6);
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 1, character: 4 } });
        });

        it("без range провайдера заменяет живой префикс", async () => {
            const { service, fake } = setup(ITEMS, "ind", 3);
            await service.trigger();
            fake.type("inde", 4);
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 4 } });
        });
    });

    it("word-based: без источника предлагает слова из документа", async () => {
        const fake = makeEditor("ind", 3, "indent_style indent_size root ab");
        const { service, component } = createService(makeGroup(fake.editor, undefined));
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        expect(component.view.items[0].kind).toBe(0);
    });

    it("word-based: собирает слова из всех открытых редакторов и дедупит с провайдерами", async () => {
        const fake = makeEditor("", 0, "alpha beta");
        const other = makeEditor("", 0, "beta gamma indent_style");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component } = createService(makeGroup(fake.editor, source, [other.editor]));
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();

        const labels = component.view.items.map((i) => i.label);
        expect(labels).toEqual(["indent_style", "indent_size", "root", "alpha", "beta", "gamma"]);
    });

    it("нет активного редактора → no-op", async () => {
        const group = {
            getActiveEditor: () => null,
            onActiveEditorChanged: () => ({ dispose: () => {} }),
            completionTriggerCharacters: [],
        } as unknown as EditorService;
        const { service, component } = createService(group);
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("hide() закрывает попап", async () => {
        const { service, body } = setup(ITEMS);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        service.hide();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        expect(service.isOpen()).toBe(false);
    });

    it("каретка вне вьюпорта (anchor null) → попап не открывается", async () => {
        const fake = makeEditor("ind", 3, "ind");
        fake.setAnchorNull(true);
        const { service, component } = createService(
            makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(ITEMS))),
            ),
        );
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("безымянный буфер уходит в запрос как untitled:-ресурс, а не пустой строкой", async () => {
        const fake = makeEditor("ind", 3, "ind");
        (fake.editor as unknown as { uri: Uri }).uri = Uri.parse("untitled:Untitled-1");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component } = createService(makeGroup(fake.editor, source));
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(source).toHaveBeenCalledWith(expect.objectContaining({ uri: "untitled:Untitled-1" }));
    });

    it("word-based пропускает несуществующий (null) редактор группы", async () => {
        const fake = makeEditor("", 0, "alpha beta");
        const group = {
            getActiveEditor: () => fake.editor,
            onActiveEditorChanged: () => ({ dispose: () => {} }),
            completionSource: undefined,
            completionTriggerCharacters: [],
            editorCount: 2, // но getEditor(1) === null
            getEditor: (i: number) => (i === 0 ? fake.editor : null),
        } as unknown as EditorService;
        const { service, component } = createService(group);
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(component.view.items.map((i) => i.label)).toEqual(["alpha", "beta"]);
    });

    it("accept без активного редактора (после close) — no-op", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        service.close(); // activeEditor = null, но список у view остаётся
        service.acceptSelected();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("accept элемента без command не дёргает CommandRegistry", async () => {
        const { service, fake, execute } = setup(ITEMS, "", 0, "");
        await service.trigger();
        service.selectNext();
        service.selectNext(); // к "root" (без command)
        service.acceptSelected();
        expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(execute).not.toHaveBeenCalled();
    });

    it("item.command без arguments исполняется c пустым списком аргументов", async () => {
        const items: ICoreCompletionItem[] = [{ label: "only", insertText: "only", command: { command: "c.noargs" } }];
        const { service, execute } = setup(items, "", 0, "");
        await service.trigger();
        service.acceptSelected();
        await Promise.resolve();
        expect(execute).toHaveBeenCalledWith("c.noargs");
    });

    // ─── Re-filter по мере набора (попап открыт) ───────────────────────────────

    it("набор сужает список и попап следует за кареткой", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        expect(component.view.items).toHaveLength(2);
        fake.type("indent_st", 9); // префикс расширился — сужаем до одного
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style"]);
        expect(service.isOpen()).toBe(true);
    });

    it("набор без совпадений оставляет последний непустой список (не закрывает)", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        fake.type("indz", 4); // ничего не матчит
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        expect(service.isOpen()).toBe(true);
    });

    it("смена строки закрывает попап", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.move(1, 0); // ушли на другую строку
        expect(service.isOpen()).toBe(false);
    });

    it("непустое выделение закрывает попап", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.setSelection(1, 3); // anchor != active
        expect(service.isOpen()).toBe(false);
    });

    it("каретка ушла из вьюпорта при наборе закрывает попап", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.setAnchorNull(true);
        fake.type("indent", 6);
        expect(service.isOpen()).toBe(false);
    });

    // ─── Авто-suggest (попап закрыт) ───────────────────────────────────────────

    it("набор word-символа авто-открывает попап", async () => {
        const { service, fake, source } = setup(ITEMS); // старт: "ind", каретка 3
        expect(service.isOpen()).toBe(false);
        fake.type("inde", 4); // вставлен один word-символ
        await flushTimers();
        expect(source).toHaveBeenCalled();
        expect(service.isOpen()).toBe(true);
    });

    it("чистое движение каретки НЕ открывает попап", async () => {
        const { service, fake, source } = setup(ITEMS);
        fake.move(0, 2); // без content-изменения
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("принятие пункта не приводит к авто-переоткрытию", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        service.acceptSelected(); // close() + suppress + applyExternalEdits (mock, без эмита)
        // Эмулируем правку accept как одиночную вставку у каретки — авто-suggest подавлен.
        fake.type("indent_style2", 13);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
    });

    it("onFocusChanged(false) закрывает открытый попап", async () => {
        const { service } = setup(ITEMS);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        service.onFocusChanged(false); // фокус ушёл с редактора
        expect(service.isOpen()).toBe(false);
    });

    it("клик по пункту (view.onAccept) принимает через сервис", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        // Клик по первому ряду (localY=1) → view.onAccept → service.accept.
        component.view.dispatchEvent(
            new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 1, localX: 5, localY: 1 }),
        );
        expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
    });

    it("selectPrevious / page-навигация делегируются в view", async () => {
        const items = Array.from({ length: 15 }, (_, i) => ({ label: `w${i}`, insertText: `w${i}` }));
        const { service, component } = setup(items, "", 0, "");
        await service.trigger();
        component.view.maxVisibleItems = 5;
        service.selectNextPage();
        expect(component.view.selectedIndex).toBe(5);
        service.selectPreviousPage();
        expect(component.view.selectedIndex).toBe(0);
        service.selectNext();
        service.selectPrevious();
        expect(component.view.selectedIndex).toBe(0);
    });

    it("смена активного редактора закрывает открытый попап", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let activeCb: (e: TextEditorPane | null) => void = () => {};
        const group = {
            getActiveEditor: () => fake.editor,
            onActiveEditorChanged: (cb: (e: TextEditorPane | null) => void) => {
                activeCb = cb;
                return { dispose: () => {} };
            },
            completionSource: vi.fn(() => Promise.resolve(completionResult(ITEMS))),
            completionTriggerCharacters: [],
            editorCount: 1,
            getEditor: (i: number) => (i === 0 ? fake.editor : null),
        } as unknown as EditorService;
        const { service, component } = createService(group);
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        activeCb(fake.editor); // onActiveEditorChanged → bindEditor закрывает попап
        expect(service.isOpen()).toBe(false);
    });

    it("изменение каретки при отсутствии активного редактора — no-op", () => {
        const fake = makeEditor("ind", 3, "ind");
        let ref: TextEditorPane | null = fake.editor;
        const group = {
            getActiveEditor: () => ref,
            onActiveEditorChanged: () => ({ dispose: () => {} }),
            completionSource: undefined,
            completionTriggerCharacters: [],
            editorCount: 1,
            getEditor: () => fake.editor,
        } as unknown as EditorService;
        const { service, component } = createService(group);
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        ref = null; // активный редактор пропал
        fake.type("inde", 4); // fires cursor listener → onCaretChanged, getActiveEditor()===null
        expect(service.isOpen()).toBe(false);
    });

    it("набор небуквенного символа (граница слова) закрывает открытый попап", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.type("ind ", 4); // пробел сдвинул начало слова → wordStart != prefixStart
        expect(service.isOpen()).toBe(false);
    });

    it("авто-suggest не срабатывает при не-одиночной/небуквенной вставке", async () => {
        // Каждая ветка эвристики isSingleWordCharInsert, из закрытого состояния.
        const cases: [string, number, number][] = [
            ["x", 1, 1], // другая строка
            ["indee", 5, 0], // каретка не +1
            ["inXde", 4, 0], // длина не +1 (вставка не у каретки)
            ["ind ", 4, 0], // небуквенный символ
        ];
        for (const [line, ch, lineNo] of cases) {
            const { service, fake, source } = setup(ITEMS); // кэш: "ind", каретка 3
            fake.type(line, ch, lineNo);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
            expect(service.isOpen()).toBe(false);
        }
    });

    it("acceptSelected без выбранного пункта — no-op", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        component.view.setFilter("zzzz"); // список пуст → getSelectedItem null
        service.acceptSelected();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("активный редактор пропал при открытом попапе — закрывает", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let ref: TextEditorPane | null = fake.editor;
        const group = {
            getActiveEditor: () => ref,
            onActiveEditorChanged: () => ({ dispose: () => {} }),
            completionSource: vi.fn(() => Promise.resolve(completionResult(ITEMS))),
            completionTriggerCharacters: [],
            editorCount: 1,
            getEditor: () => fake.editor,
        } as unknown as EditorService;
        const { service, component } = createService(group);
        const body = new BodyElement();
        TestApp.create(body, new Size(80, 24));
        component.attachHost(body);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        ref = null; // активный редактор пропал
        fake.type("inde", 4); // onCaretChanged: editor null && isOpen → close
        expect(service.isOpen()).toBe(false);
    });

    it("конструктор с непустым начальным выделением безопасен", () => {
        const fake = makeEditor("ind", 3, "ind", 1); // anchor=1, active=3 (не collapsed)
        const { service } = createService(makeGroup(fake.editor, undefined));
        expect(service.isOpen()).toBe(false);
    });
});
