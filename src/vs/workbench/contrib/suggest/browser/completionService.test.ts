import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter, Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { ILineTokens } from "../../../../editor/common/languages/iLineTokens.ts";
import { createLineTokens, createToken } from "../../../../editor/common/languages/iLineTokens.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { isValidConfigurationValue } from "../../../../platform/configuration/common/configurationValidation.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";

import { CompletionService, type IInlineSuggestionsState } from "./completionService.ts";
import { SuggestComponent } from "./suggestComponent.ts";

interface FakeEditor {
    editor: TextEditorPane;
    applyExternalEdits: ReturnType<typeof vi.fn<(edits: ITextEdit[], label: string) => void>>;
    /**
     * Набор с клавиатуры: обновляет строку/каретку, шлёт content+cursor, а затем
     * `onDidType` символом слева от каретки (как редактор после правки набора).
     */
    type: (line: string, character: number, lineNo?: number) => void;
    /** Правка мимо набора (вставка, accept, удаление): content+cursor без `onDidType`. */
    edit: (line: string, character: number, lineNo?: number) => void;
    /** Только `onDidType` — набор, оставивший выделение (auto-surround). */
    fireTyped: (text: string) => void;
    /** Чистое движение каретки: шлёт только cursor (без content-маркера). */
    move: (lineNo: number, character: number) => void;
    /** Непустое выделение: anchor != active. */
    setSelection: (anchorChar: number, activeChar: number) => void;
    /** Мультикурсор: сколько кареток отдаёт `viewState.selections`. */
    setCursorCount: (count: number) => void;
    setAnchorNull: (value: boolean) => void;
    /** Токены строки каретки (как их отдаёт `viewState.tokenStore`); `undefined` — стора нет. */
    setTokens: (tokens: ILineTokens | undefined) => void;
}

function makeEditor(lineContent: string, character: number, docText = lineContent, anchorChar = character): FakeEditor {
    const state: {
        line: string;
        lineNo: number;
        anchorChar: number;
        activeChar: number;
        tokens: ILineTokens | undefined;
    } = { line: lineContent, lineNo: 0, anchorChar, activeChar: character, tokens: undefined };
    // Версия модели: запрос к провайдеру несёт её вместо текста; печать её поднимает.
    const document = { versionId: 1 };
    let anchorNull = false;
    let cursorCount = 1;
    const contentListeners: (() => void)[] = [];
    const cursorListeners: (() => void)[] = [];
    const typeListeners: ((text: string) => void)[] = [];
    const applyExternalEdits = vi.fn<(edits: ITextEdit[], label: string) => void>();

    const editor = {
        get viewState() {
            return {
                selections: Array.from({ length: cursorCount }, (_, i) => ({
                    anchor: { line: state.lineNo + i, character: state.anchorChar },
                    active: { line: state.lineNo + i, character: state.activeChar },
                })),
                document: { getLineContent: (_line: number) => state.line },
                tokenStore:
                    state.tokens === undefined
                        ? undefined
                        : { tokenizeUpTo: () => undefined, getLineTokens: () => state.tokens },
            };
        },
        getText: () => docText,
        model: { document },
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
        onDidType: (l: (text: string) => void) => {
            typeListeners.push(l);
            return { dispose: () => typeListeners.splice(typeListeners.indexOf(l), 1) };
        },
    } as unknown as TextEditorPane;

    const fireContent = (): void => {
        for (const l of [...contentListeners]) l();
    };
    const fireCursor = (): void => {
        for (const l of [...cursorListeners]) l();
    };

    const fireTyped = (text: string): void => {
        for (const l of [...typeListeners]) l(text);
    };
    const edit = (line: string, ch: number, lineNo = 0): void => {
        state.line = line;
        state.lineNo = lineNo;
        state.anchorChar = ch;
        state.activeChar = ch;
        document.versionId++;
        fireContent();
        fireCursor();
    };

    return {
        editor,
        applyExternalEdits,
        type: (line, ch, lineNo = 0) => {
            edit(line, ch, lineNo);
            fireTyped(line.slice(ch - 1, ch));
        },
        edit,
        fireTyped,
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
        setAnchorNull: (value) => {
            anchorNull = value;
        },
        setTokens: (tokens) => {
            state.tokens = tokens;
        },
    };
}

/** Ответ источника «полным списком» — форма {@link ICoreCompletionResult}. */
function completionResult(items: readonly ICoreCompletionItem[], isIncomplete = false): ICoreCompletionResult {
    return { items, isIncomplete };
}

type FakeCompletionSource = CompletionItemProvider["provideCompletionItems"] | undefined;
type FakeCompletionResolver = ((id: string) => Promise<ICoreResolvedCompletion | null>) | undefined;

/**
 * Языковые «швы» фейковой группы: тесты задают источник, resolve и триггеры
 * прямо на ней (и меняют по ходу), а {@link createService} превращает их в
 * провайдера реестра под `*` — ровно то, что в проде делает прокси расширения.
 */
interface IFakeLanguageSeams {
    completionSource?: FakeCompletionSource;
    completionResolver?: FakeCompletionResolver;
    completionTriggerCharacters?: readonly string[];
}

/** Реестр с одним провайдером, читающим швы группы на каждый вызов. */
function languageFeaturesOf(group: IEditorService): LanguageFeaturesService {
    const seams = group as unknown as IFakeLanguageSeams;
    const languageFeatures = new LanguageFeaturesService();
    if (seams.completionSource === undefined && seams.completionResolver === undefined) return languageFeatures;
    languageFeatures.completionProvider.register("*", {
        get triggerCharacters() {
            return seams.completionTriggerCharacters ?? [];
        },
        provideCompletionItems: (request, token) =>
            seams.completionSource?.(request, token) ?? Promise.resolve(completionResult([])),
        get resolveCompletionItem() {
            return seams.completionResolver;
        },
    });
    return languageFeatures;
}

function makeGroup(
    editor: TextEditorPane,
    source: FakeCompletionSource,
    extraEditors: TextEditorPane[] = [],
): IEditorService {
    const all = [editor, ...extraEditors];
    return {
        getActiveEditor: () => editor,
        onActiveEditorChanged: () => ({ dispose: () => {} }),
        completionSource: source,
        completionTriggerCharacters: [],
        getEditors: () => all,
    } as unknown as IEditorService;
}

/**
 * Состояние в памяти: NULL_STATE_SERVICE всегда отдаёт дефолт и не годится там,
 * где проверяется «выбор пользователя переживает рестарт».
 */
function makeStateService(): IStateService {
    const store = new Map<string, unknown>();
    return {
        get: <T>(descriptor: IStateDescriptor<T>): T =>
            (store.get(descriptor.key) as T | undefined) ?? descriptor.default,
        store: <T>(descriptor: IStateDescriptor<T>, value: T): void => {
            store.set(descriptor.key, value);
        },
        remove: () => undefined,
        openWorkspace: () => undefined,
        flushSync: () => undefined,
        dispose: () => undefined,
        onDidOpenWorkspace: Event.None,
    };
}

/** Схемы ключей приложения — по ним заглушка конфига отдаёт дефолты и отбраковывает мусор. */
const APP_SCHEMAS = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getConfigurationProperties();

/**
 * Настройки теста: плоские ключи и секции языков (`"[json]": {…}`). Живые —
 * сервис читает их на каждом обращении, тест вправе менять по ходу.
 */
type TestSettings = Record<string, unknown>;

const settingsOf = new WeakMap<CompletionService, TestSettings>();

/**
 * Конфиг поверх {@link TestSettings}: значение секции языка главнее плоского,
 * значение вне схемы ключа (и отсутствующее) — дефолт схемы, как у настоящего сервиса.
 */
function makeConfiguration(settings: TestSettings): IConfigurationService {
    return {
        get: (key: string, overrides?: IConfigurationOverrides): unknown => {
            const section =
                overrides?.overrideIdentifier === undefined
                    ? undefined
                    : (settings[`[${overrides.overrideIdentifier}]`] as TestSettings | undefined);
            const raw = section?.[key] ?? settings[key];
            const schema = APP_SCHEMAS.get(key);
            if (schema === undefined) return raw;
            return raw !== undefined && isValidConfigurationValue(schema, raw) ? raw : schema.default;
        },
    } as unknown as IConfigurationService;
}

/** Меняет настройку уже созданного сервиса (live-reload в проде). */
function setSetting(service: CompletionService, key: string, value: unknown): void {
    const settings = settingsOf.get(service);
    if (settings === undefined) throw new Error("сервис создан мимо createService");
    settings[key] = value;
}

/**
 * Сервис с конфигом теста. Дефолт задержки quick suggest — 0: авто-suggest
 * детерминированно срабатывает на следующем тике.
 */
function newService(
    component: SuggestComponent,
    group: IEditorService,
    commands: CommandRegistry,
    state: IStateService,
    focusTracker: FocusTracker,
    languageFeatures: LanguageFeaturesService,
    initial: TestSettings = {},
): CompletionService {
    const settings: TestSettings = { "editor.quickSuggestionsDelay": 0, ...initial };
    const service = new CompletionService(
        component,
        group,
        commands,
        state,
        focusTracker,
        languageFeatures,
        makeConfiguration(settings),
    );
    settingsOf.set(service, settings);
    return service;
}

/** Пара component+service с фейковым CommandRegistry (шпион `execute`). */
function createService(
    group: IEditorService,
    state: IStateService = makeStateService(),
    settings: TestSettings = {},
    languageFeatures: LanguageFeaturesService = languageFeaturesOf(group),
): {
    service: CompletionService;
    component: SuggestComponent;
    body: BodyElement;
    execute: ReturnType<typeof vi.fn>;
    focusTracker: FocusTracker;
} {
    const execute = vi.fn();
    const commands = { execute } as unknown as CommandRegistry;
    // Корневая view — хост попапа: компонент создаёт сессию на её слое сразу.
    const body = new BodyElement();
    const component = new SuggestComponent(testLayoutService(body));
    const focusTracker = new FocusTracker();
    const service = newService(component, group, commands, state, focusTracker, languageFeatures, settings);
    return { service, component, body, execute, focusTracker };
}

function setup(items: readonly ICoreCompletionItem[], lineContent = "ind", character = 3, docText = lineContent) {
    const fake = makeEditor(lineContent, character, docText);
    const source = vi.fn(() => Promise.resolve(completionResult(items)));
    const group = makeGroup(fake.editor, source);

    const { service, component, execute, focusTracker, body } = createService(group);
    const testApp = TestApp.create(body, new Size(80, 24));
    return { service, component, body, testApp, fake, source, execute, focusTracker, editor: fake.editor };
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
        const { service, component, body } = createService(makeGroup(fake.editor, undefined));
        TestApp.create(body, new Size(80, 24));
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

    it("префикс — слово под кареткой, а не вся строка до неё", async () => {
        const { service, component, fake } = setup(ITEMS, "x = ind", 7);
        await service.trigger();
        // Фильтр по всей строке `x = ind` не нашёл бы ничего и откатился бы к полному списку с `root`.
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);

        service.acceptSelected();
        const [edits] = fake.applyExternalEdits.mock.calls[0];
        // Заменяется только слово `ind`, присваивание слева не трогаем.
        expect(edits[0].range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 7 } });
    });

    it("onDidClose фаерится на закрытии ОТКРЫТОГО попапа и молчит на холостых close", async () => {
        const { service } = setup(ITEMS);
        const closed = vi.fn();
        const subscription = service.onDidClose(closed);

        // Попап ещё не открывался — close() (его зовут либерально, например
        // bindEditor) не должен изображать событие закрытия.
        service.close();
        expect(closed).not.toHaveBeenCalled();

        await service.trigger();
        expect(service.isOpen()).toBe(true);
        service.hide(); // Esc-путь сходится в close()
        expect(closed).toHaveBeenCalledTimes(1);

        // Повторное закрытие уже закрытого — не событие.
        service.close();
        expect(closed).toHaveBeenCalledTimes(1);

        // Отписка снимает слушателя; повторный dispose — безвредный no-op и
        // НЕ задевает других подписчиков (splice(-1) снял бы последнего).
        const other = vi.fn();
        service.onDidClose(other);
        await service.trigger();
        subscription.dispose();
        subscription.dispose();
        service.close();
        expect(closed).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(1);
    });

    it("передаёт корректный запрос источнику: версия документа вместо текста", async () => {
        const { service, source, fake } = setup(ITEMS);
        fake.type("ind", 3); // версия 2: запрос берёт текущую, а не начальную
        service.close();
        source.mockClear();
        await service.trigger();
        expect(source).toHaveBeenCalledWith(
            {
                uri: Uri.file("/proj/.editorconfig").toString(),
                languageId: "editorconfig",
                versionId: 2,
                line: 0,
                character: 3,
                triggerKind: CompletionTriggerKind.Invoke,
            },
            expect.anything(),
        );
    });

    describe("панель описания", () => {
        const RESOLVABLE: ICoreCompletionItem[] = [
            { label: "indent_style", insertText: "indent_style", id: "1.0", kind: 9 },
            { label: "indent_size", insertText: "indent_size", id: "1.1", kind: 9 },
        ];

        function setupWithResolver(
            resolver: FakeCompletionResolver,
            state = makeStateService(),
        ): ReturnType<typeof createService> & { fake: FakeEditor; body: BodyElement } {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            (group as unknown as IFakeLanguageSeams).completionResolver = resolver;
            const created = createService(group, state);
            const body = created.body;
            TestApp.create(body, new Size(120, 24));
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
            const first = setupWithResolver(
                vi.fn(() => Promise.resolve(null)),
                state,
            );
            await first.service.trigger();
            first.service.toggleDetails();
            expect(first.component.detailsVisible).toBe(true);

            const second = setupWithResolver(
                vi.fn(() => Promise.resolve(null)),
                state,
            );
            expect(second.component.detailsVisible).toBe(true);
        });

        it("у края экрана панель уезжает влево от списка", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            (group as unknown as IFakeLanguageSeams).completionResolver = () =>
                Promise.resolve({ detail: "(property) indent_style" });
            const { service, component, body } = createService(group);
            // Узкий экран: справа от каретки (screenX=5) виджет с панелью не влезает.
            TestApp.create(body, new Size(30, 24));

            service.toggleDetails();
            await service.trigger();
            await flushTimers();

            expect(component.widget.detailsSide).toBe("left");
        });

        it("при нулевой ширине корня сторона панели не пересчитывается", () => {
            const fake = makeEditor("ind", 3, "ind");
            const { component, body } = createService(makeGroup(fake.editor, undefined));
            // Корень разложен в ширину 0: «справа не помещается» было бы правдой
            // для любого якоря, но переворачивать панель по такой ширине нельзя.
            body.layout(BoxConstraints.tight(new Size(0, 24)));
            component.openAt({ screenX: 5, screenY: 5, preferBelow: true });
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
            const { service, component, body } = createService(group); // completionResolver не задан
            TestApp.create(body, new Size(120, 24));

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
            const { service, component, body } = createService(
                makeGroup(
                    fake.editor,
                    vi.fn(() => Promise.resolve(completionResult(items))),
                ),
            );
            TestApp.create(body, new Size(120, 24));

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
            const { service, component, body } = createService(
                makeGroup(
                    fake.editor,
                    vi.fn(() => Promise.resolve(completionResult(items))),
                ),
            );
            TestApp.create(body, new Size(120, 24));

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

        function setupImportable(
            resolver: FakeCompletionResolver,
            items: readonly ICoreCompletionItem[] = IMPORTABLE,
        ): {
            service: CompletionService;
            fake: FakeEditor;
        } {
            const fake = makeEditor("gree", 4, "gree");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(items))),
            );
            (group as unknown as IFakeLanguageSeams).completionResolver = resolver;
            const { service, component, body } = createService(group);
            TestApp.create(body, new Size(120, 24));
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

        it("провайдер без resolve — вставка сразу, без ожидания", async () => {
            const { service, fake } = setupImportable(undefined);

            await service.trigger();
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(1);
            expect(edits[0].text).toBe("greet");
        });

        it("пункт без id resolve не зовёт ни на выборе, ни на вставке", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "greet", additionalEdits: [IMPORT_EDIT] }));
            const { service, fake } = setupImportable(resolver, [{ label: "greet", insertText: "greet", kind: 2 }]);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.acceptSelected();
            await flushTimers();

            expect(resolver).not.toHaveBeenCalled();
            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(1);
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
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));

        fake.type("d.", 2);
        await flushTimers();

        expect(source).toHaveBeenCalledWith(
            expect.objectContaining({
                triggerKind: CompletionTriggerKind.TriggerCharacter,
                triggerCharacter: ".",
            }),
            expect.anything(),
        );
        expect(service.isOpen()).toBe(true);
    });

    it("триггер-символ провайдера чужого языка попап не открывает и RPC не будит", async () => {
        const fake = makeEditor("d", 1, "d"); // документ на editorconfig
        const provide = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const languageFeatures = new LanguageFeaturesService();
        languageFeatures.completionProvider.register("python", {
            triggerCharacters: ["."],
            provideCompletionItems: provide,
        });
        const group = makeGroup(fake.editor, undefined);
        const body = new BodyElement();
        const component = new SuggestComponent(testLayoutService(body));
        const commands = { execute: vi.fn() } as unknown as CommandRegistry;
        const service = newService(
            component,
            group,
            commands,
            makeStateService(),
            new FocusTracker(),
            languageFeatures,
        );
        TestApp.create(body, new Size(80, 24));

        fake.type("d.", 2);
        await flushTimers();

        expect(provide).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("триггер-символом считается только одиночная вставка нужного символа", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));

        // Вставка блока (не набор) — не триггер, хотя кончается на `.`.
        fake.edit("d.foo.", 6);
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
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, component, body } = createService(group);
        setSetting(service, "editor.quickSuggestionsDelay", 5);
        TestApp.create(body, new Size(80, 24));

        await service.trigger(); // попап открыт
        expect(service.isOpen()).toBe(true);

        fake.type("di", 2); // запланировали авто-suggest…
        fake.type("di.", 3); // …и тут же набрали триггер-символ
        await flushTimers();

        expect(source).toHaveBeenLastCalledWith(
            expect.objectContaining({ triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: "." }),
            expect.anything(),
        );
    });

    it("явный Ctrl+Space отменяет уже запланированный авто-запрос", async () => {
        const { service, source, fake } = setup(ITEMS);
        setSetting(service, "editor.quickSuggestionsDelay", 50); // достаточно, чтобы успеть отменить

        fake.type("inde", 4); // запланировали авто-suggest
        await service.trigger(); // ручной триггер отменяет отложенный
        // Ждём заведомо дольше задержки: без отмены отложенный успел бы выстрелить.
        await new Promise((resolve) => setTimeout(resolve, 100));

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
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

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
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        const slow = service.trigger();
        await service.trigger(); // свежий запрос обгоняет медленный
        expect(service.isOpen()).toBe(true);

        service.hide();
        resolveSlow!(completionResult(ITEMS));
        await slow;

        // Медленный ответ пришёл последним — но он устарел и попап не поднимает.
        expect(service.isOpen()).toBe(false);
    });

    it("ответ, пришедший после закрытия, попап не поднимает", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let resolveSlow: ((value: ICoreCompletionResult) => void) | null = null;
        const source = vi.fn<() => Promise<ICoreCompletionResult>>(
            () =>
                new Promise<ICoreCompletionResult>((res) => {
                    resolveSlow = res;
                }),
        );
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        const pending = service.trigger();
        // Запрос в полёте, попап ещё не открыт — закрытие гасит именно запрос.
        service.close();
        resolveSlow!(completionResult(ITEMS));
        await pending;

        expect(service.isOpen()).toBe(false);
    });

    it("закрытие попапа отменяет запрос и у провайдера", () => {
        const fake = makeEditor("ind", 3, "ind");
        const tokens: ICancellationToken[] = [];
        const source = vi.fn((_request: ICompletionRequest, token: ICancellationToken) => {
            tokens.push(token);
            return new Promise<ICoreCompletionResult>(() => undefined);
        });
        const { service, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        void service.trigger();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        service.close();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    // Срока ответа у провайдеров нет (language server на холодном старте думает
    // секунды), поэтому запрос «в полёте» обязан сам знать, нужен ли ещё ответ.
    describe("запрос в полёте: ответа ещё нет, попап не открыт", () => {
        /** Источник, отвечающий по команде теста; токены запросов — в `cancelled()`. */
        function pendingSetup(line: string, character: number) {
            const fake = makeEditor(line, character, line);
            const tokens: ICancellationToken[] = [];
            const answers: ((value: ICoreCompletionResult) => void)[] = [];
            const source = vi.fn((_request: ICompletionRequest, token: ICancellationToken) => {
                tokens.push(token);
                return new Promise<ICoreCompletionResult>((res) => {
                    answers.push(res);
                });
            });
            const group = makeGroup(fake.editor, source);
            const { service, component, body, focusTracker } = createService(group);
            // Перезапрос по набору в этих тестах не нужен: смотрим на судьбу ПЕРВОГО запроса.
            setSetting(service, "editor.quickSuggestionsDelay", 10_000);
            TestApp.create(body, new Size(80, 24));
            const cancelled = (): boolean[] => tokens.map((token) => token.isCancellationRequested);
            return { fake, service, component, focusTracker, group, source, answers, cancelled };
        }

        it("медленный ответ дожидается и открывает попап пунктами провайдера, а не словами буфера", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            // Сколько бы сервер ни думал — попапа со словами буфера вместо него нет.
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(h.service.isOpen()).toBe(false);
            expect(h.cancelled()).toEqual([false]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        });

        it("каретка ушла на другую строку — запрос отменён, опоздавший ответ попап не поднимает", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.move(1, 3);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("шаг каретки влево от точки запроса отменяет запрос", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.move(0, 2);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("выделение и мультикурсор отменяют запрос", () => {
            const selected = pendingSetup("ind", 3);
            void selected.service.trigger();
            selected.fake.setSelection(1, 3);
            expect(selected.cancelled()).toEqual([true]);

            const multi = pendingSetup("ind", 3);
            void multi.service.trigger();
            multi.fake.setCursorCount(2);
            expect(multi.cancelled()).toEqual([true]);
        });

        it("несловесный добор (пробел) отменяет запрос", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.type("ind ", 4);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("событие каретки без сдвига запрос не трогает", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.move(0, 3);
            expect(h.cancelled()).toEqual([false]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(true);
        });

        it("добор слова, пока ждали ответ: список сужен под набранное, accept заменяет всё слово", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.type("inden", 5); // словесный добор запрос переживает
            expect(h.cancelled()).toEqual([false]);

            h.answers[0](completionResult([...ITEMS, { label: "index", insertText: "index" }]));
            await pending;

            // Фильтр — по живому префиксу `inden`, а не по снимку `ind` момента запроса.
            expect(h.component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
            h.service.acceptSelected();
            const [edits] = h.fake.applyExternalEdits.mock.calls[0];
            // Снимок оставил бы в буфере хвост `en`.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } });
        });

        it("добор при провайдерском range: конец range догоняет каретку от точки ЗАПРОСА", async () => {
            const h = pendingSetup('{ "e', 4);
            const pending = h.service.trigger();
            h.fake.type('{ "edi', 6);

            h.answers[0](
                completionResult([
                    {
                        label: "editor.tabSize",
                        insertText: '"editor.tabSize"',
                        filterText: '"editor.tabSize"',
                        range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
                    },
                ]),
            );
            await pending;
            expect(h.service.isOpen()).toBe(true);

            h.service.acceptSelected();
            const [edits] = h.fake.applyExternalEdits.mock.calls[0];
            // Провайдер видел `"e` (range [2,4)); два добранных символа сдвигают конец на 2.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 6 } });
        });

        it("уход фокуса с редактора отменяет запрос", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
            expect(h.cancelled()).toEqual([false]);
            h.focusTracker.fire(null);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("триггер-символ отменяет запрос прежнего слова: его ответ не поднимает старый список", async () => {
            const h = pendingSetup("re", 2);
            (h.group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
            const pending = h.service.trigger();
            h.fake.type("re.", 3); // «.» — словесный символ ядра, но для сервера это новый запрос
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });
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

    // Провайдер вправе прислать собственный range (diode-settings накрывает им кавычки,
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
            fake.edit('{ "', 3);
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

    // Пока попап видим, Enter принадлежит `acceptSelectedSuggestion`
    // (when: suggestWidgetVisible) — открытый «на всякий случай» попап крадёт
    // перенос строки и заменяет набранное пунктом списка. Поэтому любой
    // несловесный добор обязан его закрывать, в том числе когда границу
    // префикса задал провайдер (её пересчёт запрещён, см. refilterOpen).
    describe("несловесный добор закрывает попап", () => {
        /** Пункты tsserver-формы: у всех общий range, то есть граница «от провайдера». */
        const PROVIDER_ANCHORED: ICoreCompletionItem[] = [
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

        it("`{` после провайдерского префикса закрывает попап (Enter снова печатает)", async () => {
            const { service, fake } = setup(PROVIDER_ANCHORED, "cons", 4, "cons");
            await service.trigger();
            expect(service.isOpen()).toBe(true);

            fake.type("cons{", 5);

            expect(service.isOpen()).toBe(false);
        });

        it("тот же добор буквами попап не трогает", async () => {
            const { service, fake } = setup(PROVIDER_ANCHORED, "cons", 4, "cons");
            await service.trigger();

            fake.type("conso", 5);

            expect(service.isOpen()).toBe(true);
        });

        it("`(` и пробел закрывают его так же", async () => {
            for (const tail of ["(", " "]) {
                const { service, fake } = setup(PROVIDER_ANCHORED, "cons", 4, "cons");
                await service.trigger();
                expect(service.isOpen()).toBe(true);

                fake.type(`cons${tail}`, 5);

                expect(service.isOpen()).toBe(false);
            }
        });
    });

    it("word-based: без источника предлагает слова из документа", async () => {
        const fake = makeEditor("ind", 3, "indent_style indent_size root ab");
        const { service, component, body } = createService(makeGroup(fake.editor, undefined));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        expect(component.view.items[0].kind).toBe(0);
    });

    it("word-based: слова не подмешиваются к пунктам с провайдерским range", async () => {
        const items: ICoreCompletionItem[] = [
            {
                label: "indent_style",
                insertText: "indent_style",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            },
        ];
        const { service, component } = setup(items, "ind", 3, "ind indigo");
        await service.trigger();
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style"]);
    });

    it("word-based: собирает слова из всех открытых редакторов и дедупит с провайдерами", async () => {
        const fake = makeEditor("", 0, "alpha beta");
        const other = makeEditor("", 0, "beta gamma indent_style");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component, body } = createService(makeGroup(fake.editor, source, [other.editor]));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();

        const labels = component.view.items.map((i) => i.label);
        expect(labels).toEqual(["indent_style", "indent_size", "root", "alpha", "beta", "gamma"]);
    });

    it("нет активного редактора → no-op", async () => {
        const group = {
            getActiveEditor: () => null,
            onActiveEditorChanged: () => ({ dispose: () => {} }),
            completionTriggerCharacters: [],
        } as unknown as IEditorService;
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));
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
        const { service, component, body } = createService(
            makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(ITEMS))),
            ),
        );
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("безымянный буфер уходит в запрос как untitled:-ресурс, а не пустой строкой", async () => {
        const fake = makeEditor("ind", 3, "ind");
        (fake.editor as unknown as { uri: Uri }).uri = Uri.parse("untitled:Untitled-1");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(source).toHaveBeenCalledWith(expect.objectContaining({ uri: "untitled:Untitled-1" }), expect.anything());
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
        fake.type("indq", 4); // ничего не матчит
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

    it("мультикурсор закрывает попап и не даёт открыть его заново", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.setCursorCount(2);
        expect(service.isOpen()).toBe(false);

        // Ручной Ctrl+Space тоже обязан быть no-op: попап якорится на одной каретке,
        // а accept вставил бы правку мимо остальных.
        await service.trigger();
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

    it("движение каретки при закрытом попапе не снимает запланированный авто-запрос", async () => {
        const { service, fake, source } = setup(ITEMS);
        setSetting(service, "editor.quickSuggestionsDelay", 20);
        fake.type("inde", 4); // запланировали авто-suggest
        fake.move(0, 4); // каретка дёрнулась до срабатывания таймера
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(source).toHaveBeenCalled();
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
        service.acceptSelected(); // close() + applyExternalEdits (mock, без эмита)
        // Правка accept — не набор: события `onDidType` у неё нет, авто-suggest молчит.
        fake.edit("indent_style2", 13);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
    });

    it("уход фокуса с редактора закрывает открытый попап, фокус в редакторе — нет", async () => {
        const { service, focusTracker } = setup(ITEMS);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
        expect(service.isOpen()).toBe(true);
        focusTracker.fire(null); // фокус ушёл с редактора
        expect(service.isOpen()).toBe(false);
    });

    it("suggestWidgetVisible — открыт ли попап", async () => {
        const { service } = setup(ITEMS);
        const keys = new ContextKeyService();
        service.updateContextKeys(keys);
        expect(keys.get("suggestWidgetVisible")).toBe(false);
        await service.trigger();
        service.updateContextKeys(keys);
        expect(keys.get("suggestWidgetVisible")).toBe(true);
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
            getEditors: () => [fake.editor],
        } as unknown as IEditorService;
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        activeCb(fake.editor); // onActiveEditorChanged → bindEditor закрывает попап
        expect(service.isOpen()).toBe(false);
    });

    it("набор небуквенного символа (граница слова) закрывает открытый попап", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.type("ind ", 4); // пробел — несловесный добор
        expect(service.isOpen()).toBe(false);
    });

    it("уехавшее начало слова закрывает попап, даже когда добора не было", async () => {
        // Правка ЛЕВЕЕ каретки (удалили пробел перед словом): добора с триггера
        // нет, поэтому проверку «добор словесный» этот путь проходит, а слово
        // теперь начинается не там, где встал префикс.
        const { service, fake } = setup(ITEMS, "a ind", 5, "a ind");
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.edit("aind", 4);

        expect(service.isOpen()).toBe(false);
    });

    it("авто-suggest открывает только набор word-символа одной кареткой", async () => {
        // Из закрытого состояния: правки мимо набора (вставка, undo) — событий
        // `onDidType` у них нет; набор не-word символа; набор мультикурсором и
        // при выделении.
        const attempts: ((fake: FakeEditor) => void)[] = [
            (fake) => {
                fake.edit("inde", 4); // вставка/undo одного символа — не набор
            },
            (fake) => {
                fake.type("ind ", 4); // небуквенный символ
            },
            (fake) => {
                fake.setCursorCount(2);
                fake.type("inde", 4);
            },
            (fake) => {
                fake.setSelection(0, 3);
                fake.fireTyped("e"); // набор, оставивший выделение (auto-surround)
            },
        ];
        for (const attempt of attempts) {
            const { service, fake, source } = setup(ITEMS); // "ind", каретка 3
            attempt(fake);
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

    it("конструктор с непустым начальным выделением безопасен", () => {
        const fake = makeEditor("ind", 3, "ind", 1); // anchor=1, active=3 (не collapsed)
        const { service } = createService(makeGroup(fake.editor, undefined));
        expect(service.isOpen()).toBe(false);
    });
});

/** Состояние призрака, которым управляет тест (как его видит suggest). */
function fakeInlineState(): IInlineSuggestionsState & {
    visible: boolean;
    loading: boolean;
    stopped: number;
    change: (patch: { visible?: boolean; loading?: boolean }) => void;
} {
    const emitter = new Emitter<void>();
    const state = {
        visible: false,
        loading: false,
        stopped: 0,
        isVisible: () => state.visible,
        isLoading: () => state.loading,
        stopAutomatic: () => {
            state.stopped++;
            state.loading = false;
        },
        onDidChange: emitter.event,
        change: (patch: { visible?: boolean; loading?: boolean }) => {
            Object.assign(state, patch);
            emitter.fire();
        },
    };
    return state;
}

/**
 * Сервис с источником автодополнения и (по желанию) inline-провайдером в реестре
 * — под ним действует режим `offWhenInlineCompletions`.
 */
function quickSetup(options: { line?: string; character?: number; settings?: TestSettings; inline?: boolean } = {}) {
    const line = options.line ?? "ind";
    const fake = makeEditor(line, options.character ?? line.length, line);
    const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
    const group = makeGroup(fake.editor, source);
    const languageFeatures = languageFeaturesOf(group);
    if (options.inline === true) {
        languageFeatures.inlineCompletionsProvider.register("*", {
            provideInlineCompletions: () => Promise.resolve([]),
        });
    }
    const { service, body } = createService(group, makeStateService(), options.settings, languageFeatures);
    TestApp.create(body, new Size(80, 24));
    const inline = fakeInlineState();
    const registration = service.setInlineSuggestionsState(inline);
    return { service, fake, source, inline, registration, group };
}

describe("CompletionService — quick suggest (эталон suggestModel)", () => {
    it("открывается, только когда каретка в конце слова, которое не число", async () => {
        const { service, fake, source } = quickSetup({ line: "x", character: 1 });
        for (const [line, character] of [
            ["x ", 2],
            ["x (", 3],
            ["x (4", 4],
            ["x (42", 5],
        ] as const) {
            fake.type(line, character);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        }
        // Буква после числа — уже слово `42a`, не число: запрос уходит.
        fake.type("x (42a", 6);
        await flushTimers();
        expect(source).toHaveBeenCalled();
        void service;
    });

    it("не-ASCII буква тоже открывает: слово — по определению эталона, а не по \\w", async () => {
        const { service, fake } = quickSetup({ line: "", character: 0 });
        fake.type("п", 1);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("набор внутри слова — нет, а буква перед словом — да", async () => {
        const inside = quickSetup({ line: "indent", character: 3 });
        inside.fake.type("indeent", 4);
        await flushTimers();
        expect(inside.source).not.toHaveBeenCalled();

        const before = quickSetup({ line: "dent", character: 0 });
        before.fake.type("ident", 1);
        await flushTimers();
        expect(before.service.isOpen()).toBe(true);
    });

    it("editor.quickSuggestions: false — набор не открывает, Ctrl+Space работает", async () => {
        const { service, fake, source } = quickSetup({ settings: { "editor.quickSuggestions": false } });
        fake.type("inde", 4);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
        await service.trigger();
        expect(service.isOpen()).toBe(true);
    });

    it("режим берётся для вида токена перед кареткой: строки и комментарии по умолчанию off", async () => {
        const { service, fake, source } = quickSetup({ line: '"ind', character: 4 });
        const stringTokens = createLineTokens([createToken(0, ["source.json", "string.quoted.double.json"])]);
        fake.setTokens(stringTokens);
        fake.type('"inde', 5);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        fake.setTokens(createLineTokens([createToken(0, ["source.ts", "comment.line.ts"])]));
        fake.type('"inden', 6);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        // Код — открывается.
        fake.setTokens(createLineTokens([createToken(0, ["source.ts"])]));
        fake.type('"indent', 7);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("вид токена — у символа СЛЕВА от каретки, а не под ней", async () => {
        // `"ind"`: кавычки — строка, `ind` — код; каретка между `d` и закрывающей кавычкой.
        const { service, fake } = quickSetup({ line: '"in"', character: 3 });
        fake.setTokens(
            createLineTokens([
                createToken(0, ["source.json", "string.quoted.double.json"]),
                createToken(1, ["source.json"]),
                createToken(4, ["source.json", "string.quoted.double.json"]),
            ]),
        );
        fake.type('"ind"', 4);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("секция языка включает строки (как `[json]` у json-language-features)", async () => {
        const { service, fake } = quickSetup({
            line: '"ind',
            settings: { "[editorconfig]": { "editor.quickSuggestions": { strings: true } } },
        });
        fake.setTokens(createLineTokens([createToken(0, ["source.json", "string.quoted.double.json"])]));
        fake.type('"inde', 5);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("режим inline попап не открывает (ghost из пунктов suggest не поддержан)", async () => {
        const { fake, source } = quickSetup({ settings: { "editor.quickSuggestions": "inline" } });
        fake.type("inde", 4);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
    });

    it("editor.quickSuggestionsDelay: попап ждёт задержку", async () => {
        // Секция языка — настройка читается для языка документа.
        const { service, fake } = quickSetup({
            settings: { "[editorconfig]": { "editor.quickSuggestionsDelay": 40 } },
        });
        fake.type("inde", 4);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(service.isOpen()).toBe(true);
    });

    it("дефолт задержки — 10 мс, как quickSuggestionsDelay эталона", async () => {
        const { service, fake } = quickSetup();
        setSetting(service, "editor.quickSuggestionsDelay", undefined);
        fake.type("inde", 4);
        await new Promise((resolve) => setTimeout(resolve, 2));
        expect(service.isOpen()).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(service.isOpen()).toBe(true);
    });

    describe("offWhenInlineCompletions — уступает призраку", () => {
        it("призрак уже на экране — попап не открывается", async () => {
            const { fake, source, inline } = quickSetup({ inline: true });
            inline.visible = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("ждёт ответа призрака: пришёл призрак — попапа нет", async () => {
            const { fake, source, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();

            inline.change({ visible: true, loading: false });
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("ждёт ответа призрака: призрака нет — попап открывается", async () => {
            const { service, fake, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(service.isOpen()).toBe(false);

            // Событие без исхода (ещё грузится) ожидания не заканчивает.
            inline.change({});
            await flushTimers();
            expect(service.isOpen()).toBe(false);

            inline.change({ loading: false });
            await flushTimers();
            expect(service.isOpen()).toBe(true);
        });

        it("призрак не ответил за 750 мс — попап открывается, а запрос призрака бросается", async () => {
            vi.useFakeTimers();
            try {
                const { service, fake, inline } = quickSetup({ inline: true });
                inline.loading = true;
                fake.type("inde", 4);
                await vi.advanceTimersByTimeAsync(749);
                expect(service.isOpen()).toBe(false);
                expect(inline.stopped).toBe(0);
                await vi.advanceTimersByTimeAsync(1);
                expect(inline.stopped).toBe(1);
                expect(service.isOpen()).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it("исход ожидания окончателен: таймер после пришедшего призрака не открывает попап", async () => {
            vi.useFakeTimers();
            try {
                const { service, fake, inline } = quickSetup({ inline: true });
                inline.loading = true;
                fake.type("inde", 4);
                await vi.advanceTimersByTimeAsync(5);
                inline.change({ visible: true, loading: false });
                // Призрак погасили — событие снова есть, но ожидание уже снято.
                inline.change({ visible: false });
                await vi.advanceTimersByTimeAsync(1000);
                expect(service.isOpen()).toBe(false);
                expect(inline.stopped).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it("набор за время ожидания: старое ожидание не открывает попап", async () => {
            const { fake, source, inline } = quickSetup({
                inline: true,
                settings: { "editor.quickSuggestionsDelay": 30 },
            });
            inline.loading = true;
            fake.type("inde", 4);
            await new Promise((resolve) => setTimeout(resolve, 40)); // ждёт призрака
            fake.type("inde ", 5); // следующий цикл: не слово — его quick suggest не откроет
            inline.change({ loading: false });
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(source).not.toHaveBeenCalled();
        });

        it("правка и уход каретки, пока ждали, — попап не открывается", async () => {
            const edited = quickSetup({ inline: true });
            edited.inline.loading = true;
            edited.fake.type("inde", 4);
            await flushTimers();
            edited.fake.edit("indent", 4); // вставка без набора: версия другая
            edited.inline.change({ loading: false });
            await flushTimers();
            expect(edited.source).not.toHaveBeenCalled();

            const moved = quickSetup({ inline: true });
            moved.inline.loading = true;
            moved.fake.type("inde", 4);
            await flushTimers();
            moved.fake.move(0, 2);
            moved.inline.change({ loading: false });
            await flushTimers();
            expect(moved.source).not.toHaveBeenCalled();

            const lined = quickSetup({ inline: true });
            lined.inline.loading = true;
            lined.fake.type("inde", 4);
            await flushTimers();
            lined.fake.move(1, 4);
            lined.inline.change({ loading: false });
            await flushTimers();
            expect(lined.source).not.toHaveBeenCalled();

            const multi = quickSetup({ inline: true });
            multi.inline.loading = true;
            multi.fake.type("inde", 4);
            await flushTimers();
            multi.fake.setCursorCount(2);
            multi.inline.change({ loading: false });
            await flushTimers();
            expect(multi.source).not.toHaveBeenCalled();

            const selected = quickSetup({ inline: true });
            selected.inline.loading = true;
            selected.fake.type("inde", 4);
            await flushTimers();
            selected.fake.setSelection(0, 4);
            selected.inline.change({ loading: false });
            await flushTimers();
            expect(selected.source).not.toHaveBeenCalled();
        });

        it("закрытие (Esc) снимает ожидание: ответ призрака попап не поднимает", async () => {
            const { service, fake, source, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            service.close();
            inline.change({ loading: false });
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("призрака нет и запрос не идёт — попап открывается сразу, без ожидания", async () => {
            vi.useFakeTimers();
            try {
                const { service, fake } = quickSetup({ inline: true });
                fake.type("inde", 4);
                await vi.advanceTimersByTimeAsync(20);
                expect(service.isOpen()).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it("после ожидания запрос остаётся авто: под набранное ничего не подошло — попапа нет", async () => {
            const { service, fake, source, inline } = quickSetup({ inline: true, line: "inde " });
            inline.loading = true;
            fake.type("inde q", 6);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
            inline.change({ loading: false });
            await flushTimers();
            expect(source).toHaveBeenCalledTimes(1);
            expect(service.isOpen()).toBe(false);
        });

        it("смена активного редактора за время ожидания — попап не открывается ни в одном", async () => {
            const { fake, source, inline, group } = quickSetup({ inline: true });
            const other = makeEditor("indent", 6);
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            Object.assign(group, { getActiveEditor: () => other.editor });
            inline.change({ loading: false });
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("попап, открытый за время ожидания, не открывается повторно", async () => {
            const { service, fake, source, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            // Ctrl+Space, а ожидание ещё висит: trigger() снимает его.
            await service.trigger();
            inline.change({ loading: false });
            await flushTimers();
            expect(source).toHaveBeenCalledTimes(1);
        });

        it("без inline-провайдера или при editor.inlineSuggest.enabled: false — не ждёт", async () => {
            const noProvider = quickSetup();
            noProvider.inline.loading = true;
            noProvider.fake.type("inde", 4);
            await flushTimers();
            expect(noProvider.service.isOpen()).toBe(true);

            const disabled = quickSetup({
                inline: true,
                settings: { "[editorconfig]": { "editor.inlineSuggest.enabled": false } },
            });
            disabled.inline.loading = true;
            disabled.fake.type("inde", 4);
            await flushTimers();
            expect(disabled.service.isOpen()).toBe(true);
        });

        it("состояние призрака не подключено — открывает сразу, по тем же правилам авто-запроса", async () => {
            const { service, fake, inline, registration } = quickSetup({ inline: true });
            // Снятое состояние «грузится» вечно: если бы оно осталось подключённым,
            // попап ждал бы его.
            inline.loading = true;
            registration.dispose();
            fake.type("inde", 4);
            await flushTimers();
            expect(service.isOpen()).toBe(true);

            // Авто-запрос: под набранное ничего не подошло — попапа нет.
            service.close();
            fake.type("inde q", 6);
            await flushTimers();
            expect(service.isOpen()).toBe(false);
        });

        it("dispose устаревшей регистрации не снимает текущую", async () => {
            const { service, fake, registration } = quickSetup({ inline: true });
            const current = fakeInlineState();
            current.visible = true;
            service.setInlineSuggestionsState(current);
            registration.dispose(); // прежняя регистрация — уже не текущая
            fake.type("inde", 4);
            await flushTimers();
            // Текущее состояние на месте: призрак на экране — попапа нет.
            expect(service.isOpen()).toBe(false);
        });

        it("режим on не ждёт призрака и открывает поверх него", async () => {
            const { service, fake, inline } = quickSetup({
                inline: true,
                settings: { "editor.quickSuggestions": true },
            });
            inline.visible = true;
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(service.isOpen()).toBe(true);
        });
    });

    it("editor.inlineSuggest.suppressSuggestions: призрак на экране гасит авто-открытие (и по набору, и по символу)", async () => {
        const settings = {
            "editor.quickSuggestions": true,
            "[editorconfig]": { "editor.inlineSuggest.suppressSuggestions": true },
        };
        const { service, fake, source, inline, group } = quickSetup({ inline: true, settings });
        inline.visible = true;
        fake.type("inde", 4);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        fake.type("inde.", 5);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        // Призрака нет — по символу открывается.
        inline.visible = false;
        fake.type("inde..", 6);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("editor.suggestOnTriggerCharacters: false — символ не открывает попап", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, body } = createService(group, makeStateService(), {
            "[editorconfig]": { "editor.suggestOnTriggerCharacters": false },
        });
        TestApp.create(body, new Size(80, 24));
        fake.type("d.", 2);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("триггер-символ, продолжающий слово, идёт путём quick suggest (Invoke, не TriggerCharacter)", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["a"];
        const { service, body } = createService(group);
        TestApp.create(body, new Size(80, 24));
        fake.type("da", 2);
        await flushTimers();
        void service;
        expect(source).toHaveBeenCalledWith(
            expect.objectContaining({ triggerKind: CompletionTriggerKind.Invoke }),
            expect.anything(),
        );
    });

    it("под набранное ничего не подошло — авто-попапа нет, Ctrl+Space показывает весь список", async () => {
        const { service, fake, source } = quickSetup({ line: "", character: 0 });
        fake.type("q", 1);
        await flushTimers();
        expect(source).toHaveBeenCalledTimes(1);
        expect(service.isOpen()).toBe(false);

        await service.trigger();
        expect(service.isOpen()).toBe(true);
    });

    it("авто-попап закрывается, когда добор отфильтровал всё; явный держит список", async () => {
        const auto = quickSetup({ line: "in", character: 2 });
        auto.fake.type("ind", 3);
        await flushTimers();
        expect(auto.service.isOpen()).toBe(true);
        auto.fake.type("indq", 4);
        expect(auto.service.isOpen()).toBe(false);

        const explicit = quickSetup({ line: "ind", character: 3 });
        await explicit.service.trigger();
        explicit.fake.type("indq", 4);
        expect(explicit.service.isOpen()).toBe(true);
    });

    it("неполный авто-список перезапрашивается авто-запросом: пустой ответ закрывает попап", async () => {
        const fake = makeEditor("in", 2, "in");
        const source = vi
            .fn<() => Promise<ICoreCompletionResult>>()
            .mockResolvedValueOnce(completionResult(ITEMS, true))
            .mockResolvedValue(completionResult([], false));
        const { service, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));
        fake.type("ind", 3);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
        // Добор при неполном списке не закрывает локально, а перезапрашивает.
        fake.type("indq", 4);
        expect(service.isOpen()).toBe(true);
        await flushTimers();
        expect(source).toHaveBeenCalledTimes(2);
        expect(service.isOpen()).toBe(false);
    });

    it("onDidShow — один раз на открытие закрытого попапа", async () => {
        const { service } = quickSetup();
        const shown = vi.fn();
        service.onDidShow(shown);
        await service.trigger();
        await service.trigger(); // перезапрос открытого — не открытие
        expect(shown).toHaveBeenCalledTimes(1);
        service.close();
        await service.trigger();
        expect(shown).toHaveBeenCalledTimes(2);
    });
});

describe("CompletionService — editor.wordBasedSuggestions", () => {
    function wordSetup(settings: TestSettings, options: { inline?: boolean; otherLanguage?: string } = {}) {
        const fake = makeEditor("", 0, "alpha beta");
        const sameLanguage = makeEditor("", 0, "gamma");
        const otherLanguage = makeEditor("", 0, "delta");
        Object.assign(otherLanguage.editor, { languageId: options.otherLanguage ?? "python" });
        const group = makeGroup(fake.editor, undefined, [sameLanguage.editor, otherLanguage.editor]);
        const languageFeatures = new LanguageFeaturesService();
        if (options.inline === true) {
            languageFeatures.inlineCompletionsProvider.register("*", {
                provideInlineCompletions: () => Promise.resolve([]),
            });
        }
        const { service, component, body } = createService(group, makeStateService(), settings, languageFeatures);
        TestApp.create(body, new Size(80, 24));
        const labels = async (): Promise<string[]> => {
            await service.trigger();
            return component.view.items.map((i) => i.label);
        };
        return { service, labels };
    }

    it("по умолчанию — открытые документы того же языка", async () => {
        expect(await wordSetup({}).labels()).toEqual(["alpha", "beta", "gamma"]);
        expect(await wordSetup({ "editor.wordBasedSuggestions": "matchingDocuments" }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
    });

    it("allDocuments — все открытые; currentDocument — только активный; off — ничего", async () => {
        expect(await wordSetup({ "editor.wordBasedSuggestions": "allDocuments" }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
            "delta",
        ]);
        expect(await wordSetup({ "editor.wordBasedSuggestions": "currentDocument" }).labels()).toEqual([
            "alpha",
            "beta",
        ]);
        const off = wordSetup({ "editor.wordBasedSuggestions": "off" });
        expect(await off.labels()).toEqual([]);
        expect(off.service.isOpen()).toBe(false);
    });

    it("режим читается для языка документа; гашение — только в режиме offWithInlineSuggestions", async () => {
        expect(
            await wordSetup({ "[editorconfig]": { "editor.wordBasedSuggestions": "currentDocument" } }).labels(),
        ).toEqual(["alpha", "beta"]);
        // matchingDocuments при inline-провайдере и включённых AI-подсказках слова не гасит.
        expect(
            await wordSetup(
                { "editor.wordBasedSuggestions": "matchingDocuments", "github.copilot.enable": { "*": true } },
                { inline: true },
            ).labels(),
        ).toEqual(["alpha", "beta", "gamma"]);
    });

    it("offWithInlineSuggestions гасит слова, только если есть inline-провайдер И включены AI-подсказки продукта", async () => {
        // Inline-провайдер есть, но `github.copilot.enable` не задан — слова остаются (как у эталона без Copilot).
        expect(await wordSetup({}, { inline: true }).labels()).toEqual(["alpha", "beta", "gamma"]);
        // Включены для всех языков — слов нет.
        expect(await wordSetup({ "github.copilot.enable": { "*": true } }, { inline: true }).labels()).toEqual([]);
        // Без inline-провайдера настройка Copilot ничего не гасит.
        expect(await wordSetup({ "github.copilot.enable": { "*": true } }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
        // Ключ языка главнее `*`.
        expect(
            await wordSetup({ "github.copilot.enable": { "*": true, editorconfig: false } }, { inline: true }).labels(),
        ).toEqual(["alpha", "beta", "gamma"]);
        expect(
            await wordSetup({ "github.copilot.enable": { "*": false, editorconfig: true } }, { inline: true }).labels(),
        ).toEqual([]);
        // Не объект — выключены.
        expect(await wordSetup({ "github.copilot.enable": null }, { inline: true }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
        expect(await wordSetup({ "github.copilot.enable": true }, { inline: true }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
        expect(await wordSetup({ "github.copilot.enable": ["*"] }, { inline: true }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
    });
});
