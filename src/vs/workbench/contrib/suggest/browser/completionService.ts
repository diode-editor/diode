import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
import type { CompletionDetailsContent } from "@tuidom/elements/completionlist/completionDetailsElement";
import type { CompletionListItem } from "@tuidom/elements/completionlist/completionListElement";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    ICoreCompletionItem,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { CommandRegistryDIToken } from "../../../../platform/commands/common/commandRegistry.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IStateService } from "../../../../platform/state/common/iStateService.ts";
import { StateServiceDIToken } from "../../../common/coreTokens.ts";
import { SUGGEST_DETAILS_VISIBLE_STATE } from "../../../common/stateKeys.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import { collectWordCompletions } from "./collectWordCompletions.ts";
import type { SuggestComponent } from "./suggestComponent.ts";
import { SuggestComponentDIToken } from "./suggestComponent.ts";

export const CompletionServiceDIToken = token<CompletionService>("CompletionService");

/** Символы, образующие «слово» под курсором (префикс автодополнения). */
const WORD_CHAR = /[\w.-]/;

/** `CompletionItemKind.Text` — для word-based элементов. */
const KIND_TEXT = 0;

/** Сколько ждём resolve перед вставкой (правки авто-импорта). */
const ACCEPT_RESOLVE_TIMEOUT_MS = 300;

/** Ответ «источника нет» — форма {@link ICoreCompletionResult}. */
const EMPTY_RESULT: ICoreCompletionResult = { items: [], isIncomplete: false };

/**
 * Логика автодополнения ядра (WP8). По триггеру
 * (`editor.action.triggerSuggest` / Ctrl+Space) запрашивает элементы у
 * `EditorService.completionSource` (провайдеры расширений через host),
 * показывает попап {@link SuggestComponent} у каретки и вставляет выбранный
 * элемент. `item.command` исполняется напрямую через {@link CommandRegistry}
 * (как у QuickOpenService). Построен по образцу quick-open-оверлея.
 */
export class CompletionService extends Disposable {
    public static dependencies = [
        SuggestComponentDIToken,
        EditorServiceDIToken,
        CommandRegistryDIToken,
        StateServiceDIToken,
    ] as const;

    /**
     * Задержка авто-suggest (мс) перед запросом провайдеров после набора буквы.
     * Инъектируется в тестах (`0` — сразу на следующем тике).
     */
    public autoSuggestDelayMs = 120;

    private readonly component: SuggestComponent;
    private readonly group: EditorService;
    private readonly commands: CommandRegistry;
    private readonly state: IStateService;
    private activeEditor: TextEditorPane | null = null;
    private prefixRange: IRange | null = null;
    // Границу префикса задал провайдер (а не наш wordStart) — её нельзя
    // пересчитывать при доборе символов, см. refilterOpen.
    private prefixFromProvider = false;
    // Каретка на момент запроса провайдеров. Провайдерский `range` — снапшот той же
    // позиции, поэтому по нему мы отслеживаем, сколько символов добрали с триггера.
    private triggerCaret: IPosition | null = null;

    // Подписки на активный редактор (пере-навешиваются при смене активного).
    private caretSub: IDisposable | null = null;
    private contentSub: IDisposable | null = null;
    // Маркер «был правкой контента» (typing/удаление), выставляется content-листенером
    // и потребляется в onCaretChanged (view-state там уже консистентен).
    private contentDidChange = false;
    // Кэш прошлого состояния строки/каретки для эвристики «вставлен 1 word-символ».
    private lastCaretLine = -1;
    private lastCaretChar = -1;
    private lastLine = "";
    private autoSuggestTimer: ReturnType<typeof setTimeout> | null = null;
    // Символ, которым спровоцирован отложенный авто-запрос (`.`), если он был.
    private pendingTriggerCharacter: string | undefined = undefined;
    // Номер последнего запроса к источнику: ответ с чужим номером устарел.
    private requestSeq = 0;
    // Последний ответ был неполным (сервер отфильтровал список под префикс) —
    // добор символа обязан перезапросить источник, а не сужать локально.
    private isIncomplete = false;
    // Догруженные пункты и запросы «в полёте» (ключ — id пункта у источника).
    private readonly resolvedItems = new Map<string, ICoreResolvedCompletion>();
    private readonly pendingResolves = new Map<string, Promise<ICoreResolvedCompletion | null>>();
    // Гасит одно авто-открытие после принятия пункта (правка accept не должна
    // сама переоткрыть попап — переоткрытие только через провайдерский _retrigger).
    private suppressAutoSuggestOnce = false;

    public constructor(
        component: SuggestComponent,
        group: EditorService,
        commands: CommandRegistry,
        state: IStateService,
    ) {
        super();
        this.component = component;
        this.group = group;
        this.commands = commands;
        this.state = state;
        this.component.view.onAccept = (item) => {
            this.accept(item);
        };
        this.component.view.onSelectionChanged = (item) => {
            this.showDetailsFor(item);
        };
        this.component.detailsVisible = this.state.get(SUGGEST_DETAILS_VISIBLE_STATE);

        // «Всегда-включённая» подписка на активный редактор: и re-filter пока
        // попап открыт, и авто-открытие по мере набора пока закрыт.
        const activeEditorSub = this.group.onActiveEditorChanged((editor) => {
            this.bindEditor(editor);
        });
        this.bindEditor(this.group.getActiveEditor());
        this.register({
            dispose: () => {
                activeEditorSub.dispose();
                this.unbindEditor();
                this.cancelAutoSuggest();
            },
        });
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

        const active = editor.viewState.selections[0].active;
        const lineContent = editor.viewState.document.getLineContent(active.line);

        // Провайдеры расширений (если подключён источник) + word-based fallback
        // из всех открытых редакторов (как editor.wordBasedSuggestions в VS Code).
        const source = this.group.completionSource;
        const seq = ++this.requestSeq;
        const result = source
            ? await source({
                  uri: editor.uri.toString(),
                  languageId: editor.languageId,
                  text: editor.getText(),
                  line: active.line,
                  character: active.character,
                  triggerKind:
                      triggerCharacter !== undefined
                          ? CompletionTriggerKind.TriggerCharacter
                          : CompletionTriggerKind.Invoke,
                  ...(triggerCharacter !== undefined ? { triggerCharacter } : {}),
              })
            : EMPTY_RESULT;
        // Пока ходили за ответом, пользователь мог набрать ещё символ — свежий
        // запрос уже в пути, и старый ответ не имеет права перекрыть его.
        if (seq !== this.requestSeq) return;

        const extensionItems = result.items;
        // Границу префикса задаёт сам провайдер: у LSP-пунктов `range` — это
        // заменяемое слово, и после `d.` он начинается ПОСЛЕ точки. Свой
        // wordStart тут не годится: WORD_CHAR включает `.` и `-` (они нужны
        // ключам settings.json и editorconfig), поэтому префиксом стало бы
        // `d.` — он не матчит ни один label, и список схлопывался.
        const providerStart = commonPrefixStart(extensionItems, active);
        const prefixStart = providerStart ?? wordStart(lineContent, active.character);
        const prefix = lineContent.slice(prefixStart, active.character);

        // Слова из буфера подмешиваем только там, где провайдер не задал своего
        // диапазона: после точки они были бы шумом поверх членов типа.
        const items =
            providerStart === null ? [...extensionItems, ...this.wordItems(prefix, extensionItems)] : extensionItems;
        if (items.length === 0) return;

        // Каретка могла уйти за время await — берём актуальный якорь.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) return;

        this.activeEditor = editor;
        this.prefixRange = createRange(active.line, prefixStart, active.line, active.character);
        this.prefixFromProvider = providerStart !== null;
        this.triggerCaret = { line: active.line, character: active.character };
        this.isIncomplete = result.isIncomplete;

        const view = this.component.view;
        view.setItems(items.map(toListItem));
        view.setFilter(prefix);
        // Если префикс отфильтровал всё — показываем полный список (можно добрать).
        if (view.items.length === 0) view.setFilter("");

        // Фокус попап не забирает — редактор остаётся активным (VS Code-like).
        this.component.openAt(anchor);
    }

    public close(): void {
        this.cancelAutoSuggest();
        this.component.close();
        this.activeEditor = null;
        this.prefixRange = null;
        this.prefixFromProvider = false;
        this.triggerCaret = null;
        this.isIncomplete = false;
        // Ответ «в полёте» больше не нужен: его seq устареет и будет отброшен.
        this.requestSeq++;
    }

    /** Открыт ли попап (для `suggestWidgetVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.component.isOpen();
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

    /**
     * Закрывает попап при уходе фокуса с редактора (клавиатурный путь: Ctrl+Tab,
     * Quick Open). Клик-фокус уже покрыт `close-on-outside`. `editorFocused` —
     * стал ли активным элемент-редактор после смены фокуса.
     */
    public onFocusChanged(editorFocused: boolean): void {
        if (!editorFocused && this.isOpen()) this.close();
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /**
     * Пере-навешивает подписки на нового активного редактора. Безусловный
     * {@link close} (а не «закрыть, если открыт»): смена активного редактора
     * должна гасить и отложенный авто-suggest — раньше это делал отдельный
     * обработчик корневого контроллера, теперь сложено сюда.
     */
    private bindEditor(editor: TextEditorPane | null): void {
        this.unbindEditor();
        this.close();
        this.resetCaretCache(editor);
        if (editor === null) return;
        this.contentSub = editor.onDidChangeContent(() => {
            this.contentDidChange = true;
        });
        this.caretSub = editor.onDidChangeCursorPosition(() => {
            this.onCaretChanged();
        });
    }

    private unbindEditor(): void {
        this.caretSub?.dispose();
        this.caretSub = null;
        this.contentSub?.dispose();
        this.contentSub = null;
        this.contentDidChange = false;
    }

    /**
     * Единый обработчик изменения каретки/текста. Пока попап открыт — сужает
     * список от актуального префикса (или закрывает, если каретка ушла из слова);
     * пока закрыт — авто-открывает попап при наборе word-символа.
     */
    private onCaretChanged(): void {
        const wasEdit = this.contentDidChange;
        this.contentDidChange = false;

        const editor = this.group.getActiveEditor();
        if (editor === null) {
            if (this.isOpen()) this.close();
            this.resetCaretCache(null);
            return;
        }

        const selections = editor.viewState.selections;
        const single = selections.length === 1 && isSelectionCollapsed(selections[0]);
        const active = single ? selections[0].active : null;
        const line = active !== null ? editor.viewState.document.getLineContent(active.line) : "";

        const suppressed = this.suppressAutoSuggestOnce;
        this.suppressAutoSuggestOnce = false;

        // Набран триггер-символ сервера (`.`) — переоткрываем список у новой
        // границы слова, даже если попап уже висел: после точки это другой
        // запрос (`TriggerCharacter`), а не сужение прежнего.
        const triggerChar =
            !suppressed && single && active !== null && wasEdit ? this.insertedTriggerCharacter(line, active) : null;
        if (triggerChar !== null) {
            if (this.isOpen()) this.component.close();
            this.scheduleAutoSuggest(triggerChar);
        } else if (this.isOpen()) {
            this.refilterOpen(editor, active, line);
        } else if (!suppressed && single && active !== null && wasEdit && this.isSingleWordCharInsert(line, active)) {
            this.scheduleAutoSuggest();
        }

        this.updateCaretCache(active, line);
    }

    /** Re-filter при открытом попапе (закрывает при уходе каретки из слова). */
    private refilterOpen(editor: TextEditorPane, active: IPosition | null, line: string): void {
        const prefixRange = this.prefixRange;
        if (active === null || prefixRange === null) {
            this.close();
            return;
        }
        // Другая строка или каретка левее начала префикса — вышли из слова.
        if (active.line !== prefixRange.start.line || active.character < prefixRange.start.character) {
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

    /** Эвристика «вставлен ровно один word-символ у каретки» (набор буквы). */
    private isSingleWordCharInsert(line: string, active: IPosition): boolean {
        return isSingleCharInsert(line, active, this.lastCaretLine, this.lastCaretChar, this.lastLine, WORD_CHAR);
    }

    /**
     * Набранный символ, если это триггер-символ источника (`.` у tsserver);
     * иначе `null`. Символы объявляет language server при регистрации
     * провайдера — ядро их только читает.
     */
    private insertedTriggerCharacter(line: string, active: IPosition): string | null {
        const characters = this.group.completionTriggerCharacters;
        if (characters.length === 0) return null;
        if (!isSingleCharInsert(line, active, this.lastCaretLine, this.lastCaretChar, this.lastLine)) return null;
        const inserted = line.at(active.character - 1);
        return inserted !== undefined && characters.includes(inserted) ? inserted : null;
    }

    private updateCaretCache(active: IPosition | null, line: string): void {
        this.lastCaretLine = active?.line ?? -1;
        this.lastCaretChar = active?.character ?? -1;
        this.lastLine = line;
    }

    private resetCaretCache(editor: TextEditorPane | null): void {
        if (editor === null) {
            this.updateCaretCache(null, "");
            return;
        }
        const selections = editor.viewState.selections;
        const active = selections.length === 1 && isSelectionCollapsed(selections[0]) ? selections[0].active : null;
        const line = active !== null ? editor.viewState.document.getLineContent(active.line) : "";
        this.updateCaretCache(active, line);
    }

    private scheduleAutoSuggest(triggerCharacter?: string): void {
        this.cancelAutoSuggest();
        this.pendingTriggerCharacter = triggerCharacter;
        this.autoSuggestTimer = setTimeout(() => {
            this.autoSuggestTimer = null;
            const character = this.pendingTriggerCharacter;
            this.pendingTriggerCharacter = undefined;
            void this.trigger(character);
        }, this.autoSuggestDelayMs);
    }

    private cancelAutoSuggest(): void {
        if (this.autoSuggestTimer !== null) {
            clearTimeout(this.autoSuggestTimer);
            this.autoSuggestTimer = null;
        }
        this.pendingTriggerCharacter = undefined;
    }

    /**
     * Word-based элементы из текста всех открытых редакторов группы, без
     * дублей с элементами провайдеров. Большие файлы отсекаются внутри
     * {@link collectWordCompletions}.
     */
    private wordItems(prefix: string, extensionItems: readonly ICoreCompletionItem[]): ICoreCompletionItem[] {
        const texts: string[] = [];
        for (let i = 0; i < this.group.editorCount; i++) {
            const editor = this.group.getEditor(i);
            if (editor !== null) texts.push(editor.getText());
        }
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
        if (id === undefined || this.group.completionResolver === undefined) {
            this.applyAccept(editor, range, core, []);
            return;
        }
        // Правки-спутники (авто-импорт) сервер отдаёт ТОЛЬКО на resolve, а он
        // мог ещё не случиться: панель описания по умолчанию скрыта. Ждём его
        // коротко — вставка не имеет права зависнуть на молчащем сервере
        // (уже догруженный пункт resolveItem отдаёт из кэша сразу).
        void this.resolveItem(id, ACCEPT_RESOLVE_TIMEOUT_MS).then((resolved) => {
            this.applyAccept(editor, range, core, resolved?.additionalEdits ?? []);
        });
    }

    /**
     * Применяет вставку выбранного пункта вместе с правками-спутниками ОДНОЙ
     * транзакцией: `import` сверху файла и сам символ обязаны откатываться
     * одним Undo. Порядок правок не важен — модель сортирует их и применяет
     * снизу вверх.
     */
    private applyAccept(
        editor: TextEditorPane,
        range: IRange,
        core: ICoreCompletionItem,
        additionalEdits: readonly ITextEdit[],
    ): void {
        // Правка ниже синхронно вызовет onCaretChanged — не даём ей авто-переоткрыть попап.
        this.suppressAutoSuggestOnce = true;
        editor.applyExternalEdits([createTextEdit(range, core.insertText), ...additionalEdits], "Accept Completion");

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
        // Кэш и склейка параллельных запросов — внутри resolveItem; здесь не
        // дублируем проверку, иначе её ветка становится мёртвой.
        void this.resolveItem(id).then((resolved) => {
            if (resolved === null) return;
            // Пока ходили за описанием, пользователь мог уйти на другой пункт.
            const selected = this.component.view.getSelectedItem()?.data as ICoreCompletionItem | undefined;
            if (selected?.id !== id) return;
            this.component.setDetailsContent(detailsContent(core, resolved));
        });
    }

    /**
     * Догружает пункт по id (описание для панели, правки авто-импорта) через
     * {@link EditorService.completionResolver}. Результат кэшируется, повторные
     * и параллельные запросы одного id склеиваются в один RPC.
     */
    private async resolveItem(id: string, timeoutMs?: number): Promise<ICoreResolvedCompletion | null> {
        const cached = this.resolvedItems.get(id);
        if (cached !== undefined) return cached;
        const resolver = this.group.completionResolver;
        if (resolver === undefined) return null;

        let pending = this.pendingResolves.get(id);
        if (pending === undefined) {
            pending = resolver(id).catch(() => null);
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

/** Индекс начала «слова» под курсором (скан назад по {@link WORD_CHAR}). */
function wordStart(line: string, character: number): number {
    let start = Math.min(character, line.length);
    while (start > 0 && WORD_CHAR.test(line[start - 1])) start--;
    return start;
}

/**
 * Общая эвристика «вставлен ровно один символ у каретки» (набор с клавиатуры, а
 * не вставка блока/удаление). `charClass` — необязательный фильтр по символу.
 */
function isSingleCharInsert(
    line: string,
    active: IPosition,
    lastLineIndex: number,
    lastCharIndex: number,
    lastLine: string,
    charClass?: RegExp,
): boolean {
    if (active.line !== lastLineIndex) return false;
    if (active.character !== lastCharIndex + 1) return false;
    if (line.length !== lastLine.length + 1) return false;
    if (charClass === undefined) return true;
    const inserted = line.at(active.character - 1);
    return inserted !== undefined && charClass.test(inserted);
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
