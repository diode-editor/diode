import type { IDisposable } from "@tuidom/core/common/disposable";
import { Disposable } from "@tuidom/core/common/disposable";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import { createSelection } from "../../../../editor/common/core/iSelection.ts";
import { findMatches } from "../../../../editor/contrib/find/findMatches.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import type { EditorGroup, GroupId } from "../../../services/editor/browser/editorGroupModel.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";

import type { FindComponent, FindWidget } from "./findComponent.ts";
import { FindComponentDIToken } from "./findComponent.ts";

export const FindServiceDIToken = token<FindService>("FindService");

/** Состояние поисковой сессии одной группы (виджет может быть и закрыт — F3). */
interface IFindSession {
    matches: IRange[];
    currentIndex: number;
    /**
     * Редактор, по которому идёт сессия. Пиним его на открытии и НЕ перерешаем:
     * виджет забирает фокус себе, а `getActiveEditor()` следует за фокусом — со
     * второго же вызова поиск уезжал бы на другой редактор. Именно так `Ctrl+F`
     * из панели Output искал по файлу за ней.
     */
    target: TextEditorPane | null;
    /** Смена активной вкладки СВОЕЙ группы закрывает её сессию. */
    paneSubscription: IDisposable | null;
}

/**
 * Drives find-in-file: owns the per-group query → matches → current-index state
 * and pushes it to the group's editor for highlighting + reveal. Виджеты и их
 * overlay-сессии живут в {@link FindComponent} — по одному на группу (US-33):
 * find в группе A остаётся открытым со своим запросом, пока пользователь ищет
 * в группе B; Escape закрывает только виджет своей группы. Команды (Ctrl+F, F3,
 * Escape) оперируют активной группой.
 */
export class FindService extends Disposable {
    public static dependencies = [FindComponentDIToken, EditorServiceDIToken] as const;

    private readonly component: FindComponent;
    private readonly editorService: EditorService;

    private readonly sessions = new Map<GroupId, IFindSession>();

    public constructor(component: FindComponent, editorService: EditorService) {
        super();
        this.component = component;
        this.editorService = editorService;
        component.onQueryChange = (groupId) => {
            this.recompute(groupId);
        };
        component.onNext = (groupId) => {
            this.navigate(groupId, 1);
        };
        component.onPrev = (groupId) => {
            this.navigate(groupId, -1);
        };
        component.onClose = (groupId) => {
            this.closeGroup(groupId);
        };
        // Схлопнутая группа забирает сессию и виджет с собой.
        this.register(
            this.editorService.onDidGroupsChange((event) => {
                if (event.kind !== "removed") return;
                this.dropSession(event.group.id);
                this.component.disposeWidget(event.group.id);
            }),
        );
        this.register({
            dispose: () => {
                for (const groupId of [...this.sessions.keys()]) this.dropSession(groupId);
            },
        });
    }

    /** Открыт ли find-виджет АКТИВНОЙ группы (контекст-ключ findWidgetVisible). */
    public isVisible(): boolean {
        return this.component.isOpen(this.editorService.activeGroup.id);
    }

    /** Ctrl+F: открывает/фокусирует find активной группы. */
    public open(): void {
        const group = this.editorService.activeGroup;
        const widget = this.component.widgetFor(group.id);
        if (widget === null) return;
        if (widget.isOpen()) {
            // Повторный Ctrl+F на уже открытом виджете: вернуть фокус и выделить
            // весь запрос, чтобы его можно было сразу перепечатать (VS Code).
            widget.focus();
            widget.selectQuery();
            return;
        }

        const session = this.sessionFor(group);
        // Цель сессии фиксируем ДО показа виджета: показ уводит фокус в его инпут.
        session.target = this.editorService.getActiveEditor();

        // Seed the query from a single-line, non-empty selection (VS Code behaviour).
        const editor = session.target;
        if (editor) {
            const selected = editor.viewState.getSelectedText();
            if (selected.length > 0 && !selected.includes("\n")) {
                widget.setQuery(selected);
            }
        }

        this.recompute(group.id);
        widget.show();
        // Выделить сохранённый/засеянный запрос целиком — готов к перезаписи
        // первым же нажатием. Для пустого запроса selectAll — no-op.
        widget.selectQuery();
    }

    /** Escape/крестик: закрывает find активной группы. */
    public close(): void {
        this.closeGroup(this.editorService.activeGroup.id);
    }

    public next(): void {
        this.navigate(this.editorService.activeGroup.id, 1);
    }

    public prev(): void {
        this.navigate(this.editorService.activeGroup.id, -1);
    }

    // ─── Private ─────────────────────────────────────────────────────────────

    /** Сессия группы (создаётся лениво) с подпиской «смена вкладки → закрыть». */
    private sessionFor(group: EditorGroup): IFindSession {
        const existing = this.sessions.get(group.id);
        if (existing !== undefined) return existing;
        const session: IFindSession = { matches: [], currentIndex: -1, target: null, paneSubscription: null };
        // Find оперирует зафиксированной целью — смена активной вкладки ЭТОЙ
        // группы закрывает её сессию (чужие группы не влияют — US-33).
        session.paneSubscription = group.onDidChangeActivePane((pane) => {
            if (pane !== session.target) this.closeGroup(group.id);
        });
        this.sessions.set(group.id, session);
        return session;
    }

    private dropSession(groupId: GroupId): void {
        const session = this.sessions.get(groupId);
        if (session === undefined) return;
        session.paneSubscription?.dispose();
        this.sessions.delete(groupId);
    }

    private closeGroup(groupId: GroupId): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        if (widget === null || session === undefined || !widget.isOpen()) return;

        // Закрываем сессию по её же цели: активный редактор к этому моменту —
        // уже другой (фокус в инпуте виджета), и подсветку сняли бы не с того.
        const editor = session.target;
        session.target = null;
        if (editor) {
            // Leave the cursor on the current match (VS Code behaviour), then clear highlights.
            if (session.currentIndex >= 0 && session.currentIndex < session.matches.length) {
                const m = session.matches[session.currentIndex];
                editor.viewState.selections = [
                    createSelection(m.start.line, m.start.character, m.end.line, m.end.character),
                ];
            }
            editor.setSearchDecorations([], -1);
        }

        session.matches = [];
        session.currentIndex = -1;
        widget.hide();
    }

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
    private navigate(groupId: GroupId, direction: 1 | -1): void {
        const widget = this.component.widgetFor(groupId);
        if (widget === null) return;
        const group = this.editorService.groups.find((candidate) => candidate.id === groupId);
        /* v8 ignore start -- виджет существует только у живой группы */
        if (group === undefined) return;
        /* v8 ignore stop */
        const session = this.sessionFor(group);

        if (widget.isOpen()) {
            if (session.matches.length === 0) return;
            this.setCurrent(groupId, this.step(session, direction));
            return;
        }

        const startedNewSession =
            session.matches.length === 0 || session.target !== this.editorService.getActiveEditor();
        if (startedNewSession && !this.startDetachedSession(group, widget)) return;
        if (session.matches.length === 0) return;

        // Первое нажатие приводит на ближайшее совпадение от курсора (его выбрал
        // recompute), дальнейшие — шагают. Назад шагаем сразу: ближайшее «вперёд»
        // для Shift+F3 было бы движением не в ту сторону.
        const index = startedNewSession && direction === 1 ? session.currentIndex : this.step(session, direction);
        this.setCurrent(groupId, index);
        this.selectMatch(session, index);
    }

    private step(session: IFindSession, direction: 1 | -1): number {
        return (session.currentIndex + direction + session.matches.length) % session.matches.length;
    }

    /**
     * Поднимает поисковую сессию без показа виджета. Запрос помнит сам виджет,
     * поэтому обычно достаточно перецелиться на активный редактор и пересчитать.
     * Пустой запрос сеем из однострочного выделения (upstream
     * `seedSearchStringFromSelection`); если и его нет — искать нечего, открываем
     * виджет и спрашиваем. Возвращает false, когда навигацию продолжать не надо.
     */
    private startDetachedSession(group: EditorGroup, widget: FindWidget): boolean {
        const editor = this.editorService.getActiveEditor();
        if (!editor) return false;

        if (widget.getQuery().length === 0) {
            const selected = editor.viewState.getSelectedText();
            if (selected.length === 0 || selected.includes("\n")) {
                this.open();
                return false;
            }
            widget.setQuery(selected);
        }

        const session = this.sessionFor(group);
        session.target = editor;
        this.recompute(group.id);
        return true;
    }

    /** Ставит выделение на совпадение — курсор идёт за поиском, как в VS Code. */
    private selectMatch(session: IFindSession, index: number): void {
        const editor = session.target;
        /* v8 ignore start -- navigate() доходит сюда только с поднятой сессией, цель есть */
        if (!editor) return;
        /* v8 ignore stop */
        const match = session.matches[index];
        editor.viewState.selections = [
            createSelection(match.start.line, match.start.character, match.end.line, match.end.character),
        ];
    }

    /**
     * Recomputes matches for the current query, seeds the current index from the
     * cursor, and refreshes the editor highlights + counter.
     */
    private recompute(groupId: GroupId): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        if (widget === null || session === undefined) return;
        const editor = session.target;
        if (!editor) {
            session.matches = [];
            session.currentIndex = -1;
            widget.setCounter(0, 0);
            return;
        }

        session.matches = findMatches(editor.viewState.document, widget.getQuery());

        if (session.matches.length === 0) {
            session.currentIndex = -1;
        } else {
            session.currentIndex = this.pickCurrentIndex(session.matches, editor.viewState.selections[0].active);
        }

        editor.setSearchDecorations(session.matches, session.currentIndex);
        if (session.currentIndex >= 0) {
            editor.revealRange(session.matches[session.currentIndex]);
        }
        widget.setCounter(session.currentIndex + 1, session.matches.length);
    }

    private setCurrent(groupId: GroupId, index: number): void {
        const widget = this.component.widgetIfExists(groupId);
        const session = this.sessions.get(groupId);
        /* v8 ignore start -- вызывается только по живой сессии */
        if (widget === null || session === undefined) return;
        /* v8 ignore stop */
        session.currentIndex = index;
        // `matches` и `target` живут и умирают вместе (см. recompute/close), а
        // сюда попадают только при непустом списке совпадений — значит цель есть.
        const editor = session.target!;
        editor.setSearchDecorations(session.matches, index);
        editor.revealRange(session.matches[index]);
        widget.setCounter(index + 1, session.matches.length);
    }

    /** First match starting at or after `cursor`, wrapping to the first match. */
    private pickCurrentIndex(matches: IRange[], cursor: IPosition): number {
        for (let i = 0; i < matches.length; i++) {
            if (comparePositions(matches[i].start, cursor) >= 0) return i;
        }
        return 0;
    }
}
