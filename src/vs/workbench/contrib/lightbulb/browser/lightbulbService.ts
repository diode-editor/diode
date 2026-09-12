import { Disposable, type IDisposable } from "@tuidom/core/common/disposable";

import { createRange } from "../../../../editor/common/core/iRange.ts";
import { CodeActionTriggerKind } from "../../../../editor/common/languages/iCodeActionSource.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { MarkerService } from "../../../../platform/markers/common/markerService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { MarkerServiceDIToken } from "../../../common/coreTokens.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

/**
 * Задержка перед фоновым запросом действий: движение каретки по строке не
 * должно бомбить language server, а лампочке незачем мигать на каждый шаг.
 */
export const LIGHTBULB_DEBOUNCE_MS = 300;

/**
 * Индикатор code actions («лампочка») в гуттере строки каретки — аналог
 * VS Code lightbulb. Слушает каретку/правки активного редактора и смену
 * маркеров его ресурса, с дебаунсом спрашивает `codeActionSource.provide`
 * (полная строка каретки, `triggerKind: Automatic` — серверы вправе не считать
 * дорогие рефакторинги) и зажигает {@link TextEditorPane.setLightbulbLine}.
 * Сама лампочка ничего не открывает — меню за Ctrl+. (`editor.action.quickFix`).
 *
 * Гигиена асинхронности — как у {@link ../parameterHints/browser/parameterHintsService.ts:ParameterHintsService}:
 * счётчик `requestSeq` отбрасывает устаревшие ответы, а перед применением
 * ответ сверяется с текущими редактором/строкой/версией документа.
 */
export class LightbulbService extends Disposable {
    public static dependencies = [EditorServiceDIToken, MarkerServiceDIToken] as const;

    /** Guard от устаревших ответов: пока ходили за действиями, запрос мог смениться. */
    private requestSeq = 0;
    private caretSub: IDisposable | null = null;
    private contentSub: IDisposable | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    /** Вью, на которой сейчас горит лампочка, — гасить надо ИМЕННО её (вкладка могла смениться). */
    private litPane: TextEditorPane | null = null;
    // Затравка перетирается первым же событием каретки; -1 не совпадает ни с одной строкой.
    // Stryker disable next-line UnaryOperator: см. выше
    private lastLine = -1;

    public constructor(
        private readonly group: EditorService,
        private readonly markers: MarkerService,
    ) {
        super();
        const activeEditorSub = this.group.onActiveEditorChanged((editor) => {
            this.bindEditor(editor);
        });
        // Смена маркеров ресурса активного редактора: диагностика приезжает
        // ПОЗЖЕ правки (асинхронный сервер) — лампочка должна вспыхнуть и без
        // движения каретки.
        const markersSub = this.markers.onDidChangeMarkers((resources) => {
            const editor = this.group.getActiveEditor();
            if (editor === null) return;
            if (!resources.includes(editor.uri.toString())) return;
            this.schedule();
        });
        // Стартовая привязка — для уже открытого редактора (восстановленная
        // сессия). В харнессе файл открывают после конструктора, туда приходит
        // onActiveEditorChanged — пропуск юнитом не наблюдается.
        // Stryker disable next-line CallExpression: см. выше
        this.bindEditor(this.group.getActiveEditor());
        this.register({
            // Stryker disable next-line BlockStatement: снятие подписок на выключении ненаблюдаемо юнитом — редактор и группа умирают следом
            dispose: () => {
                // Stryker disable next-line CallExpression: см. выше
                activeEditorSub.dispose();
                // Stryker disable next-line CallExpression: см. выше
                markersSub.dispose();
                // Stryker disable next-line CallExpression: см. выше
                this.unbindEditor();
            },
        });
    }

    private bindEditor(editor: TextEditorPane | null): void {
        this.unbindEditor();
        // Прошлая вкладка уносит свою лампочку с собой — на новой она честно
        // пересчитывается заново.
        this.hide();
        if (editor === null) return;
        this.caretSub = editor.onDidChangeCursorPosition(() => {
            this.onCaretMoved(editor);
        });
        this.contentSub = editor.onDidChangeContent(() => {
            // Правка меняет и набор действий, и валидность позиции — прячем
            // сразу, пересчёт по дебаунсу.
            this.hide();
            this.schedule();
        });
        this.schedule();
    }

    private unbindEditor(): void {
        // Stryker disable next-line OptionalChaining: до первой привязки подписок нет
        this.caretSub?.dispose();
        this.caretSub = null;
        // Stryker disable next-line OptionalChaining: см. выше
        this.contentSub?.dispose();
        this.contentSub = null;
        this.cancelTimer();
    }

    private onCaretMoved(editor: TextEditorPane): void {
        const line = editor.viewState.selections[0].active.line;
        // Уход с подсвеченной строки гасит лампочку сразу (не дожидаясь
        // ответа): старый индикатор на чужой строке — враньё. Движение ПО
        // строке оставляет её гореть — действия строки не сменились.
        if (line !== this.lastLine) this.hide();
        this.lastLine = line;
        this.schedule();
    }

    /** Дебаунс фонового запроса: последний триггер выигрывает. */
    private schedule(): void {
        this.cancelTimer();
        this.timer = setTimeout(() => {
            this.timer = null;
            // Фоновый пересчёт индикатора не имеет права уронить процесс —
            // сбой источника читается как «действий нет» (лампочка не врёт:
            // она просто не загорится/не обновится до следующего триггера).
            this.query().catch(() => undefined);
        }, LIGHTBULB_DEBOUNCE_MS);
    }

    private cancelTimer(): void {
        // Stryker disable next-line ConditionalExpression: `clearTimeout(null)` безвреден и `this.timer = null` идемпотентен — гард только избегает холостого вызова
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async query(): Promise<void> {
        const editor = this.group.getActiveEditor();
        const source = this.group.codeActionSource;
        if (editor === null || source === undefined) {
            this.hide();
            return;
        }

        const line = editor.viewState.selections[0].active.line;
        this.lastLine = line;
        const version = editor.model.document.versionId;
        const text = editor.getText();
        const lines = text.split("\n");
        // Stryker disable next-line UpdateOperator: сравнение на равенство — направление счётчика роли не играет
        const seq = ++this.requestSeq;

        const actions = await source.provide({
            uri: editor.uri.toString(),
            languageId: editor.languageId,
            text,
            // Полная строка каретки — накрывает диагностики строки, к которым
            // сервер прицепил фиксы (та же логика, что у editor.action.quickFix).
            range: createRange(line, 0, line, lines[line]?.length ?? 0),
            triggerKind: CodeActionTriggerKind.Automatic,
        });

        // Пока ходили за ответом, мир мог уйти: новый запрос, другая вкладка,
        // другая строка или правка — старый ответ не имеет права зажечь лампочку.
        if (seq !== this.requestSeq) return;
        const current = this.group.getActiveEditor();
        if (
            current !== editor ||
            editor.viewState.selections[0].active.line !== line ||
            editor.model.document.versionId !== version
        ) {
            return;
        }

        if (actions === null || actions.length === 0) {
            this.hide();
            return;
        }
        // Гасить прошлую вью не нужно: любой путь смены редактора проходит
        // bindEditor → hide, поэтому здесь litPane либо null, либо этот же
        // editor — а элемент держит одну строку, set просто переносит её.
        editor.setLightbulbLine(line);
        this.litPane = editor;
    }

    /** Гасит лампочку на той вью, где она горела (не обязательно активной). */
    private hide(): void {
        if (this.litPane === null) return;
        this.litPane.setLightbulbLine(null);
        this.litPane = null;
    }
}

// Stryker disable next-line StringLiteral: token() возвращает новый Token, и зависимости резолвятся по ссылке — строка внутри остаётся отладочной меткой
export const LightbulbServiceDIToken = token<LightbulbService>("LightbulbService");
