import { RunOnceScheduler } from "../../../../base/common/async.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Disposable, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection, isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICoreInlineCompletionItem } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { bindActiveEditor } from "../../../services/editor/browser/activeEditorBinding.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import type { CompletionService } from "../../suggest/browser/completionService.ts";
import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";

import { provideInlineCompletions } from "./provideInlineCompletions.ts";

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
 * Призрачные подсказки (VS Code inline suggest, ghost text). При паузе в
 * наборе запрашивает подошедших документу провайдеров реестра
 * `ILanguageFeaturesService.inlineCompletionsProvider`, показывает первый подошедший пункт серым текстом
 * за кареткой ({@link TextEditorPane.setGhostText}); Tab принимает
 * (`editor.action.inlineSuggest.commit`), Escape гасит. Дисциплина
 * debounce/latest-wins/ревалидации — по образцу CompletionService.
 *
 * Настройки читаются НА КАЖДОМ обращении, а не кэшируются в полях: правка
 * `settings.json` подхватывается живым конфигом (watcher → reload) и должна
 * применяться без перезапуска редактора.
 */
export class InlineCompletionsService extends Disposable implements IContextKeyContributor {
    public static dependencies = [
        EditorServiceDIToken,
        CompletionServiceDIToken,
        IConfigurationServiceDIToken,
        LanguageFeaturesServiceDIToken,
    ] as const;

    private readonly group: IEditorService;
    private readonly completionService: CompletionService;
    private readonly configuration: IConfigurationService;
    private readonly languageFeatures: ILanguageFeaturesService;

    private session: IInlineSession | null = null;
    // Смена «показан / ждём ответа» — её ждёт quick suggest (offWhenInlineCompletions).
    private readonly onDidChangeStateEmitter = this.register(new Emitter<void>());
    /** Гейт Tab против отступа — см. context key `inlineSuggestionHasIndentationLessThanTabSize`. */
    // Stryker disable next-line BooleanLiteral: значение инициализатора никогда не читается — show() переписывает поле до появления сессии, hide() возвращает true
    private indentationLessThanTabSize = true;

    // Отложенный авто-запрос; задержка читается из настройки на каждом schedule().
    private readonly autoTrigger = this.register(
        new RunOnceScheduler(() => {
            void this.trigger(InlineCompletionTriggerKind.Automatic);
        }, 0),
    );
    // Последний запрос к источнику. Отмена билета и отбрасывает устаревший
    // ОТВЕТ, и останавливает саму РАБОТУ провайдера через токен: за подсказкой
    // может стоять платный LLM-вызов.
    private readonly latest = new LatestRequest();
    // Гасит одно авто-открытие после принятия (правка accept не должна сама
    // перезапросить подсказку).
    private suppressAutoTriggerOnce = false;

    public constructor(
        group: IEditorService,
        completionService: CompletionService,
        configuration: IConfigurationService,
        languageFeatures: ILanguageFeaturesService,
    ) {
        super();
        this.group = group;
        this.completionService = completionService;
        this.configuration = configuration;
        this.languageFeatures = languageFeatures;

        // Смена активного гасит и подсказку, и отложенный авто-запрос (hide()).
        this.register(
            bindActiveEditor(this.group, (editor, store) => {
                this.hide();
                if (editor === null) return;
                // Маркер «была правка контента»: выставляет content-листенер,
                // потребляет обработчик каретки (view-state там уже консистентен).
                let contentDidChange = false;
                store.add(
                    editor.onDidChangeContent(() => {
                        contentDidChange = true;
                    }),
                );
                store.add(
                    editor.onDidChangeCursorPosition(() => {
                        const wasEdit = contentDidChange;
                        contentDidChange = false;
                        this.onCaretChanged(wasEdit);
                    }),
                );
            }),
        );
        // Пока открыт suggest-попап, призрак не рисуется, но сессия живёт (и
        // ответ, пришедший под попапом, не выбрасывается): у upstream при
        // открытом виджете ghost text — только продолжение выбранного пункта.
        this.register(
            this.completionService.onDidShow(() => {
                this.session?.editor.setGhostText(null);
                this.onDidChangeStateEmitter.fire();
            }),
        );
        // Попап закрылся (Esc, accept, уход из слова) — место освободилось:
        // годная сессия возвращается на экран сразу, без перезапроса (upstream
        // так же показывает закэшированный ответ, когда уходит выбранный пункт).
        // Сессии нет или она испорчена — перезапрос. Дебаунс-планировщик, а не
        // прямой trigger: сам trigger перепроверит все гейты.
        this.register(
            this.completionService.onDidClose(() => {
                const session = this.session;
                if (session !== null && this.validCaretForSession(session, this.group.getActiveEditor()) !== null) {
                    this.show(session);
                    return;
                }
                this.clearSession();
                this.scheduleAutoTrigger();
            }),
        );
        // Quick suggest смотрит на призрака: уступает ему место и ждёт его ответа.
        this.register(
            this.completionService.setInlineSuggestionsState({
                isVisible: () => this.isOpen(),
                isLoading: () => this.autoTrigger.isScheduled() || this.latest.pending,
                stopAutomatic: () => {
                    this.hide();
                },
                onDidChange: this.onDidChangeStateEmitter.event,
            }),
        );
        this.register({
            // hide() снимает подсказку, запрос в полёте и отложенный запрос.
            dispose: () => {
                this.hide();
            },
        });
    }

    /**
     * Показана ли подсказка (context key `inlineSuggestionVisible`): сессия есть
     * и её не прячет открытый suggest-попап.
     */
    public isOpen(): boolean {
        return this.session !== null && !this.completionService.isOpen();
    }

    /** IContextKeyContributor: гейты Tab/Escape призрака. */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("inlineSuggestionVisible", this.isOpen());
        contextKeys.set("inlineSuggestionRequestPending", this.isRequestPending());
        contextKeys.set("inlineSuggestionHasIndentationLessThanTabSize", this.hasIndentationLessThanTabSize());
    }

    /**
     * Ждём ли сейчас ответа провайдера (context key
     * `inlineSuggestionRequestPending`). Ключ нужен Escape: пока призрака на
     * экране нет, `inlineSuggestionVisible` ложный, и без этого ключа команда
     * `.hide` до сервиса не доедет — а отменить незавершённый запрос она обязана.
     */
    private isRequestPending(): boolean {
        return this.latest.pending;
    }

    /**
     * Гейт Tab против отступа: false, когда подсказка начинается с ≥ таба
     * пробельных колонок, а каретка стоит в отступе строки, — тогда Tab должен
     * индентить, а не принимать (context key VS Code
     * `inlineSuggestionHasIndentationLessThanTabSize`, дефолт true).
     */
    private hasIndentationLessThanTabSize(): boolean {
        // Поле сбрасывается в true вместе со снятием сессии (hide) — пара
        // «session === null, поле false» недостижима, ветка мутационно
        // эквивалентна чтению поля напрямую.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: см. выше
        return this.session === null || this.indentationLessThanTabSize;
    }

    /**
     * Запрашивает подсказку для текущей позиции каретки и показывает её.
     * No-op без активного редактора и подошедших документу провайдеров; подсказка показывается при
     * единственной схлопнутой каретке (в том числе в СЕРЕДИНЕ строки — рендер
     * вклеивает фантомные колонки в layout строки, и её хвост уезжает вправо).
     * Под открытым suggest-попапом запрос тоже идёт (как у upstream), а ответ
     * ждёт закрытия попапа невидимым — после Esc призрак появляется сразу.
     *
     * `editor.inlineSuggest.enabled: false` гасит только АВТО-запрос (как в
     * VS Code): явный `Invoke` из команды `editor.action.inlineSuggest.trigger`
     * проходит и при выключенной настройке — это и есть ручной режим.
     */
    public async trigger(triggerKind: InlineCompletionTriggerKind = InlineCompletionTriggerKind.Invoke): Promise<void> {
        try {
            await this.request(triggerKind);
        } finally {
            // Любой исход (показ, «нечего», отсев, отказ гейта) — конец ожидания
            // для quick suggest.
            this.onDidChangeStateEmitter.fire();
        }
    }

    private async request(triggerKind: InlineCompletionTriggerKind): Promise<void> {
        this.cancelAutoTrigger();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const providers = this.languageFeatures.inlineCompletionsProvider.ordered(editor);
        if (providers.length === 0) return;
        if (editor.readOnly) return;
        if (triggerKind === InlineCompletionTriggerKind.Automatic && !this.autoTriggerEnabled(editor.languageId))
            return;

        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;
        const caret = selections[0].active;
        const lineContent = editor.viewState.document.getLineContent(caret.line);

        const versionId = editor.viewState.document.versionId;
        // Предыдущий запрос (если он ещё в полёте) устарел ровно сейчас.
        const ticket = this.latest.start();
        // Сбойный провайдер отвечает «подсказок нет» внутри агрегатора.
        const items = await provideInlineCompletions(
            providers,
            {
                uri: editor.uri.toString(),
                languageId: editor.languageId,
                versionId,
                line: caret.line,
                character: caret.character,
                triggerKind,
                timeoutMs: this.requestTimeoutMs(editor.languageId),
            },
            ticket.token,
        );
        // Запрос отработал — отменять больше нечего.
        ticket.done();
        // Пока ходили за ответом: правка или уход каретки делают снапшот
        // недействительным.
        if (this.group.getActiveEditor() !== editor) return;
        if (editor.viewState.document.versionId !== versionId) return;
        const current = editor.viewState.selections;
        if (current.length !== 1 || !isSelectionCollapsed(current[0])) return;
        if (current[0].active.line !== caret.line || current[0].active.character !== caret.character) return;
        // Отдельный гейт от всех, что выше: новый запрос обгоняет старый, а
        // Escape (и смена активного редактора без события) гасит запрос, НЕ
        // меняя ни текста, ни каретки, — все эти пути отменяют билет. Провайдер,
        // проигнорировавший отмену, тут и отсекается: призрак не должен
        // появиться задним числом.
        if (ticket.isStale()) return;

        for (const item of items) {
            const session = this.sessionFromItem(editor, item, caret, lineContent);
            if (session !== null) {
                this.show(session);
                return;
            }
        }
        // Показать нечего — снимаем прежний ghost, но отложенный авто-запрос
        // (его мог завести закрывшийся попап) не трогаем: полный hide() тут
        // съел бы чужой запланированный запрос.
        this.clearSession();
    }

    // ─── Настройки (читаются на каждом обращении — правка применяется на лету;
    //     для языка документа — с его секцией `"[lang]"`) ─

    /** `editor.inlineSuggest.enabled`: разрешён ли авто-запрос при наборе. */
    private autoTriggerEnabled(languageId: string): boolean {
        return this.configuration.get("editor.inlineSuggest.enabled", { overrideIdentifier: languageId });
    }

    /** `editor.inlineSuggest.delay`: пауза перед авто-запросом, мс. */
    private autoTriggerDelayMs(languageId: string | undefined): number {
        return this.configuration.get("editor.inlineSuggest.delay", { overrideIdentifier: languageId });
    }

    /** `editor.inlineSuggest.requestTimeout`: сколько ждать ответ источника, мс. */
    private requestTimeoutMs(languageId: string): number {
        return this.configuration.get("editor.inlineSuggest.requestTimeout", { overrideIdentifier: languageId });
    }

    /** Принимает показанную подсказку: одна undoable-правка, каретка в конец. */
    public acceptCurrent(): void {
        const session = this.session;
        // Спрятанную под попапом подсказку не принимаем: человек её не видит.
        if (session === null || this.completionService.isOpen()) return;
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
            ([inserted]) => [createCursorSelection(inserted.range.end.line, inserted.range.end.character)],
        );
    }

    /**
     * Гасит подсказку (Escape, инвалидация, уход каретки) — и останавливает всю
     * работу под неё: отменяет запрос в полёте и снимает отложенный авто-запрос.
     * Escape — это «не надо», а не «спрячь показанное»: и незавершённый запрос,
     * и запланированный по последней правке обязаны умолкнуть, иначе призрак
     * всплыл бы через секунду после того, как его погасили.
     */
    public hide(): void {
        this.latest.cancel();
        this.cancelAutoTrigger();
        this.clearSession();
        this.onDidChangeStateEmitter.fire();
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /** Снимает показанный ghost, не трогая запросы (см. {@link hide}). */
    private clearSession(): void {
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

    /**
     * Показывает сессию: ghost = хвост `insertText` за набранным. Под открытым
     * suggest-попапом сессия запоминается, но не рисуется.
     */
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
        session.editor.setGhostText(
            this.completionService.isOpen() ? null : { line: session.line, character: caretCharacter, lines },
        );
    }

    /**
     * Единый обработчик изменения каретки/текста. Живая сессия либо сжимается/
     * растёт локально (набранное совпадает с подсказкой), либо гаснет; правка
     * при погашенной планирует авто-запрос (как upstream — рефетч на любое
     * изменение текста: одиночный символ, paste, Backspace, Enter).
     */
    private onCaretChanged(wasEdit: boolean): void {
        const suppressed = this.suppressAutoTriggerOnce;
        this.suppressAutoTriggerOnce = false;
        // Снапшот, по которому ушёл запрос, только что протух — и на правке
        // (текст другой), и на уходе каретки (позиция другая). Его ответ всё
        // равно отсеют гарды ниже по трассе, поэтому провайдер вправе бросить
        // работу прямо сейчас.
        this.latest.cancel();

        const editor = this.group.getActiveEditor();
        if (editor === null) {
            // hide() снимает и подсказку, и отложенный авто-запрос.
            this.hide();
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
        this.autoTrigger.schedule(this.autoTriggerDelayMs(this.group.getActiveEditor()?.languageId));
    }

    private cancelAutoTrigger(): void {
        this.autoTrigger.cancel();
    }
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
