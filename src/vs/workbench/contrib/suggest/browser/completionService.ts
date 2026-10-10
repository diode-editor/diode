import type { CompletionDetailsContent } from "@tuidom/elements/completionlist/completionDetailsElement";
import type { CompletionListItem } from "@tuidom/elements/completionlist/completionListElement";

import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
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
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
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
import type { SuggestComponent } from "./suggestComponent.ts";
import { SuggestComponentDIToken } from "./suggestComponent.ts";

export const CompletionServiceDIToken = token<CompletionService>("CompletionService");

/** Символы, образующие «слово» под курсором (префикс автодополнения). */
const WORD_CHAR = /[\w.-]/;

/** `CompletionItemKind.Text` — для word-based элементов. */
const KIND_TEXT = 0;

/** Сколько ждём resolve перед вставкой (правки авто-импорта). */
const ACCEPT_RESOLVE_TIMEOUT_MS = 300;

/** Ответ «провайдеров для документа нет». */
const EMPTY_RESULT: ICompletionsFromProviders = { items: [], isIncomplete: false, providerOf: new Map() };

/**
 * Логика автодополнения ядра (WP8). По триггеру
 * (`editor.action.triggerSuggest` / Ctrl+Space) запрашивает элементы у
 * подошедших документу провайдеров реестра `ILanguageFeaturesService.completionProvider`,
 * показывает попап {@link SuggestComponent} у каретки и вставляет выбранный
 * элемент. `item.command` исполняется напрямую через {@link CommandRegistry}
 * (как у QuickOpenService). Построен по образцу quick-open-оверлея.
 */
export class CompletionService extends Disposable implements IContextKeyContributor {
    private readonly onDidCloseEmitter = this.register(new Emitter<void>());
    public static dependencies = [
        SuggestComponentDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        StateServiceDIToken,
        FocusTrackerDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    /**
     * Задержка авто-suggest (мс) перед запросом провайдеров после набора буквы.
     * Инъектируется в тестах (`0` — сразу на следующем тике).
     */
    public autoSuggestDelayMs = 120;

    private readonly component: SuggestComponent;
    private readonly group: IEditorService;
    private readonly commands: CommandRegistry;
    private readonly state: IStateService;
    private readonly languageFeatures: ILanguageFeaturesService;
    private activeEditor: TextEditorPane | null = null;
    private prefixRange: IRange | null = null;
    // Границу префикса задал провайдер (а не наш wordStart) — её нельзя
    // пересчитывать при доборе символов, см. refilterOpen.
    private prefixFromProvider = false;
    // Каретка на момент запроса провайдеров. Провайдерский `range` — снапшот той же
    // позиции, поэтому по нему мы отслеживаем, сколько символов добрали с триггера.
    private triggerCaret: IPosition | null = null;
    // Каретка последнего запроса к провайдерам (`null` — запросов ещё не было).
    // Пока ответа нет и попап не открыт, по ней решается, нужен ли он ещё:
    // см. cancelRequestIfCaretLeft. После ответа отмена по ней холостая.
    private requestCaret: IPosition | null = null;

    // Отложенный авто-запрос по набору; символ, которым он спровоцирован (`.`),
    // лежит в pendingTriggerCharacter.
    private readonly autoSuggest = this.register(
        new RunOnceScheduler(() => {
            const character = this.pendingTriggerCharacter;
            this.pendingTriggerCharacter = undefined;
            void this.trigger(character);
        }, this.autoSuggestDelayMs),
    );
    private pendingTriggerCharacter: string | undefined = undefined;
    // Последний запрос к источнику: ответ перебитого запроса устарел.
    private readonly latest = new LatestRequest();
    // Последний ответ был неполным (сервер отфильтровал список под префикс) —
    // добор символа обязан перезапросить источник, а не сужать локально.
    private isIncomplete = false;
    // Владелец каждого пункта показанного списка — у него и спрашивается resolve.
    private providerOf: ReadonlyMap<ICoreCompletionItem, CompletionItemProvider> = new Map();
    // Догруженные пункты и запросы «в полёте» (ключ — id пункта у источника).
    private readonly resolvedItems = new Map<string, ICoreResolvedCompletion>();
    private readonly pendingResolves = new Map<string, Promise<ICoreResolvedCompletion | null>>();

    public constructor(
        component: SuggestComponent,
        group: IEditorService,
        commands: CommandRegistry,
        state: IStateService,
        focusTracker: FocusTracker,
        languageFeatures: ILanguageFeaturesService,
    ) {
        super();
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
        // Фокус ушёл с редактора (клавиатурный путь: Ctrl+Tab, Quick Open) —
        // попап закрывается, а запрос «в полёте» отменяется: его ответ поднял бы
        // попап под чужим фокусом. Клик-фокус уже покрыт `close-on-outside`.
        this.register(
            focusTracker.onDidChangeFocus((active) => {
                if (!(active instanceof EditorElement)) this.close();
            }),
        );

        // «Всегда-включённая» подписка на активный редактор: и re-filter пока
        // попап открыт, и авто-открытие по мере набора пока закрыт. Безусловный
        // close() на смене: она гасит и отложенный авто-suggest.
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
     * Запрашивает автодополнения для текущей позиции курсора и показывает попап.
     * No-op, если нет активного редактора, источника, или каретка вне вьюпорта.
     * `triggerCharacter` — символ, которым набор спровоцировал открытие (`.`):
     * серверы отвечают на него не тем же, чем на Ctrl+Space.
     */
    public async trigger(triggerCharacter?: string): Promise<void> {
        this.cancelAutoSuggest();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;

        // Мультикурсор автодополнение не поддерживает: попап якорится на одной каретке, а
        // accept вставил бы правку мимо остальных и схлопнул бы их. Авто-путь
        // (`handleSelectionChange`) это уже учитывает; ручной Ctrl+Space обязан тоже.
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;

        const active = selections[0].active;

        // Провайдеры, подошедшие документу + word-based fallback из всех
        // открытых редакторов (как editor.wordBasedSuggestions в VS Code).
        const providers = this.languageFeatures.completionProvider.ordered(editor);
        const ticket = this.latest.start();
        this.requestCaret = active;
        // Срока ответа у провайдеров нет (как в upstream): language server на
        // холодном старте думает секунды, и подменять его ответ словами из
        // буфера нельзя — открытый попап уже не перезапросится. Ждём, пока ответ
        // нужен; ненужный гасит билет (новый запрос, уход каретки, close).
        // Без провайдеров — пустой ответ без обращения к агрегатору.
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
        // Пока ходили за ответом, пользователь мог набрать ещё символ — свежий
        // запрос уже в пути, и старый ответ не имеет права перекрыть его.
        if (ticket.isStale()) return;

        // Пока ждали ответа, слово могли добрать: запрос переживает только такой
        // сдвиг каретки (остальные его отменяют — cancelRequestIfCaretLeft), и
        // список сужается под набранное сразу, а не под снимок момента запроса.
        const caret = editor.viewState.selections[0].active;
        const caretLine = editor.viewState.document.getLineContent(caret.line);

        const extensionItems = result.items;
        // Границу префикса задаёт сам провайдер: у LSP-пунктов `range` — это
        // заменяемое слово, и после `d.` он начинается ПОСЛЕ точки. Свой
        // wordStart тут не годится: WORD_CHAR включает `.` и `-` (они нужны
        // ключам settings.json и editorconfig), поэтому префиксом стало бы
        // `d.` — он не матчит ни один label, и список схлопывался.
        const providerStart = commonPrefixStart(extensionItems, active);
        const prefixStart = providerStart ?? wordStart(caretLine, caret.character);
        const prefix = caretLine.slice(prefixStart, caret.character);

        // Слова из буфера подмешиваем только там, где провайдер не задал своего
        // диапазона: после точки они были бы шумом поверх членов типа.
        const items =
            providerStart === null ? [...extensionItems, ...this.wordItems(prefix, extensionItems)] : extensionItems;
        if (items.length === 0) return;

        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.activeEditor = editor;
        this.prefixRange = createRange(caret.line, prefixStart, caret.line, caret.character);
        this.prefixFromProvider = providerStart !== null;
        // Снимок каретки ЗАПРОСА, а не текущей: от него accept отсчитывает добор
        // к провайдерскому range (resolveAcceptRange).
        this.triggerCaret = { line: active.line, character: active.character };
        this.isIncomplete = result.isIncomplete;
        this.providerOf = result.providerOf;

        const view = this.component.view;
        view.setItems(items.map(toListItem));
        view.setFilter(prefix);
        // Если префикс отфильтровал всё — показываем полный список (можно добрать).
        if (view.items.length === 0) view.setFilter("");

        // Фокус попап не забирает — редактор остаётся активным (VS Code-like).
        this.component.openAt(anchor);
    }

    public close(): void {
        // Закрытие ОТКРЫТОГО попапа — событие для подписчиков (призрачные
        // подсказки перезапрашиваются, когда попап освобождает место — VS Code
        // так же «пересеивает» inline-состояние на закрытии виджета). Флаг
        // снимается до сайд-эффектов: close() зовут либерально (bindEditor —
        // безусловно), и холостые вызовы событием быть не должны.
        const wasOpen = this.isOpen();
        this.cancelAutoSuggest();
        this.component.close();
        this.activeEditor = null;
        this.prefixRange = null;
        this.prefixFromProvider = false;
        this.triggerCaret = null;
        this.isIncomplete = false;
        // Ответ «в полёте» больше не нужен: его билет устареет и ответ будет отброшен.
        this.latest.cancel();
        if (wasOpen) {
            this.onDidCloseEmitter.fire();
        }
    }

    /**
     * Подписка на закрытие попапа (Esc, accept, уход каретки из слова, смена
     * редактора/фокуса — все пути сходятся в {@link close}). Не фаерится, если
     * попап и так был закрыт.
     */
    public readonly onDidClose = this.onDidCloseEmitter.event;

    /** Открыт ли попап (для `suggestWidgetVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.component.isOpen();
    }

    /** IContextKeyContributor: `suggestWidgetVisible` — гейт Enter/Tab/стрелок попапа. */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("suggestWidgetVisible", this.isOpen());
    }

    // ─── Delegators for keybinding commands (suggestWidgetVisible) ─────────────

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

    /**
     * Показать/скрыть панель описания (`toggleSuggestionDetails`). Выбор
     * пользователя переживает рестарт: это привычка человека, а не свойство
     * проекта. Дефолт — скрыта, как в VS Code.
     */
    public toggleDetails(): void {
        const next = !this.component.detailsVisible;
        this.component.detailsVisible = next;
        this.state.store(SUGGEST_DETAILS_VISIBLE_STATE, next);
        // Сворачивание меняет ширину попапа так же, как разворот — слой обязан
        // пересчитать позицию и перерисовать освободившуюся область.
        this.component.refreshDetailsLayout();
        // Тумблер включили при открытом попапе — описание выбранного пункта
        // могло быть ещё не запрошено.
        if (next) this.showDetailsFor(this.component.view.getSelectedItem());
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /**
     * Правка или движение каретки при открытом попапе: сужает список от
     * актуального префикса (или закрывает, если каретка ушла из слова).
     */
    private onCaretChanged(editor: TextEditorPane): void {
        if (!this.isOpen()) {
            this.cancelRequestIfCaretLeft(editor);
            return;
        }
        const selections = editor.viewState.selections;
        // Выделение или мультикурсор — сужать нечего: попап привязан к одной каретке.
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) {
            this.close();
            return;
        }
        const active = selections[0].active;
        this.refilterOpen(editor, active, editor.viewState.document.getLineContent(active.line));
    }

    /**
     * Запрос «в полёте» нужен, пока каретка продолжает слово, для которого он
     * задан: та же строка, не левее и добор словесный (upstream
     * `SuggestModel._onNewContext`: другая строка и шаг влево отменяют запрос).
     * Иначе запрос отменяется сразу — срока ответа у него нет, и ответ
     * медленного сервера поднял бы попап там, откуда человек давно ушёл, а сам
     * сервер считал бы впустую.
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
     * Набор символа (событие редактора, а не «строка выросла на символ»: правка
     * от accept, undo и вставка набором не считаются — как quick suggest в
     * upstream). Приходит ПОСЛЕ события каретки той же правки. Триггер-символ
     * сервера (`.`) переоткрывает список у новой границы слова, даже если попап
     * висел: после точки это другой запрос (`TriggerCharacter`), а не сужение
     * прежнего. Word-символ при закрытом попапе авто-открывает его.
     */
    private onDidType(editor: TextEditorPane, text: string): void {
        // Мультикурсор и выделение отсекает сам trigger(): попап привязан к одной каретке.
        // Символы — метаданные провайдеров, подошедших именно этому документу:
        // «.» сервера TypeScript не открывает попап в markdown.
        const triggers = this.languageFeatures.completionProvider
            .ordered(editor)
            .flatMap((provider) => provider.triggerCharacters);
        if (triggers.includes(text)) {
            if (this.isOpen()) this.component.close();
            // Запрос «в полёте» — про слово ДО символа: его ответ поднял бы
            // прежний список на время ожидания нового.
            this.latest.cancel();
            this.scheduleAutoSuggest(text);
        } else if (!this.isOpen() && WORD_CHAR.test(text)) {
            this.scheduleAutoSuggest();
        }
    }

    /** Re-filter при открытом попапе (закрывает при уходе каретки из слова). */
    private refilterOpen(editor: TextEditorPane, active: IPosition, line: string): void {
        const prefixRange = this.prefixRange;
        // При открытом попапе prefixRange недостижимо пуст: его ставит trigger()
        // вместе с открытием, а снимает только close() — проверка ради сужения типа.
        /* v8 ignore start -- defensive: см. выше */
        // Stryker disable next-line ConditionalExpression,BlockStatement: недостижимая ветка, см. выше
        if (prefixRange === null) {
            this.close();
            return;
        }
        /* v8 ignore stop */
        // Другая строка или каретка левее начала префикса — вышли из слова.
        if (active.line !== prefixRange.start.line || active.character < prefixRange.start.character) {
            this.close();
            return;
        }
        // Добор с момента запроса обязан продолжать слово. Провайдерскую границу
        // пересчитывать нельзя (см. ниже), и без этой проверки попап переживал
        // ЛЮБОЙ несловесный символ: `refineFilter` при непопадании оставляет
        // последний непустой список, так что виджет оставался видимым со
        // стухшими пунктами. А пока он видим, Enter забирает себе
        // `acceptSelectedSuggestion` (when: suggestWidgetVisible) — вместо
        // переноса строки набранное молча заменялось пунктом списка:
        // `cons{` + Enter давали `console`.
        const trigger = this.triggerCaret;
        // `trigger === null` при открытом попапе недостижимо: снимок каретки ставит
        // trigger() вместе с prefixRange, а снимает только close() — проверка тут
        // ради сужения типа.
        // Stryker disable next-line ConditionalExpression: недостижимая ветка, см. выше
        if (trigger !== null && !isWordRun(line.slice(trigger.character, active.character))) {
            this.close();
            return;
        }
        // Границу, заданную провайдером, своим wordStart пересчитывать нельзя:
        // она намеренно проходит там, где у ядра границы слова нет (кавычка
        // ключа в settings.json, точка у dot-accessor'ов tsserver) — пересчёт
        // «не сошёлся» и закрывал попап на первом же добранном символе.
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
        this.component.view.refineFilter(prefix);
        this.prefixRange = createRange(prefixRange.start.line, prefixStart, active.line, active.character);
        this.component.setAnchor(anchor);

        // Неполный список сервер отфильтровал под ПРЕЖНИЙ префикс — локальное
        // сужение по нему врёт (пунктов, подходящих под новый, в нём может не
        // быть вовсе). Показываем сужение сразу, а следом перезапрашиваем.
        if (this.isIncomplete) this.scheduleAutoSuggest();
    }

    private scheduleAutoSuggest(triggerCharacter?: string): void {
        this.pendingTriggerCharacter = triggerCharacter;
        this.autoSuggest.schedule(this.autoSuggestDelayMs);
    }

    private cancelAutoSuggest(): void {
        this.autoSuggest.cancel();
        this.pendingTriggerCharacter = undefined;
    }

    /**
     * Word-based элементы из текста всех открытых редакторов (всех групп), без
     * дублей с элементами провайдеров. Большие файлы отсекаются внутри
     * {@link collectWordCompletions}.
     */
    private wordItems(prefix: string, extensionItems: readonly ICoreCompletionItem[]): ICoreCompletionItem[] {
        const texts = this.group.getEditors().map((editor) => editor.getText());
        const existing = new Set(extensionItems.map((item) => item.label));
        return collectWordCompletions(texts, prefix)
            .filter((word) => !existing.has(word))
            .map((word) => ({ label: word, insertText: word, kind: KIND_TEXT }));
    }

    /**
     * Диапазон, который реально заменяется при accept.
     *
     * Без провайдерского `range` берём `prefixRange` — он живой, `refilterOpen`
     * держит его в актуальном состоянии. А вот `core.range` — снапшот момента
     * триггера: попап при доборе символов не перезапрашивается (re-filter
     * локальный), поэтому конец range отстаёт от каретки, и accept затёр бы
     * только часть набранного, оставив хвост (`"editor.tabSize"di`). Сдвигаем
     * конец на число набранных с триггера символов.
     *
     * Сдвиг посимвольный, поэтому применим только к однострочному range.
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
        // Многострочный range провайдера: посимвольный сдвиг к нему неприменим.
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
        if (id === undefined || resolve === undefined) {
            this.applyAccept(editor, range, core, []);
            return;
        }
        // Правки-спутники (авто-импорт) сервер отдаёт ТОЛЬКО на resolve, а он
        // мог ещё не случиться: панель описания по умолчанию скрыта. Ждём его
        // коротко — вставка не имеет права зависнуть на молчащем сервере
        // (уже догруженный пункт resolveItem отдаёт из кэша сразу).
        void this.resolveItem(id, resolve, ACCEPT_RESOLVE_TIMEOUT_MS).then((resolved) => {
            this.applyAccept(editor, range, core, resolved?.additionalEdits ?? []);
        });
    }

    /**
     * Применяет вставку выбранного пункта вместе с правками-спутниками ОДНОЙ
     * транзакцией: `import` сверху файла и сам символ обязаны откатываться
     * одним Undo. Порядок правок не важен — модель сортирует их и применяет
     * снизу вверх. Каретка — одна, в конце вставленного символа (с учётом
     * строк, которые добавил импорт выше): так эталон ставит курсор основной
     * вставкой, а `additionalTextEdits` курсоры лишь сдвигают
     * (`suggestController` — `executeEdits` без cursor computer).
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

    /**
     * Наполняет панель описанием выбранного пункта: сразу тем, что уже есть в
     * пункте, и — если источник умеет resolve — догруженным описанием следом.
     * Пока панель скрыта, ничего не запрашиваем: у language server'а это сетевой
     * запрос на каждое движение по списку.
     */
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
        // Stryker disable next-line ConditionalExpression: без проверки `resolve(id)` кидает из промиса, который никто не ждёт, — раннер падает на unhandled error, а не тест (см. docs/TESTING.md, «Раннер упал на мутанте»); ветку «провайдер без resolve» держит тест «источник без резолвера панель не ломает»
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

    /** Resolve провайдера, отдавшего пункт; `undefined` — провайдер его не умеет. */
    private resolverOf(
        core: ICoreCompletionItem,
    ): ((id: string) => Promise<ICoreResolvedCompletion | null>) | undefined {
        const provider = this.providerOf.get(core);
        return provider?.resolveCompletionItem?.bind(provider);
    }

    /**
     * Догружает пункт по id (описание для панели, правки авто-импорта) у
     * провайдера, который его отдал. Результат кэшируется, повторные и
     * параллельные запросы одного id склеиваются в один RPC.
     */
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

/** Все ли символы куска — «словесные» (см. {@link WORD_CHAR}); пустой кусок — да. */
function isWordRun(text: string): boolean {
    for (const char of text) {
        if (!WORD_CHAR.test(char)) return false;
    }
    return true;
}

/** Индекс начала «слова» под курсором (скан назад по {@link WORD_CHAR}). */
function wordStart(line: string, character: number): number {
    let start = Math.min(character, line.length);
    while (start > 0 && WORD_CHAR.test(line[start - 1])) start--;
    return start;
}

/**
 * Начало заменяемого слова по мнению провайдера: общий `range.start.character`
 * всех пунктов на строке каретки. `null` — диапазонов нет или они расходятся
 * (тогда границу считает ядро своим {@link wordStart}).
 */
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

/**
 * Содержимое панели: сигнатура (`labelDetail` предпочтительнее — у LSP это
 * компактная сигнатура, тогда как `detail` бывает целым абзацем) и документация;
 * догруженные поля побеждают исходные.
 */
function detailsContent(core: ICoreCompletionItem, resolved?: ICoreResolvedCompletion): CompletionDetailsContent {
    const detail = resolved?.detail ?? core.detail ?? core.labelDetail;
    const documentation = resolved?.documentation ?? core.documentation;
    return {
        ...(detail !== undefined && detail !== "" ? { detail } : {}),
        ...(documentation !== undefined && documentation !== "" ? { documentation } : {}),
    };
}

/** Проецирует core-item в элемент виджета (core сохраняется в `data`). */
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
