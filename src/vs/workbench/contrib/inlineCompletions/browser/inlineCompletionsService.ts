import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import { CancellationTokenSource } from "../../../../base/common/cancellation.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICoreInlineCompletionItem } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { CompletionService } from "../../suggest/browser/completionService.ts";
import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";

export const InlineCompletionsServiceDIToken = token<InlineCompletionsService>("InlineCompletionsService");

/**
 * Живая сессия показанной подсказки. Ghost text — производное: хвост
 * `insertText` за уже набранным `line.slice(startCharacter, caret)`. Набор
 * символа, совпадающего с подсказкой, сдвигает каретку — подсказка сжимается
 * локально без перезапроса; Backspace растит её обратно; расхождение — гасит.
 */
interface IInlineSession {
    readonly editor: TextEditorPane;
    readonly line: number;
    /** Начало заменяемого диапазона: `range.start` провайдера либо каретка запроса. */
    readonly startCharacter: number;
    readonly insertText: string;
}

/**
 * Дефолт `editor.inlineSuggest.delay` — как upstream-дебаунс
 * `InlineCompletionsDebounce` (50 мс). Обязан совпадать с `default` ключа в
 * {@link ../../../common/configuration/editorConfiguration.ts}: настройки может
 * не быть в модели вовсе (тестовая заглушка, битый settings.json).
 */
export const DEFAULT_INLINE_SUGGEST_DELAY_MS = 50;

/**
 * Дефолт `editor.inlineSuggest.requestTimeout` — щедрее completion (1500 мс):
 * за провайдером может стоять холодный LLM-бэкенд. Тот же лок-степ с `default`
 * ключа, что и у {@link DEFAULT_INLINE_SUGGEST_DELAY_MS}.
 */
export const DEFAULT_INLINE_SUGGEST_REQUEST_TIMEOUT_MS = 5000;

/**
 * Призрачные подсказки (VS Code inline suggest, ghost text). При паузе в
 * наборе запрашивает `EditorService.inlineCompletionSource` (провайдеры
 * расширений через host), показывает первый подошедший пункт серым текстом
 * за кареткой ({@link TextEditorPane.setGhostText}); Tab принимает
 * (`editor.action.inlineSuggest.commit`), Escape гасит. Дисциплина
 * debounce/seq/ревалидации — по образцу CompletionService/LightbulbService.
 *
 * Настройки читаются НА КАЖДОМ обращении, а не кэшируются в полях: правка
 * `settings.json` подхватывается живым конфигом (watcher → reload) и должна
 * применяться без перезапуска редактора.
 */
export class InlineCompletionsService extends Disposable {
    public static dependencies = [
        EditorServiceDIToken,
        CompletionServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    private readonly group: EditorService;
    private readonly completionService: CompletionService;
    private readonly configuration: IConfigurationService;

    private session: IInlineSession | null = null;
    /** Гейт Tab против отступа — см. context key `inlineSuggestionHasIndentationLessThanTabSize`. */
    // Stryker disable next-line BooleanLiteral: значение инициализатора никогда не читается — show() переписывает поле до появления сессии, hide() возвращает true
    private indentationLessThanTabSize = true;

    // Подписки на активный редактор (пере-навешиваются при смене активного).
    private caretSub: IDisposable | null = null;
    private contentSub: IDisposable | null = null;
    // Маркер «была правка контента», выставляется content-листенером и
    // потребляется в onCaretChanged (view-state там уже консистентен).
    // Stryker disable next-line BooleanLiteral: инициализатор не читается — bindEditor в конструкторе тут же сбрасывает флаг через unbindEditor
    private contentDidChange = false;
    private autoTriggerTimer: ReturnType<typeof setTimeout> | null = null;
    // Номер последнего запроса к источнику: ответ с чужим номером устарел.
    private requestSeq = 0;
    // Источник отмены запроса, который сейчас в полёте. Seq-гард отбрасывает
    // устаревший ОТВЕТ, а этот источник останавливает саму РАБОТУ провайдера:
    // за подсказкой может стоять платный LLM-вызов.
    private pendingRequest: CancellationTokenSource | null = null;
    // Гасит одно авто-открытие после принятия (правка accept не должна сама
    // перезапросить подсказку).
    private suppressAutoTriggerOnce = false;

    public constructor(
        group: EditorService,
        completionService: CompletionService,
        configuration: IConfigurationService,
    ) {
        super();
        this.group = group;
        this.completionService = completionService;
        this.configuration = configuration;

        const activeEditorSub = this.group.onActiveEditorChanged((editor) => {
            this.bindEditor(editor);
        });
        this.bindEditor(this.group.getActiveEditor());
        // Попап закрылся (Esc, accept, уход из слова) — место освободилось:
        // перезапрашиваем подсказку, иначе призрак появился бы только на
        // следующей правке (VS Code на закрытии виджета так же пересеивает
        // inline-состояние). Дебаунс-планировщик, а не прямой trigger: сам
        // trigger перепроверит все гейты (редактор, каретка в конце строки).
        const popupCloseSub = this.completionService.onDidClose(() => {
            this.scheduleAutoTrigger();
        });
        this.register({
            dispose: () => {
                activeEditorSub.dispose();
                popupCloseSub.dispose();
                this.unbindEditor();
                this.cancelAutoTrigger();
                this.hide();
            },
        });
    }

    /** Показана ли подсказка (context key `inlineSuggestionVisible`). */
    public isOpen(): boolean {
        return this.session !== null;
    }

    /**
     * Ждём ли сейчас ответа провайдера (context key
     * `inlineSuggestionRequestPending`). Ключ нужен Escape: пока призрака на
     * экране нет, `inlineSuggestionVisible` ложный, и без этого ключа команда
     * `.hide` до сервиса не доедет — а отменить незавершённый запрос она обязана.
     */
    public isRequestPending(): boolean {
        return this.pendingRequest !== null;
    }

    /**
     * Гейт Tab против отступа: false, когда подсказка начинается с ≥ таба
     * пробельных колонок, а каретка стоит в отступе строки, — тогда Tab должен
     * индентить, а не принимать (context key VS Code
     * `inlineSuggestionHasIndentationLessThanTabSize`, дефолт true).
     */
    public hasIndentationLessThanTabSize(): boolean {
        // Поле сбрасывается в true вместе со снятием сессии (hide) — пара
        // «session === null, поле false» недостижима, ветка мутационно
        // эквивалентна чтению поля напрямую.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: см. выше
        return this.session === null || this.indentationLessThanTabSize;
    }

    /**
     * Запрашивает подсказку для текущей позиции каретки и показывает её.
     * No-op без активного редактора/источника; подсказка показывается при
     * единственной схлопнутой каретке (в том числе в СЕРЕДИНЕ строки — рендер
     * вклеивает фантомные колонки в layout строки, и её хвост уезжает вправо) и
     * закрытом suggest-попапе.
     *
     * `editor.inlineSuggest.enabled: false` гасит только АВТО-запрос (как в
     * VS Code): явный `Invoke` из команды `editor.action.inlineSuggest.trigger`
     * проходит и при выключенной настройке — это и есть ручной режим.
     */
    public async trigger(triggerKind: InlineCompletionTriggerKind = InlineCompletionTriggerKind.Invoke): Promise<void> {
        this.cancelAutoTrigger();
        const editor = this.group.getActiveEditor();
        const source = this.group.inlineCompletionSource;
        if (editor === null || source === undefined) return;
        if (editor.readOnly) return;
        if (triggerKind === InlineCompletionTriggerKind.Automatic && !this.autoTriggerEnabled) return;
        if (this.completionService.isOpen()) return;

        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;
        const caret = selections[0].active;
        const lineContent = editor.viewState.document.getLineContent(caret.line);

        const versionId = editor.viewState.document.versionId;
        // Stryker disable next-line UpdateOperator: направление счётчика не наблюдаемо — гейту важна только уникальность номера
        const seq = ++this.requestSeq;
        // Предыдущий запрос (если он ещё в полёте) устарел ровно сейчас.
        this.cancelPendingRequest();
        const cancellation = new CancellationTokenSource();
        this.pendingRequest = cancellation;
        const items = await source(
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                text: editor.getText(),
                line: caret.line,
                character: caret.character,
                triggerKind,
                timeoutMs: this.requestTimeoutMs,
            },
            cancellation.token,
        ).catch(() => []);
        // Запрос отработал — отменять больше нечего (наш источник могли уже
        // сменить на более свежий, тогда трогать поле нельзя).
        if (this.pendingRequest === cancellation) this.pendingRequest = null;
        cancellation.dispose();
        // Пока ходили за ответом: новый запрос обгоняет старый; правка или уход
        // каретки делают снапшот недействительным; открывшийся попап — гейт показа.
        if (seq !== this.requestSeq) return;
        if (this.group.getActiveEditor() !== editor) return;
        if (editor.viewState.document.versionId !== versionId) return;
        const current = editor.viewState.selections;
        if (current.length !== 1 || !isSelectionCollapsed(current[0])) return;
        if (current[0].active.line !== caret.line || current[0].active.character !== caret.character) return;
        if (this.completionService.isOpen()) return;
        // Отдельный гейт от всех, что выше: Escape (и смена активного редактора
        // без события) гасит запрос, НЕ меняя ни текста, ни каретки, ни номера
        // запроса. Провайдер, проигнорировавший отмену, тут и отсекается —
        // призрак не должен появиться задним числом.
        if (cancellation.token.isCancellationRequested) return;

        for (const item of items) {
            const session = this.sessionFromItem(editor, item, caret, lineContent);
            if (session !== null) {
                this.show(session);
                return;
            }
        }
        this.hide();
    }

    // ─── Настройки (читаются на каждом обращении — правка применяется на лету) ─

    /** `editor.inlineSuggest.enabled`: разрешён ли авто-запрос при наборе. */
    private get autoTriggerEnabled(): boolean {
        return this.configuration.get<boolean>("editor.inlineSuggest.enabled") !== false;
    }

    /** `editor.inlineSuggest.delay`: пауза перед авто-запросом, мс. */
    private get autoTriggerDelayMs(): number {
        return readMillisecondsSetting(
            this.configuration.get("editor.inlineSuggest.delay"),
            DEFAULT_INLINE_SUGGEST_DELAY_MS,
            0,
        );
    }

    /** `editor.inlineSuggest.requestTimeout`: сколько ждать ответ источника, мс. */
    private get requestTimeoutMs(): number {
        return readMillisecondsSetting(
            this.configuration.get("editor.inlineSuggest.requestTimeout"),
            DEFAULT_INLINE_SUGGEST_REQUEST_TIMEOUT_MS,
            1,
        );
    }

    /** Принимает показанную подсказку: одна undoable-правка, каретка в конец. */
    public acceptCurrent(): void {
        const session = this.session;
        if (session === null) return;
        const editor = this.group.getActiveEditor();
        const caret = this.validCaretForSession(session, editor);
        /* v8 ignore start -- defensive: onCaretChanged гасит сессию раньше, чем
           расхождение доживёт до команды (диспетчер обновляет ключи перед резолвом) */
        // Stryker disable ConditionalExpression,LogicalOperator,BlockStatement,CallExpression: недостижимый защитный гард, см. v8 ignore
        if (editor === null || caret === null) {
            this.hide();
            return;
        }
        // Stryker restore ConditionalExpression,LogicalOperator,BlockStatement,CallExpression
        /* v8 ignore stop */
        this.hide();
        // Правка ниже синхронно дёрнет onCaretChanged — не даём ей перезапросить.
        this.suppressAutoTriggerOnce = true;
        editor.applyExternalEdits(
            [
                createTextEdit(
                    createRange(session.line, session.startCharacter, session.line, caret.character),
                    session.insertText,
                ),
            ],
            "Accept Inline Suggestion",
        );
    }

    /**
     * Гасит подсказку (Escape, инвалидация, уход каретки) И отменяет запрос,
     * который ещё в полёте: Escape по незавершённому запросу — «не надо», а не
     * «спрячь показанное», поэтому отмена идёт до гарда на сессию.
     */
    public hide(): void {
        this.cancelPendingRequest();
        if (this.session === null) return;
        this.session.editor.setGhostText(null);
        this.session = null;
        // Stryker disable next-line BooleanLiteral: пара к гарду session === null в hasIndentationLessThanTabSize — расхождение недостижимо
        this.indentationLessThanTabSize = true;
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /**
     * Строит сессию из пункта провайдера, либо `null`, если пункт не подходит
     * под гейт показа: заменяемый текст (`range.start`..каретка) обязан быть
     * префиксом `filterText ?? insertText`, а хвост `insertText` за ним —
     * непустым (контракт vscode.d.ts). `range` за пределами строки каретки или
     * многострочный — отбрасывается.
     */
    private sessionFromItem(
        editor: TextEditorPane,
        item: ICoreInlineCompletionItem,
        caret: IPosition,
        lineContent: string,
    ): IInlineSession | null {
        let startCharacter = caret.character;
        if (item.range !== undefined) {
            const range = item.range;
            if (range.start.line !== caret.line || range.end.line !== caret.line) return null;
            if (range.start.character > caret.character || range.end.character < caret.character) return null;
            startCharacter = range.start.character;
        }
        const typed = lineContent.slice(startCharacter, caret.character);
        if (!(item.filterText ?? item.insertText).startsWith(typed)) return null;
        if (!item.insertText.startsWith(typed)) return null;
        if (item.insertText.length === typed.length) return null;
        return { editor, line: caret.line, startCharacter, insertText: item.insertText };
    }

    /**
     * Каретка, при которой сессия ещё действительна: та же строка, единственная
     * схлопнутая, набранное (`startCharacter`..каретка) — префикс `insertText`, и
     * хвост непуст. `null` — сессия испорчена. Хвост строки ПРАВЕЕ каретки к
     * действительности отношения не имеет: он уезжает вправо под фантомом.
     */
    private validCaretForSession(session: IInlineSession, editor: TextEditorPane | null): IPosition | null {
        if (editor !== session.editor) return null;
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return null;
        const caret = selections[0].active;
        if (caret.line !== session.line || caret.character < session.startCharacter) return null;
        const lineContent = editor.viewState.document.getLineContent(caret.line);
        const typed = lineContent.slice(session.startCharacter, caret.character);
        if (!session.insertText.startsWith(typed)) return null;
        if (session.insertText.length === typed.length) return null;
        return caret;
    }

    /** Показывает сессию: ghost = хвост `insertText` за набранным. */
    private show(session: IInlineSession): void {
        const caretCharacter = session.editor.viewState.selections[0].active.character;
        const remainder = session.insertText.slice(caretCharacter - session.startCharacter);
        const lines = remainder.split("\n");
        this.session = session;
        this.indentationLessThanTabSize = computeIndentationLessThanTabSize(
            session.editor.viewState.document.getLineContent(session.line),
            caretCharacter,
            lines[0],
            session.editor.viewState.tabSize,
        );
        session.editor.setGhostText({ line: session.line, character: caretCharacter, lines });
    }

    /**
     * Пере-навешивает подписки на нового активного редактора; смена активного
     * гасит и подсказку, и отложенный авто-запрос.
     */
    private bindEditor(editor: TextEditorPane | null): void {
        this.unbindEditor();
        this.hide();
        this.cancelAutoTrigger();
        // Stryker disable next-line UpdateOperator: направление счётчика не наблюдаемо — гейту важна только уникальность номера
        this.requestSeq++;
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
     * Единый обработчик изменения каретки/текста. Живая сессия либо сжимается/
     * растёт локально (набранное совпадает с подсказкой), либо гаснет; правка
     * при погашенной планирует авто-запрос (как upstream — рефетч на любое
     * изменение текста: одиночный символ, paste, Backspace, Enter).
     */
    private onCaretChanged(): void {
        const wasEdit = this.contentDidChange;
        this.contentDidChange = false;
        const suppressed = this.suppressAutoTriggerOnce;
        this.suppressAutoTriggerOnce = false;
        // Снапшот, по которому ушёл запрос, только что протух — и на правке
        // (текст другой), и на уходе каретки (позиция другая). Его ответ всё
        // равно отсеют гарды ниже по трассе, поэтому провайдер вправе бросить
        // работу прямо сейчас.
        this.cancelPendingRequest();

        const editor = this.group.getActiveEditor();
        if (editor === null) {
            this.hide();
            // Отмена дублирует гейт: trigger() без активного редактора — no-op
            // до RPC, так что снятие таймера здесь мутационно ненаблюдаемо.
            // Stryker disable next-line CallExpression: см. выше
            this.cancelAutoTrigger();
            return;
        }

        const session = this.session;
        if (session !== null) {
            const caret = this.validCaretForSession(session, editor);
            // Пере-показ живой сессии — только на ПРАВКЕ: движение каретки само
            // по себе подсказку гасит (стрелки снимают призрака, как upstream).
            // Пока показ был заперт концом строки, это выходило само собой —
            // уйти с конца строки движением иначе нельзя; mid-line каретка ходит
            // и внутри подсказки, поэтому правило стало явным.
            if (caret !== null && wasEdit) {
                // Набранное совпадает с подсказкой — сжать/растить без перезапроса.
                this.show(session);
                return;
            }
            this.hide();
        }

        const selections = editor.viewState.selections;
        // Гейт повторяется в trigger() до RPC — «расширяющий» мутант лишь
        // планирует запрос, который сам себя отсечёт; ненаблюдаемо.
        // Stryker disable next-line LogicalOperator,ConditionalExpression,EqualityOperator: см. выше
        const single = selections.length === 1 && isSelectionCollapsed(selections[0]);

        if (!suppressed && wasEdit && single) {
            this.scheduleAutoTrigger();
        } else {
            this.cancelAutoTrigger();
        }
    }

    private scheduleAutoTrigger(): void {
        this.cancelAutoTrigger();
        this.autoTriggerTimer = setTimeout(() => {
            this.autoTriggerTimer = null;
            void this.trigger(InlineCompletionTriggerKind.Automatic);
        }, this.autoTriggerDelayMs);
    }

    /** Отменяет запрос в полёте: провайдер узнаёт об этом через свой токен. */
    private cancelPendingRequest(): void {
        const pending = this.pendingRequest;
        if (pending === null) return;
        this.pendingRequest = null;
        pending.cancel();
        pending.dispose();
    }

    private cancelAutoTrigger(): void {
        // true-ветка мутанта — clearTimeout(null): безвредный no-op, гард тут
        // только экономит вызов. «Не отменять вовсе» ловят тесты отмены.
        // Stryker disable next-line ConditionalExpression: см. выше
        if (this.autoTriggerTimer !== null) {
            clearTimeout(this.autoTriggerTimer);
            this.autoTriggerTimer = null;
        }
    }
}

/**
 * Читает настройку-длительность (мс) из конфига: `settings.json` правит человек,
 * и там бывает что угодно — строка, отрицательное число, `NaN`. Всё, что не
 * конечное число не меньше `min`, откатывается на `fallback`, а редактор
 * стартует и работает как с дефолтами (`ConfigurationService.get` типы не
 * проверяет — отдаёт значение как есть).
 */
export function readMillisecondsSetting(raw: unknown, fallback: number, min: number): number {
    // Гард `typeof` нужен ТИПАМ, а не рантайму: `Number.isFinite` не приводит
    // аргумент и на любом не-числе уже возвращает false, но сигнатуры-предиката
    // у него нет — без typeof не сузить `unknown` до `number` для `raw < min` и
    // `return raw`. Мутант «убрать проверку» поэтому эквивалентен.
    // Stryker disable next-line ConditionalExpression: см. выше
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < min) return fallback;
    return raw;
}

/**
 * Видимая ширина ведущих пробельных колонок `text` (таб добивает до кратной
 * `tabSize` границы) МЕНЬШЕ tabSize, либо каретка стоит не в отступе строки.
 * Управляет гейтом Tab: подсказка «с отступа» при каретке в отступе не должна
 * красть Tab у индентации (upstream `getIndentationInfo`).
 */
export function computeIndentationLessThanTabSize(
    lineContent: string,
    caretCharacter: number,
    ghostFirstLine: string,
    tabSize: number,
): boolean {
    const beforeCaret = lineContent.slice(0, caretCharacter);
    const cursorInIndentation = beforeCaret.trim().length === 0;
    if (!cursorInIndentation) return true;

    let width = 0;
    for (const char of ghostFirstLine) {
        // Таб всегда добивает ширину до кратной tabSize границы, то есть до
        // >= tabSize (width здесь всегда < tabSize — иначе вышли бы раньше).
        if (char === "\t") return false;
        if (char !== " ") break;
        width += 1;
        if (width >= tabSize) return false;
    }
    return true;
}
