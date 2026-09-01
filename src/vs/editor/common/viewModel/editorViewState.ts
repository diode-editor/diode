import { DisplayLine } from "@tuidom/core/common/displayLine";
import type { IDisposable } from "@tuidom/core/common/disposable";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type { IMultiCursorFindSession } from "../../contrib/multicursor/iMultiCursorFindSession.ts";
import type { IPosition } from "../core/iPosition.ts";
import { comparePositions, createPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange, rangeContainsPosition } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import {
    createCursorSelection,
    createSelection,
    isSelectionCollapsed,
    selectionToRange,
} from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { createTextEdit } from "../core/iTextEdit.ts";
import { sortAndMergeSelections } from "../core/sortAndMergeSelections.ts";
import { charClass } from "../core/wordClassification.ts";
import { computeNewLinePlan } from "../languages/autoIndent.ts";
import type { ILineTokens } from "../languages/iLineTokens.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import { detectIndentation } from "../model/indentationDetector.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";
import type { IUndoElement } from "../model/iUndoElement.ts";
import type { DocumentTokenStore } from "../tokens/documentTokenStore.ts";

import type { IViewZone, ViewLineKind } from "./iViewZone.ts";
import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";
import { LineBreaksCache } from "./lineBreaksCache.ts";

/** Режим переноса строк — значения `editor.wordWrap` (VS Code). */
export type WordWrapMode = "off" | "on" | "wordWrapColumn" | "bounded";

/**
 * Проекция документа на ряды вью. Параллельные массивы, а не массив объектов:
 * проекция — длиной с документ, аллокация объекта на ряд ударила бы по большим
 * файлам (та же причина, что у числовой кодировки зон в {@link encodeViewZoneRow}).
 */
interface IViewProjection {
    /** По ряду вью: номер документной строки (`>= 0`) либо код зоны (`< 0`, см. {@link encodeViewZoneRow}). */
    rowDocLine: number[];
    /** По ряду вью: offset начала фрагмента в своей документной строке; 0 у зон и целых строк. */
    rowStartOffset: number[];
    /** По документной строке: её первый ряд вью, либо -1, если строка скрыта свёрткой. */
    firstRowOfDocLine: Int32Array;
}

/**
 * Represents the view state for one editor pane.
 * Multiple EditorViewStates can reference the same ITextDocument (split view).
 *
 * Acts as a "lens" (projection) through which the renderer sees the TextDocument:
 * logical lines may differ from visual lines due to code folding, view zones and
 * word wrap (одна логическая строка → несколько рядов-фрагментов).
 */
export class EditorViewState {
    private scrollLeftValue = 0;
    private scrollTopValue = 0;

    /**
     * Скролл — аксессоры с уведомлением {@link onDidChangeView}: команды и
     * колесо пишут scrollTop/scrollLeft напрямую, и редактор обязан узнать об
     * этом, чтобы пометить себя на перерисовку (damage-tracking кадра рисует
     * только помеченное — молчаливый скролл оставлял бы экран несвежим).
     */
    public get scrollLeft(): number {
        return this.scrollLeftValue;
    }

    public set scrollLeft(value: number) {
        // Инвариант «wrap ⇒ scrollLeft ≡ 0» держится здесь, by construction, а
        // не проверками у каждого потребителя (колесо, revealPosition, команды).
        const clamped = this.isWordWrapActive ? 0 : value;
        if (this.scrollLeftValue === clamped) return;
        this.scrollLeftValue = clamped;
        this.fireViewChange();
    }

    public get scrollTop(): number {
        return this.scrollTopValue;
    }

    public set scrollTop(value: number) {
        if (this.scrollTopValue === value) return;
        this.scrollTopValue = value;
        this.fireViewChange();
    }

    public viewportWidth = 80;
    public viewportHeight = 24;
    /**
     * Режим переноса строк (`editor.wordWrap`). Плоское поле, как {@link tabSize}:
     * владелец вью пишет значение и зовёт `markDirty()`; проекция инвалидируется
     * снапшот-сравнением в {@link buildProjection}. Упрощение v1: режим
     * `wordWrapColumn` ведёт себя как `bounded` (без горизонтального скролла к
     * колонке шире вьюпорта) — см. docs/TODO/WordWrap.md.
     */
    public wordWrap: WordWrapMode = "off";
    /** Колонка переноса для режимов `wordWrapColumn`/`bounded` (`editor.wordWrapColumn`). */
    public wordWrapColumn = 80;
    /**
     * Minimum number of lines to keep visible between the primary cursor and the
     * top/bottom edge of the viewport when scrolling it into view (VS Code's
     * `editor.cursorSurroundingLines`). `0` glues the cursor to the very edge.
     */
    public cursorSurroundingLines = 0;
    /**
     * Действующая ширина отступа. Не настройка, а РЕЗУЛЬТАТ: её пересобирает
     * {@link runDetectIndentation} из трёх источников по приоритету —
     * {@link indentExplicitlySet} → детекция по содержимому → {@link configuredTabSize}.
     */
    public tabSize = 4;
    /** Действующий вид отступа — см. {@link tabSize} про источники. */
    public insertSpaces = false;
    /** `editor.tabSize` — база детекции и значение при выключенном детекте. */
    public configuredTabSize = 4;
    /** `editor.insertSpaces` — база детекции и значение при выключенном детекте. */
    public configuredInsertSpaces = false;
    /** `editor.detectIndentation`: определять ли отступ по содержимому файла. */
    public detectIndentation = true;
    /**
     * Отступ выставлен явно через `editor.options` (расширение — например,
     * стоковый EditorConfig). Такое решение главнее и детекции, и конфига:
     * расширение знает про файл то, чего не знаем ни мы, ни настройки.
     */
    public indentExplicitlySet = false;
    /**
     * Запрещает правку документа через этот view-state (VS Code
     * `EditorOption.readOnly`). Живёт здесь, а не на `EditorElement`, потому что
     * все мутации идут через эту точку — клавиатура и paste, accept completion,
     * rename/bulkEdit и `editor.applyEdit` из расширений. Мутаторы становятся
     * no-op и возвращают `undefined`, как `CodeEditorWidget.executeEdits`
     * возвращает `false` в VS Code.
     *
     * Не трогает view-состояние: курсор, выделение, скролл и фолдинг в read-only
     * работают — как и в VS Code.
     */
    public readOnly = false;
    private selectionsValue!: ISelection[];
    private cursorChangeListeners: (() => void)[] = [];
    /**
     * Ranges of all current search matches to highlight (set by the find
     * controller). Аксессоры — по той же причине, что и скролл: подсветка
     * меняет картинку, {@link onDidChangeView} обязан выстрелить.
     */
    public get searchMatches(): IRange[] {
        return this.searchMatchesValue;
    }

    public set searchMatches(value: IRange[]) {
        this.searchMatchesValue = value;
        this.fireViewChange();
    }

    /** Index into {@link searchMatches} of the active match, or -1 when there is none. */
    public get currentSearchMatchIndex(): number {
        return this.currentSearchMatchIndexValue;
    }

    public set currentSearchMatchIndex(value: number) {
        if (this.currentSearchMatchIndexValue === value) return;
        this.currentSearchMatchIndexValue = value;
        this.fireViewChange();
    }

    private searchMatchesValue: IRange[] = [];
    private currentSearchMatchIndexValue = -1;
    public readonly document: ITextDocument;
    public foldedRegions: IFoldingRegion[] = [];
    private viewZonesValue: readonly IViewZone[] = [];
    /**
     * Optional per-document token cache. The renderer is responsible for
     * calling `tokenStore.tokenizeUpTo(visibleBottom)` before reading tokens.
     */
    public tokenStore: DocumentTokenStore | undefined;

    /**
     * Живая сессия семейства «выделить следующее вхождение» (Ctrl+D). Состояние лежит
     * здесь, а не в отдельном контроллере, чтобы умереть вместе со вью и не заводить своей
     * подписки; ЛОГИКА — чистые функции `editor/contrib/multicursor/`. Тип импортируется
     * type-only — тот же приём, что с `IFoldingRegion`: рантайм-зависимости common → contrib
     * нет.
     */
    public multiCursorSession: IMultiCursorFindSession | null = null;

    private projectionCache: IViewProjection | null = null;
    /** Стартовая строка вью каждой зоны (по якорю) — offset для многострочных зон за O(1). */
    private zoneStartRowsCache: Map<number, number> | null = null;
    // Сентинелы версий не несут смысла: первый rebuild гейтится projectionCache === null.
    // Stryker disable next-line UnaryOperator: см. выше
    private projectionCacheDocVersion = -1;
    private foldsVersion = 0;
    // Stryker disable next-line UnaryOperator: см. выше
    private projectionCacheFoldsVersion = -1;
    private zonesVersion = 0;
    // Stryker disable next-line UnaryOperator: см. выше
    private projectionCacheZonesVersion = -1;
    /**
     * Снапшоты wrap-входов проекции, а не версии-счётчики: писателей у
     * {@link wordWrap}/{@link wordWrapColumn}/{@link viewportWidth}/{@link tabSize}
     * много, и «не забудь bump-нуть версию» — приглашение к багу; сравнение с
     * фактическим значением самовалидно. `-1` — «wrap выключен» (см.
     * {@link effectiveWrapWidth}).
     */
    // Stryker disable next-line UnaryOperator: сентинел не несёт смысла — первый rebuild гейтится projectionCache === null
    private projectionCacheWrapWidth = -1;
    // Stryker disable next-line UnaryOperator: см. выше
    private projectionCacheTabSize = -1;
    /** Кеш break-offsets; создаётся при первом включении wrap. */
    private lineBreaksCacheValue: LineBreaksCache | null = null;

    /**
     * Взведён, пока правку применяет СОБСТВЕННЫЙ мутатор этого view-state
     * (type/deleteLeft/…): они пересчитывают свои выделения и фолды точно, и
     * ремап по {@link remapForDocumentChange} для них был бы вторым сдвигом.
     * Чужие правки (другая вью того же документа, undo/redo, владелец
     * синтетического буфера) приходят с опущенным флагом и ремапятся.
     */
    private applyingOwnEdits = false;
    private readonly docContentSubscription: IDisposable;

    public constructor(document: ITextDocument, selections?: ISelection[]) {
        this.document = document;
        this.docContentSubscription = document.onDidChangeContent((change) => {
            if (!this.applyingOwnEdits) this.remapForDocumentChange(change);
        });
        this.selections = selections && selections.length > 0 ? selections : [createCursorSelection(0, 0)];
        this.runDetectIndentation();
    }

    /** Отписка от документа. Зовёт владелец view-state при пересоздании/закрытии вью. */
    public dispose(): void {
        this.docContentSubscription.dispose();
        this.lineBreaksCacheValue?.dispose();
    }

    // ─── Word wrap ──────────────────────────────────────────

    /** Активен ли перенос строк (любой режим, кроме `off`). */
    public get isWordWrapActive(): boolean {
        return this.wordWrap !== "off";
    }

    /**
     * Действующая ширина переноса в колонках, `null` — wrap выключен. Все
     * wrap-входы проекции схлопнуты в один скаляр: он же — ключ инвалидации
     * кеша. Нижний кламп ширины — в {@link computeLineBreakOffsets}
     * (MIN_WRAP_WIDTH), у единственного места применения.
     */
    private effectiveWrapWidth(): number | null {
        if (this.wordWrap === "off") return null;
        if (this.wordWrap === "on") return this.viewportWidth;
        // wordWrapColumn | bounded. Упрощение v1: wordWrapColumn ведёт себя как
        // bounded — колонка шире вьюпорта потребовала бы горизонтальный скролл
        // при переносе (см. docs/TODO/WordWrap.md).
        return Math.min(this.viewportWidth, this.wordWrapColumn);
    }

    /** Ленивый кеш break-offsets с актуальными параметрами. */
    private wrapBreaks(wrapWidth: number): LineBreaksCache {
        // Stryker disable next-line ConditionalExpression: чистая мемоизация — пересозданный с теми же параметрами кеш даёт тот же результат, только медленнее
        if (this.lineBreaksCacheValue === null) {
            this.lineBreaksCacheValue = new LineBreaksCache(this.document, this.tabSize, wrapWidth);
        }
        this.lineBreaksCacheValue.setParams(this.tabSize, wrapWidth);
        return this.lineBreaksCacheValue;
    }

    /**
     * Применяет собственные правки к документу под гейтом {@link applyingOwnEdits}.
     * Единственная законная дверь мутаторов view-state к `document.applyEdits`.
     */
    private applyDocumentEdits(edits: readonly ITextEdit[]): ReturnType<ITextDocument["applyEdits"]> {
        this.applyingOwnEdits = true;
        try {
            return this.document.applyEdits(edits);
        } finally {
            this.applyingOwnEdits = false;
        }
    }

    /**
     * Сдвигает состояние этой вью под правку, применённую МИМО неё: другой вью
     * того же документа, undo/redo или владельцем синтетического буфера. Ремап
     * строчный — {@link IDocumentContentChange} несёт только границы строк;
     * позиции внутри изменённого диапазона клампятся к его концу (колоночный
     * дрейф на изменённой строке принят осознанно).
     */
    private remapForDocumentChange(change: IDocumentContentChange): void {
        const lineDelta = change.newEndLine - change.oldEndLine;

        this.adjustFoldingRegionsForLineChange(change.startLine, change.oldEndLine, lineDelta);

        const remapped = this.selectionsValue.map((sel) => {
            const anchor = this.remapPosition(sel.anchor, change, lineDelta);
            const active = this.remapPosition(sel.active, change, lineDelta);
            return anchor === sel.anchor && active === sel.active
                ? sel
                : { anchor, active, idealColumn: sel.idealColumn };
        });
        // Присваиваем только при реальном сдвиге: setter файрит cursor-change, и
        // холостой выстрел на каждую чужую правку дёргал бы статус-бар и host.
        if (remapped.some((sel, i) => sel !== this.selectionsValue[i])) {
            this.selections = remapped;
        }

        // Скролл: правка целиком выше вьюпорта сдвигает содержимое — держим на
        // экране те же строки. Только без свёрнутых регионов и зон: с ними
        // логический сдвиг не равен визуальному, и честный пересчёт не стоит
        // своей цены.
        if (
            lineDelta !== 0 &&
            this.scrollTopValue > 0 &&
            !this.foldedRegions.some((region) => region.isCollapsed) &&
            this.viewZonesValue.length === 0 &&
            change.oldEndLine < this.scrollTopValue
        ) {
            this.scrollTop = Math.max(0, this.scrollTopValue + lineDelta);
        }
    }

    /** Строчный ремап одной позиции; возвращает исходный объект, если сдвига нет. */
    private remapPosition(pos: IPosition, change: IDocumentContentChange, lineDelta: number): IPosition {
        if (pos.line > change.oldEndLine) {
            return lineDelta === 0 ? pos : { line: pos.line + lineDelta, character: pos.character };
        }
        if (pos.line < change.startLine) return pos;
        // Позиция внутри изменённого диапазона: кламп к границам нового текста.
        const line = Math.min(pos.line, change.newEndLine);
        const character = Math.min(pos.character, this.document.getLineLength(line));
        return line === pos.line && character === pos.character ? pos : { line, character };
    }

    /**
     * Единая точка построения {@link DisplayLine} для строк документа — с
     * порогом {@link STOP_RENDERING_LINE_AFTER}. За порогом разбирается только
     * префикс, поэтому экстремально длинная строка перестаёт быть O(длины) на
     * любом пути (рендер, каретка, навигация по словам, hit-test). Виджеты вне
     * редактора строят `DisplayLine` без порога — их короткие строки этого не
     * требуют.
     */
    public displayLineFor(lineContent: string): DisplayLine {
        return new DisplayLine(lineContent, this.tabSize, STOP_RENDERING_LINE_AFTER);
    }

    /**
     * Primary cursor/selection list. Assigning a new array notifies
     * cursor-change listeners (used e.g. by the status bar Ln/Col indicator).
     * In-place mutation of the returned array does NOT fire the event.
     *
     * Присваивание проводит значение через {@link sortAndMergeSelections}: геттер всегда
     * отдаёт выделения в документном порядке и без пересечений, а событие несёт уже
     * финальный набор. Нормализация живёт здесь, а не отдельным вызовом у каждого мутатора,
     * потому что писателей у поля много (навигация, правки, мышь, undo, find, расширения),
     * и «не забудь нормализовать» — приглашение к багу. Первичное выделение —
     * `selections[0]`, то есть самое верхнее в документе.
     */
    public get selections(): ISelection[] {
        return this.selectionsValue;
    }

    public set selections(value: readonly ISelection[]) {
        this.selectionsValue = sortAndMergeSelections(value);
        this.fireCursorChange();
    }

    /**
     * Subscribes to cursor/selection changes. Fires whenever `selections` is
     * reassigned — cursor movement, typing, deletion, mouse, undo/redo.
     */
    public onDidChangeCursorPosition(listener: () => void): IDisposable {
        this.cursorChangeListeners.push(listener);
        return {
            dispose: () => {
                const i = this.cursorChangeListeners.indexOf(listener);
                if (i >= 0) this.cursorChangeListeners.splice(i, 1);
            },
        };
    }

    private fireCursorChange(): void {
        for (const listener of [...this.cursorChangeListeners]) {
            listener();
        }
    }

    /**
     * Подписка на визуальные изменения view-состояния мимо курсора: скролл,
     * фолдинг, подсветка поиска. Редактор помечает себя на перерисовку —
     * контракт damage-tracking «любое видимое изменение проходит через
     * markDirty» (docs/LAYOUT.md).
     */
    public onDidChangeView(listener: () => void): IDisposable {
        this.viewChangeListeners.push(listener);
        return {
            dispose: () => {
                const i = this.viewChangeListeners.indexOf(listener);
                if (i >= 0) this.viewChangeListeners.splice(i, 1);
            },
        };
    }

    private viewChangeListeners: (() => void)[] = [];

    private fireViewChange(): void {
        for (const listener of [...this.viewChangeListeners]) {
            listener();
        }
    }

    /** Единая точка мутации фолдинга: версия для кэшей + уведомление view. */
    private bumpFoldsVersion(): void {
        this.foldsVersion++;
        this.fireViewChange();
    }

    /**
     * Пересобирает действующие {@link tabSize}/{@link insertSpaces} по приоритету
     * источников: явный `editor.options` → детекция по содержимому (если она
     * включена) → значения из конфига. Зовётся из конструктора и на каждое
     * изменение конфига — детекция дешёвая, а результат обязан пересчитываться
     * целиком: иначе выключение `editor.detectIndentation` некуда откатывать.
     */
    public runDetectIndentation(): void {
        if (this.indentExplicitlySet) return;
        const defaults = { tabSize: this.configuredTabSize, insertSpaces: this.configuredInsertSpaces };
        const result = this.detectIndentation ? detectIndentation(this.document, defaults) : defaults;
        this.insertSpaces = result.insertSpaces;
        this.tabSize = result.tabSize;
    }

    // ─── View zones API ─────────────────────────────────────

    /** Текущие зоны — нормализованные (см. {@link setViewZones}). */
    public get viewZones(): readonly IViewZone[] {
        return this.viewZonesValue;
    }

    /**
     * Заменяет весь набор зон. Вход нормализуется: пустые зоны выбрасываются,
     * якоря клампятся в `[-1, lineCount-1]`, зоны с одинаковым якорем сливаются
     * (размеры суммируются), порядок — по якорю. Повторная установка того же
     * набора — no-op без события: сеттер зовут на каждый пересчёт диффа, и
     * лишний {@link onDidChangeView} дёргал бы перерисовку впустую.
     */
    public setViewZones(zones: readonly IViewZone[]): void {
        const byAnchor = new Map<number, number>();
        for (const zone of zones) {
            if (zone.size <= 0) continue;
            const anchor = Math.min(Math.max(-1, zone.afterLine), this.document.lineCount - 1);
            byAnchor.set(anchor, (byAnchor.get(anchor) ?? 0) + zone.size);
        }
        const normalized: IViewZone[] = [...byAnchor.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([afterLine, size]) => ({ afterLine, size }));

        const same =
            normalized.length === this.viewZonesValue.length &&
            normalized.every(
                (zone, i) =>
                    zone.afterLine === this.viewZonesValue[i].afterLine && zone.size === this.viewZonesValue[i].size,
            );
        if (same) return;

        this.viewZonesValue = normalized;
        this.zonesVersion++;
        this.fireViewChange();
    }

    /** Вид строки вью: документная, виртуальная (зона) или за концом вью. */
    public viewLineKind(viewLine: number): ViewLineKind {
        const row = this.buildVisibleLines().at(viewLine);
        if (viewLine < 0 || row === undefined) return "none";
        return row >= 0 ? "doc" : "zone";
    }

    /**
     * Якорь зоны, которой принадлежит строка вью, либо `null`, если строка не
     * зона. Адресация зон-декораций (филлеры и плашки диффа): владелец задаёт
     * их тем же `afterLine`, что и сами зоны.
     */
    public zoneAnchorForViewLine(viewLine: number): number | null {
        const row = this.buildVisibleLines().at(viewLine);
        if (viewLine < 0 || row === undefined || row >= 0) return null;
        return decodeViewZoneAnchor(row);
    }

    /**
     * Якорь зоны И offset строки внутри неё — адресация многострочного
     * содержимого зоны (`IViewZoneDecoration.lines[offset]`, призраки
     * inline-диффа). `null` у документных строк и за концом вью. O(1): стартовые
     * строки зон кэшируются вместе с проекцией (в кодировке проекции offset не
     * хранится — все строки зоны кодируются одинаково, см. encodeViewZoneRow).
     */
    public zoneRowForViewLine(viewLine: number): { anchor: number; offset: number } | null {
        const rows = this.buildVisibleLines();
        const row = rows.at(viewLine);
        if (viewLine < 0 || row === undefined || row >= 0) return null;
        const anchor = decodeViewZoneAnchor(row);
        /* v8 ignore start -- ?? недостижимы: кэш стартов строит тот же buildVisibleLines, якорь взят из проекции */
        const start = this.zoneStartRowsCache?.get(anchor) ?? 0;
        /* v8 ignore stop */
        return { anchor, offset: viewLine - start };
    }

    /**
     * Ближайшая документная строка для строки вью — hit-test кликов и якорь
     * прогрева токенов: сама строка, у зоны — её якорь (первая видимая
     * документная строка выше), у зоны перед началом файла — первая видимая
     * строка ниже. `viewLine` клампится в границы вью.
     */
    public docLineForViewLine(viewLine: number): number {
        const rows = this.buildVisibleLines();
        const clamped = Math.min(Math.max(0, viewLine), rows.length - 1);
        for (let i = clamped; i >= 0; i--) {
            if (rows[i] >= 0) return rows[i];
        }
        for (let i = clamped + 1; i < rows.length; i++) {
            if (rows[i] >= 0) return rows[i];
        }
        /* v8 ignore start -- недостижимо: документ не бывает пустым, хотя бы одна doc-строка во вью есть */
        return 0;
        /* v8 ignore stop */
    }

    // ─── Folding API ────────────────────────────────────────

    /**
     * Replaces the entire folding regions array.
     * Useful for external folding providers.
     */
    public setFoldingRegions(regions: IFoldingRegion[]): void {
        this.foldedRegions = regions;
        this.bumpFoldsVersion();
    }

    /**
     * Toggles the collapsed state of the folding region whose startLine matches the given line.
     * No-op if no region starts at that line.
     */
    public toggleFold(line: number): void {
        for (const region of this.foldedRegions) {
            if (region.startLine === line) {
                region.isCollapsed = !region.isCollapsed;
                this.bumpFoldsVersion();
                this.reconcileHiddenCursors();
                return;
            }
        }
    }

    /**
     * Returns the innermost region covering `line` (header line included) that
     * satisfies `accept`, or `undefined`. "Innermost" = the candidate with the
     * greatest `startLine`.
     */
    private innermostRegionContaining(
        line: number,
        accept: (region: IFoldingRegion) => boolean,
    ): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            const covers = region.startLine <= line && line <= region.endLine && accept(region);
            if (covers && (best === undefined || region.startLine > best.startLine)) {
                best = region;
            }
        }
        return best;
    }

    /**
     * Returns the innermost folding region that spans `line` (header line
     * included), or `undefined` when no region covers it.
     */
    public foldingRegionContaining(line: number): IFoldingRegion | undefined {
        return this.innermostRegionContaining(line, () => true);
    }

    /**
     * Collapses the innermost expanded region covering `line`. Repeated calls
     * fold outward (each pass collapses the next enclosing region). No-op when
     * no expanded region covers the line.
     */
    public foldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => !region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = true;
            this.bumpFoldsVersion();
            this.reconcileHiddenCursors();
        }
    }

    /**
     * Expands the innermost collapsed region covering `line`. No-op when no
     * collapsed region covers the line.
     */
    public unfoldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = false;
            this.bumpFoldsVersion();
        }
    }

    /**
     * Toggles the collapsed state of the innermost region covering `line`.
     * No-op when no region covers the line.
     */
    public toggleFoldContaining(line: number): void {
        const region = this.foldingRegionContaining(line);
        if (region !== undefined) {
            region.isCollapsed = !region.isCollapsed;
            this.bumpFoldsVersion();
            this.reconcileHiddenCursors();
        }
    }

    /**
     * Collapses all folding regions.
     */
    public foldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = true;
        }
        this.bumpFoldsVersion();
        this.reconcileHiddenCursors();
    }

    /**
     * Expands all folding regions.
     */
    public unfoldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = false;
        }
        this.bumpFoldsVersion();
    }

    /**
     * Collapses the innermost region at `line` together with every region nested
     * inside it (VS Code's "Fold Recursively").
     */
    public foldRecursively(line: number): void {
        this.setCollapsedRecursively(line, true);
    }

    /**
     * Expands the innermost region at `line` together with every region nested
     * inside it (VS Code's "Unfold Recursively").
     */
    public unfoldRecursively(line: number): void {
        this.setCollapsedRecursively(line, false);
    }

    private setCollapsedRecursively(line: number, collapsed: boolean): void {
        const root = this.foldingRegionContaining(line);
        if (root === undefined) return;
        for (const region of this.foldedRegions) {
            if (region.startLine >= root.startLine && region.endLine <= root.endLine) {
                region.isCollapsed = collapsed;
            }
        }
        this.bumpFoldsVersion();
        if (collapsed) this.reconcileHiddenCursors();
    }

    /**
     * Folds every region at nesting level ≥ `level` and unfolds the rest, showing
     * the document structure down to that level (VS Code's "Fold Level N").
     */
    public foldLevel(level: number): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = this.regionNestingLevel(region) >= level;
        }
        this.bumpFoldsVersion();
        this.reconcileHiddenCursors();
    }

    /** 1-based nesting depth: 1 for an outermost region, +1 per enclosing region. */
    private regionNestingLevel(region: IFoldingRegion): number {
        let level = 1;
        for (const other of this.foldedRegions) {
            if (other === region) continue;
            if (other.startLine <= region.startLine && region.endLine <= other.endLine) {
                level++;
            }
        }
        return level;
    }

    /**
     * Moves the caret to the header of the next foldable region below `line`,
     * revealing it if hidden. No-op when there is no later region.
     */
    public gotoNextFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine > line && (target === undefined || region.startLine < target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    /**
     * Moves the caret to the header of the previous foldable region above `line`.
     * No-op when there is no earlier region.
     */
    public gotoPreviousFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine < line && (target === undefined || region.startLine > target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    /**
     * The collapsed region hiding `line` with the smallest `startLine` — the
     * outermost one, whose header line is always visible. `undefined` if `line`
     * is not hidden by any collapsed region.
     */
    private outermostCollapsedRegionHiding(line: number): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && region.startLine < line && line <= region.endLine) {
                if (best === undefined || region.startLine < best.startLine) best = region;
            }
        }
        return best;
    }

    /**
     * After a fold operation hides a cursor, moves it onto the header of the
     * region that hides it (VS Code snaps the caret to the fold header rather
     * than stranding it on an invisible line). No-op for cursors still visible.
     */
    private reconcileHiddenCursors(): void {
        const previous = this.selections;
        // Сравниваем ДО присваивания: сеттер сливает выделения, поэтому после него длины
        // могли разойтись и поэлементное сличение по индексу врало бы.
        const mapped = previous.map((sel) => {
            if (this.logicalToVisualLine(sel.active.line) >= 0) return sel;
            const region = this.outermostCollapsedRegionHiding(sel.active.line);
            /* v8 ignore start -- defensive: fold ops only hide valid document lines, which are always inside a collapsed region here */
            if (region === undefined) return sel;
            /* v8 ignore stop */
            const char = Math.min(sel.active.character, this.document.getLineLength(region.startLine));
            return createCursorSelection(region.startLine, char);
        });
        if (!mapped.some((sel, i) => sel !== previous[i])) return;
        this.selections = mapped;
        this.ensureCursorVisible();
    }

    // ─── Scroll API ─────────────────────────────────────────

    public scrollLineUp(): void {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
    }

    public scrollLineDown(): void {
        const maxScrollTop = Math.max(0, this.getViewLineCount() - this.viewportHeight);
        this.scrollTop = Math.min(maxScrollTop, this.scrollTop + 1);
    }

    // ─── View API (projection for renderer) ─────────────────

    /**
     * Returns the number of visible lines (accounting for collapsed regions).
     */
    public getViewLineCount(): number {
        return this.buildVisibleLines().length;
    }

    /**
     * Returns the text content of a visual line.
     * The visualLineNumber is 0-based index into the visible lines array.
     */
    public getViewLine(visualLineNumber: number): string {
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return "";
        }
        return this.document.getLineContent(logicalLine);
    }

    /**
     * Returns tokens for a visual line (from the attached token store, if any).
     * Does NOT trigger lazy tokenization — the renderer must call
     * `tokenStore.tokenizeUpTo(...)` first.
     */
    public getViewLineTokens(visualLineNumber: number): ILineTokens | undefined {
        if (!this.tokenStore) return undefined;
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return undefined;
        }
        return this.tokenStore.getLineTokens(logicalLine);
    }

    // ─── Line Mapping ───────────────────────────────────────

    /**
     * Translates a logical (document) line number to a visual (screen) line number.
     * Returns -1 if the line is hidden inside a collapsed region.
     */
    public logicalToVisualLine(logicalLine: number): number {
        const { firstRowOfDocLine } = this.buildProjection();
        // Гарды по границам: за пределами массива Int32Array отдаёт undefined,
        // а контракт метода — «-1, если строки нет во вью».
        if (logicalLine < 0 || logicalLine >= firstRowOfDocLine.length) return -1;
        return firstRowOfDocLine[logicalLine];
    }

    /**
     * Translates a visual (screen) line number to a logical (document) line number.
     * Returns -1 if the visual line is out of range OR is a view zone row —
     * виртуальной строке документная не соответствует ({@link viewLineKind}
     * различает эти случаи, {@link docLineForViewLine} даёт ближайшую строку).
     */
    public visualToLogicalLine(visualLine: number): number {
        const visible = this.buildVisibleLines();
        if (visualLine < 0 || visualLine >= visible.length) {
            return -1;
        }
        const row = visible[visualLine];
        return row >= 0 ? row : -1;
    }

    /**
     * Диапазон offsets `[start, end)` фрагмента строки, который занимает ряд
     * вью; у последнего (или единственного) фрагмента `end` — длина строки.
     * `{0, 0}` у рядов-зон и за границами вью — у них документного текста нет.
     */
    public viewLineRange(viewLine: number): { start: number; end: number } {
        const { rowDocLine, rowStartOffset } = this.buildProjection();
        const doc = rowDocLine.at(viewLine);
        if (viewLine < 0 || doc === undefined || doc < 0) return { start: 0, end: 0 };
        const start = rowStartOffset[viewLine];
        // Фрагменты одной строки контигуозны (зона встаёт только после
        // последнего — см. insertViewZones), поэтому конец фрагмента — начало
        // следующего ряда той же строки.
        const end = rowDocLine[viewLine + 1] === doc ? rowStartOffset[viewLine + 1] : this.document.getLineLength(doc);
        return { start, end };
    }

    /**
     * Дисплейная колонка начала фрагмента в целой строке — сдвиг «колоночного
     * окна», которым рендер и хит-тест смотрят на фрагмент. 0 у первых
     * фрагментов, целых строк и зон.
     */
    public viewLineStartColumn(viewLine: number): number {
        const { rowDocLine, rowStartOffset } = this.buildProjection();
        // Индексы за границами (и отрицательные) дают undefined, ряды-зоны и
        // целые строки несут 0 — везде колонка начала нулевая.
        const start = rowStartOffset[viewLine];
        if (!start) return 0;
        return this.displayLineFor(this.document.getLineContent(rowDocLine[viewLine])).offsetToColumn(start);
    }

    /**
     * Ряд вью, содержащий позицию документа, либо -1, если строка скрыта
     * свёрткой. Offset ровно на границе фрагментов маппится на СЛЕДУЮЩИЙ ряд
     * (без cursor affinity — упрощение v1, см. docs/TODO/WordWrap.md).
     */
    public viewLineForPosition(line: number, character: number): number {
        // Скрытая строка даёт -1, и цикл его не сдвинет: rowDocLine[0] — видимая
        // строка, скрытой она не равна, так что -1 возвращается как есть.
        let row = this.logicalToVisualLine(line);
        const { rowDocLine, rowStartOffset } = this.buildProjection();
        while (rowDocLine[row + 1] === line && rowStartOffset[row + 1] <= character) {
            row++;
        }
        return row;
    }

    /**
     * Returns the text covered by the primary (first) selection.
     * Returns an empty string when the selection is collapsed (cursor only).
     */
    public getSelectedText(): string {
        const sel = this.selections[0];
        if (isSelectionCollapsed(sel)) {
            return "";
        }
        return this.document.getTextInRange(selectionToRange(sel));
    }

    /**
     * Текст каждого выделения в документном порядке; у схлопнутого — пустая строка.
     * Мультикурсорные Copy/Cut склеивают результат через перевод строки, как VS Code:
     * {@link getSelectedText} видит только первичное выделение, и на нём Cut удалял бы
     * больше, чем скопировал.
     */
    public getSelectedTexts(): string[] {
        return this.selections.map((sel) =>
            isSelectionCollapsed(sel) ? "" : this.document.getTextInRange(selectionToRange(sel)),
        );
    }

    /**
     * Inserts text at every cursor/selection, replacing any selected content.
     * Delegates to type() which already handles selection replacement.
     */
    public insertText(text: string): IUndoElement | undefined {
        return this.type(text);
    }

    /**
     * Types text at every cursor/selection.
     * If a selection is non-collapsed, the selected text is replaced.
     */
    public type(text: string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const edits = this.buildEditsFromSelections(text);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.computeSelectionsAfterEdits(edits);
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Applies an arbitrary batch of edits as a single undoable operation.
     *
     * Unlike {@link type}, the edits are supplied by the caller instead of
     * being derived from the current selections — used by external/programmatic
     * edits (e.g. trim-trailing-whitespace, save participants). Returns an
     * {@link IUndoElement} to push onto the undo stack, or `undefined` when
     * there is nothing to apply.
     */
    public applyEdits(edits: readonly ITextEdit[], label: string): IUndoElement | undefined {
        if (this.readOnly || edits.length === 0) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.computeSelectionsAfterEdits(edits);
        this.ensureCursorVisible();
        return {
            label,
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Inserts a newline at every cursor, carrying over the current line's
     * indentation (and expanding bracket pairs). See {@link computeNewLinePlan}.
     */
    public insertNewLine(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();
        const plans = sorted.map((sel) => {
            const range = selectionToRange(sel);
            return computeNewLinePlan({
                lineContent: this.document.getLineContent(range.start.line),
                column: range.start.character,
                tabSize: this.tabSize,
                insertSpaces: this.insertSpaces,
            });
        });
        const edits = sorted.map((sel, i) => createTextEdit(selectionToRange(sel), plans[i].editText));
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // computeSelectionsAfterEdits lands the cursor at the end of the inserted
        // text. For a block expansion the closer occupies the last inserted line,
        // so move that cursor up one line onto the empty middle line.
        this.selections = this.computeSelectionsAfterEdits(edits).map((sel, i) =>
            plans[i].blockExpand ? createCursorSelection(sel.active.line - 1, plans[i].cursorColumn) : sel,
        );
        this.ensureCursorVisible();
        return {
            label: "type",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Deletes one character to the left of each cursor, or deletes the selection.
     */
    public deleteLeft(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                // Collapsed: expand one grapheme left
                const pos = sel.active;
                if (pos.character > 0) {
                    const lineContent = this.document.getLineContent(pos.line);
                    const dl = this.displayLineFor(lineContent);
                    let prevOffset: number;
                    if (pos.character >= lineContent.length) {
                        /* v8 ignore start -- the `: 0` arm is unreachable: this branch needs pos.character > 0 AND >= line length, so the line is non-empty and always has slots */
                        prevOffset = dl.slots.length > 0 ? dl.slots[dl.slots.length - 1].offset : 0;
                        /* v8 ignore stop */
                    } else {
                        const slotIndex = dl.slotIndexAtOffset(pos.character);
                        prevOffset = slotIndex > 0 ? dl.slots[slotIndex - 1].offset : 0;
                    }
                    edits.push(createTextEdit(createRange(pos.line, prevOffset, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteLeft",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    // ─── Cursor Navigation ───────────────────────────────────

    /**
     * Moves each cursor one character to the left.
     * At the start of a line, wraps to the end of the previous visible line.
     * Updates idealColumn to the new activeColumn.
     */
    public cursorLeft(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            let newLine = pos.line;
            let newChar: number;

            if (pos.character > 0) {
                const lineContent = this.document.getLineContent(pos.line);
                const dl = this.displayLineFor(lineContent);
                if (pos.character >= lineContent.length) {
                    /* v8 ignore start -- the `: 0` arm is unreachable: this branch needs pos.character > 0 AND >= line length, so the line is non-empty and always has slots */
                    newChar = dl.slots.length > 0 ? dl.slots[dl.slots.length - 1].offset : 0;
                    /* v8 ignore stop */
                } else {
                    const slotIndex = dl.slotIndexAtOffset(pos.character);
                    newChar = slotIndex > 0 ? dl.slots[slotIndex - 1].offset : 0;
                }
            } else if (pos.line > 0) {
                const prevVisible = this.previousVisibleLine(pos.line);
                /* v8 ignore start -- the else is unreachable: line 0 is always visible, so previousVisibleLine never returns -1 for a line>0 cursor */
                if (prevVisible >= 0) {
                    newLine = prevVisible;
                    newChar = this.document.getLineLength(prevVisible);
                } else {
                    return sel;
                }
                /* v8 ignore stop */
            } else {
                return sel;
            }

            const targetDl = this.displayLineFor(this.document.getLineContent(newLine));
            return this.buildSelection(sel, newLine, newChar, targetDl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one character to the right.
     * At the end of a line, wraps to the start of the next visible line.
     * Updates idealColumn to the new activeColumn.
     */
    public cursorRight(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const lineLen = this.document.getLineLength(pos.line);
            let newLine = pos.line;
            let newChar: number;

            if (pos.character < lineLen) {
                const lineContent = this.document.getLineContent(pos.line);
                const dl = this.displayLineFor(lineContent);
                const slotIndex = dl.slotIndexAtOffset(pos.character);
                if (slotIndex >= 0 && slotIndex < dl.slots.length - 1) {
                    newChar = dl.slots[slotIndex + 1].offset;
                } else {
                    newChar = lineLen;
                }
            } else {
                const nextVisible = this.nextVisibleLine(pos.line);
                if (nextVisible >= 0) {
                    newLine = nextVisible;
                    newChar = 0;
                } else {
                    return sel;
                }
            }

            const targetDl = this.displayLineFor(this.document.getLineContent(newLine));
            return this.buildSelection(sel, newLine, newChar, targetDl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one visual line up.
     * Skips over collapsed folding regions.
     * Does NOT change idealColumn — vertical navigation preserves it.
     */
    public cursorUp(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => this.moveVertically(sel, -1, inSelectionMode));
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one visual line down.
     * Skips over collapsed folding regions.
     * Does NOT change idealColumn — vertical navigation preserves it.
     */
    public cursorDown(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => this.moveVertically(sel, 1, inSelectionMode));
        this.ensureCursorVisible();
    }

    /** Выделение после шага каретки на соседний ряд вью; у края вью — исходное. */
    private moveVertically(sel: ISelection, direction: 1 | -1, inSelectionMode: boolean): ISelection {
        const step = this.stepPositionVertically(sel.active, this.idealColumnOf(sel), direction);
        if (step === null) return sel;
        return this.buildSelection(sel, step.line, step.character, step.idealColumn, inSelectionMode);
    }

    /**
     * Шаг позиции на соседний документный ряд вью (ряды-зоны проскакиваются),
     * либо `null` — некуда: край вью. Вертикальное движение при wrap ходит по
     * РЯДАМ, а не строкам: внутри перенесённой строки каретка идёт по
     * фрагментам. «Липкая» колонка держится ОТНОСИТЕЛЬНО НАЧАЛА фрагмента
     * (`idealAbs − startCol` текущего ряда), а возвращённый `idealColumn` —
     * снова абсолютный, спроецированный на целевой ряд: следующий шаг вычтет
     * его стартовую колонку и получит ту же относительную. Без wrap все
     * стартовые колонки — нули, и математика тождественна прежней построчной.
     */
    private stepPositionVertically(
        pos: IPosition,
        idealAbs: number,
        direction: 1 | -1,
    ): { line: number; character: number; idealColumn: number } | null {
        const currentRow = this.viewLineForPosition(pos.line, pos.character);
        if (currentRow < 0) {
            // Каретка на скрытой строке (до reconcileHiddenCursors): прежняя
            // построчная посадка на ближайшую видимую строку.
            const fallbackLine =
                direction === -1 ? this.previousVisibleLine(pos.line) : this.nextVisibleLine(pos.line);
            if (fallbackLine < 0) return null;
            const dl = this.displayLineFor(this.document.getLineContent(fallbackLine));
            return { line: fallbackLine, character: dl.columnToOffset(idealAbs), idealColumn: idealAbs };
        }

        const { rowDocLine } = this.buildProjection();
        let targetRow = currentRow + direction;
        // Ряды-зоны (< 0) проскакиваются; индекс за краем вью даёт undefined —
        // он сам останавливает скан (не < 0) и он же — признак «некуда».
        while (rowDocLine[targetRow] < 0) {
            targetRow += direction;
        }
        if (rowDocLine[targetRow] === undefined) return null;

        const idealInRow = Math.max(0, idealAbs - this.viewLineStartColumn(currentRow));
        return this.landOnRow(targetRow, idealInRow);
    }

    /**
     * Посадка каретки на документный ряд по ideal-колонке ВНУТРИ ряда: у
     * не-последнего фрагмента каретка не переезжает границу (offset на границе
     * принадлежит уже следующему ряду) — кламп к последней графеме фрагмента.
     */
    private landOnRow(
        targetRow: number,
        idealInRow: number,
    ): { line: number; character: number; idealColumn: number } {
        const targetLine = this.buildProjection().rowDocLine[targetRow];
        const targetStartCol = this.viewLineStartColumn(targetRow);
        const targetDl = this.displayLineFor(this.document.getLineContent(targetLine));
        const range = this.viewLineRange(targetRow);
        const isLastFragment = range.end === this.document.getLineLength(targetLine);
        let landingCol = targetStartCol + idealInRow;
        if (!isLastFragment) {
            landingCol = Math.min(landingCol, targetDl.offsetToColumn(range.end) - 1);
        }
        return {
            line: targetLine,
            character: targetDl.columnToOffset(landingCol),
            idealColumn: targetStartCol + idealInRow,
        };
    }

    /**
     * Moves each cursor to the very beginning of the document (line 0, char 0).
     */
    public cursorTop(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, 0, 0, 0, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the very end of the document (last line, last char).
     */
    public cursorBottom(inSelectionMode = false): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        const dl = this.displayLineFor(this.document.getLineContent(lastLine));
        const idealCol = dl.offsetToColumn(lastChar);
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, lastLine, lastChar, idealCol, inSelectionMode);
        });
        this.reconcileHiddenCursors();
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the "smart home" position of its line, VS Code style:
     * first press lands on the first non-whitespace character (after the indent),
     * a second press (when already there) collapses to column 0, toggling between
     * the two. Lines with no indentation always go to column 0.
     * idealColumn tracks the display column of the target so Up/Down stays aligned
     * even with tabs.
     */
    public cursorHome(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const content = this.document.getLineContent(sel.active.line);
            // На ряду-продолжении wrap Home идёт к началу ФРАГМЕНТА (как VS
            // Code); повторное нажатие там же — no-op, логического smart-home с
            // продолжения нет (упрощение v1, см. docs/TODO/WordWrap.md).
            const row = this.viewLineForPosition(sel.active.line, sel.active.character);
            const rowStart = this.viewLineRange(row).start;
            if (rowStart > 0) {
                const idealCol = this.viewLineStartColumn(row);
                return this.buildSelection(sel, sel.active.line, rowStart, idealCol, inSelectionMode);
            }
            const firstNonWs = firstNonWhitespaceIndex(content);
            const target = sel.active.character === firstNonWs && firstNonWs !== 0 ? 0 : firstNonWs;
            const idealCol = this.displayLineFor(content).offsetToColumn(target);
            return this.buildSelection(sel, sel.active.line, target, idealCol, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor to the end of its line.
     * Sets idealColumn to MAX_SAFE_INTEGER so subsequent Up/Down "stick" to the right edge.
     */
    public cursorEnd(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const lineLen = this.document.getLineLength(sel.active.line);
            // На не-последнем фрагменте wrap End идёт к последней графеме
            // ФРАГМЕНТА: offset границы принадлежит следующему ряду (без
            // cursor affinity — упрощение v1, см. docs/TODO/WordWrap.md).
            const rowEnd = this.viewLineRange(this.viewLineForPosition(sel.active.line, sel.active.character)).end;
            if (rowEnd !== lineLen) {
                const dl = this.displayLineFor(this.document.getLineContent(sel.active.line));
                const target = dl.columnToOffset(dl.offsetToColumn(rowEnd) - 1);
                return this.buildSelection(sel, sel.active.line, target, Number.MAX_SAFE_INTEGER, inSelectionMode);
            }
            return this.buildSelection(sel, sel.active.line, lineLen, Number.MAX_SAFE_INTEGER, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one word to the left.
     * At the start of a line, wraps to the end of the previous visible line.
     */
    public cursorWordLeft(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            if (pos.character === 0) {
                const prevLine = this.previousVisibleLine(pos.line);
                if (prevLine >= 0) {
                    const lineLen = this.document.getLineLength(prevLine);
                    const dl = this.displayLineFor(this.document.getLineContent(prevLine));
                    return this.buildSelection(sel, prevLine, lineLen, dl.offsetToColumn(lineLen), inSelectionMode);
                }
                return sel;
            }
            const line = this.document.getLineContent(pos.line);
            const newChar = findWordBoundaryLeft(line, pos.character);
            const dl = this.displayLineFor(line);
            return this.buildSelection(sel, pos.line, newChar, dl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Moves each cursor one word to the right.
     * At the end of a line, wraps to the start of the next visible line.
     */
    public cursorWordRight(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const lineLen = this.document.getLineLength(pos.line);
            if (pos.character >= lineLen) {
                const nextLine = this.nextVisibleLine(pos.line);
                if (nextLine >= 0) {
                    return this.buildSelection(sel, nextLine, 0, 0, inSelectionMode);
                }
                return sel;
            }
            const line = this.document.getLineContent(pos.line);
            const newChar = findWordBoundaryRight(line, pos.character);
            const dl = this.displayLineFor(line);
            return this.buildSelection(sel, pos.line, newChar, dl.offsetToColumn(newChar), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Selects the entire document content.
     */
    public selectAll(): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        this.selections = [createSelection(0, 0, lastLine, lastChar)];
    }

    // ─── Multi-cursor ────────────────────────────────────────

    /**
     * Adds a caret one visible line above every current selection (VS Code
     * `editor.action.insertCursorAbove`).
     */
    public insertCursorAbove(): void {
        this.insertCursorVertically(-1);
    }

    /**
     * Adds a caret one visible line below every current selection (VS Code
     * `editor.action.insertCursorBelow`).
     */
    public insertCursorBelow(): void {
        this.insertCursorVertically(1);
    }

    /**
     * Collapses the multi-cursor back to a single caret (VS Code
     * `removeSecondaryCursors`, Escape). The survivor is the primary selection —
     * the topmost one, за которой стоит аппаратный курсор терминала.
     */
    public removeSecondaryCursors(): void {
        // Холостое присваивание разбудило бы статус-бар, историю и ext-host впустую.
        if (this.selections.length <= 1) return;
        this.selections = [this.selections[0]];
        this.ensureCursorVisible();
    }

    /**
     * Alt-клик: ставит каретку в точку или снимает ту, что уже её накрывает (VS Code
     * ведёт себя так же — повторный alt-клик убирает лишний курсор). Последнюю каретку
     * не снимаем: редактор без курсора не бывает.
     */
    public toggleCursorAt(line: number, character: number): void {
        const position = createPosition(line, character);
        const covering = this.selections.findIndex((sel) =>
            rangeContainsPosition(selectionToRange(sel), position),
        );
        if (covering >= 0) {
            if (this.selections.length === 1) return;
            this.selections = this.selections.filter((_, i) => i !== covering);
            return;
        }
        const added = createCursorSelection(line, character);
        this.selections = [...this.selections, added];
        this.revealSelection(added);
    }

    /**
     * Ядро {@link insertCursorAbove}/{@link insertCursorBelow}: дублирует каждое выделение
     * на соседнюю ВИДИМУЮ строку (свёрнутое тело и ряды-зон проскакиваются
     * `previousVisibleLine`/`nextVisibleLine`, поэтому каретка на скрытой строке не
     * возникает by construction).
     *
     * Повторное нажатие наращивает пачку в ту же сторону даром: копии внутренних кареток
     * совпадают с уже существующими и схлопываются слиянием в сеттере — ровно как
     * `CursorMoveCommands.addCursorUp` в VS Code полагается на `normalize()`.
     */
    private insertCursorVertically(direction: 1 | -1): void {
        const added: ISelection[] = [];
        for (const sel of this.selections) {
            const translated = this.translateSelectionToAdjacentLine(sel, direction);
            if (translated !== null) added.push(translated);
        }
        // Пачка упёрлась в край вью — ни одной новой каретки, и события быть не должно.
        if (added.length === 0) return;

        this.selections = [...this.selections, ...added];
        // Показываем крайнюю каретку в сторону движения: она и есть «новая» для глаза.
        this.revealSelection(direction === -1 ? this.selections[0] : this.selections[this.selections.length - 1]);
    }

    /**
     * Копия выделения, сдвинутая на соседнюю видимую строку; `null`, если сдвинуть некуда.
     * `active` кладётся по `idealColumn` (как {@link cursorUp}), `anchor` — по своей
     * дисплейной колонке, поэтому непустое выделение переезжает целиком и не перекашивается
     * на строках с табами.
     */
    private translateSelectionToAdjacentLine(selection: ISelection, direction: 1 | -1): ISelection | null {
        const idealColumn = this.idealColumnOf(selection);
        const activeStep = this.stepPositionVertically(selection.active, idealColumn, direction);
        if (activeStep === null) return null;

        if (isSelectionCollapsed(selection)) {
            return createCursorSelection(activeStep.line, activeStep.character, activeStep.idealColumn);
        }

        const anchorContent = this.document.getLineContent(selection.anchor.line);
        const anchorColumn = this.displayLineFor(anchorContent).offsetToColumn(selection.anchor.character);
        const anchorStep = this.stepPositionVertically(selection.anchor, anchorColumn, direction);
        // Якорь упёрся в край вью, а active — нет: значит якорь дальше active по ходу
        // движения, и копия целиком легла бы внутрь исходного выделения (слияние съело бы
        // её без следа). Не плодим её вовсе — иначе на ровном месте вылетало бы холостое
        // событие смены курсора.
        if (anchorStep === null) return null;

        return createSelection(
            anchorStep.line,
            anchorStep.character,
            activeStep.line,
            activeStep.character,
            activeStep.idealColumn,
        );
    }

    /**
     * Дисплейная колонка, к которой «липнет» вертикальное движение выделения: явный
     * `idealColumn`, а без него — реальная колонка каретки (у `getIdealColumn` fallback
     * посимвольный, а нам нужна колонка с учётом табов и широких символов).
     */
    private idealColumnOf(selection: ISelection): number {
        if (selection.idealColumn !== undefined) return selection.idealColumn;
        const content = this.document.getLineContent(selection.active.line);
        return this.displayLineFor(content).offsetToColumn(selection.active.character);
    }

    /**
     * Moves each cursor one page (viewportHeight lines) down.
     * Preserves idealColumn for vertical navigation.
     */
    public cursorPageDown(inSelectionMode = false): void {
        this.cursorPage(1, inSelectionMode);
    }

    /**
     * Moves each cursor one page (viewportHeight lines) up.
     * Preserves idealColumn for vertical navigation.
     */
    public cursorPageUp(inSelectionMode = false): void {
        this.cursorPage(-1, inSelectionMode);
    }

    /**
     * Страница считается в СТРОКАХ ВЬЮ, а не в видимых документных: зоны тоже
     * занимают экран, и шаг «по документным» уводил бы каретку на страницу
     * дальше видимого. Целевая строка вью может оказаться зоной — берётся
     * ближайшая документная ({@link docLineForViewLine}). Без зон поведение
     * тождественно прежнему пошаговому обходу видимых строк.
     */
    private cursorPage(direction: 1 | -1, inSelectionMode: boolean): void {
        const pageSize = Math.max(1, this.viewportHeight - 1);
        this.selections = this.selections.map((sel) => {
            const pos = sel.active;
            const idealAbs = this.idealColumnOf(sel);
            const currentView = this.viewLineForPosition(pos.line, pos.character);
            /* v8 ignore start -- defensive: скрытая каретка выправляется reconcileHiddenCursors до команд */
            if (currentView < 0) return sel;
            /* v8 ignore stop */
            const targetView = Math.min(Math.max(0, currentView + direction * pageSize), this.getViewLineCount() - 1);
            // Целевой ряд может быть зоной — берём ближайший документный (та же
            // политика, что docLineForViewLine: сначала выше, потом ниже).
            // Индекс за краем даёт undefined — скан останавливается сам.
            const { rowDocLine } = this.buildProjection();
            let targetRow = targetView;
            while (rowDocLine[targetRow] < 0) targetRow--;
            if (rowDocLine[targetRow] === undefined) {
                targetRow = targetView;
                while (rowDocLine[targetRow] < 0) targetRow++;
            }
            const idealInRow = Math.max(0, idealAbs - this.viewLineStartColumn(currentView));
            const landing = this.landOnRow(targetRow, idealInRow);
            return this.buildSelection(sel, landing.line, landing.character, landing.idealColumn, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /**
     * Deletes one character to the right of each cursor, or deletes the selection.
     */
    public deleteRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                // Collapsed: expand one grapheme right
                const pos = sel.active;
                const lineLen = this.document.getLineLength(pos.line);
                if (pos.character < lineLen) {
                    const lineContent = this.document.getLineContent(pos.line);
                    const dl = this.displayLineFor(lineContent);
                    const slotIndex = dl.slotIndexAtOffset(pos.character);
                    let nextEnd: number;
                    /* v8 ignore start -- the else is unreachable: Segmenter slots contiguously cover the line, so every in-range offset maps to a slot */
                    if (slotIndex >= 0) {
                        const slot = dl.slots[slotIndex];
                        nextEnd = slot.offset + slot.length;
                    } else {
                        nextEnd = Math.min(pos.character + 1, lineLen);
                    }
                    /* v8 ignore stop */
                    edits.push(createTextEdit(createRange(pos.line, pos.character, pos.line, nextEnd), ""));
                } else if (pos.line < this.document.lineCount - 1) {
                    edits.push(createTextEdit(createRange(pos.line, lineLen, pos.line + 1, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    /**
     * Deletes one word to the left of each cursor, or deletes the selection.
     */
    public deleteWordLeft(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                if (pos.character > 0) {
                    const line = this.document.getLineContent(pos.line);
                    const wordStart = findWordBoundaryLeft(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, wordStart, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteWordLeft",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    /**
     * Deletes one word to the right of each cursor, or deletes the selection.
     */
    public deleteWordRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                const lineLen = this.document.getLineLength(pos.line);
                if (pos.character < lineLen) {
                    const line = this.document.getLineContent(pos.line);
                    const wordEnd = findWordBoundaryRight(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, pos.character, pos.line, wordEnd), ""));
                } else if (pos.line < this.document.lineCount - 1) {
                    edits.push(createTextEdit(createRange(pos.line, lineLen, pos.line + 1, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        if (edits.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
            this.adjustFoldingRegionsForEdits(edits);
            this.selections = this.computeSelectionsAfterEdits(edits);
            this.ensureCursorVisible();
            return {
                label: "deleteWordRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: edits,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    // ─── Indentation ────────────────────────────────────────

    /**
     * Increases the indentation of the current selections (Tab).
     *
     * With a collapsed cursor or a single-line selection this inserts one
     * indent unit at the cursor (replacing the selection) — identical to typing.
     * With a selection spanning multiple lines it prepends one indent unit to
     * every touched line and keeps the selection covering them.
     */
    public indentLines(): IUndoElement | undefined {
        const spansMultipleLines = this.selections.some((sel) => {
            const range = selectionToRange(sel);
            return range.start.line !== range.end.line;
        });
        if (!spansMultipleLines) {
            return this.type(this.indentUnit());
        }
        return this.shiftIndent(1);
    }

    /**
     * Decreases the indentation of every line touched by a selection (Shift+Tab),
     * removing up to one indent level of leading whitespace from each. Operates
     * on the cursor's line when the selection is collapsed. Returns `undefined`
     * when no line has leading whitespace to remove.
     */
    public outdentLines(): IUndoElement | undefined {
        return this.shiftIndent(-1);
    }

    private indentUnit(): string {
        return this.insertSpaces ? " ".repeat(this.tabSize) : "\t";
    }

    /**
     * Shifts the leading indentation of the touched lines one level in the given
     * direction (+1 indent, −1 outdent), applying the edits as a single undoable
     * operation and remapping the selections to follow the shifted text.
     */
    private shiftIndent(direction: 1 | -1): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const unit = this.indentUnit();
        const perLine = new Map<number, number>();
        const edits: ITextEdit[] = [];
        for (const line of this.collectTouchedLines()) {
            if (direction === 1) {
                edits.push(createTextEdit(createRange(line, 0, line, 0), unit));
                perLine.set(line, unit.length);
            } else {
                const removed = computeOutdentRemoval(this.document.getLineContent(line), this.tabSize);
                if (removed > 0) {
                    edits.push(createTextEdit(createRange(line, 0, line, removed), ""));
                    perLine.set(line, -removed);
                }
            }
        }

        if (edits.length === 0) return undefined;

        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selections.map((sel) => this.remapSelectionForIndent(sel, perLine));
        this.ensureCursorVisible();
        return {
            label: direction === 1 ? "indent" : "outdent",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Collects the logical lines touched by any selection, in ascending order.
     * A selection whose end sits at column 0 of a later line does not pull that
     * trailing line in (matches VS Code — the empty tail is excluded).
     */
    private collectTouchedLines(): number[] {
        const lines = new Set<number>();
        for (const sel of this.selections) {
            const range = selectionToRange(sel);
            let endLine = range.end.line;
            if (endLine > range.start.line && range.end.character === 0) {
                endLine--;
            }
            for (let line = range.start.line; line <= endLine; line++) {
                lines.add(line);
            }
        }
        return [...lines].sort((a, b) => a - b);
    }

    /**
     * Remaps a selection after an indent/outdent, shifting each endpoint on an
     * edited line by that line's delta. Line-start endpoints stay anchored at
     * column 0 on indent; on outdent an endpoint inside the removed run clamps
     * to the new line start.
     */
    private remapSelectionForIndent(sel: ISelection, perLine: Map<number, number>): ISelection {
        const remap = (pos: IPosition): IPosition => {
            const delta = perLine.get(pos.line);
            if (delta === undefined) return pos;
            if (delta > 0) {
                return { line: pos.line, character: pos.character === 0 ? 0 : pos.character + delta };
            }
            return { line: pos.line, character: Math.max(0, pos.character + delta) };
        };
        const anchor = remap(sel.anchor);
        const active = remap(sel.active);
        return createSelection(anchor.line, anchor.character, active.line, active.character);
    }

    // ─── Auto-expand ────────────────────────────────────────

    /**
     * Ensures a logical line is visible by expanding any collapsed region that hides it.
     * A line is hidden if it falls in the range (startLine+1 .. endLine) of a collapsed region.
     */
    public ensureLineVisible(logicalLine: number): void {
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && logicalLine > region.startLine && logicalLine <= region.endLine) {
                region.isCollapsed = false;
                this.bumpFoldsVersion();
            }
        }
    }

    /**
     * Scrolls the viewport so that `range` is brought into view, first expanding
     * any collapsed fold that hides its start line.
     */
    public revealRange(range: IRange): void {
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(range.start);
    }

    /**
     * Прокручивает вьюпорт к КОНКРЕТНОМУ выделению, разворачивая свёртку, которая прячет
     * его края. Нужен командам, которые добавляют выделение: {@link ensureCursorVisible}
     * смотрит на `selections[0]`, а после нормализации новое выделение может оказаться где
     * угодно в массиве — показать надо именно его.
     */
    public revealSelection(selection: ISelection): void {
        const range = selectionToRange(selection);
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(selection.active);
    }

    /**
     * Ensures the primary cursor is visible: expands any collapsed region hiding
     * its line, then scrolls it into view. Used after a folding recompute that
     * may have re-collapsed a region around the just-edited line, so the caret
     * (and the text under it) stays visible — VS Code keeps the edited line shown.
     */
    public ensurePrimaryCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    /** Number of logical lines in the underlying document. */
    public get lineCount(): number {
        return this.document.lineCount;
    }

    /** 0-based line of the primary cursor (0 when there is no selection). */
    public get primaryCursorLine(): number {
        return this.selections[0]?.active.line ?? 0;
    }

    /** 0-based character offset of the primary cursor (0 when there is no selection). */
    public get primaryCursorColumn(): number {
        return this.selections[0]?.active.character ?? 0;
    }

    /**
     * Moves the primary cursor to (`line`, `character`) — both 0-based — clamping
     * to document/line bounds, collapsing any selection, and revealing the target
     * (expanding a fold that hides it). Used by Go-to-Line navigation.
     */
    public goToPosition(line: number, character = 0): void {
        const clampedLine = Math.max(0, Math.min(line, this.document.lineCount - 1));
        const clampedChar = Math.max(0, Math.min(character, this.document.getLineLength(clampedLine)));
        this.selections = [createCursorSelection(clampedLine, clampedChar)];
        this.ensureLineVisible(clampedLine);
        this.revealPosition(this.selections[0].active);
    }

    /**
     * Restores selections from a saved snapshot (used by UndoManager).
     */
    public restoreSelections(selections: readonly ISelection[]): void {
        this.selections = [...selections];
        // Undo/redo may restore the caret into a region that is still collapsed;
        // reveal it (like goToPosition) rather than leaving it on a hidden line.
        if (this.selections.length > 0) this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    // ─── Private ────────────────────────────────────────────

    private ensureCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.revealPosition(this.selections[0].active);
    }

    /** Scrolls the viewport (vertically + horizontally) to bring `pos` into view. */
    private revealPosition(pos: IPosition): void {
        if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

        // При wrap показываем РЯД позиции, а не первый фрагмент строки — иначе
        // каретка на хвосте длинной строки оставалась бы за нижним краем.
        const visualLine = this.viewLineForPosition(pos.line, pos.character);
        /* v8 ignore start -- callers (goToPosition/revealRange/restoreSelections) expand folds before revealing, so a hidden line never reaches here */
        if (visualLine < 0) return;
        /* v8 ignore stop */

        // Keep `margin` lines between the cursor and the top/bottom edge so the
        // cursor "steps back" from the edge (VS Code's `cursorSurroundingLines`).
        // Cap the margin at half the viewport, otherwise the two edges collide
        // and the cursor could be pushed out of view.
        const maxMargin = Math.floor((this.viewportHeight - 1) / 2);
        const margin = Math.max(0, Math.min(this.cursorSurroundingLines, maxMargin));

        if (visualLine < this.scrollTop + margin) {
            this.scrollTop = Math.max(0, visualLine - margin);
        } else if (visualLine > this.scrollTop + this.viewportHeight - 1 - margin) {
            this.scrollTop = visualLine - this.viewportHeight + 1 + margin;
        }

        // Горизонтальную часть при wrap отдельно не гейтим: инвариант
        // «wrap ⇒ scrollLeft ≡ 0» держит сеттер scrollLeft, и записи ниже
        // вырождаются в no-op сами.
        const lineContent = this.document.getLineContent(pos.line);
        const dl = this.displayLineFor(lineContent);
        const col = dl.offsetToColumn(pos.character);
        // On a truncated line the cursor clamps to the cut column; the "[…]"
        // badge sits just past it. Reveal up to the badge's last cell so
        // reaching the line end (End / scroll) shows the whole badge, not a
        // sliver clipped at the right edge.
        const revealCol = dl.isTruncated && col >= dl.displayWidth ? col + LONG_LINE_TRUNCATION_BADGE_WIDTH - 1 : col;
        if (col < this.scrollLeft) {
            this.scrollLeft = col;
        } else if (revealCol >= this.scrollLeft + this.viewportWidth) {
            this.scrollLeft = revealCol - this.viewportWidth + 1;
        }
    }

    /**
     * Ряды проекции без offset'ов — короткая рука для потребителей, которым
     * нужны только документные номера рядов (см. {@link IViewProjection.rowDocLine}).
     */
    private buildVisibleLines(): number[] {
        return this.buildProjection().rowDocLine;
    }

    /**
     * Строит проекцию документа на ряды вью: видимые (не скрытые свёрткой)
     * строки плюс виртуальные ряды зон. A line is hidden if it falls in range
     * (startLine+1 .. endLine) of a collapsed region.
     */
    private buildProjection(): IViewProjection {
        const wrapWidth = this.effectiveWrapWidth() ?? -1;
        if (
            // Stryker disable next-line ConditionalExpression: null-гейт — чистая мемоизация; сентинелы версий не совпадают с реальными, так что мутант всё равно уходит в rebuild
            this.projectionCache !== null &&
            this.projectionCacheDocVersion === this.document.versionId &&
            this.projectionCacheFoldsVersion === this.foldsVersion &&
            this.projectionCacheZonesVersion === this.zonesVersion &&
            this.projectionCacheWrapWidth === wrapWidth &&
            this.projectionCacheTabSize === this.tabSize
        ) {
            return this.projectionCache;
        }

        // Collect all hidden line ranges from collapsed regions
        const hiddenRanges: { from: number; to: number }[] = [];
        for (const region of this.foldedRegions) {
            if (region.isCollapsed) {
                hiddenRanges.push({ from: region.startLine + 1, to: region.endLine });
            }
        }

        // Sort by start line for efficient processing
        hiddenRanges.sort((a, b) => a.from - b.from);

        const visible: number[] = [];
        const startOffsets: number[] = [];
        const breaksCache = wrapWidth >= 0 ? this.wrapBreaks(wrapWidth) : null;
        const hiddenIdx = 0;

        for (let line = 0; line < this.document.lineCount; line++) {
            let isHidden = false;
            // Check against all hidden ranges
            for (let h = hiddenIdx; h < hiddenRanges.length; h++) {
                const range = hiddenRanges[h];
                if (line < range.from) {
                    break; // past all relevant ranges
                }
                if (line >= range.from && line <= range.to) {
                    isHidden = true;
                    break;
                }
            }
            if (!isHidden) {
                visible.push(line);
                startOffsets.push(0);
                // При wrap строка разворачивается в ряд на фрагмент: тот же
                // docLine, offset начала фрагмента из кеша breaks.
                const breaks = breaksCache?.getBreaks(line);
                if (breaks != null) {
                    for (const breakOffset of breaks) {
                        visible.push(line);
                        startOffsets.push(breakOffset);
                    }
                }
            }
        }

        const { rowDocLine, rowStartOffset } =
            // Stryker disable next-line ConditionalExpression: fast path — insertViewZones с пустым списком зон возвращает те же массивы
            this.viewZonesValue.length === 0
                ? { rowDocLine: visible, rowStartOffset: startOffsets }
                : insertViewZones(visible, startOffsets, this.viewZonesValue);

        // Стартовые строки зон — тем же проходом, что и проекция (якоря после
        // нормализации уникальны, первая встреченная строка зоны — её начало).
        let zoneStarts: Map<number, number> | null = null;
        if (this.viewZonesValue.length > 0) {
            zoneStarts = new Map();
            // Мутанты отсева неубиваемы: «якорь» от документного ряда (decode
            // положительного числа) уходит в чужое пространство ключей (<= -3
            // против реальных >= -1) и никогда не читается.
            // Stryker disable EqualityOperator,ConditionalExpression: см. выше
            for (let i = 0; i < rowDocLine.length; i++) {
                if (rowDocLine[i] < 0) {
                    const anchor = decodeViewZoneAnchor(rowDocLine[i]);
                    if (!zoneStarts.has(anchor)) zoneStarts.set(anchor, i);
                }
            }
            // Stryker restore EqualityOperator,ConditionalExpression
        }
        this.zoneStartRowsCache = zoneStarts;

        const firstRowOfDocLine = new Int32Array(this.document.lineCount).fill(-1);
        // Stryker disable next-line EqualityOperator: лишняя итерация читает undefined и отсеивается сравнением с -1
        for (let i = 0; i < rowDocLine.length; i++) {
            const doc = rowDocLine[i];
            // Отрицательные коды зон отсеиваются сами: чтение Int32Array по
            // отрицательному индексу даёт undefined, а не -1.
            if (firstRowOfDocLine[doc] === -1) firstRowOfDocLine[doc] = i;
        }

        this.projectionCache = { rowDocLine, rowStartOffset, firstRowOfDocLine };
        this.projectionCacheDocVersion = this.document.versionId;
        this.projectionCacheFoldsVersion = this.foldsVersion;
        this.projectionCacheZonesVersion = this.zonesVersion;
        this.projectionCacheWrapWidth = wrapWidth;
        this.projectionCacheTabSize = this.tabSize;
        return this.projectionCache;
    }

    /**
     * Returns the previous visible logical line before the given logical line, or -1.
     */
    private previousVisibleLine(logicalLine: number): number {
        const { rowDocLine: visible, firstRowOfDocLine } = this.buildProjection();
        const currentIdx = firstRowOfDocLine[logicalLine];
        if (currentIdx > 0) {
            // Соседний ряд может быть зоной (< 0) — каретка её проскакивает.
            for (let i = currentIdx - 1; i >= 0; i--) {
                if (visible[i] >= 0) return visible[i];
            }
            return -1;
        }
        // If current line is not in visible list (hidden), find the last visible line before it
        if (currentIdx === -1) {
            for (let i = visible.length - 1; i >= 0; i--) {
                if (visible[i] >= 0 && visible[i] < logicalLine) {
                    return visible[i];
                }
            }
        }
        return -1;
    }

    /**
     * Returns the next visible logical line after the given logical line, or -1.
     */
    private nextVisibleLine(logicalLine: number): number {
        const { rowDocLine: visible, firstRowOfDocLine } = this.buildProjection();
        const currentIdx = firstRowOfDocLine[logicalLine];
        if (currentIdx >= 0) {
            // Документные ряды идут по возрастанию строк: первый ряд со строкой
            // БОЛЬШЕ текущей — следующая видимая. Одно сравнение отсеивает и
            // зоны (их коды отрицательны), и wrap-фрагменты той же строки.
            for (let i = currentIdx + 1; i < visible.length; i++) {
                if (visible[i] > logicalLine) return visible[i];
            }
            return -1;
        }
        // If current line is not in visible list (hidden), find the first visible line after it
        for (const vLine of visible) {
            if (vLine >= 0 && vLine > logicalLine) {
                return vLine;
            }
        }
        return -1;
    }

    /**
     * Adjusts folding region boundaries after document edits.
     * Processes edits in reverse document order to avoid cascading adjustments.
     * Public because {@link UndoManager} applies edits straight to the document
     * (bypassing {@link applyEdits}) and must shift regions the same way, so the
     * subsequent recompute re-keys collapsed state by the correct `startLine`.
     */
    public adjustFoldingRegionsForEdits(edits: readonly ITextEdit[]): void {
        // Sort edits in reverse document order (bottom-to-top)
        const sorted = [...edits].sort((a, b) => comparePositions(b.range.start, a.range.start));

        for (const edit of sorted) {
            const editStartLine = edit.range.start.line;
            const editEndLine = edit.range.end.line;
            const insertedLineCount = edit.text.split("\n").length;
            const deletedLineCount = editEndLine - editStartLine;
            const lineDelta = insertedLineCount - 1 - deletedLineCount;
            this.adjustFoldingRegionsForLineChange(editStartLine, editEndLine, lineDelta);
        }
    }

    /**
     * Строчный сдвиг фолдов под одну правку `[editStartLine..editEndLine] → +lineDelta`.
     * Общее ядро {@link adjustFoldingRegionsForEdits} (свои правки, точные границы)
     * и {@link remapForDocumentChange} (чужие правки, границы из события документа).
     */
    private adjustFoldingRegionsForLineChange(editStartLine: number, editEndLine: number, lineDelta: number): void {
        this.adjustViewZonesForLineChange(editStartLine, editEndLine, lineDelta);
        this.foldedRegions = this.foldedRegions.filter((region) => {
            // Edit completely after the region → no change
            if (editStartLine > region.endLine) {
                return true;
            }

            // Edit completely before the region → shift both boundaries
            if (editEndLine < region.startLine) {
                region.startLine += lineDelta;
                region.endLine += lineDelta;
                return true;
            }

            // Edit starts before region starts and ends inside/after region → remove
            if (editStartLine <= region.startLine && editEndLine >= region.startLine) {
                return false;
            }

            // Edit is completely inside the region → adjust endLine
            if (editStartLine > region.startLine && editEndLine <= region.endLine) {
                region.endLine += lineDelta;
                return region.endLine > region.startLine; // remove if region became empty
            }

            // Edit starts inside region and extends beyond → remove
            /* v8 ignore start -- the fall-through else and the final `return true` are unreachable: reaching here needs editStartLine>endLine, but that case already returned at the "completely after" check */
            if (editStartLine > region.startLine && editStartLine <= region.endLine && editEndLine > region.endLine) {
                return false;
            }

            return true;
            /* v8 ignore stop */
        });
    }

    /**
     * Строчный сдвиг якорей зон под правку — зоны переживают правки документа
     * между пересчётами владельца (дифф пересчитает их сам по debounce, но до
     * этого проекция обязана оставаться целостной). Кэш и событие не трогаем:
     * правка уже меняет versionId документа (кэш пересоберётся) и уже
     * уведомляет рендер своим событием.
     */
    private adjustViewZonesForLineChange(editStartLine: number, editEndLine: number, lineDelta: number): void {
        if (this.viewZonesValue.length === 0 || lineDelta === 0) return;
        this.viewZonesValue = this.viewZonesValue.map((zone) => {
            if (zone.afterLine > editEndLine) {
                return { afterLine: zone.afterLine + lineDelta, size: zone.size };
            }
            if (zone.afterLine < editStartLine) return zone;
            // Якорь внутри изменённого диапазона: кламп к его новому концу.
            const clamped = Math.max(editStartLine - 1, Math.min(zone.afterLine, editEndLine + lineDelta));
            return clamped === zone.afterLine ? zone : { afterLine: clamped, size: zone.size };
        });
    }

    /**
     * Returns selections sorted by position in document order.
     */
    private sortedSelections(): ISelection[] {
        return [...this.selections].sort((a, b) => {
            const rangeA = selectionToRange(a);
            const rangeB = selectionToRange(b);
            return comparePositions(rangeA.start, rangeB.start);
        });
    }

    /**
     * Builds text edits from all current selections.
     */
    private buildEditsFromSelections(text: string): ITextEdit[] {
        return this.sortedSelections().map((sel) => {
            const range = selectionToRange(sel);
            return createTextEdit(range, text);
        });
    }

    /**
     * After edits are applied, computes the new cursor positions.
     * Each cursor moves to the end of the inserted text.
     */
    private computeSelectionsAfterEdits(edits: readonly ITextEdit[]): ISelection[] {
        // Sort edits in document order (ascending)
        const sorted = [...edits].sort((a, b) => comparePositions(a.range.start, b.range.start));

        const newSelections: ISelection[] = [];
        let accLineDelta = 0;
        let accCharDelta = 0;
        let lastEditEndLine = -1;

        for (const edit of sorted) {
            const range = edit.range;
            const insertedLines = edit.text.split("\n");
            const insertedLineCount = insertedLines.length;

            // End position of the inserted text
            let newLine: number;
            let newChar: number;

            if (insertedLineCount === 1) {
                // Single-line insert: cursor goes to start + text length
                newLine = range.start.line + accLineDelta;
                const startChar =
                    range.start.line === lastEditEndLine ? range.start.character + accCharDelta : range.start.character;
                newChar = startChar + insertedLines[0].length;
            } else {
                // Multi-line insert: cursor goes to the last inserted line
                newLine = range.start.line + accLineDelta + insertedLineCount - 1;
                newChar = insertedLines[insertedLineCount - 1].length;
            }

            newSelections.push(createCursorSelection(newLine, newChar));

            // Update accumulated deltas
            const deletedLines = range.end.line - range.start.line;
            const lineDelta = insertedLineCount - 1 - deletedLines;
            accLineDelta += lineDelta;

            if (insertedLineCount === 1 && deletedLines === 0) {
                // Same-line edit: accumulate character delta
                const charDelta = insertedLines[0].length - (range.end.character - range.start.character);
                if (range.start.line === lastEditEndLine) {
                    accCharDelta += charDelta;
                } else {
                    accCharDelta = charDelta;
                }
                lastEditEndLine = range.start.line;
            } else {
                accCharDelta = 0;
                lastEditEndLine = -1;
            }
        }

        /* v8 ignore start -- the `: [...]` fallback is unreachable: callers only invoke this with a non-empty edit list, and every document has at least one selection, so newSelections is never empty */
        return newSelections.length > 0 ? newSelections : [createCursorSelection(0, 0)];
        /* v8 ignore stop */
    }

    /**
     * Constructs a new selection after a cursor movement.
     * If inSelectionMode is false, anchor collapses to the new active position.
     * If true, the original anchor is preserved.
     */
    private buildSelection(
        original: ISelection,
        newLine: number,
        newChar: number,
        idealColumn: number,
        inSelectionMode: boolean,
    ): ISelection {
        if (inSelectionMode) {
            return createSelection(original.anchor.line, original.anchor.character, newLine, newChar, idealColumn);
        }
        return createCursorSelection(newLine, newChar, idealColumn);
    }

    public cloneSelections(): ISelection[] {
        return this.selections.map((s) => ({ ...s, anchor: { ...s.anchor }, active: { ...s.active } }));
    }
}

/**
 * Number of leading characters to strip to remove one indent level from a line:
 * a single leading tab, or up to `tabSize` leading spaces (fewer if the run is
 * shorter). Returns 0 when the line has no leading whitespace.
 */
function computeOutdentRemoval(content: string, tabSize: number): number {
    if (content.length === 0) return 0;
    if (content.startsWith("\t")) return 1;
    let count = 0;
    while (count < tabSize && content[count] === " ") {
        count++;
    }
    return count;
}

/**
 * Index of the first non-whitespace character in `content`, or the line length
 * when the line is empty or all whitespace.
 */
function firstNonWhitespaceIndex(content: string): number {
    for (let i = 0; i < content.length; i++) {
        if (!/\s/.test(content[i])) return i;
    }
    return content.length;
}

// ─── Word Boundary Helpers ──────────────────────────────────

/**
 * Finds the start of the previous word boundary, scanning left from `offset`.
 * Mirrors VS Code Ctrl+Left behavior: skip whitespace, then skip same-class characters.
 */
function findWordBoundaryLeft(line: string, offset: number): number {
    let pos = offset;
    // Skip whitespace
    while (pos > 0 && charClass(line[pos - 1]) === 0) {
        pos--;
    }
    if (pos === 0) return 0;
    // Skip same-class chars
    const cls = charClass(line[pos - 1]);
    while (pos > 0 && charClass(line[pos - 1]) === cls) {
        pos--;
    }
    return pos;
}

/**
 * Finds the end of the next word boundary, scanning right from `offset`.
 * Mirrors VS Code Ctrl+Right behavior: skip same-class characters, then skip whitespace.
 */
function findWordBoundaryRight(line: string, offset: number): number {
    let pos = offset;
    const len = line.length;
    /* v8 ignore start -- unreachable via callers: both cursorWordRight and deleteWordRight only call this when offset < line length */
    if (pos >= len) return len;
    /* v8 ignore stop */
    // Skip same-class chars
    const cls = charClass(line[pos]);
    while (pos < len && charClass(line[pos]) === cls) {
        pos++;
    }
    // Skip whitespace
    while (pos < len && charClass(line[pos]) === 0) {
        pos++;
    }
    return pos;
}

/**
 * Кодировка строки-зоны в проекции вью: документные строки — их индексы
 * (`>= 0`), виртуальные — отрицательные числа, несущие якорь зоны
 * (`-(afterLine + 3)`, чтобы `-1` остался сентинелом «не найдено», а якорь
 * `-1` «перед первой строкой» кодировался `-2`). Кодировка числом, а не
 * объектом: проекция — массив длиной с документ, аллокация объекта на строку
 * ударила бы по большим файлам.
 */
function encodeViewZoneRow(afterLine: number): number {
    return -(afterLine + 3);
}

/** Обратное к {@link encodeViewZoneRow}: якорь зоны из закодированного ряда. */
function decodeViewZoneAnchor(row: number): number {
    // `-3 - row`, а не `-(row + 3)`: последнее для якоря 0 дало бы -0.
    return -3 - row;
}

/**
 * Вставка виртуальных строк зон в проекцию видимых документных строк. Зона
 * встаёт ПОСЛЕ последней видимой строки с `docLine <= afterLine`: если якорь
 * скрыт свёрткой, зона выживает после заголовка свернувшего региона — дифф
 * сворачивает unchanged-куски и обязан не терять выравнивание (upstream решает
 * то же самое флагом `showInHiddenAreas`). Якорь `-1` (и якорь ниже первой
 * видимой строки) даёт зону перед началом вью.
 *
 * `visible`/`startOffsets` — параллельные массивы рядов (ряд = документная
 * строка или её фрагмент при wrap); зона вставляется только после ПОСЛЕДНЕГО
 * ряда своей строки: у промежуточных фрагментов `next === visible[i]`, и
 * условие `afterLine < next` не срабатывает.
 */
function insertViewZones(
    visible: readonly number[],
    startOffsets: readonly number[],
    zones: readonly IViewZone[],
): { rowDocLine: number[]; rowStartOffset: number[] } {
    const rowDocLine: number[] = [];
    const rowStartOffset: number[] = [];
    const pushZone = (zone: IViewZone): void => {
        for (let k = 0; k < zone.size; k++) {
            rowDocLine.push(encodeViewZoneRow(zone.afterLine));
            rowStartOffset.push(0);
        }
    };
    let zi = 0;
    /* v8 ignore start -- ?? недостижим: видимый список пуст не бывает — фолд не прячет собственный заголовок */
    const firstVisible = visible[0] ?? Number.MAX_SAFE_INTEGER;
    /* v8 ignore stop */
    while (zi < zones.length && zones[zi].afterLine < firstVisible) {
        pushZone(zones[zi]);
        zi++;
    }
    for (let i = 0; i < visible.length; i++) {
        rowDocLine.push(visible[i]);
        rowStartOffset.push(startOffsets[i]);
        const next = i + 1 < visible.length ? visible[i + 1] : Number.MAX_SAFE_INTEGER;
        while (zi < zones.length && zones[zi].afterLine >= visible[i] && zones[zi].afterLine < next) {
            pushZone(zones[zi]);
            zi++;
        }
    }
    return { rowDocLine, rowStartOffset };
}
