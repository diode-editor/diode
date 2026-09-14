import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";
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
 * Призрачные подсказки (VS Code inline suggest, ghost text). При паузе в
 * наборе запрашивает `EditorService.inlineCompletionSource` (провайдеры
 * расширений через host), показывает первый подошедший пункт серым текстом
 * за кареткой ({@link TextEditorPane.setGhostText}); Tab принимает
 * (`editor.action.inlineSuggest.commit`), Escape гасит. Дисциплина
 * debounce/seq/ревалидации — по образцу CompletionService/LightbulbService.
 */
export class InlineCompletionsService extends Disposable {
    public static dependencies = [EditorServiceDIToken, CompletionServiceDIToken, IConfigurationServiceDIToken] as const;

    /**
     * Задержка перед авто-запросом после набора (мс) — как upstream-дебаунс
     * `InlineCompletionsDebounce` (50 мс). Явный триггер идёт без неё.
     * Инъектируется в тестах (`0` — сразу на следующем тике).
     */
    public autoTriggerDelayMs = 50;

    private readonly group: EditorService;
    private readonly completionService: CompletionService;
    private readonly configuration: IConfigurationService;

    private session: IInlineSession | null = null;
    /** Гейт Tab против отступа — см. context key `inlineSuggestionHasIndentationLessThanTabSize`. */
    private indentationLessThanTabSize = true;

    // Подписки на активный редактор (пере-навешиваются при смене активного).
    private caretSub: IDisposable | null = null;
    private contentSub: IDisposable | null = null;
    // Маркер «была правка контента», выставляется content-листенером и
    // потребляется в onCaretChanged (view-state там уже консистентен).
    private contentDidChange = false;
    private autoTriggerTimer: ReturnType<typeof setTimeout> | null = null;
    // Номер последнего запроса к источнику: ответ с чужим номером устарел.
    private requestSeq = 0;
    // Гасит одно авто-открытие после принятия (правка accept не должна сама
    // перезапросить подсказку).
    private suppressAutoTriggerOnce = false;

    public constructor(group: EditorService, completionService: CompletionService, configuration: IConfigurationService) {
        super();
        this.group = group;
        this.completionService = completionService;
        this.configuration = configuration;

        const activeEditorSub = this.group.onActiveEditorChanged((editor) => {
            this.bindEditor(editor);
        });
        this.bindEditor(this.group.getActiveEditor());
        this.register({
            dispose: () => {
                activeEditorSub.dispose();
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
     * Гейт Tab против отступа: false, когда подсказка начинается с ≥ таба
     * пробельных колонок, а каретка стоит в отступе строки, — тогда Tab должен
     * индентить, а не принимать (context key VS Code
     * `inlineSuggestionHasIndentationLessThanTabSize`, дефолт true).
     */
    public hasIndentationLessThanTabSize(): boolean {
        return this.session === null || this.indentationLessThanTabSize;
    }

    /**
     * Запрашивает подсказку для текущей позиции каретки и показывает её.
     * No-op без активного редактора/источника; подсказка показывается только
     * при единственной схлопнутой каретке В КОНЦЕ строки (v1: рендер не умеет
     * сдвигать хвост строки под фантом) и закрытом suggest-попапе.
     */
    public async trigger(triggerKind: InlineCompletionTriggerKind = InlineCompletionTriggerKind.Invoke): Promise<void> {
        this.cancelAutoTrigger();
        const editor = this.group.getActiveEditor();
        const source = this.group.inlineCompletionSource;
        if (editor === null || source === undefined) return;
        if (editor.readOnly) return;
        if (this.configuration.get<boolean>("editor.inlineSuggest.enabled") === false) return;
        if (this.completionService.isOpen()) return;

        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return;
        const caret = selections[0].active;
        const lineContent = editor.viewState.document.getLineContent(caret.line);
        if (caret.character !== lineContent.length) return;

        const versionId = editor.viewState.document.versionId;
        const seq = ++this.requestSeq;
        const items = await source({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text: editor.getText(),
            line: caret.line,
            character: caret.character,
            triggerKind,
        }).catch(() => []);
        // Пока ходили за ответом: новый запрос обгоняет старый; правка или уход
        // каретки делают снапшот недействительным; открывшийся попап — гейт показа.
        if (seq !== this.requestSeq) return;
        if (this.group.getActiveEditor() !== editor) return;
        if (editor.viewState.document.versionId !== versionId) return;
        const current = editor.viewState.selections;
        if (current.length !== 1 || !isSelectionCollapsed(current[0])) return;
        if (current[0].active.line !== caret.line || current[0].active.character !== caret.character) return;
        if (this.completionService.isOpen()) return;

        for (const item of items) {
            const session = this.sessionFromItem(editor, item, caret, lineContent);
            if (session !== null) {
                this.show(session);
                return;
            }
        }
        this.hide();
    }

    /** Принимает показанную подсказку: одна undoable-правка, каретка в конец. */
    public acceptCurrent(): void {
        const session = this.session;
        if (session === null) return;
        const editor = this.group.getActiveEditor();
        const caret = this.validCaretForSession(session, editor);
        /* v8 ignore start -- defensive: onCaretChanged гасит сессию раньше, чем
           расхождение доживёт до команды (диспетчер обновляет ключи перед резолвом) */
        if (editor === null || caret === null) {
            this.hide();
            return;
        }
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

    /** Гасит подсказку (Escape, инвалидация, уход каретки). */
    public hide(): void {
        if (this.session === null) return;
        this.session.editor.setGhostText(null);
        this.session = null;
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
     * схлопнутая, в конце строки, набранное — префикс `insertText`, и хвост
     * непуст. `null` — сессия испорчена.
     */
    private validCaretForSession(session: IInlineSession, editor: TextEditorPane | null): IPosition | null {
        if (editor !== session.editor) return null;
        const selections = editor.viewState.selections;
        if (selections.length !== 1 || !isSelectionCollapsed(selections[0])) return null;
        const caret = selections[0].active;
        if (caret.line !== session.line || caret.character < session.startCharacter) return null;
        const lineContent = editor.viewState.document.getLineContent(caret.line);
        if (caret.character !== lineContent.length) return null;
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

        const editor = this.group.getActiveEditor();
        if (editor === null) {
            this.hide();
            this.cancelAutoTrigger();
            return;
        }

        const session = this.session;
        if (session !== null) {
            const caret = this.validCaretForSession(session, editor);
            if (caret !== null) {
                // Набранное совпадает с подсказкой — сжать/растить без перезапроса.
                this.show(session);
                return;
            }
            this.hide();
        }

        const selections = editor.viewState.selections;
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

    private cancelAutoTrigger(): void {
        if (this.autoTriggerTimer !== null) {
            clearTimeout(this.autoTriggerTimer);
            this.autoTriggerTimer = null;
        }
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
        if (char === " ") {
            width += 1;
        } else if (char === "\t") {
            width += tabSize - (width % tabSize);
        } else {
            break;
        }
        if (width >= tabSize) return false;
    }
    return true;
}
