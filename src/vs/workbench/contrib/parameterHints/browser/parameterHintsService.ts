import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { isSelectionCollapsed } from "../../../../editor/common/core/iSelection.ts";
import type {
    ICoreSignatureHelp,
    SignatureHelpTriggerKind as TriggerKind,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import { stripMarkdown } from "../../hover/browser/hoverService.ts";
import { isSingleCharInsert } from "../../suggest/browser/completionService.ts";

import type { ParameterHintsComponent } from "./parameterHintsComponent.ts";
import { ParameterHintsComponentDIToken } from "./parameterHintsComponent.ts";
import { activeParameterSpan } from "./signatureLayout.ts";

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке на него — строка внутри остаётся отладочной меткой
export const ParameterHintsServiceDIToken = token<ParameterHintsService>("ParameterHintsService");

/**
 * Логика подсказки параметров. Открывается сама при наборе триггер-символа
 * сервера (`(`, `,`, `<` у tsserver) и по команде
 * `editor.action.triggerParameterHints`; пока показана — перезапрашивается на
 * каждую правку и движение каретки (так активный параметр следует за набором),
 * а ответ `null` её закрывает — именно так закрывающая скобка гасит попап.
 *
 * Пара к {@link ParameterHintsComponent} по образцу suggest/hover: компонент
 * владеет попапом и его overlay-сессией, сервис — запросами и состоянием.
 */
export class ParameterHintsService extends Disposable {
    public static dependencies = [ParameterHintsComponentDIToken, EditorServiceDIToken] as const;

    /** Задержка авто-запроса, мс (в тестах — 0). Как `autoSuggestDelayMs` у suggest. */
    public triggerDelayMs = 120;

    /** Guard от устаревших ответов: пока ходили за подсказкой, запрос мог смениться. */
    private requestSeq = 0;
    private caretSub: IDisposable | null = null;
    private contentSub: IDisposable | null = null;
    // Затравки полей ниже перетираются ещё в конструкторе (`bindEditor` зовёт
    // `unbindEditor` и `resetCaretCache`), поэтому их значения ненаблюдаемы.
    // Stryker disable next-line BooleanLiteral: см. выше
    /** Правка пришла до события каретки — их общий обработчик читает этот флаг. */
    private contentDidChange = false;
    // Stryker disable next-line UnaryOperator: см. выше
    private lastCaretLine = -1;
    // Stryker disable next-line UnaryOperator: см. выше
    private lastCaretChar = -1;
    // Stryker disable next-line StringLiteral: см. выше
    private lastLine = "";
    private triggerTimer: ReturnType<typeof setTimeout> | null = null;
    /** Показанная сейчас подсказка (она же — эхо `activeSignatureHelp` серверу). */
    private currentHelp: ICoreSignatureHelp | null = null;
    private activeSignatureIndex = 0;

    public constructor(
        private readonly component: ParameterHintsComponent,
        private readonly group: EditorService,
    ) {
        super();
        const activeEditorSub = this.group.onActiveEditorChanged((editor) => {
            this.bindEditor(editor);
        });
        // Стартовая привязка — для случая, когда редактор уже открыт к моменту
        // сборки сервиса (восстановленная сессия). В харнессе файл открывают
        // после конструктора, и туда приходит onActiveEditorChanged — поэтому
        // пропуск этого вызова юнит-тестом не наблюдается.
        // Stryker disable next-line CallExpression: см. выше — привязку уже открытого редактора юнит не наблюдает, её путь проверяет поднятие приложения
        this.bindEditor(this.group.getActiveEditor());
        this.register({
            // Stryker disable next-line BlockStatement: снятие подписок на выключении ненаблюдаемо юнитом — редактор и группа умирают следом, слушать некому
            dispose: () => {
                // Stryker disable next-line CallExpression: см. выше
                activeEditorSub.dispose();
                // Stryker disable next-line CallExpression: см. выше
                this.unbindEditor();
            },
        });
    }

    /**
     * Запрашивает подсказку для позиции каретки и показывает попап. No-op, если
     * нет активного редактора или источника; пустой ответ закрывает попап.
     */
    public async trigger(triggerKind: TriggerKind = SignatureHelpTriggerKind.Invoke, character?: string): Promise<void> {
        this.cancelScheduledTrigger();
        const editor = this.group.getActiveEditor();
        if (editor === null) return;
        const source = this.group.signatureHelpSource;
        if (source === undefined) return;

        const caret = editor.viewState.selections[0].active;
        // Stryker disable next-line UpdateOperator: сравнение идёт на равенство, поэтому направление счётчика роли не играет — важно лишь, что каждый запрос берёт свежее значение
        const seq = ++this.requestSeq;
        const isRetrigger = this.isOpen();
        const help = await source({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text: editor.getText(),
            line: caret.line,
            character: caret.character,
            triggerKind,
            ...(character === undefined ? {} : { triggerCharacter: character }),
            isRetrigger,
            // Эхо показанной подсказки: по нему сервер удерживает перегрузку,
            // которую пользователь выбрал стрелками (tsserver ищет её по метке).
            ...(isRetrigger && this.currentHelp !== null
                ? { activeSignatureHelp: { ...this.currentHelp, activeSignature: this.activeSignatureIndex } }
                : {}),
        });
        // Пока ходили за ответом, попап могли закрыть или перезапросить — старый
        // ответ не имеет права перекрыть новое состояние.
        if (seq !== this.requestSeq) return;
        if (help === null) {
            this.close();
            return;
        }
        // Каретка могла уйти за время await — без якоря показывать негде.
        const anchor = editor.getCaretAnchor();
        if (anchor === null) {
            this.close();
            return;
        }

        this.currentHelp = help;
        this.activeSignatureIndex = clampIndex(help.activeSignature, help.signatures.length);
        this.renderHint();
        this.component.openAt(anchor);
    }

    /** Открыт ли попап (для `parameterHintsVisible` и делегаторов команд). */
    public isOpen(): boolean {
        return this.component.isOpen();
    }

    /** Есть ли перегрузки (для `parameterHintsMultipleSignatures` — стрелки листают только их). */
    public hasMultipleSignatures(): boolean {
        return (this.currentHelp?.signatures.length ?? 0) > 1;
    }

    /** Следующая перегрузка — локально, без запроса к серверу. */
    public nextSignature(): void {
        this.stepSignature(1);
    }

    public previousSignature(): void {
        this.stepSignature(-1);
    }

    public close(): void {
        this.cancelScheduledTrigger();
        this.component.close();
        this.component.setHint(null);
        this.currentHelp = null;
        this.activeSignatureIndex = 0;
        // Ответ «в полёте» больше не нужен: его seq устареет и будет отброшен.
        // Stryker disable next-line UpdateOperator: сдвиг счётчика в любую сторону делает «летящий» seq неравным — направление роли не играет
        this.requestSeq++;
    }

    /** Фокус ушёл с редактора (Ctrl+Tab, Quick Open) — попап без якоря не жилец. */
    public onFocusChanged(editorFocused: boolean): void {
        if (!editorFocused && this.isOpen()) this.close();
    }

    private stepSignature(delta: 1 | -1): void {
        const count = this.currentHelp?.signatures.length ?? 0;
        // Stryker disable next-line ConditionalExpression: без выхода одна сигнатура просто пересобирает попап тем же содержимым, а ноль даёт NaN-индекс, который перетрёт следующий ответ, — поведение не меняется
        if (count <= 1) return;
        this.activeSignatureIndex = (((this.activeSignatureIndex + delta) % count) + count) % count;
        this.renderHint();
    }

    /** Перекладывает текущую подсказку в попап (после запроса и после листания). */
    private renderHint(): void {
        const help = this.currentHelp;
        /* v8 ignore start -- defensive: рендер зовут только при живой подсказке */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: ветка недостижима — см. v8 ignore выше
        if (help === null) return;
        /* v8 ignore stop */
        const signature = help.signatures[this.activeSignatureIndex];
        // Сигнатура вправе задать свой активный параметр — он важнее общего.
        const activeParameter = signature.activeParameter ?? help.activeParameter;
        const documentation = [signature.parameters[activeParameter]?.documentation, signature.documentation]
            .map((doc) => (doc === undefined ? "" : stripMarkdown(doc)))
            .filter((doc) => doc !== "");
        this.component.setHint({
            label: signature.label,
            activeSpan: activeParameterSpan(signature, activeParameter),
            counter: help.signatures.length > 1 ? `${this.activeSignatureIndex + 1}/${help.signatures.length}` : null,
            documentation,
        });
    }

    private bindEditor(editor: TextEditorPane | null): void {
        this.unbindEditor();
        // Смена редактора при открытом попапе в приложении уже сопровождается
        // сменой фокуса (её ловит onFocusChanged), поэтому в юните пропуск этого
        // закрытия не наблюдается — вызов держим для программной смены редактора
        // без участия фокуса (восстановление сессии, split).
        // Stryker disable next-line CallExpression: см. выше
        this.close();
        this.resetCaretCache(editor);
        if (editor === null) return;
        // Правка только взводит флаг: вся работа идёт из события каретки, где
        // view-state уже консистентен (схема CompletionService).
        this.contentSub = editor.onDidChangeContent(() => {
            this.contentDidChange = true;
        });
        this.caretSub = editor.onDidChangeCursorPosition(() => {
            this.onCaretChanged();
        });
    }

    private unbindEditor(): void {
        // Stryker disable next-line OptionalChaining: до первой привязки подписок нет — обращение к dispose несуществующей кинуло бы на старте
        this.caretSub?.dispose();
        this.caretSub = null;
        // Stryker disable next-line OptionalChaining: см. выше
        this.contentSub?.dispose();
        this.contentSub = null;
        // Stryker disable next-line BooleanLiteral: «правка была» без правки всё равно отсекается проверкой длины строки в isSingleCharInsert — флаг лишь экономит её вызов
        this.contentDidChange = false;
    }

    /**
     * Единый обработчик правки/движения каретки: набор триггер-символа
     * открывает подсказку, а пока она показана — любое изменение позиции или
     * текста её перезапрашивает (иначе активный параметр застыл бы на первом).
     */
    private onCaretChanged(): void {
        const wasEdit = this.contentDidChange;
        // Stryker disable next-line BooleanLiteral: не сброшенный флаг ненаблюдаем по той же причине, что и в unbindEditor — вставку символа опознаёт длина строки, а не он
        this.contentDidChange = false;

        const editor = this.group.getActiveEditor();
        /* v8 ignore start -- defensive: события приходят от привязанного редактора */
        // Stryker disable next-line ConditionalExpression,EqualityOperator: ветка недостижима — см. v8 ignore выше
        if (editor === null) return;
        /* v8 ignore stop */

        const { active, line } = this.readCaret(editor);

        if (active === null) {
            // Выделение, а не каретка: показывать подсказку вызова не для чего.
            // `close()` идемпотентен и заодно снимает отложенный запрос — иначе
            // набранная перед выделением «(» открыла бы попап уже поверх него.
            this.close();
            // Stryker disable next-line CallExpression: кэш каретки при выделении всё равно не совпадёт с одиночной вставкой (длина строки не сойдётся), поэтому пропуск сброса ненаблюдаем
            this.updateCaretCache(active, line);
            return;
        }

        const inserted = wasEdit ? this.insertedChar(line, active) : null;
        if (inserted !== null && this.group.signatureHelpTriggerCharacters.includes(inserted)) {
            this.scheduleTrigger(SignatureHelpTriggerKind.TriggerCharacter, inserted);
        } else if (this.isOpen()) {
            // Ретриггер-символ (`)`) отличается от прочих правок только тем, что
            // сервер получает его в контексте — ответ на нём обычно пустой,
            // и подсказка закрывается сама.
            const retrigger =
                inserted !== null && this.group.signatureHelpRetriggerCharacters.includes(inserted) ? inserted : null;
            this.scheduleTrigger(
                retrigger === null ? SignatureHelpTriggerKind.ContentChange : SignatureHelpTriggerKind.TriggerCharacter,
                retrigger ?? undefined,
            );
        }

        this.updateCaretCache(active, line);
    }

    /** Набранный только что символ (ровно одна вставка у каретки) или `null`. */
    private insertedChar(line: string, active: IPosition): string | null {
        if (!isSingleCharInsert(line, active, this.lastCaretLine, this.lastCaretChar, this.lastLine)) return null;
        // `slice`, а не `at`: эвристика выше уже гарантировала, что символ на
        // этой позиции есть, и ветка «его нет» была бы мёртвой.
        return line.slice(active.character - 1, active.character);
    }

    /** Каретка и её строка; `active: null` — выделение, а не одиночная каретка. */
    private readCaret(editor: TextEditorPane): { active: IPosition | null; line: string } {
        const selections = editor.viewState.selections;
        const active = selections.length === 1 && isSelectionCollapsed(selections[0]) ? selections[0].active : null;
        // Stryker disable next-line StringLiteral: строка без каретки уходит только в кэш, а он в этом состоянии всё равно не даст совпадения по длине
        const line = active !== null ? editor.viewState.document.getLineContent(active.line) : "";
        return { active, line };
    }

    private scheduleTrigger(triggerKind: TriggerKind, character?: string): void {
        this.cancelScheduledTrigger();
        this.triggerTimer = setTimeout(() => {
            this.triggerTimer = null;
            void this.trigger(triggerKind, character);
        }, this.triggerDelayMs);
    }

    private cancelScheduledTrigger(): void {
        // Stryker disable next-line ConditionalExpression: clearTimeout(null) — no-op, поэтому проверка экономит вызов, а не меняет поведение
        if (this.triggerTimer !== null) {
            clearTimeout(this.triggerTimer);
            this.triggerTimer = null;
        }
    }

    private updateCaretCache(active: IPosition | null, line: string): void {
        // `-1` — заведомо недостижимая позиция: чтобы часовой сработал, вставка
        // должна оставить каретку на нулевой колонке, а она всегда сдвигает её
        // вправо. Сдвиг часового на +1 требует уже противоречия (каретка на
        // колонке 2 в строке длиной 1), поэтому тоже ненаблюдаем.
        // Stryker disable next-line UnaryOperator: см. выше
        this.lastCaretLine = active?.line ?? -1;
        // Stryker disable next-line UnaryOperator: см. выше
        this.lastCaretChar = active?.character ?? -1;
        this.lastLine = line;
    }

    private resetCaretCache(editor: TextEditorPane | null): void {
        if (editor === null) {
            // Stryker disable next-line StringLiteral: без редактора набирать некуда — строка кэша в этом состоянии не читается
            this.updateCaretCache(null, "");
            return;
        }
        const { active, line } = this.readCaret(editor);
        this.updateCaretCache(active, line);
    }
}

/** Индекс активной сигнатуры в границах списка (сервер вправе прислать любой). */
function clampIndex(index: number, length: number): number {
    // Stryker disable next-line EqualityOperator: на index === 0 обе границы дают ноль — тот же индекс, что и без клампа
    if (index < 0 || index >= length) return 0;
    return index;
}
