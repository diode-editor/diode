import { Disposable } from "../../../../../../tuidom/common/disposable.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { findMatches } from "../../../../editor/contrib/find/findMatches.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import type { FindComponent } from "./findComponent.ts";
import { FindComponentDIToken } from "./findComponent.ts";

export const FindServiceDIToken = token<FindService>("FindService");

/**
 * Drives find-in-file: owns the query → matches → current-index state and
 * pushes it to the active editor for highlighting + reveal. The widget and its
 * overlay session live in {@link FindComponent}; the service wires the widget
 * callbacks and follows the active editor via {@link EditorService} (switching
 * editors closes the widget — find operates on the active editor only).
 */
export class FindService extends Disposable {
    public static dependencies = [FindComponentDIToken, EditorServiceDIToken] as const;

    private readonly component: FindComponent;
    private readonly editorService: EditorService;

    private matches: IRange[] = [];
    private currentIndex = -1;
    /**
     * Редактор, по которому идёт текущая сессия поиска. Пиним его на открытии и
     * НЕ перерешаем: виджет забирает фокус себе, а `getActiveEditor()` следует за
     * фокусом — со второго же вызова поиск уезжал бы на другой редактор. Именно
     * так `Ctrl+F` из панели Output искал по файлу за ней.
     */
    private target: TextEditorPane | null = null;

    public constructor(component: FindComponent, editorService: EditorService) {
        super();
        this.component = component;
        this.editorService = editorService;
        component.onQueryChange = () => {
            this.recompute();
        };
        component.onNext = () => {
            this.next();
        };
        component.onPrev = () => {
            this.prev();
        };
        component.onClose = () => {
            this.close();
        };
        // Find оперирует только активным редактором — смена активного закрывает
        // виджет (раньше эту подписку держал корневой контроллер).
        this.register(
            this.editorService.onActiveEditorChanged(() => {
                this.close();
            }),
        );
    }

    public isVisible(): boolean {
        return this.component.isOpen();
    }

    public open(): void {
        if (this.component.isOpen()) {
            // Повторный Ctrl+F на уже открытом виджете: вернуть фокус и выделить
            // весь запрос, чтобы его можно было сразу перепечатать (VS Code).
            this.component.focus();
            this.component.selectQuery();
            return;
        }

        // Цель сессии фиксируем ДО показа виджета: показ уводит фокус в его инпут.
        this.target = this.editorService.getActiveEditor();

        // Seed the query from a single-line, non-empty selection (VS Code behaviour).
        const editor = this.target;
        if (editor) {
            const selected = editor.viewState.getSelectedText();
            if (selected.length > 0 && !selected.includes("\n")) {
                this.component.setQuery(selected);
            }
        }

        this.recompute();
        this.component.show();
        // Выделить сохранённый/засеянный запрос целиком — готов к перезаписи
        // первым же нажатием. Для пустого запроса selectAll — no-op.
        this.component.selectQuery();
    }

    public close(): void {
        if (!this.component.isOpen()) return;

        // Закрываем сессию по её же цели: активный редактор к этому моменту —
        // уже другой (фокус в инпуте виджета), и подсветку сняли бы не с того.
        const editor = this.target;
        this.target = null;
        if (editor) {
            // Leave the cursor on the current match (VS Code behaviour), then clear highlights.
            if (this.currentIndex >= 0 && this.currentIndex < this.matches.length) {
                const m = this.matches[this.currentIndex];
                editor.viewState.selections = [
                    createSelection(m.start.line, m.start.character, m.end.line, m.end.character),
                ];
            }
            editor.setSearchDecorations([], -1);
        }

        this.matches = [];
        this.currentIndex = -1;
        this.component.hide();
    }

    public next(): void {
        this.navigate(1);
    }

    public prev(): void {
        this.navigate(-1);
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /**
     * Шаг по совпадениям. В VS Code «Find Next» живёт от фокуса в редакторе, а не
     * от видимости виджета: состояние поиска переживает закрытие, и F3 продолжает
     * ходить по последнему запросу (`NextMatchFindAction`, `kbExpr: EditorContextKeys.focus`).
     *
     * При открытом виджете фокус в его инпуте, курсор редактора не трогаем — его
     * поставит `close()`. При закрытом фокус в тексте, поэтому совпадение сразу
     * становится выделением: иначе «нашлось» было бы видно только подсветкой,
     * а курсор остался бы на месте.
     */
    private navigate(direction: 1 | -1): void {
        if (this.component.isOpen()) {
            if (this.matches.length === 0) return;
            this.setCurrent(this.step(direction));
            return;
        }

        const startedNewSession = this.matches.length === 0 || this.target !== this.editorService.getActiveEditor();
        if (startedNewSession && !this.startDetachedSession()) return;
        if (this.matches.length === 0) return;

        // Первое нажатие приводит на ближайшее совпадение от курсора (его выбрал
        // recompute), дальнейшие — шагают. Назад шагаем сразу: ближайшее «вперёд»
        // для Shift+F3 было бы движением не в ту сторону.
        const index = startedNewSession && direction === 1 ? this.currentIndex : this.step(direction);
        this.setCurrent(index);
        this.selectMatch(index);
    }

    private step(direction: 1 | -1): number {
        return (this.currentIndex + direction + this.matches.length) % this.matches.length;
    }

    /**
     * Поднимает поисковую сессию без показа виджета. Запрос помнит сам компонент,
     * поэтому обычно достаточно перецелиться на активный редактор и пересчитать.
     * Пустой запрос сеем из однострочного выделения (upstream
     * `seedSearchStringFromSelection`); если и его нет — искать нечего, открываем
     * виджет и спрашиваем. Возвращает false, когда навигацию продолжать не надо.
     */
    private startDetachedSession(): boolean {
        const editor = this.editorService.getActiveEditor();
        if (!editor) return false;

        if (this.component.getQuery().length === 0) {
            const selected = editor.viewState.getSelectedText();
            if (selected.length === 0 || selected.includes("\n")) {
                this.open();
                return false;
            }
            this.component.setQuery(selected);
        }

        this.target = editor;
        this.recompute();
        return true;
    }

    /** Ставит выделение на совпадение — курсор идёт за поиском, как в VS Code. */
    private selectMatch(index: number): void {
        const editor = this.target;
        /* v8 ignore start -- navigate() доходит сюда только с поднятой сессией, цель есть */
        if (!editor) return;
        /* v8 ignore stop */
        const match = this.matches[index];
        editor.viewState.selections = [
            createSelection(match.start.line, match.start.character, match.end.line, match.end.character),
        ];
    }

    /**
     * Recomputes matches for the current query, seeds the current index from the
     * cursor, and refreshes the editor highlights + counter.
     */
    private recompute(): void {
        const editor = this.target;
        if (!editor) {
            this.matches = [];
            this.currentIndex = -1;
            this.component.setCounter(0, 0);
            return;
        }

        this.matches = findMatches(editor.viewState.document, this.component.getQuery());

        if (this.matches.length === 0) {
            this.currentIndex = -1;
        } else {
            this.currentIndex = this.pickCurrentIndex(this.matches, editor.viewState.selections[0].active);
        }

        editor.setSearchDecorations(this.matches, this.currentIndex);
        if (this.currentIndex >= 0) {
            editor.revealRange(this.matches[this.currentIndex]);
        }
        this.component.setCounter(this.currentIndex + 1, this.matches.length);
    }

    private setCurrent(index: number): void {
        this.currentIndex = index;
        // `matches` и `target` живут и умирают вместе (см. recompute/close), а
        // сюда попадают только при непустом списке совпадений — значит цель есть.
        const editor = this.target!;
        editor.setSearchDecorations(this.matches, index);
        editor.revealRange(this.matches[index]);
        this.component.setCounter(index + 1, this.matches.length);
    }

    /** First match starting at or after `cursor`, wrapping to the first match. */
    private pickCurrentIndex(matches: IRange[], cursor: IPosition): number {
        for (let i = 0; i < matches.length; i++) {
            if (comparePositions(matches[i].start, cursor) >= 0) return i;
        }
        return 0;
    }
}
