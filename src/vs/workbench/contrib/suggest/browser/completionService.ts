import type { CompletionDetailsContent } from "@tuidom/elements/completionlist/completionDetailsElement";
import type { CompletionListItem } from "@tuidom/elements/completionlist/completionListElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter, type Event } from "../../../../base/common/event.ts";
import { Disposable, DisposableStore, type IDisposable, MutableDisposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection, isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    CompletionItemProvider,
    ICoreCompletionItem,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import { type StandardTokenType, standardTokenTypeAt } from "../../../../editor/common/languages/standardTokenType.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { SUGGEST_DETAILS_VISIBLE_STATE } from "../../../common/stateKeys.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { collectWordCompletions } from "./collectWordCompletions.ts";
import { type ICompletionsFromProviders, provideCompletions } from "./provideCompletions.ts";
import {
    type IQuickSuggestionsOptions,
    readQuickSuggestions,
    shouldAutoTrigger,
    valueFor,
} from "./quickSuggestions.ts";
import type { SuggestComponent } from "./suggestComponent.ts";
import { SuggestComponentDIToken } from "./suggestComponent.ts";

export const CompletionServiceDIToken = token<CompletionService>("CompletionService");

/**
 * Буквы любого алфавита, как эталонный `DEFAULT_WORD_REGEXP`: с ASCII-`\w` quick suggest на
 * кириллице мерцал — открывался с пустым префиксом и закрывался следующей же буквой.
 */
const WORD_CHAR = /[\p{L}\p{M}\p{N}_.-]/u;

/** `CompletionItemKind.Text` — для word-based элементов. */
const KIND_TEXT = 0;

/** Сколько ждём resolve перед вставкой (правки авто-импорта). */
const ACCEPT_RESOLVE_TIMEOUT_MS = 300;

/** Как upstream `_waitForInlineCompletionsAndTrigger`. */
const INLINE_COMPLETIONS_WAIT_MS = 750;

/**
 * `product.defaultChatAgent.completionsEnablementSetting` эталона: по ней в режиме
 * `offWithInlineSuggestions` гасятся слова из буфера.
 */
const COMPLETIONS_ENABLEMENT_SETTING = "github.copilot.enable";

/**
 * То, что upstream `SuggestModel` читает у `InlineCompletionsController`. Сервис призраков сам
 * зависит от {@link CompletionService}, поэтому не инъектируется, а регистрируется в нём.
 */
export interface IInlineSuggestionsState {
    isVisible(): boolean;
    /** Запрос отложен дебаунсом или в полёте. */
    isLoading(): boolean;
    stopAutomatic(): void;
    readonly onDidChange: Event<void>;
}

const EMPTY_RESULT: ICompletionsFromProviders = { items: [], isIncomplete: false, providerOf: new Map() };

export class CompletionService extends Disposable implements IContextKeyContributor {
    private readonly onDidCloseEmitter = this.register(new Emitter<void>());
    private readonly onDidShowEmitter = this.register(new Emitter<void>());
    public static dependencies = [
        SuggestComponentDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        StateServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private readonly component: SuggestComponent;
    private readonly group: IEditorService;
    private readonly commands: CommandRegistry;
    private readonly state: IStateService;
    private readonly languageFeatures: ILanguageFeaturesService;
    private readonly configuration: IConfigurationService;
    private inlineSuggestions: IInlineSuggestionsState | null = null;
    private readonly waitForInline = this.register(new MutableDisposable<DisposableStore>());
    private activeEditor: TextEditorPane | null = null;
    private prefixRange: IRange | null = null;
    // Границу префикса задал провайдер — при доборе её не пересчитывать (refilterOpen).
    private prefixFromProvider = false;
    // Попап открыт не явной командой (набор, триггер-символ).
    // Stryker disable next-line BooleanLiteral: значение до первого trigger() не читается — refilterOpen работает только при открытом попапе, а открывает его trigger(), выставляя поле
    private autoSession = false;
    // Провайдерский `range` — снимок этой же позиции: по ней считаем, сколько добрали с триггера.
    private triggerCaret: IPosition | null = null;
    // `null` — запросов ещё не было; см. cancelRequestIfCaretLeft.
    private requestCaret: IPosition | null = null;

    // Quick suggest, запрос по триггер-символу или перезапрос неполного списка — что именно,
    // лежит в pendingAutoSuggest (задержки у них разные).
    private readonly autoSuggest = this.register(
        new RunOnceScheduler(() => {
            this.pendingAutoSuggest();
        }, 0),
    );
    // Stryker disable next-line ArrowFunction: заглушка до первого scheduleAuto не вызывается — планировщик срабатывает только после него
    private pendingAutoSuggest: () => void = () => undefined;
    private readonly latest = new LatestRequest();
    // Сервер отфильтровал список под префикс — добор обязан перезапросить, а не сужать локально.
    private isIncomplete = false;
    private providerOf: ReadonlyMap<ICoreCompletionItem, CompletionItemProvider> = new Map();
    // Ключ — id пункта у источника.
    private readonly resolvedItems = new Map<string, ICoreResolvedCompletion>();
    private readonly pendingResolves = new Map<string, Promise<ICoreResolvedCompletion | null>>();

    public constructor(
        component: SuggestComponent,
        group: IEditorService,
        commands: CommandRegistry,
        state: IStateService,
        focusTracker: FocusTracker,
        languageFeatures: ILanguageFeaturesService,
        configuration: IConfigurationService,
    ) {
        super();
        this.configuration = configuration;
        this.component = component;
        this.group = group;
        this.commands = commands;
        this.state = state;
        this.languageFeatures = languageFeatures;
        this.component.view.onAccept = (item) => {
            this.accept(item);
        };
        this.component.view.onSelectionChanged = (item) => {
            this.showDetailsFor(item);
        };
        this.component.detailsVisible = this.state.get(SUGGEST_DETAILS_VISIBLE_STATE);
        // Клавиатурный уход фокуса (Ctrl+Tab, Quick Open): ответ запроса в полёте поднял бы попап
        // под чужим фокусом. Клик-фокус уже покрыт `close-on-outside`.
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement)) this.close();
            }),
        );

        // Безусловный close() на смене редактора гасит и отложенный авто-suggest.
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                this.close();
                if (editor === null) return;
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        this.onCaretChanged(editor);
                    }),
                );
                store.add(
                    editor.onDidType((text) => {
                        this.onDidType(editor, text);
                    }),
                );
            }),
        );
    }

    /**
     * `auto` — quick suggest: как у эталона, попап не показывается, если под набранное ничего
     * не подошло, и закрывается, когда добор отфильтровал список в ноль.
     */
    public async trigger(triggerCharacter?: string, auto = false): Promise<void> {
        this.cancelAutoSuggest();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        // Мультикурсор не поддерживается: accept вставил бы правку мимо остальных кареток и схлопнул их.
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;

        const active = selections[0].active;

        const providers = this.languageFeatures.completionProvider.ordered(editor);
        const ticket = this.latest.start();
        this.requestCaret = active;
        // Срока ответа нет (как в upstream): language server на холодном старте думает секунды, а
        // открытый попап уже не перезапросится. Ненужный ответ гасит билет.
        const result =
            // Stryker disable next-line ConditionalExpression: provideCompletions([]) даёт тот же пустой ответ — ветка лишь не зовёт агрегатор впустую
            providers.length === 0
                ? EMPTY_RESULT
                : await provideCompletions(
                      providers,
                      {
                          uri: editor.uri.toString(),
                          languageId: editor.languageId,
                          versionId: editor.model.document.versionId,
                          line: active.line,
                          character: active.character,
                          triggerKind:
                              triggerCharacter !== undefined
                                  ? CompletionTriggerKind.TriggerCharacter
                                  : CompletionTriggerKind.Invoke,
                          // Stryker disable next-line ConditionalExpression: запрос уходит по RPC JSON'ом, а он выбрасывает undefined-поля — `{triggerCharacter: undefined}` у провайдера неотличим от отсутствия
                          ...(triggerCharacter !== undefined ? { triggerCharacter } : {}),
                      },
                      ticket.token,
                  );
        if (ticket.isStale()) return;

        // Пока ждали, слово могли добрать: список сужается под набранное, а не под снимок запроса.
        const caret = editor.viewState.selections[0].active;

        // Неполный список сервер отфильтровал под префикс момента запроса — сужать его локально нельзя
        // (gopls ставит всем пунктам один `filterText`): перезапрос, как upstream `_onNewContext`.
        if (result.isIncomplete && caret.character > active.character) {
            void this.trigger(undefined, auto);
            return;
        }
        const caretLine = editor.viewState.document.getLineContent(caret.line);

        const extensionItems = result.items;
        // Границу префикса задаёт провайдер: после `d.` его `range` начинается за точкой, а наш
        // wordStart (WORD_CHAR включает `.` и `-` ради settings.json) дал бы префикс `d.`.
        const providerStart = commonPrefixStart(extensionItems, active);
        const prefixStart = providerStart ?? wordStart(caretLine, caret.character);
        const prefix = caretLine.slice(prefixStart, caret.character);

        // Слова из буфера подмешиваем только там, где провайдер не задал своего
        // диапазона: после точки они были бы шумом поверх членов типа.
        const items =
            providerStart === null
                ? [...extensionItems, ...this.wordItems(editor, prefix, extensionItems)]
                : extensionItems;
        if (items.length === 0) return;

        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.activeEditor = editor;
        this.prefixRange = createRange(caret.line, prefixStart, caret.line, caret.character);
        this.prefixFromProvider = providerStart !== null;
        // Снимок каретки запроса, не текущей: от него accept отсчитывает добор (resolveAcceptRange).
        this.triggerCaret = { line: active.line, character: active.character };
        this.isIncomplete = result.isIncomplete;
        this.providerOf = result.providerOf;
        this.autoSession = auto;

        const view = this.component.view;
        view.setItems(items.map(toListItem));
        view.setFilter(prefix);
        if (view.items.length === 0) {
            // Авто-запрос без совпадений — попапа нет (upstream: «nothing left» → cancel), иначе любое
            // слово открывало бы весь список слов буфера.
            if (auto) {
                this.close();
                return;
            }
            view.setFilter("");
        }

        // Фокус попап не забирает — как в VS Code.
        const wasOpen = this.isOpen();
        this.component.openAt(anchor);
        if (!wasOpen) this.onDidShowEmitter.fire();
    }

    public close(): void {
        // Событие — только для открытого попапа: close() зовут либерально (bindEditor — безусловно).
        const wasOpen = this.isOpen();
        this.cancelAutoSuggest();
        this.component.close();
        this.activeEditor = null;
        this.prefixRange = null;
        this.prefixFromProvider = false;
        this.triggerCaret = null;
        this.isIncomplete = false;
        this.latest.cancel();
        if (wasOpen) {
            this.onDidCloseEmitter.fire();
        }
    }

    /** Не фаерится, если попап и так был закрыт. */
    public readonly onDidClose = this.onDidCloseEmitter.event;

    /**
     * Призрак на это время уходит с экрана: у upstream при открытом виджете ghost text — лишь
     * продолжение выбранного пункта.
     */
    public readonly onDidShow = this.onDidShowEmitter.event;

    public setInlineSuggestionsState(state: IInlineSuggestionsState): IDisposable {
        this.inlineSuggestions = state;
        return {
            dispose: () => {
                if (this.inlineSuggestions === state) this.inlineSuggestions = null;
            },
        };
    }

    public isOpen(): boolean {
        return this.component.isOpen();
    }

    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("suggestWidgetVisible", this.isOpen());
    }

    public selectNext(): void {
        this.component.view.selectNext();
    }

    public selectPrevious(): void {
        this.component.view.selectPrevious();
    }

    public selectNextPage(): void {
        this.component.view.selectNextPage();
    }

    public selectPreviousPage(): void {
        this.component.view.selectPreviousPage();
    }

    public acceptSelected(): void {
        const item = this.component.view.getSelectedItem();
        if (item !== null) this.accept(item);
    }

    public hide(): void {
        this.close();
    }

    /** Выбор переживает рестарт: это привычка человека, а не свойство проекта. */
    public toggleDetails(): void {
        const next = !this.component.detailsVisible;
        this.component.detailsVisible = next;
        this.state.store(SUGGEST_DETAILS_VISIBLE_STATE, next);
        // Сворачивание меняет ширину попапа — позицию надо пересчитать.
        this.component.refreshDetailsLayout();
        // Описание выбранного пункта могло быть ещё не запрошено.
        if (next) this.showDetailsFor(this.component.view.getSelectedItem());
    }

    private onCaretChanged(editor: TextEditorPane): void {
        if (!this.isOpen()) {
            this.cancelRequestIfCaretLeft(editor);
            return;
        }
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) {
            this.close();
            return;
        }
        const active = selections[0].active;
        this.refilterOpen(editor, active, editor.viewState.document.getLineContent(active.line));
    }

    /**
     * Запрос нужен, пока каретка продолжает его слово (upstream `_onNewContext`): срока ответа
     * нет, и ответ медленного сервера поднял бы попап там, откуда человек давно ушёл.
     */
    private cancelRequestIfCaretLeft(editor: TextEditorPane): void {
        const from = this.requestCaret;
        if (from === null) return;
        const selections = editor.viewState.selections;
        if (selections.length === 1 && isSelectionCollapsed(selections[0])) {
            const active = selections[0].active;
            const line = editor.viewState.document.getLineContent(active.line);
            if (
                active.line === from.line &&
                active.character >= from.character &&
                isWordRun(line.slice(from.character, active.character))
            ) {
                return;
            }
        }
        this.latest.cancel();
    }

    /**
     * Событие набора, а не «строка выросла»: accept, undo и вставка не считаются. Приходит ПОСЛЕ
     * события каретки той же правки. Триггер-символ переоткрывает список и при открытом попапе.
     */
    private onDidType(editor: TextEditorPane, text: string): void {
        if (this.isTriggerCharacterCase(editor, text)) {
            if (!this.canShowSuggestWithInline(editor.languageId)) return;
            if (this.isOpen()) this.component.close();
            // Ответ запроса в полёте — про слово до символа.
            this.latest.cancel();
            // Следующим тиком, вне стека правки (эталон — сразу). Не `auto`: наш префикс захватывает и
            // символ (`d.`), без провайдерского range под ним не подошло бы ничего.
            this.scheduleAuto(() => void this.trigger(text), 0);
        } else if (!this.isOpen()) {
            this.scheduleQuickSuggest(editor);
        }
    }

    /**
     * upstream `_triggerCharacterListener`: символ объявлен провайдером ЭТОГО документа («.»
     * TypeScript не открывает попап в markdown); буква, продолжающая слово, — путь quick suggest.
     */
    private isTriggerCharacterCase(editor: TextEditorPane, text: string): boolean {
        const triggers = this.languageFeatures.completionProvider
            .ordered(editor)
            .flatMap((provider) => provider.triggerCharacters);
        if (!triggers.includes(text)) return false;
        if (!this.configuration.get("editor.suggestOnTriggerCharacters", { overrideIdentifier: editor.languageId }))
            return false;
        const caret = editor.viewState.selections[0].active;
        return !shouldAutoTrigger(editor.viewState.document.getLineContent(caret.line), caret.character);
    }

    private refilterOpen(editor: TextEditorPane, active: IPosition, line: string): void {
        const prefixRange = this.prefixRange;
        // Недостижимо: prefixRange ставит trigger() вместе с открытием, снимает close().
        /* v8 ignore start -- defensive: см. выше */
        // Stryker disable next-line ConditionalExpression,BlockStatement: недостижимая ветка, см. выше
        if (prefixRange === null) {
            this.close();
            return;
        }
        /* v8 ignore stop */
        if (active.line !== prefixRange.start.line || active.character < prefixRange.start.character) {
            this.close();
            return;
        }
        // Добор обязан продолжать слово: иначе `refineFilter` оставлял последний непустой список,
        // Enter забирал `acceptSelectedSuggestion`, и `cons{` + Enter давали `console`.
        const trigger = this.triggerCaret;
        // Недостижимо при открытом попапе, как prefixRange выше; проверка ради сужения типа.
        // Stryker disable next-line ConditionalExpression: недостижимая ветка, см. выше
        if (trigger !== null && !isWordRun(line.slice(trigger.character, active.character))) {
            this.close();
            return;
        }
        // Провайдерскую границу не пересчитывать: она проходит там, где у ядра границы слова нет
        // (кавычка ключа settings.json, точка tsserver), и пересчёт закрывал попап на первом символе.
        const prefixStart = this.prefixFromProvider ? prefixRange.start.character : wordStart(line, active.character);
        if (prefixStart !== prefixRange.start.character) {
            this.close();
            return;
        }
        const anchor = editor.getCaretAnchor();
        if (anchor === null) {
            this.close();
            return;
        }
        const prefix = line.slice(prefixStart, active.character);
        const view = this.component.view;
        if (this.autoSession && !this.isIncomplete) {
            // Авто-попап, отфильтрованный в ноль, закрывается; явный держит последний непустой список.
            view.setFilter(prefix);
            if (view.items.length === 0) {
                this.close();
                return;
            }
        } else {
            view.refineFilter(prefix);
        }
        this.prefixRange = createRange(prefixRange.start.line, prefixStart, active.line, active.character);
        this.component.setAnchor(anchor);

        // Неполный список отфильтрован под прежний префикс: сужение показываем сразу, но перезапрашиваем.
        if (this.isIncomplete) {
            const auto = this.autoSession;
            this.scheduleAuto(() => void this.trigger(undefined, auto), 0);
        }
    }

    private scheduleAuto(run: () => void, delayMs: number): void {
        // Stryker disable next-line CallExpression: ожидание прежнего цикла и так не откроет попап — новый набор сменил версию документа, а это проверяет finish; снимаем его сразу, чтобы не держать таймер и подписку
        this.waitForInline.clear();
        this.pendingAutoSuggest = run;
        this.autoSuggest.schedule(delayMs);
    }

    private cancelAutoSuggest(): void {
        this.autoSuggest.cancel();
        this.waitForInline.clear();
    }

    private quickSuggestions(languageId: string): IQuickSuggestionsOptions {
        return readQuickSuggestions(
            this.configuration.get("editor.quickSuggestions", { overrideIdentifier: languageId }),
        );
    }

    /** Гейты проверяются на срабатывании — по состоянию, до которого человек успел допечатать. */
    private scheduleQuickSuggest(editor: TextEditorPane): void {
        const delay = this.configuration.get("editor.quickSuggestionsDelay", { overrideIdentifier: editor.languageId });
        this.scheduleAuto(() => {
            this.doQuickSuggest(editor);
        }, delay);
    }

    /**
     * В режиме `offWhenInlineCompletions` при живом inline-провайдере сначала дожидается
     * призрака: появился — попап не нужен.
     */
    private doQuickSuggest(editor: TextEditorPane): void {
        // Stryker disable next-line ConditionalExpression: планирование и так идёт только при закрытом попапе; гард — на случай открытия между планом и срабатыванием
        if (this.isOpen()) return;
        // Гард — на тихую смену редактора без события (с событием план снимает close).
        // Stryker disable next-line ConditionalExpression: тихая смена между планом и срабатыванием в тестах не воспроизводится, а trigger() всё равно берёт активный редактор
        if (this.group.getActiveEditor() !== editor) return;
        // Выделение и мультикурсор отсекают trigger() и finish ожидания.
        const caret = editor.viewState.selections[0].active;
        if (!shouldAutoTrigger(editor.viewState.document.getLineContent(caret.line), caret.character)) return;

        const languageId = editor.languageId;
        // Эталон пропускает токенизацию, когда всё `on`/всё `off`; здесь режим
        // берётся всегда — каретка во вьюпорте, строка уже размечена рендером.
        const value = valueFor(this.quickSuggestions(languageId), this.tokenTypeBefore(editor, caret));
        if (value === "off" || value === "inline") return;
        const waitForInline =
            value === "offWhenInlineCompletions" &&
            this.languageFeatures.inlineCompletionsProvider.has(editor) &&
            this.configuration.get("editor.inlineSuggest.enabled", { overrideIdentifier: languageId });
        if (!this.canShowSuggestWithInline(languageId)) return;

        if (waitForInline) {
            this.waitForInlineAndTrigger(editor, caret);
        } else {
            void this.trigger(undefined, true);
        }
    }

    /**
     * Символ слева от каретки, как upstream (`column - 2`). Доводка токенизации — только дешёвая
     * (`tokenizeIfCheap`): честный проход до каретки на большом файле — секунды на нажатие.
     */
    private tokenTypeBefore(editor: TextEditorPane, caret: IPosition): StandardTokenType {
        const store = editor.viewState.tokenStore;
        store?.tokenizeIfCheap(caret.line);
        return standardTokenTypeAt(store?.getLineTokens(caret.line), Math.max(caret.character - 1, 0));
    }

    /** Призрака нет — можно; есть — решает `editor.inlineSuggest.suppressSuggestions`. */
    private canShowSuggestWithInline(languageId: string): boolean {
        if (this.inlineSuggestions?.isVisible() !== true) return true;
        return !this.configuration.get("editor.inlineSuggest.suppressSuggestions", { overrideIdentifier: languageId });
    }

    /**
     * upstream `_waitForInlineCompletionsAndTrigger`. Не дождались за {@link INLINE_COMPLETIONS_WAIT_MS} —
     * попап открывается, а запрос призрака бросается; сдвинулись текст или каретка — это уже другой цикл.
     */
    private waitForInlineAndTrigger(editor: TextEditorPane, caret: IPosition): void {
        const inline = this.inlineSuggestions;
        if (inline === null) {
            void this.trigger(undefined, true);
            return;
        }
        const versionId = editor.model.document.versionId;
        const store = new DisposableStore();
        this.waitForInline.value = store;
        // Призрак уже на экране — check() закончит ожидание сразу, без попапа.
        const finish = (doTrigger: boolean): void => {
            this.waitForInline.clear();
            if (!doTrigger || this.isOpen()) return;
            const selections = editor.viewState.selections;
            if (
                this.group.getActiveEditor() === editor &&
                editor.model.document.versionId === versionId &&
                // Stryker disable next-line ConditionalExpression: мульти-каретку trigger() отсекает сам; гард — чтобы не читать selections[0] пустого списка
                selections.length === 1 &&
                isSelectionCollapsed(selections[0]) &&
                selections[0].active.line === caret.line &&
                selections[0].active.character === caret.character
            ) {
                void this.trigger(undefined, true);
            }
        };
        const check = (): void => {
            if (inline.isVisible()) {
                finish(false);
            } else if (!inline.isLoading()) {
                finish(true);
            }
        };
        const timer = setTimeout(() => {
            finish(true);
            inline.stopAutomatic();
        }, INLINE_COMPLETIONS_WAIT_MS);
        store.add({
            dispose: () => {
                clearTimeout(timer);
            },
        });
        store.add(inline.onDidChange(check));
        check();
    }

    /** Из каких документов — по `editor.wordBasedSuggestions` (upstream `WordBasedCompletionItemProvider`). */
    private wordItems(
        editor: TextEditorPane,
        prefix: string,
        extensionItems: readonly ICoreCompletionItem[],
    ): ICoreCompletionItem[] {
        const languageId = editor.languageId;
        const mode = this.configuration.get("editor.wordBasedSuggestions", { overrideIdentifier: languageId });
        if (mode === "off") return [];
        if (
            mode === "offWithInlineSuggestions" &&
            this.languageFeatures.inlineCompletionsProvider.has(editor) &&
            isCompletionsEnabled(this.configuration.get<unknown>(COMPLETIONS_ENABLEMENT_SETTING), languageId)
        ) {
            return [];
        }
        // Stryker disable next-line ConditionalExpression,MethodExpression: эквивалентный — collectWordCompletions дедупит слова, активный документ дважды ничего не меняет
        const others = this.group.getEditors().filter((candidate) => candidate !== editor);
        const sources =
            mode === "currentDocument"
                ? [editor]
                : [
                      editor,
                      ...others.filter((candidate) => mode === "allDocuments" || candidate.languageId === languageId),
                  ];
        const texts = sources.map((source) => source.getText());
        const existing = new Set(extensionItems.map((item) => item.label));
        return collectWordCompletions(texts, prefix)
            .filter((word) => !existing.has(word))
            .map((word) => ({ label: word, insertText: word, kind: KIND_TEXT }));
    }

    /**
     * `core.range` — снимок момента триггера, а добор фильтруется локально: конец range отстаёт от
     * каретки, и accept оставил бы хвост (`"editor.tabSize"di`). Сдвигаем конец на число добранных
     * символов — поэтому только для однострочного range.
     */
    private resolveAcceptRange(core: ICoreCompletionItem, prefixRange: IRange, caret: IPosition): IRange {
        const providerRange = core.range;
        if (providerRange === undefined) return prefixRange;

        const trigger = this.triggerCaret;
        /* v8 ignore start -- defensive: пока попап открыт, triggerCaret выставлен
           (его ставит trigger(), снимает close()), а уход каретки на другую строку
           закрывает попап через refilterOpen — то есть до accept дело не доходит */
        if (caret.line !== trigger?.line) return providerRange;
        /* v8 ignore stop */
        if (providerRange.end.line !== trigger.line) return providerRange;

        const delta = caret.character - trigger.character;
        if (delta === 0) return providerRange;
        return createRange(
            providerRange.start.line,
            providerRange.start.character,
            providerRange.end.line,
            providerRange.end.character + delta,
        );
    }

    private accept(item: CompletionListItem): void {
        const editor = this.activeEditor;
        const core = item.data as ICoreCompletionItem | undefined;
        const prefixRange = this.prefixRange;
        if (editor === null || core === undefined || prefixRange === null) {
            this.close();
            return;
        }
        // Каретку читаем ДО close() — resolveAcceptRange сверяет её с triggerCaret.
        const range = this.resolveAcceptRange(core, prefixRange, editor.viewState.selections[0].active);
        this.close();

        const id = core.id;
        const resolve = this.resolverOf(core);
        // Правки, пришедшие в самом списке (gopls), применяются сразу — эталон
        // в этом случае resolve не ждёт (`suggestController`, «sync additional edits»).
        if (core.additionalEdits !== undefined || id === undefined || resolve === undefined) {
            this.applyAccept(editor, range, core, core.additionalEdits ?? []);
            return;
        }
        // Правки авто-импорта сервер отдаёт только на resolve, а панель описания обычно скрыта.
        // Ждём коротко: вставка не должна зависнуть на молчащем сервере.
        void this.resolveItem(id, resolve, ACCEPT_RESOLVE_TIMEOUT_MS).then((resolved) => {
            this.applyAccept(editor, range, core, resolved?.additionalEdits ?? []);
        });
    }

    /**
     * Вставка и правки-спутники — одна транзакция (один Undo). Каретка — в конце основной вставки,
     * как у эталона: `additionalTextEdits` курсоры лишь сдвигают.
     */
    private applyAccept(
        editor: TextEditorPane,
        range: IRange,
        core: ICoreCompletionItem,
        additionalEdits: readonly ITextEdit[],
    ): void {
        // Правка ниже синхронно вызовет onCaretChanged — не даём ей авто-переоткрыть попап.
        editor.applyExternalEdits(
            [createTextEdit(range, core.insertText), ...additionalEdits],
            "Accept Completion",
            ([inserted]) => [createCursorSelection(inserted.range.end.line, inserted.range.end.character)],
        );

        const command = core.command;
        if (command !== undefined) {
            // Исполняем после вставки, вне текущего стека (editorconfig
            // _triggerSuggestAfterDelay повторно откроет попап).
            queueMicrotask(() => {
                this.commands.execute(command.command, ...(command.arguments ?? []));
            });
        }
    }

    /** Пока панель скрыта, не запрашиваем: у language server'а это запрос на каждое движение по списку. */
    private showDetailsFor(item: CompletionListItem | null): void {
        if (!this.component.detailsVisible) return;
        const core = item?.data as ICoreCompletionItem | undefined;
        if (core === undefined) {
            this.component.setDetailsContent(null);
            return;
        }
        this.component.setDetailsContent(detailsContent(core, this.resolvedItems.get(core.id ?? "")));

        const id = core.id;
        if (id === undefined) return;
        const resolve = this.resolverOf(core);
        // Stryker disable next-line ConditionalExpression: без проверки `resolve(id)` кидает из промиса, который никто не ждёт, — раннер падает на unhandled error, а не тест (см. docs/MUTATION.md, «Раннер упал на мутанте»); ветку «провайдер без resolve» держит тест «источник без резолвера панель не ломает»
        if (resolve === undefined) return;
        // Кэш и склейка параллельных запросов — внутри resolveItem; здесь не
        // дублируем проверку, иначе её ветка становится мёртвой.
        void this.resolveItem(id, resolve).then((resolved) => {
            if (resolved === null) return;
            // Пока ходили за описанием, пользователь мог уйти на другой пункт.
            const selected = this.component.view.getSelectedItem()?.data as ICoreCompletionItem | undefined;
            if (selected?.id !== id) return;
            this.component.setDetailsContent(detailsContent(core, resolved));
        });
    }

    /** `undefined` — провайдер resolve не умеет. */
    private resolverOf(
        core: ICoreCompletionItem,
    ): ((id: string) => Promise<ICoreResolvedCompletion | null>) | undefined {
        const provider = this.providerOf.get(core);
        return provider?.resolveCompletionItem?.bind(provider);
    }

    /** Результат кэшируется, параллельные запросы одного id склеиваются в один RPC. */
    private async resolveItem(
        id: string,
        resolve: (id: string) => Promise<ICoreResolvedCompletion | null>,
        timeoutMs?: number,
    ): Promise<ICoreResolvedCompletion | null> {
        const cached = this.resolvedItems.get(id);
        if (cached !== undefined) return cached;

        let pending = this.pendingResolves.get(id);
        if (pending === undefined) {
            // Stryker disable next-line ArrowFunction: `undefined` вместо `null` дальше неотличим — в кэш он не попадает (get вернёт тот же undefined), а потребители читают ответ через `?.`
            pending = resolve(id).catch(() => null);
            this.pendingResolves.set(id, pending);
            void pending.then((resolved) => {
                this.pendingResolves.delete(id);
                if (resolved !== null) this.resolvedItems.set(id, resolved);
            });
        }
        if (timeoutMs === undefined) return pending;
        // Гонка с таймаутом только для пути accept: там за ожиданием стоит
        // правка буфера, и «сервер думает» не должен читаться как зависание.
        return Promise.race([
            pending,
            new Promise<null>((resolve) => {
                setTimeout(() => {
                    resolve(null);
                }, timeoutMs);
            }),
        ]);
    }
}

/** upstream `isCompletionsEnabledFromObject`: ключ языка главнее `"*"`; не объект — выключены. */
function isCompletionsEnabled(setting: unknown, languageId: string): boolean {
    if (typeof setting !== "object" || setting === null || Array.isArray(setting)) return false;
    const byLanguage = setting as Readonly<Record<string, unknown>>;
    if (byLanguage[languageId] !== undefined) return Boolean(byLanguage[languageId]);
    return Boolean(byLanguage["*"]);
}

/** Пустой кусок — тоже «слово». */
function isWordRun(text: string): boolean {
    for (const char of text) {
        if (!WORD_CHAR.test(char)) return false;
    }
    return true;
}

function wordStart(line: string, character: number): number {
    let start = Math.min(character, line.length);
    while (start > 0 && WORD_CHAR.test(line[start - 1])) start--;
    return start;
}

/** Общий `range.start.character` пунктов; `null` — диапазонов нет или они расходятся. */
function commonPrefixStart(items: readonly ICoreCompletionItem[], caret: IPosition): number | null {
    let start: number | null = null;
    for (const item of items) {
        const range = item.range;
        if (range === undefined) continue;
        if (range.start.line !== caret.line || range.start.character > caret.character) return null;
        if (start === null) {
            start = range.start.character;
        } else if (start !== range.start.character) {
            return null;
        }
    }
    return start;
}

/** `labelDetail` предпочтительнее `detail`: у LSP это компактная сигнатура, а `detail` бывает абзацем. */
function detailsContent(core: ICoreCompletionItem, resolved?: ICoreResolvedCompletion): CompletionDetailsContent {
    const detail = resolved?.detail ?? core.detail ?? core.labelDetail;
    const documentation = resolved?.documentation ?? core.documentation;
    return {
        ...(detail !== undefined && detail !== "" ? { detail } : {}),
        ...(documentation !== undefined && documentation !== "" ? { documentation } : {}),
    };
}

function toListItem(core: ICoreCompletionItem): CompletionListItem {
    return {
        label: core.label,
        ...(core.detail !== undefined ? { detail: core.detail } : {}),
        ...(core.labelDetail !== undefined ? { labelDetail: core.labelDetail } : {}),
        ...(core.kind !== undefined ? { kind: core.kind } : {}),
        ...(core.filterText !== undefined ? { filterText: core.filterText } : {}),
        ...(core.sortText !== undefined ? { sortText: core.sortText } : {}),
        data: core,
    };
}
