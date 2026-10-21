import { DisplayLine } from "@tuidom/core/common/displayLine";

import { Emitter } from "../../../base/common/event.ts";
import type { IDisposable } from "../../../base/common/lifecycle.ts";
import type { IMarkerDecoration } from "../../../platform/markers/common/iMarker.ts";
import type { IFoldingRegion } from "../../contrib/folding/iFoldingRegion.ts";
import type { IMultiCursorFindSession } from "../../contrib/multicursor/iMultiCursorFindSession.ts";
import type { IPosition } from "../core/iPosition.ts";
import { comparePositions, createPosition } from "../core/iPosition.ts";
import type { IRange } from "../core/iRange.ts";
import { createRange, rangeContainsPosition } from "../core/iRange.ts";
import type { ISelection } from "../core/iSelection.ts";
import { createCursorSelection, createSelection, isSelectionCollapsed, selectionToRange } from "../core/iSelection.ts";
import type { ITextEdit } from "../core/iTextEdit.ts";
import { compareTextEditsInDocumentOrder, createTextEdit } from "../core/iTextEdit.ts";
import { sortAndMergeSelections } from "../core/sortAndMergeSelections.ts";
import { charClass } from "../core/wordClassification.ts";
import { computeNewLinePlan } from "../languages/autoIndent.ts";
import type { IDocumentContentChange } from "../model/iDocumentContentChange.ts";
import { detectIndentation } from "../model/indentationDetector.ts";
import type { ITextDocument } from "../model/iTextDocument.ts";
import type { IUndoElement } from "../model/iUndoElement.ts";
import { TrackedRangeStickiness } from "../model/trackedDecorations.ts";
import type { DocumentTokenStore } from "../tokens/documentTokenStore.ts";
import type { LineTokens } from "../tokens/lineTokens.ts";
import type { ISemanticLineTokens } from "../tokens/semanticTokensLines.ts";
import type { SemanticTokensStore } from "../tokens/semanticTokensStore.ts";

import type { IViewZone, ViewLineKind } from "./iViewZone.ts";
import { LineBreaksCache } from "./lineBreaksCache.ts";
import type { ILineOperationResult, ITextToCopy } from "./lineOperations.ts";
import {
    computeCopyLines,
    computeCutEdits,
    computeDeleteLines,
    computeDuplicateSelection,
    computeMoveLines,
    computeTextToCopy,
} from "./lineOperations.ts";
import { LONG_LINE_TRUNCATION_BADGE_WIDTH, STOP_RENDERING_LINE_AFTER } from "./longLineRendering.ts";
import type { ICursorStateComputer } from "./trackedSelections.ts";
import { planTrackedSelections, resolveTrackedSelections } from "./trackedSelections.ts";

export type WordWrapMode = "off" | "on" | "wordWrapColumn" | "bounded";

interface IViewMarkerDecoration {
    readonly id: string;
    readonly severity: IMarkerDecoration["severity"];
}

/** Параллельные массивы, а не объекты на ряд: проекция длиной с документ, аллокация на ряд ударила бы по большим файлам. */
interface IViewProjection {
    /** `>= 0` — номер документной строки, `< 0` — код зоны ({@link encodeViewZoneRow}). */
    rowDocLine: number[];
    rowStartOffset: number[];
    /** -1 — строка скрыта свёрткой. */
    firstRowOfDocLine: Int32Array;
}

export class EditorViewState {
    private scrollLeftValue = 0;
    private scrollTopValue = 0;

    /** Сеттеры шлют {@link onDidChangeView}: damage-tracking рисует только помеченное, молчаливый скролл оставил бы экран несвежим. */
    public get scrollLeft(): number {
        return this.scrollLeftValue;
    }

    public set scrollLeft(value: number) {
        // Инвариант «wrap ⇒ scrollLeft ≡ 0» держится здесь, а не проверками у каждого потребителя.
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
    /** Упрощение v1: `wordWrapColumn` ведёт себя как `bounded` — docs/TODO/WordWrap.md. */
    public wordWrap: WordWrapMode = "off";
    public wordWrapColumn = 80;
    public cursorSurroundingLines = 0;
    /**
     * Не настройка, а результат {@link runDetectIndentation}: {@link indentExplicitlySet}
     * → детекция по содержимому → {@link configuredTabSize}.
     */
    public tabSize = 4;
    public insertSpaces = false;
    public configuredTabSize = 4;
    public configuredInsertSpaces = false;
    public detectIndentation = true;
    /** Отступ из `editor.options` (например, стоковый EditorConfig) главнее и детекции, и конфига. */
    public indentExplicitlySet = false;
    /**
     * Живёт здесь, а не на `EditorElement`: все мутации (клавиатура, paste, completion,
     * rename/bulkEdit, `editor.applyEdit`) идут через эту точку. Мутаторы — no-op с
     * `undefined`, как `executeEdits` → `false` в VS Code; курсор, скролл, фолдинг работают.
     */
    public readOnly = false;
    private selectionsValue!: ISelection[];
    private readonly onDidChangeCursorPositionEmitter = new Emitter<void>();
    public readonly onDidChangeCursorPosition = this.onDidChangeCursorPositionEmitter.event;
    private readonly onDidChangeViewEmitter = new Emitter<void>();
    public readonly onDidChangeView = this.onDidChangeViewEmitter.event;
    public get searchMatches(): IRange[] {
        return this.searchMatchesValue;
    }

    public set searchMatches(value: IRange[]) {
        this.searchMatchesValue = value;
        this.fireViewChange();
    }

    /** -1 — активного совпадения нет. */
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
    /** Перед чтением токенов рендер обязан позвать `tokenStore.tokenizeViewport(top, bottom)`. */
    public tokenStore: DocumentTokenStore | undefined;
    public semanticTokens: SemanticTokensStore | undefined;

    /**
     * Сессия Ctrl+D живёт здесь, чтобы умереть вместе со вью; логика — в
     * `editor/contrib/multicursor/`, импорт type-only: рантайм-зависимости common → contrib нет.
     */
    public multiCursorSession: IMultiCursorFindSession | null = null;

    private projectionCache: IViewProjection | null = null;
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
     * Снапшоты wrap-входов, а не версии-счётчики: писателей у wordWrap/viewportWidth/tabSize
     * много, «не забудь bump-нуть версию» — приглашение к багу. `-1` — wrap выключен.
     */
    // Stryker disable next-line UnaryOperator: сентинел не несёт смысла — первый rebuild гейтится projectionCache === null
    private projectionCacheWrapWidth = -1;
    // Stryker disable next-line UnaryOperator: см. выше
    private projectionCacheTabSize = -1;
    private lineBreaksCacheValue: LineBreaksCache | null = null;

    /**
     * Свои мутаторы пересчитывают выделения и фолды точно — ремап
     * {@link remapForDocumentChange} для них был бы вторым сдвигом.
     */
    private applyingOwnEdits = false;
    private readonly docContentSubscription: IDisposable;
    // Stryker disable next-line ArrayDeclaration: мусорный элемент без id документ не знает — getDecorationRange даёт null
    private markerDecorationIds: readonly IViewMarkerDecoration[] = [];

    public constructor(document: ITextDocument, selections?: ISelection[]) {
        this.document = document;
        this.docContentSubscription = document.onDidChangeContent((change) => {
            if (!this.applyingOwnEdits) this.remapForDocumentChange(change);
        });
        this.selections = selections && selections.length > 0 ? selections : [createCursorSelection(0, 0)];
        this.runDetectIndentation();
    }

    public dispose(): void {
        this.docContentSubscription.dispose();
        this.setMarkerDecorations([]);
        this.lineBreaksCacheValue?.dispose();
    }

    /** Диапазоны становятся декорациями документа и едут с текстом (upstream `MarkerDecorations.update`). */
    public setMarkerDecorations(decorations: readonly IMarkerDecoration[]): void {
        const ids = this.document.deltaDecorations(
            this.markerDecorationIds.map((decoration) => decoration.id),
            decorations.map((decoration) => ({
                range: decoration.range,
                options: {
                    // Stryker disable next-line StringLiteral: описание — только для отладки, как в эталоне
                    description: "marker-decoration",
                    stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
                },
            })),
        );
        this.markerDecorationIds = ids.map((id, i) => ({ id, severity: decorations[i].severity }));
    }

    public getMarkerDecorations(): IMarkerDecoration[] {
        const result: IMarkerDecoration[] = [];
        for (const { id, severity } of this.markerDecorationIds) {
            const range = this.document.getDecorationRange(id);
            // Декорации вью снимает только она сама, так что null — лишь защита от чужого id.
            // Stryker disable next-line ConditionalExpression: см. выше — снаружи её id никто не снимает
            if (range !== null) result.push({ range, severity });
        }
        return result;
    }

    public get isWordWrapActive(): boolean {
        return this.wordWrap !== "off";
    }

    /** `null` — wrap выключен. Скаляр — он же ключ инвалидации кеша; нижний кламп — в {@link computeLineBreakOffsets}. */
    private effectiveWrapWidth(): number | null {
        if (this.wordWrap === "off") return null;
        if (this.wordWrap === "on") return this.viewportWidth;
        return Math.min(this.viewportWidth, this.wordWrapColumn);
    }

    private wrapBreaks(wrapWidth: number): LineBreaksCache {
        // Stryker disable next-line ConditionalExpression: чистая мемоизация — пересозданный с теми же параметрами кеш даёт тот же результат, только медленнее
        this.lineBreaksCacheValue ??= new LineBreaksCache(this.document, this.tabSize, wrapWidth);
        this.lineBreaksCacheValue.setParams(this.tabSize, wrapWidth);
        return this.lineBreaksCacheValue;
    }

    /** Единственная законная дверь мутаторов к `document.applyEdits`. */
    private applyDocumentEdits(edits: readonly ITextEdit[]): ReturnType<ITextDocument["applyEdits"]> {
        this.applyingOwnEdits = true;
        try {
            return this.document.applyEdits(edits);
        } finally {
            this.applyingOwnEdits = false;
        }
    }

    /**
     * Ремап под чужую правку (другая вью, undo/redo, синтетический буфер) — строчный:
     * позиции внутри изменённого диапазона клампятся к его концу, колоночный дрейф принят.
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
        // Только при реальном сдвиге: холостой cursor-change дёргал бы статус-бар и host.
        if (remapped.some((sel, i) => sel !== this.selectionsValue[i])) {
            this.selections = remapped;
        }

        // Правка выше вьюпорта: держим на экране те же строки. Со свёртками и зонами
        // логический сдвиг ≠ визуальному, честный пересчёт не стоит своей цены.
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

    private remapPosition(pos: IPosition, change: IDocumentContentChange, lineDelta: number): IPosition {
        if (pos.line > change.oldEndLine) {
            return lineDelta === 0 ? pos : { line: pos.line + lineDelta, character: pos.character };
        }
        if (pos.line < change.startLine) return pos;
        const line = Math.min(pos.line, change.newEndLine);
        const character = Math.min(pos.character, this.document.getLineLength(line));
        return line === pos.line && character === pos.character ? pos : { line, character };
    }

    /** Порог {@link STOP_RENDERING_LINE_AFTER} — чтобы экстремально длинная строка не была O(длины) ни на одном пути. */
    public displayLineFor(lineContent: string): DisplayLine {
        return new DisplayLine(lineContent, this.tabSize, STOP_RENDERING_LINE_AFTER);
    }

    /**
     * Присваивание нормализует через {@link sortAndMergeSelections} и шлёт событие;
     * мутация массива на месте события не шлёт. Нормализация здесь, а не у мутаторов:
     * писателей много. Первичное — `selections[0]`, самое верхнее в документе.
     */
    public get selections(): ISelection[] {
        return this.selectionsValue;
    }

    public set selections(value: readonly ISelection[]) {
        this.selectionsValue = sortAndMergeSelections(value);
        this.fireCursorChange();
    }

    private fireCursorChange(): void {
        this.onDidChangeCursorPositionEmitter.fire();
    }

    private fireViewChange(): void {
        this.onDidChangeViewEmitter.fire();
    }

    private bumpFoldsVersion(): void {
        this.foldsVersion++;
        this.fireViewChange();
    }

    /** Пересчитывается целиком на каждое изменение конфига: иначе выключение `editor.detectIndentation` некуда откатывать. */
    public runDetectIndentation(): void {
        if (this.indentExplicitlySet) return;
        const defaults = { tabSize: this.configuredTabSize, insertSpaces: this.configuredInsertSpaces };
        const result = this.detectIndentation ? detectIndentation(this.document, defaults) : defaults;
        this.insertSpaces = result.insertSpaces;
        this.tabSize = result.tabSize;
    }

    public get viewZones(): readonly IViewZone[] {
        return this.viewZonesValue;
    }

    /**
     * Нормализует: пустые зоны выбрасывает, якоря клампит в `[-1, lineCount-1]`, одинаковые
     * якоря сливает. Тот же набор — no-op без события: сеттер зовут на каждый пересчёт диффа.
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

    public viewLineKind(viewLine: number): ViewLineKind {
        const row = this.buildVisibleLines().at(viewLine);
        if (viewLine < 0 || row === undefined) return "none";
        return row >= 0 ? "doc" : "zone";
    }

    public zoneAnchorForViewLine(viewLine: number): number | null {
        const row = this.buildVisibleLines().at(viewLine);
        if (viewLine < 0 || row === undefined || row >= 0) return null;
        return decodeViewZoneAnchor(row);
    }

    /** O(1): стартовые строки зон кэшируются с проекцией — в кодировке ряда offset не хранится. */
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

    /** У зоны — её якорь (видимая строка выше), у зоны перед началом файла — первая видимая ниже. */
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

    public setFoldingRegions(regions: IFoldingRegion[]): void {
        this.foldedRegions = regions;
        this.bumpFoldsVersion();
    }

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

    /** «Innermost» — кандидат с наибольшим `startLine`. */
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

    public foldingRegionContaining(line: number): IFoldingRegion | undefined {
        return this.innermostRegionContaining(line, () => true);
    }

    public foldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => !region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = true;
            this.bumpFoldsVersion();
            this.reconcileHiddenCursors();
        }
    }

    public unfoldRegionContaining(line: number): void {
        const target = this.innermostRegionContaining(line, (region) => region.isCollapsed);
        if (target !== undefined) {
            target.isCollapsed = false;
            this.bumpFoldsVersion();
        }
    }

    public toggleFoldContaining(line: number): void {
        const region = this.foldingRegionContaining(line);
        if (region !== undefined) {
            region.isCollapsed = !region.isCollapsed;
            this.bumpFoldsVersion();
            this.reconcileHiddenCursors();
        }
    }

    public foldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = true;
        }
        this.bumpFoldsVersion();
        this.reconcileHiddenCursors();
    }

    public unfoldAll(): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = false;
        }
        this.bumpFoldsVersion();
    }

    public foldRecursively(line: number): void {
        this.setCollapsedRecursively(line, true);
    }

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

    public foldLevel(level: number): void {
        for (const region of this.foldedRegions) {
            region.isCollapsed = this.regionNestingLevel(region) >= level;
        }
        this.bumpFoldsVersion();
        this.reconcileHiddenCursors();
    }

    /** 1-based. */
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

    public gotoNextFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine > line && (target === undefined || region.startLine < target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    public gotoPreviousFold(line: number): void {
        let target: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.startLine < line && (target === undefined || region.startLine > target.startLine)) {
                target = region;
            }
        }
        if (target !== undefined) this.goToPosition(target.startLine, 0);
    }

    /** Наружный — его заголовок всегда виден. */
    private outermostCollapsedRegionHiding(line: number): IFoldingRegion | undefined {
        let best: IFoldingRegion | undefined;
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && region.startLine < line && line <= region.endLine) {
                if (best === undefined || region.startLine < best.startLine) best = region;
            }
        }
        return best;
    }

    /** Курсор, скрытый свёрткой, — на заголовок региона, как в VS Code. */
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

    public scrollLineUp(): void {
        this.scrollTop = Math.max(0, this.scrollTop - 1);
    }

    public scrollLineDown(): void {
        const maxScrollTop = Math.max(0, this.getViewLineCount() - this.viewportHeight);
        this.scrollTop = Math.min(maxScrollTop, this.scrollTop + 1);
    }

    public getViewLineCount(): number {
        return this.buildVisibleLines().length;
    }

    public getViewLine(visualLineNumber: number): string {
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return "";
        }
        return this.document.getLineContent(logicalLine);
    }

    /** Не токенизирует: рендер обязан сначала позвать `tokenStore.tokenizeViewport(...)`. */
    public getViewLineTokens(visualLineNumber: number): LineTokens | undefined {
        if (!this.tokenStore) return undefined;
        const logicalLine = this.visualToLogicalLine(visualLineNumber);
        if (logicalLine < 0 || logicalLine >= this.document.lineCount) {
            return undefined;
        }
        return this.tokenStore.getLineTokens(logicalLine);
    }

    public getViewLineSemanticTokens(visualLineNumber: number): ISemanticLineTokens | undefined {
        if (!this.semanticTokens) return undefined;
        return this.semanticTokens.getLineTokens(this.visualToLogicalLine(visualLineNumber));
    }

    /** -1 — строка скрыта свёрткой. */
    public logicalToVisualLine(logicalLine: number): number {
        const { firstRowOfDocLine } = this.buildProjection();
        if (logicalLine < 0 || logicalLine >= firstRowOfDocLine.length) return -1;
        return firstRowOfDocLine[logicalLine];
    }

    /** -1 и за границей, и у ряда-зоны: различает {@link viewLineKind}, ближайшую строку даёт {@link docLineForViewLine}. */
    public visualToLogicalLine(visualLine: number): number {
        const visible = this.buildVisibleLines();
        if (visualLine < 0 || visualLine >= visible.length) {
            return -1;
        }
        const row = visible[visualLine];
        return row >= 0 ? row : -1;
    }

    /** `[start, end)`; `{0, 0}` у зон и за границами вью. */
    public viewLineRange(viewLine: number): { start: number; end: number } {
        const { rowDocLine, rowStartOffset } = this.buildProjection();
        const doc = rowDocLine.at(viewLine);
        if (viewLine < 0 || doc === undefined || doc < 0) return { start: 0, end: 0 };
        const start = rowStartOffset[viewLine];
        // Фрагменты строки контигуозны (зона встаёт только после последнего).
        const end = rowDocLine[viewLine + 1] === doc ? rowStartOffset[viewLine + 1] : this.document.getLineLength(doc);
        return { start, end };
    }

    public viewLineStartColumn(viewLine: number): number {
        const { rowDocLine, rowStartOffset } = this.buildProjection();
        const start = rowStartOffset[viewLine];
        if (!start) return 0;
        return this.displayLineFor(this.document.getLineContent(rowDocLine[viewLine])).offsetToColumn(start);
    }

    /** Offset на границе фрагментов — СЛЕДУЮЩИЙ ряд (без cursor affinity, упрощение v1 — docs/TODO/WordWrap.md). */
    public viewLineForPosition(line: number, character: number): number {
        let row = this.logicalToVisualLine(line);
        const { rowDocLine, rowStartOffset } = this.buildProjection();
        while (rowDocLine[row + 1] === line && rowStartOffset[row + 1] <= character) {
            row++;
        }
        return row;
    }

    public getSelectedText(): string {
        const sel = this.selections[0];
        if (isSelectionCollapsed(sel)) {
            return "";
        }
        return this.document.getTextInRange(selectionToRange(sel));
    }

    /** Для мультикурсорных Copy/Cut: на одном первичном Cut удалял бы больше, чем скопировал. */
    public getSelectedTexts(): string[] {
        return this.selections.map((sel) =>
            isSelectionCollapsed(sel) ? "" : this.document.getTextInRange(selectionToRange(sel)),
        );
    }

    public insertText(text: string): IUndoElement | undefined {
        return this.type(text);
    }

    public type(text: string): IUndoElement | undefined {
        return this.typeEach(() => text);
    }

    /** Текст у каждой каретки свой: Tab добирает пробелами до СВОЕГО табстопа. */
    private typeEach(textFor: (range: IRange) => string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const edits = this.buildEditsFromSelections(textFor);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selectionsAfterEdits(inverseEdits);
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

    /** Каретка между `text` и `close`; решение «закрывать ли» — у вызывающего (`planAutoClose`). `close` однострочный. */
    public typeWithAutoClose(text: string, close: string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const edits = this.buildEditsFromSelections(() => text + close);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        // Stryker disable next-line CallExpression: токены пары однострочные, число строк не
        // меняется — двигать границы фолдов нечего; вызов держит общий порядок мутаторов
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selectionsAfterEdits(inverseEdits).map((sel) =>
            createCursorSelection(sel.active.line, sel.active.character - close.length),
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

    /** Документ не меняется — undo-шага нет. Прекондицию «под кареткой этот символ» держит вызывающий. */
    public typeOverClosingChar(): void {
        this.selections = this.selections.map((sel) =>
            createCursorSelection(sel.active.line, sel.active.character + 1),
        );
        this.ensureCursorVisible();
    }

    public surroundSelections(open: string, close: string): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();

        const edits: ITextEdit[] = [];
        for (const sel of sorted) {
            const range = selectionToRange(sel);
            edits.push(
                createTextEdit(
                    createRange(range.start.line, range.start.character, range.start.line, range.start.character),
                    open,
                ),
            );
            edits.push(
                createTextEdit(
                    createRange(range.end.line, range.end.character, range.end.line, range.end.character),
                    close,
                ),
            );
        }
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        // Stryker disable next-line CallExpression: как и в typeWithAutoClose — обрамление
        // однострочными токенами не меняет число строк, границам фолдов двигаться некуда
        this.adjustFoldingRegionsForEdits(edits);

        // Токены однострочные — дрейф только по колонкам, сдвиг копится по строкам в документном порядке.
        const lineDelta = new Map<number, number>();
        const remapped: ISelection[] = [];
        for (const sel of sorted) {
            const range = selectionToRange(sel);
            const startChar = range.start.character + (lineDelta.get(range.start.line) ?? 0) + open.length;
            const endChar =
                range.end.character +
                (lineDelta.get(range.end.line) ?? 0) +
                (range.end.line === range.start.line ? open.length : 0);
            // Stryker disable next-line EqualityOperator: у схлопнутого выделения (равенство)
            // обе ветки строят одну и ту же пустую пару позиций — направление неразличимо
            const ltr = comparePositions(sel.anchor, sel.active) <= 0;
            remapped.push(
                ltr
                    ? createSelection(range.start.line, startChar, range.end.line, endChar)
                    : createSelection(range.end.line, endChar, range.start.line, startChar),
            );
            lineDelta.set(range.start.line, (lineDelta.get(range.start.line) ?? 0) + open.length);
            lineDelta.set(range.end.line, (lineDelta.get(range.end.line) ?? 0) + close.length);
        }
        this.selections = remapped;
        this.ensureCursorVisible();
        return {
            label: "surround",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * Выделения после — как у `editor.executeEdits` эталона: их назначает `computeCursorState`
     * (обратные правки — в порядке `edits`), без него или при `null` прежние сдвигаются вслед
     * за правками. Каретку на каждую правку не ставим: правок несколько, каретка одна.
     */
    public applyEdits(
        edits: readonly ITextEdit[],
        label: string,
        computeCursorState?: ICursorStateComputer,
    ): IUndoElement | undefined {
        if (this.readOnly || edits.length === 0) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        // Документный порядок — тот же, в котором документ вернёт обратные правки.
        const order = edits.map((_, i) => i).sort((a, b) => compareTextEditsInDocumentOrder(edits[a], edits[b]));
        const sorted = order.map((i) => edits[i]);
        const tracked = planTrackedSelections(this.document, sorted, this.selections);
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // Stryker disable next-line ArrayDeclaration: order — перестановка индексов edits, каждый слот перезаписывается
        const inverseInInputOrder: ITextEdit[] = [];
        order.forEach((input, k) => (inverseInInputOrder[input] = inverseEdits[k]));
        this.selections =
            computeCursorState?.(inverseInInputOrder) ?? resolveTrackedSelections(tracked, sorted, inverseEdits);
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
        // У раскрытия блока закрывающая скобка заняла последнюю вставленную строку — каретка на строку выше.
        this.selections = this.selectionsAfterEdits(inverseEdits).map((sel, i) =>
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

    public deleteLeft(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
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
            this.selections = this.selectionsAfterEdits(inverseEdits);
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

    /** idealColumn не меняет — вертикальная навигация его сохраняет. */
    public cursorUp(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => this.moveVertically(sel, -1, inSelectionMode));
        this.ensureCursorVisible();
    }

    /** idealColumn не меняет — вертикальная навигация его сохраняет. */
    public cursorDown(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => this.moveVertically(sel, 1, inSelectionMode));
        this.ensureCursorVisible();
    }

    private moveVertically(sel: ISelection, direction: 1 | -1, inSelectionMode: boolean): ISelection {
        const step = this.stepPositionVertically(sel.active, this.idealColumnOf(sel), direction);
        if (step === null) return sel;
        return this.buildSelection(sel, step.line, step.character, step.idealColumn, inSelectionMode);
    }

    /**
     * При wrap ходит по РЯДАМ. Липкая колонка держится относительно начала фрагмента
     * (`idealAbs − startCol`), а возвращённый `idealColumn` — снова абсолютный: следующий
     * шаг вычтет стартовую колонку и получит ту же относительную. `null` — край вью.
     */
    private stepPositionVertically(
        pos: IPosition,
        idealAbs: number,
        direction: 1 | -1,
    ): { line: number; character: number; idealColumn: number } | null {
        const currentRow = this.viewLineForPosition(pos.line, pos.character);
        if (currentRow < 0) {
            // Каретка на скрытой строке (до reconcileHiddenCursors) — построчная посадка.
            const fallbackLine = direction === -1 ? this.previousVisibleLine(pos.line) : this.nextVisibleLine(pos.line);
            if (fallbackLine < 0) return null;
            const dl = this.displayLineFor(this.document.getLineContent(fallbackLine));
            return { line: fallbackLine, character: dl.columnToOffset(idealAbs), idealColumn: idealAbs };
        }

        const { rowDocLine } = this.buildProjection();
        let targetRow = currentRow + direction;
        // Индекс за краем даёт undefined — он сам останавливает скан (не < 0).
        while (rowDocLine[targetRow] < 0) {
            targetRow += direction;
        }
        if (targetRow < 0 || targetRow >= rowDocLine.length) return null;

        const idealInRow = Math.max(0, idealAbs - this.viewLineStartColumn(currentRow));
        return this.landOnRow(targetRow, idealInRow);
    }

    /** У не-последнего фрагмента — кламп к последней графеме: offset на границе принадлежит следующему ряду. */
    private landOnRow(targetRow: number, idealInRow: number): { line: number; character: number; idealColumn: number } {
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

    public cursorTop(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            return this.buildSelection(sel, 0, 0, 0, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

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

    /** Smart home, как в VS Code: отступ ↔ колонка 0. */
    public cursorHome(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const content = this.document.getLineContent(sel.active.line);
            // На ряду-продолжении wrap — к началу фрагмента; smart-home с продолжения нет
            // (упрощение v1, docs/TODO/WordWrap.md).
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

    /** VS Code `cursorLineStart` (Mac Ctrl+A): в отличие от {@link cursorHome}, на отступе не останавливается. */
    public cursorLineStart(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const row = this.viewLineForPosition(sel.active.line, sel.active.character);
            const rowStart = this.viewLineRange(row).start;
            return this.buildSelection(sel, sel.active.line, rowStart, this.viewLineStartColumn(row), inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    /** idealColumn = MAX_SAFE_INTEGER — Up/Down «липнут» к правому краю. */
    public cursorEnd(inSelectionMode = false): void {
        this.selections = this.selections.map((sel) => {
            const lineLen = this.document.getLineLength(sel.active.line);
            // На не-последнем фрагменте — к последней графеме фрагмента: offset границы
            // принадлежит следующему ряду (без cursor affinity, docs/TODO/WordWrap.md).
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

    public selectAll(): void {
        const lastLine = this.document.lineCount - 1;
        const lastChar = this.document.getLineLength(lastLine);
        this.selections = [createSelection(0, 0, lastLine, lastChar)];
    }

    public insertCursorAbove(): void {
        this.insertCursorVertically(-1);
    }

    public insertCursorBelow(): void {
        this.insertCursorVertically(1);
    }

    /** Выживает первичное — самое верхнее, за ним стоит аппаратный курсор терминала. */
    public removeSecondaryCursors(): void {
        // Холостое присваивание разбудило бы статус-бар, историю и ext-host впустую.
        if (this.selections.length <= 1) return;
        this.selections = [this.selections[0]];
        this.ensureCursorVisible();
    }

    /** Последнюю каретку не снимаем: редактор без курсора не бывает. */
    public toggleCursorAt(line: number, character: number): void {
        const position = createPosition(line, character);
        const covering = this.selections.findIndex((sel) => rangeContainsPosition(selectionToRange(sel), position));
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
     * Повторное нажатие наращивает пачку даром: копии внутренних кареток схлопываются
     * слиянием в сеттере — как `addCursorUp` в VS Code полагается на `normalize()`.
     */
    private insertCursorVertically(direction: 1 | -1): void {
        const added: ISelection[] = [];
        for (const sel of this.selections) {
            const translated = this.translateSelectionToAdjacentLine(sel, direction);
            if (translated !== null) added.push(translated);
        }
        if (added.length === 0) return;

        this.selections = [...this.selections, ...added];
        this.revealSelection(direction === -1 ? this.selections[0] : this.selections[this.selections.length - 1]);
    }

    /** `anchor` — по своей дисплейной колонке, а не по `idealColumn`: иначе выделение перекосит на табах. */
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
        // Якорь упёрся в край, а active — нет: копия легла бы внутрь исходного выделения,
        // слияние съело бы её, а событие смены курсора вылетело бы холостым.
        if (anchorStep === null) return null;

        return createSelection(
            anchorStep.line,
            anchorStep.character,
            activeStep.line,
            activeStep.character,
            activeStep.idealColumn,
        );
    }

    /** Без `idealColumn` — колонка с учётом табов и широких символов, а не посимвольный fallback `getIdealColumn`. */
    private idealColumnOf(selection: ISelection): number {
        if (selection.idealColumn !== undefined) return selection.idealColumn;
        const content = this.document.getLineContent(selection.active.line);
        return this.displayLineFor(content).offsetToColumn(selection.active.character);
    }

    public cursorPageDown(inSelectionMode = false): void {
        this.cursorPage(1, inSelectionMode);
    }

    public cursorPageUp(inSelectionMode = false): void {
        this.cursorPage(-1, inSelectionMode);
    }

    /** Страница — в строках ВЬЮ: зоны тоже занимают экран, шаг по документным уводил бы дальше видимого. */
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
            // Ряд-зона — ближайший документный, как docLineForViewLine: сначала выше, потом ниже.
            const { rowDocLine } = this.buildProjection();
            let targetRow = targetView;
            while (rowDocLine[targetRow] < 0) targetRow--;
            if (targetRow < 0) {
                targetRow = targetView;
                while (rowDocLine[targetRow] < 0) targetRow++;
            }
            const idealInRow = Math.max(0, idealAbs - this.viewLineStartColumn(currentView));
            const landing = this.landOnRow(targetRow, idealInRow);
            return this.buildSelection(sel, landing.line, landing.character, landing.idealColumn, inSelectionMode);
        });
        this.ensureCursorVisible();
    }

    public deleteRight(): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
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
            this.selections = this.selectionsAfterEdits(inverseEdits);
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

    public deleteWordLeft(): IUndoElement | undefined {
        return this.deleteLeftTo("deleteWordLeft", (line, character) => findWordBoundaryLeft(line, character));
    }

    public deleteAllLeft(): IUndoElement | undefined {
        return this.deleteLeftTo("deleteAllLeft", () => 0);
    }

    private deleteLeftTo(
        label: string,
        boundary: (line: string, character: number) => number,
    ): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits: ITextEdit[] = [];

        for (const sel of this.sortedSelections()) {
            const range = selectionToRange(sel);
            if (range.start.line === range.end.line && range.start.character === range.end.character) {
                const pos = sel.active;
                if (pos.character > 0) {
                    const line = this.document.getLineContent(pos.line);
                    const start = boundary(line, pos.character);
                    edits.push(createTextEdit(createRange(pos.line, start, pos.line, pos.character), ""));
                } else if (pos.line > 0) {
                    const prevLineLen = this.document.getLineLength(pos.line - 1);
                    edits.push(createTextEdit(createRange(pos.line - 1, prevLineLen, pos.line, 0), ""));
                }
            } else {
                edits.push(createTextEdit(range, ""));
            }
        }

        const clipped = clipDeletionOverlaps(edits);
        if (clipped.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(clipped);
            this.adjustFoldingRegionsForEdits(clipped);
            this.selections = this.selectionsAfterEdits(inverseEdits);
            this.ensureCursorVisible();
            return {
                label,
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: clipped,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

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

        const clipped = clipDeletionOverlaps(edits);
        if (clipped.length > 0) {
            const beforeSelections = this.cloneSelections();
            const versionBefore = this.document.versionId;
            const { appliedVersion, inverseEdits } = this.applyDocumentEdits(clipped);
            this.adjustFoldingRegionsForEdits(clipped);
            this.selections = this.selectionsAfterEdits(inverseEdits);
            this.ensureCursorVisible();
            return {
                label: "deleteWordRight",
                versionBefore,
                versionAfter: appliedVersion,
                forwardEdits: clipped,
                backwardEdits: inverseEdits,
                beforeSelections,
                afterSelections: this.cloneSelections(),
            };
        }

        return undefined;
    }

    /** Однострочное выделение — вставка до следующего табстопа ({@link indentUnitAt}), многострочное — уровень каждой строке. */
    public indentLines(): IUndoElement | undefined {
        const spansMultipleLines = this.selections.some((sel) => {
            const range = selectionToRange(sel);
            return range.start.line !== range.end.line;
        });
        if (!spansMultipleLines) {
            return this.typeEach((range) => this.indentUnitAt(range.start));
        }
        return this.shiftIndent(1);
    }

    public outdentLines(): IUndoElement | undefined {
        return this.shiftIndent(-1);
    }

    /** К табстопам не выравнивает: эталон тоже добавляет строке ровно один уровень. */
    private indentUnit(): string {
        return this.insertSpaces ? " ".repeat(this.tabSize) : "\t";
    }

    /**
     * До СЛЕДУЮЩЕГО табстопа, как VS Code (`ab|` при tabSize 4 → колонка 4, а не 6), по
     * видимой колонке, а не по offset: таб слева и широкая графема сдвигают табстоп.
     */
    private indentUnitAt(pos: IPosition): string {
        if (!this.insertSpaces) return "\t";
        const lineContent = this.document.getLineContent(pos.line);
        const visibleColumn = this.displayLineFor(lineContent).offsetToColumn(pos.character);
        return " ".repeat(this.tabSize - (visibleColumn % this.tabSize));
    }

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

    /** Конец выделения на колонке 0 следующей строки её не захватывает — как VS Code. */
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

    /** На indent конец на колонке 0 остаётся на 0; на outdent точка внутри удалённого — к началу строки. */
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

    public copyLinesUp(): IUndoElement | undefined {
        return this.applyLineOperation("copyLinesUp", computeCopyLines(this.document, this.sortedSelections(), false));
    }

    public copyLinesDown(): IUndoElement | undefined {
        return this.applyLineOperation("copyLinesDown", computeCopyLines(this.document, this.sortedSelections(), true));
    }

    public duplicateSelection(): IUndoElement | undefined {
        return this.applyLineOperation(
            "duplicateSelection",
            computeDuplicateSelection(this.document, this.sortedSelections()),
        );
    }

    public moveLinesUp(): IUndoElement | undefined {
        return this.applyLineOperation("moveLinesUp", computeMoveLines(this.document, this.sortedSelections(), false));
    }

    public moveLinesDown(): IUndoElement | undefined {
        return this.applyLineOperation("moveLinesDown", computeMoveLines(this.document, this.sortedSelections(), true));
    }

    public deleteLines(): IUndoElement | undefined {
        return this.applyLineOperation("deleteLines", computeDeleteLines(this.document, this.sortedSelections()));
    }

    /** Кламп к документу: чистые функции держат колонку каретки, а строка под ней могла стать короче. */
    private applyLineOperation(label: string, computed: ILineOperationResult | null): IUndoElement | undefined {
        if (this.readOnly || computed === null) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(computed.edits);
        this.adjustFoldingRegionsForEdits(computed.edits);
        this.selections = computed.afterSelections.map((sel) => this.clampSelectionToDocument(sel));
        this.ensureCursorVisible();
        return {
            label,
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: computed.edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /** Не только защита: deleteLines сажает каретку на строку ЗА новым концом документа — кламп возвращает её. */
    private clampSelectionToDocument(sel: ISelection): ISelection {
        const clamp = (pos: IPosition): IPosition => {
            const line = Math.max(0, Math.min(pos.line, this.document.lineCount - 1));
            return { line, character: Math.max(0, Math.min(pos.character, this.document.getLineLength(line))) };
        };
        return { anchor: clamp(sel.anchor), active: clamp(sel.active), idealColumn: sel.idealColumn };
    }

    public getTextToCopy(emptySelectionClipboard: boolean): ITextToCopy {
        return computeTextToCopy(this.document, this.sortedSelections(), emptySelectionClipboard);
    }

    public cutSelections(emptySelectionClipboard: boolean): IUndoElement | undefined {
        if (this.readOnly) return undefined;
        const edits = computeCutEdits(this.document, this.sortedSelections(), emptySelectionClipboard);
        if (edits.length === 0) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        this.selections = this.selectionsAfterEdits(inverseEdits);
        this.ensureCursorVisible();
        return {
            label: "cut",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    /**
     * `pasteOnNewLine` — линейная вставка VS Code: строка, скопированная ПУСТЫМ выделением,
     * ложится строкой выше курсорной; действует на каждую пустую каретку отдельно.
     */
    public pasteText(text: string, pasteOnNewLine: boolean): IUndoElement | undefined {
        // Пустой текст (-1 === -1) тоже проходит — безобидно: обе ветки дают пустые правки.
        const linewise = pasteOnNewLine && text.indexOf("\n") === text.length - 1;
        if (!linewise) return this.insertText(text);
        if (this.readOnly) return undefined;
        const beforeSelections = this.cloneSelections();
        const versionBefore = this.document.versionId;
        const sorted = this.sortedSelections();
        const edits = sorted.map((sel) =>
            isSelectionCollapsed(sel)
                ? createTextEdit(createRange(sel.active.line, 0, sel.active.line, 0), text)
                : createTextEdit(selectionToRange(sel), text),
        );
        const { appliedVersion, inverseEdits } = this.applyDocumentEdits(edits);
        this.adjustFoldingRegionsForEdits(edits);
        // Каретку в конце вставленного (начало съехавшей строки) возвращаем в её колонку.
        this.selections = this.selectionsAfterEdits(inverseEdits).map((after, i) =>
            isSelectionCollapsed(sorted[i])
                ? createCursorSelection(after.active.line, sorted[i].active.character)
                : after,
        );
        this.ensureCursorVisible();
        return {
            label: "paste",
            versionBefore,
            versionAfter: appliedVersion,
            forwardEdits: edits,
            backwardEdits: inverseEdits,
            beforeSelections,
            afterSelections: this.cloneSelections(),
        };
    }

    public ensureLineVisible(logicalLine: number): void {
        for (const region of this.foldedRegions) {
            if (region.isCollapsed && logicalLine > region.startLine && logicalLine <= region.endLine) {
                region.isCollapsed = false;
                this.bumpFoldsVersion();
            }
        }
    }

    public revealRange(range: IRange): void {
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(range.start);
    }

    /** Для команд, добавляющих выделение: после нормализации новое может оказаться где угодно, а не в `selections[0]`. */
    public revealSelection(selection: ISelection): void {
        const range = selectionToRange(selection);
        this.ensureLineVisible(range.start.line);
        this.ensureLineVisible(range.end.line);
        this.revealPosition(selection.active);
    }

    /** После пересчёта фолдинга, который мог свернуть регион вокруг правленой строки. */
    public ensurePrimaryCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    public get lineCount(): number {
        return this.document.lineCount;
    }

    public get primaryCursorLine(): number {
        return this.selections[0]?.active.line ?? 0;
    }

    public get primaryCursorColumn(): number {
        return this.selections[0]?.active.character ?? 0;
    }

    public goToPosition(line: number, character = 0): void {
        const clampedLine = Math.max(0, Math.min(line, this.document.lineCount - 1));
        const clampedChar = Math.max(0, Math.min(character, this.document.getLineLength(clampedLine)));
        this.selections = [createCursorSelection(clampedLine, clampedChar)];
        this.ensureLineVisible(clampedLine);
        this.revealPosition(this.selections[0].active);
    }

    public restoreSelections(selections: readonly ISelection[]): void {
        this.selections = [...selections];
        if (this.selections.length > 0) this.ensureLineVisible(this.selections[0].active.line);
        this.ensureCursorVisible();
    }

    private ensureCursorVisible(): void {
        if (this.selections.length === 0) return;
        this.revealPosition(this.selections[0].active);
    }

    private revealPosition(pos: IPosition): void {
        if (this.viewportWidth <= 0 || this.viewportHeight <= 0) return;

        // При wrap — РЯД позиции, а не первый фрагмент: иначе хвост длинной строки остался бы за краем.
        const visualLine = this.viewLineForPosition(pos.line, pos.character);
        /* v8 ignore start -- callers (goToPosition/revealRange/restoreSelections) expand folds before revealing, so a hidden line never reaches here */
        if (visualLine < 0) return;
        /* v8 ignore stop */

        // Отступ ограничен половиной вьюпорта, иначе края сойдутся и вытолкнут курсор.
        const maxMargin = Math.floor((this.viewportHeight - 1) / 2);
        const margin = Math.max(0, Math.min(this.cursorSurroundingLines, maxMargin));

        if (visualLine < this.scrollTop + margin) {
            this.scrollTop = Math.max(0, visualLine - margin);
        } else if (visualLine > this.scrollTop + this.viewportHeight - 1 - margin) {
            this.scrollTop = visualLine - this.viewportHeight + 1 + margin;
        }

        // При wrap не гейтим: сеттер scrollLeft держит «wrap ⇒ 0», записи ниже — no-op.
        const lineContent = this.document.getLineContent(pos.line);
        const dl = this.displayLineFor(lineContent);
        const col = dl.offsetToColumn(pos.character);
        // На обрезанной строке — до последней клетки плашки «[…]», а не её обрезка у края.
        const revealCol = dl.isTruncated && col >= dl.displayWidth ? col + LONG_LINE_TRUNCATION_BADGE_WIDTH - 1 : col;
        if (col < this.scrollLeft) {
            this.scrollLeft = col;
        } else if (revealCol >= this.scrollLeft + this.viewportWidth) {
            this.scrollLeft = revealCol - this.viewportWidth + 1;
        }
    }

    private buildVisibleLines(): number[] {
        return this.buildProjection().rowDocLine;
    }

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

        const hiddenRanges: { from: number; to: number }[] = [];
        for (const region of this.foldedRegions) {
            if (region.isCollapsed) {
                hiddenRanges.push({ from: region.startLine + 1, to: region.endLine });
            }
        }

        hiddenRanges.sort((a, b) => a.from - b.from);

        const visible: number[] = [];
        const startOffsets: number[] = [];
        const breaksCache = wrapWidth >= 0 ? this.wrapBreaks(wrapWidth) : null;
        const hiddenIdx = 0;

        for (let line = 0; line < this.document.lineCount; line++) {
            let isHidden = false;
            for (let h = hiddenIdx; h < hiddenRanges.length; h++) {
                const range = hiddenRanges[h];
                if (line < range.from) {
                    break;
                }
                if (line >= range.from && line <= range.to) {
                    isHidden = true;
                    break;
                }
            }
            if (!isHidden) {
                visible.push(line);
                startOffsets.push(0);
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

        // Якоря после нормализации уникальны — первая встреченная строка зоны и есть её начало.
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
            // Коды зон отсеиваются сами: Int32Array по отрицательному индексу даёт undefined, а не -1.
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

    private previousVisibleLine(logicalLine: number): number {
        const { rowDocLine: visible, firstRowOfDocLine } = this.buildProjection();
        const currentIdx = firstRowOfDocLine[logicalLine];
        if (currentIdx > 0) {
            for (let i = currentIdx - 1; i >= 0; i--) {
                if (visible[i] >= 0) return visible[i];
            }
            return -1;
        }
        if (currentIdx === -1) {
            for (let i = visible.length - 1; i >= 0; i--) {
                if (visible[i] >= 0 && visible[i] < logicalLine) {
                    return visible[i];
                }
            }
        }
        return -1;
    }

    private nextVisibleLine(logicalLine: number): number {
        const { rowDocLine: visible, firstRowOfDocLine } = this.buildProjection();
        const currentIdx = firstRowOfDocLine[logicalLine];
        if (currentIdx >= 0) {
            // Ряды идут по возрастанию строк: `>` отсеивает и зоны, и wrap-фрагменты той же строки.
            for (let i = currentIdx + 1; i < visible.length; i++) {
                if (visible[i] > logicalLine) return visible[i];
            }
            return -1;
        }
        for (const vLine of visible) {
            if (vLine >= 0 && vLine > logicalLine) {
                return vLine;
            }
        }
        return -1;
    }

    /** Публичный: {@link UndoManager} применяет правки мимо {@link applyEdits} и обязан сдвинуть регионы так же. */
    public adjustFoldingRegionsForEdits(edits: readonly ITextEdit[]): void {
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

    private adjustFoldingRegionsForLineChange(editStartLine: number, editEndLine: number, lineDelta: number): void {
        this.adjustViewZonesForLineChange(editStartLine, editEndLine, lineDelta);
        this.foldedRegions = this.foldedRegions.filter((region) => {
            if (editStartLine > region.endLine) {
                return true;
            }

            if (editEndLine < region.startLine) {
                region.startLine += lineDelta;
                region.endLine += lineDelta;
                return true;
            }

            if (editStartLine <= region.startLine && editEndLine >= region.startLine) {
                return false;
            }

            if (editStartLine > region.startLine && editEndLine <= region.endLine) {
                region.endLine += lineDelta;
                return region.endLine > region.startLine;
            }

            /* v8 ignore start -- the fall-through else and the final `return true` are unreachable: reaching here needs editStartLine>endLine, but that case already returned at the "completely after" check */
            if (editStartLine > region.startLine && editStartLine <= region.endLine && editEndLine > region.endLine) {
                return false;
            }

            return true;
            /* v8 ignore stop */
        });
    }

    /**
     * Зоны переживают правки до пересчёта владельцем. Кэш и событие не трогаем: правка
     * уже меняет versionId и уведомляет рендер сама.
     */
    private adjustViewZonesForLineChange(editStartLine: number, editEndLine: number, lineDelta: number): void {
        if (this.viewZonesValue.length === 0 || lineDelta === 0) return;
        this.viewZonesValue = this.viewZonesValue.map((zone) => {
            if (zone.afterLine > editEndLine) {
                return { afterLine: zone.afterLine + lineDelta, size: zone.size };
            }
            if (zone.afterLine < editStartLine) return zone;
            const clamped = Math.max(editStartLine - 1, Math.min(zone.afterLine, editEndLine + lineDelta));
            return clamped === zone.afterLine ? zone : { afterLine: clamped, size: zone.size };
        });
    }

    private sortedSelections(): ISelection[] {
        return [...this.selections].sort((a, b) => {
            const rangeA = selectionToRange(a);
            const rangeB = selectionToRange(b);
            return comparePositions(rangeA.start, rangeB.start);
        });
    }

    private buildEditsFromSelections(textFor: (range: IRange) => string): ITextEdit[] {
        return this.sortedSelections().map((sel) => {
            const range = selectionToRange(sel);
            return createTextEdit(range, textFor(range));
        });
    }

    /**
     * Позиции — из ОБРАТНЫХ правок: их диапазон в координатах применённого документа ровно
     * накрывает вставленный текст, конец — каретка. Порядок документный, вызывающие зипают
     * по индексу со `sortedSelections()`. Арифметика по исходным координатам уводила каретки
     * за конец строки на многострочных батчах и роняла рендер.
     */
    private selectionsAfterEdits(inverseEdits: readonly ITextEdit[]): ISelection[] {
        return inverseEdits.map((inverse) =>
            createCursorSelection(inverse.range.end.line, inverse.range.end.character),
        );
    }

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

/** Один ведущий таб или до `tabSize` пробелов. */
function computeOutdentRemoval(content: string, tabSize: number): number {
    if (content.length === 0) return 0;
    if (content.startsWith("\t")) return 1;
    let count = 0;
    while (count < tabSize && content[count] === " ") {
        count++;
    }
    return count;
}

function firstNonWhitespaceIndex(content: string): number {
    for (let i = 0; i < content.length; i++) {
        if (!/\s/.test(content[i])) return i;
    }
    return content.length;
}

/**
 * Батч удаляющих правок в документном порядке: начало поднимается до конца предыдущей,
 * накрытая целиком выбрасывается. Перекрытия (две каретки в одном слове) `applyEdits`
 * документа не переносит: съедал «hello wo» вместо «hello» и давал отрицательные колонки.
 * Слияние — поведение vscode.
 */
function clipDeletionOverlaps(edits: readonly ITextEdit[]): ITextEdit[] {
    const clipped: ITextEdit[] = [];
    let previousEnd: IPosition | null = null;
    for (const edit of edits) {
        const limit = previousEnd ?? edit.range.start;
        // Stryker disable next-line EqualityOperator: на равенстве обе ветки дают одну и ту же позицию (`limit` и есть `edit.range.start`), мутант `<` → `<=` эквивалентен
        const start = comparePositions(edit.range.start, limit) < 0 ? limit : edit.range.start;
        if (comparePositions(start, edit.range.end) >= 0) continue;
        clipped.push(
            createTextEdit(
                createRange(start.line, start.character, edit.range.end.line, edit.range.end.character),
                edit.text,
            ),
        );
        previousEnd = edit.range.end;
    }
    return clipped;
}

/** Как VS Code Ctrl+Left: пробелы, затем символы одного класса. */
function findWordBoundaryLeft(line: string, offset: number): number {
    let pos = offset;
    while (pos > 0 && charClass(line[pos - 1]) === 0) {
        pos--;
    }
    if (pos === 0) return 0;
    const cls = charClass(line[pos - 1]);
    while (pos > 0 && charClass(line[pos - 1]) === cls) {
        pos--;
    }
    return pos;
}

/** Как VS Code Ctrl+Right: символы одного класса, затем пробелы. */
function findWordBoundaryRight(line: string, offset: number): number {
    let pos = offset;
    const len = line.length;
    /* v8 ignore start -- unreachable via callers: both cursorWordRight and deleteWordRight only call this when offset < line length */
    if (pos >= len) return len;
    /* v8 ignore stop */
    const cls = charClass(line[pos]);
    while (pos < len && charClass(line[pos]) === cls) {
        pos++;
    }
    while (pos < len && charClass(line[pos]) === 0) {
        pos++;
    }
    return pos;
}

/** `-(afterLine + 3)`: `-1` остаётся сентинелом «не найдено», якорь `-1` кодируется `-2`. */
function encodeViewZoneRow(afterLine: number): number {
    return -(afterLine + 3);
}

function decodeViewZoneAnchor(row: number): number {
    // `-3 - row`, а не `-(row + 3)`: последнее для якоря 0 дало бы -0.
    return -3 - row;
}

/**
 * Зона встаёт после последней видимой строки с `docLine <= afterLine`: скрытый свёрткой
 * якорь не теряет зону — дифф обязан держать выравнивание (upstream: `showInHiddenAreas`).
 * У промежуточных wrap-фрагментов `next === visible[i]` — зона встаёт только после последнего.
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
