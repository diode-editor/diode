import type { TUIElement } from "@tuidom/core/dom/tuiElement";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { DefaultLinesDiffComputer } from "../../../../editor/common/diff/defaultLinesDiffComputer/defaultLinesDiffComputer.ts";
import { DiffInnerRanges } from "../../../../editor/common/diff/diffInnerRanges.ts";
import type { DiffSide } from "../../../../editor/common/diff/diffSide.ts";
import type { IDiffV2SideLayout } from "../../../../editor/common/diff/diffV2Layout.ts";
import {
    computeDiffV2Layout,
    computeInlineLayout,
    mergeZoneDecorationsByAnchor,
} from "../../../../editor/common/diff/diffV2Layout.ts";
import { DiffViewModel } from "../../../../editor/common/diff/diffViewModel.ts";
import type { DetailedLineRangeMapping } from "../../../../editor/common/diff/rangeMapping.ts";
import type { ILanguageService } from "../../../../editor/common/languages/iLanguageService.ts";
import type { ITokenStyleResolver } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import type { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { IFileService } from "../../../../platform/files/common/files.ts";
import type { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { SyntheticTextModel } from "../../../common/editor/syntheticTextModel.ts";
import type { BaseTextEditorModel } from "../../../common/editor/textEditorModel.ts";
import type { TextFileModel } from "../../../services/textfile/common/textFileModel.ts";
import type { ITextFileModelReference } from "../../../services/textfile/common/textFileModelRegistry.ts";
import { Component } from "../../component.ts";

import type { DiffPaneMode, DiffPaneModeOverride } from "./diffPaneElement.ts";
import { DiffPaneElement } from "./diffPaneElement.ts";
import { EditorComponent } from "./editorComponent.ts";
import type { IEditorPane } from "./iEditorPane.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/** Максимум времени на дифф; сверх — грубый результат вместо залипшей вкладки. */
const MAX_DIFF_COMPUTATION_MS = 2000;

const EOL_SPLIT = /\r\n|\n/;

/** Значение VS Code `diffEditorViewModel`, совпадает с QuickDiff. */
export const DIFF_RECOMPUTE_DEBOUNCE_MS = 200;

/**
 * `shared` — общая модель файла из реестра `EditorService`: правки и undo общие с
 * обычными вкладками; `owned` — модель панели (untitled-стороны); `snapshot` —
 * read-only снимок, меняется только {@link DiffEditorPane2.replaceSnapshotContent}.
 */
export type DiffV2SideSource =
    | { readonly kind: "shared"; readonly ref: ITextFileModelReference }
    | { readonly kind: "owned"; readonly model: TextFileModel }
    | { readonly kind: "snapshot"; readonly text: string };

export interface IDiffEditorPane2Input {
    /** Он же идентичность вкладки в группе. */
    readonly uri: Uri;
    readonly label: string;
    readonly originalLabel: string;
    readonly modifiedLabel: string;
    readonly original: DiffV2SideSource;
    readonly modified: DiffV2SideSource;
    /** Только для snapshot-сторон: у моделей язык свой. */
    readonly languageId: string;
    /** Сторона может не существовать как ресурс (Clipboard). */
    readonly originalUri?: Uri;
    readonly modifiedUri?: Uri;
    readonly debounceMs?: number;
    readonly modeOverride?: DiffPaneModeOverride;
}

const EMPTY_SIDE_LAYOUT: IDiffV2SideLayout = { zones: [], foldingRegions: [], decorations: {} };

/**
 * Композиция двух настоящих редакторов (`TextEditorPane` на сторону): выравнивание —
 * зоны, свёртка unchanged — фолдинг, подсветка — внешние декорации. Поэтому каретка,
 * копирование и команды — код редактора, а не вторая реализация.
 */
export class DiffEditorPane2 extends Component implements IEditorPane {
    public readonly uri: Uri;
    public readonly label: string;
    public readonly view: TUIElement;
    public readonly originalUri: Uri | null;
    public readonly modifiedUri: Uri | null;

    private readonly sides: Record<DiffSide, TextEditorPane>;
    private readonly sideKinds: Record<DiffSide, DiffV2SideSource["kind"]>;
    private readonly snapshotModels: Partial<Record<DiffSide, SyntheticTextModel>> = {};
    private activeSideValue: DiffSide = "modified";
    private regionPairs: { original: number; modified: number; collapsed: boolean }[] = [];
    private layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null = null;
    private changes: readonly DetailedLineRangeMapping[] = [];
    /** Реэнтрантный гард зеркалирования скролла и фолд-синка. */
    private syncing = false;
    private readonly viewSyncSubscriptions: Record<DiffSide, IDisposable | null> = { original: null, modified: null };
    private recomputeTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly debounceMs: number;
    private readonly paneElement: DiffPaneElement;
    private paneDisposed = false;

    public constructor(
        private readonly languageService: ILanguageService,
        private readonly undoRedoService: UndoRedoService,
        // Стороны-снимки синтетические и на диск не пишут; сервис нужен модели по контракту.
        private readonly files: IFileService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPane2Input,
    ) {
        super();
        this.uri = input.uri;
        this.label = input.label;
        this.originalUri = input.originalUri ?? null;
        this.modifiedUri = input.modifiedUri ?? null;
        this.debounceMs = input.debounceMs ?? DIFF_RECOMPUTE_DEBOUNCE_MS;
        this.sideKinds = { original: input.original.kind, modified: input.modified.kind };

        this.sides = {
            original: this.createSide("original", tokenizationRegistry, tokenStyleResolver, input),
            modified: this.createSide("modified", tokenizationRegistry, tokenStyleResolver, input),
        };
        this.paneElement = new DiffPaneElement(this.sides.original.component.view, this.sides.modified.component.view, {
            original: input.originalLabel,
            modified: input.modifiedLabel,
        });
        this.view = this.paneElement;
        this.view.id = "diffEditorV2";
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        // Одна полоса прокрутки на пару: скролл синхронен, левая была бы дублем
        // и съедала бы колонку текста.
        this.sides.original.component.view.verticalScrollBar = "never";
        // Смену режима элемент объявляет из layout — зоны перекладываем
        // ОТЛОЖЕННО: правка зон прямо из layout оставила бы корень
        // layout-грязным после кадра (dirty-гейт TuiApplication).
        this.paneElement.onDidChangeMode = () => {
            queueMicrotask(() => {
                if (this.paneDisposed) return;
                this.handleModeChange();
            });
        };
        if (input.modeOverride !== undefined) this.paneElement.setModeOverride(input.modeOverride);

        this.recomputeLayout({ preserveView: false });
        this.wireSync();
        this.wireLiveness();

        this.register({
            dispose: () => {
                this.paneDisposed = true;
                if (this.recomputeTimer !== undefined) clearTimeout(this.recomputeTimer);
                this.viewSyncSubscriptions.original?.dispose();
                this.viewSyncSubscriptions.modified?.dispose();
                // Компонент и модель (или ссылку реестра) освобождает сама сторона.
                this.sides.original.dispose();
                this.sides.modified.dispose();
                // view из дерева НЕ отцепляем: как и у первой панели, это
                // делает контент-слот группы при смене контента.
            },
        });
    }

    private createSide(
        side: DiffSide,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPane2Input,
    ): TextEditorPane {
        const source = input[side];
        let model: BaseTextEditorModel;
        let ownership: IDisposable | undefined;
        if (source.kind === "shared") {
            model = source.ref.model;
            ownership = source.ref;
        } else if (source.kind === "owned") {
            model = source.model;
        } else {
            const snapshot = new SyntheticTextModel(
                this.languageService,
                this.undoRedoService,
                Uri.from({ scheme: "diode-diff-side", path: input.uri.path, query: input.uri.query, fragment: side }),
                input.languageId,
            );
            snapshot.replaceContent(source.text);
            this.snapshotModels[side] = snapshot;
            model = snapshot;
        }
        const component = new EditorComponent(tokenizationRegistry, tokenStyleResolver, model);
        component.foldingOwnedExternally = true;
        const pane = new TextEditorPane(model, component, ownership);
        pane.detached = true;
        // Стороны выравниваются по view-строкам через зоны — wrap развёл бы их
        // (docs/TODO/WordWrap.md); wrap в диффе — non-goal (docs/TODO/Diff.md).
        pane.wordWrapForcedOff = true;
        pane.labelOverride = side === "original" ? input.originalLabel : input.modifiedLabel;
        pane.readOnly = source.kind === "snapshot";
        return pane;
    }

    public snapshotSides(): DiffSide[] {
        return (["original", "modified"] as const).filter((side) => this.sideKinds[side] === "snapshot");
    }

    /** Неизменившийся текст — no-op: замена пересоздаёт view-state и потеряла бы каретку. */
    public replaceSnapshotContent(side: DiffSide, text: string): void {
        const snapshot = this.snapshotModels[side];
        if (snapshot === undefined || snapshot.getText() === text) return;
        // Раскладку на замену содержимого целиком перезальёт wireLiveness.
        snapshot.replaceContent(text);
    }

    public sidePanes(): readonly TextEditorPane[] {
        return [this.sides.original, this.sides.modified];
    }

    public get mode(): DiffPaneMode {
        return this.paneElement.mode;
    }

    public setModeOverride(override: DiffPaneModeOverride): void {
        this.paneElement.setModeOverride(override);
    }

    /** `hidden` фокус не двигает — переносим явно, иначе ввод ушёл бы в невидимый редактор. */
    private handleModeChange(): void {
        if (this.paneElement.mode === "inline" && this.activeSideValue === "original") {
            this.activeSideValue = "modified";
            const focused = this.sides.original.component.view.getRoot()?.focusManager?.activeElement;
            if (focused?.getAncestorPath().includes(this.sides.original.component.view) === true) {
                this.sides.modified.component.focus();
            }
        }
        this.recomputeLayout({ preserveView: true });
    }

    /**
     * Как VS Code `diffEditor.revert`. У пустого на этой стороне диапазона якорь —
     * строка перед местом изменения, как у зоны-филлера.
     */
    public revertHunkAtCaret(): "reverted" | "no-hunk" | "read-only" {
        if (this.sides.modified.readOnly) return "read-only";
        const change = this.hunkAtCaret();
        if (change === null) return "no-hunk";

        const originalLines = this.sides.original.model
            .getText()
            .split(EOL_SPLIT)
            .slice(change.original.startLineNumber - 1, change.original.endLineNumberExclusive - 1);
        this.sides.modified.applyExternalEdits(
            [buildLineReplaceEdit(this.sides.modified.model.document, change.modified, originalLines)],
            "diff.revertHunk",
        );
        return "reverted";
    }

    private hunkAtCaret(): DetailedLineRangeMapping | null {
        const side = this.activeSide;
        const caret = this.sides[side].primaryCursorLine;
        return (
            this.changes.find((change) => {
                const own = side === "original" ? change.original : change.modified;
                const start = own.startLineNumber - 1;
                const endExclusive = own.endLineNumberExclusive - 1;
                if (endExclusive > start) return caret >= start && caret < endExclusive;
                return caret === Math.max(0, endExclusive - 1);
            }) ?? null
        );
    }

    /** Подписки — на моделях сторон: переживают Save As со сменой uri. */
    private wireLiveness(): void {
        for (const side of ["original", "modified"] as const) {
            this.register(
                this.sides[side].model.onDidChangeContent(() => {
                    this.scheduleRecompute();
                }),
            );
            // Замена содержимого целиком — раскладка сразу, без паузы набора: прежняя
            // ничего не говорит о новом тексте.
            this.register(
                this.sides[side].model.document.onDidChangeContent((change) => {
                    if (change.isFlush === true) this.recomputeLayout({ preserveView: true });
                }),
            );
        }
    }

    private scheduleRecompute(): void {
        if (this.recomputeTimer !== undefined) clearTimeout(this.recomputeTimer);
        this.recomputeTimer = setTimeout(() => {
            this.recomputeTimer = undefined;
            this.recomputeLayout({ preserveView: true });
        }, this.debounceMs);
    }

    /**
     * `preserveView`: свёрнутость переносится со старых пар, скролл якорится по
     * документной строке (проекция doc↔view меняется вместе с зонами), каретки не
     * трогаются — позиции документные.
     */
    private recomputeLayout({ preserveView }: { preserveView: boolean }): void {
        const originalLines = this.sides.original.model.document.getLinesContent();
        const modifiedLines = this.sides.modified.model.document.getLinesContent();

        this.syncing = true;
        try {
            // Вьюпорт на самом верху остаётся на самом верху: якорение по
            // документной строке утащило бы его ПОД зону над первой строкой
            // (нотис «The files are identical»), появившуюся этим пересчётом.
            const scrollTopBefore = this.sides.modified.viewState.scrollTop;
            const anchorDocLine =
                preserveView && scrollTopBefore > 0
                    ? this.sides.modified.viewState.docLineForViewLine(scrollTopBefore)
                    : null;

            const diff = new DefaultLinesDiffComputer().computeDiff(originalLines, modifiedLines, {
                ignoreTrimWhitespace: false,
                maxComputationTimeMs: MAX_DIFF_COMPUTATION_MS,
                computeMoves: false,
            });
            const model = new DiffViewModel(diff.changes, originalLines.length, modifiedLines.length, {
                hideUnchangedRegions: true,
            });
            this.changes = diff.changes;
            const previous = { pairs: this.regionPairs, layout: this.layout };
            const innerRanges = new DiffInnerRanges(diff.changes);
            // Скрытой стороне заливается пустота, чтобы возврат в side-by-side не
            // встретил устаревшие зоны/фолды.
            this.layout =
                this.paneElement.mode === "inline"
                    ? {
                          original: EMPTY_SIDE_LAYOUT,
                          modified: computeInlineLayout(
                              diff.changes,
                              model.regions,
                              innerRanges,
                              modifiedLines.length,
                              originalLines,
                          ),
                      }
                    : computeDiffV2Layout(diff.changes, model.regions, innerRanges, {
                          original: originalLines.length,
                          modified: modifiedLines.length,
                      });
            this.regionPairs = this.buildRegionPairs(preserveView ? previous : null);
            this.applySideLayout("original");
            this.applySideLayout("modified");

            if (anchorDocLine !== null) {
                const viewLine = this.sides.modified.viewState.logicalToVisualLine(anchorDocLine);
                if (viewLine >= 0) {
                    this.sides.modified.viewState.scrollTop = viewLine;
                    this.sides.original.viewState.scrollTop = viewLine;
                }
            }
        } finally {
            this.syncing = false;
        }
    }

    /**
     * Свёрнутость переносится по пересечению диапазонов, новые куски свёрнуты.
     * Кусок, накрывший каретку, разворачивается: `setFoldingRegions` каретку не переносит.
     */
    private buildRegionPairs(
        previous: {
            pairs: { original: number; modified: number; collapsed: boolean }[];
            layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null;
        } | null,
    ): { original: number; modified: number; collapsed: boolean }[] {
        const layout = this.layout;
        /* v8 ignore start -- defensive: зовётся только после computeDiffV2Layout */
        if (layout === null) return [];
        /* v8 ignore stop */
        // Первичны регионы modified: в inline у original их нет вовсе (сторона
        // скрыта, раскладка пустая) — пара тогда вырождается в modified-координаты.
        return layout.modified.foldingRegions.map((modifiedRegion, i) => {
            const originalRegion =
                (layout.original.foldingRegions[i] as (typeof layout.original.foldingRegions)[number] | undefined) ??
                null;
            let collapsed = previous === null ? true : this.carryCollapsed(previous, originalRegion, modifiedRegion);
            if (
                (originalRegion !== null && this.caretInsideHiddenPart("original", originalRegion)) ||
                this.caretInsideHiddenPart("modified", modifiedRegion)
            ) {
                collapsed = false;
            }
            return {
                original: (originalRegion ?? modifiedRegion).startLine,
                modified: modifiedRegion.startLine,
                collapsed,
            };
        });
    }

    /**
     * По original сравнивается, только когда координаты есть у обоих поколений:
     * inline не держит original-регионов.
     */
    private carryCollapsed(
        previous: {
            pairs: { original: number; modified: number; collapsed: boolean }[];
            layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null;
        },
        originalRegion: { startLine: number; endLine: number } | null,
        modifiedRegion: { startLine: number; endLine: number },
    ): boolean {
        /* v8 ignore start -- defensive: prev-раскладка есть у любой живой панели */
        if (previous.layout === null) return true;
        /* v8 ignore stop */
        let best: { overlap: number; collapsed: boolean } | null = null;
        for (let i = 0; i < previous.pairs.length; i++) {
            const prevOriginal = previous.layout.original.foldingRegions[i] as
                | { startLine: number; endLine: number }
                | undefined;
            const prevModified = previous.layout.modified.foldingRegions[i];
            const originalOverlap =
                originalRegion !== null && prevOriginal !== undefined ? rangeOverlap(originalRegion, prevOriginal) : 0;
            const overlap = originalOverlap + rangeOverlap(modifiedRegion, prevModified);
            if (overlap > 0 && (best === null || overlap > best.overlap)) {
                best = { overlap, collapsed: previous.pairs[i].collapsed };
            }
        }
        return best?.collapsed ?? true;
    }

    /** Каретка стороны — строго внутри скрытой части региона (заголовок видим). */
    private caretInsideHiddenPart(side: DiffSide, region: { startLine: number; endLine: number }): boolean {
        const caret = this.sides[side].primaryCursorLine;
        return caret > region.startLine && caret <= region.endLine;
    }

    private applySideLayout(side: DiffSide): void {
        const layout = this.layout;
        /* v8 ignore start -- defensive: зовётся только после recomputeLayout */
        if (layout === null) return;
        /* v8 ignore stop */
        const sideLayout = layout[side];
        const viewState = this.sides[side].viewState;

        const collapsedByStart = new Map(this.regionPairs.map((pair) => [pair[side], pair.collapsed]));
        const folding = sideLayout.foldingRegions.map((region) => ({
            startLine: region.startLine,
            endLine: region.endLine,
            /* v8 ignore start -- ?? недостижим: пары построены из этих же регионов */
            isCollapsed: collapsedByStart.get(region.startLine) ?? true,
            /* v8 ignore stop */
        }));
        viewState.setFoldingRegions(folding);

        // Плашка живёт только у свёрнутого куска: развёрнутый показывает сами
        // строки, и парная зона с обеих сторон исчезает согласованно. Текстовая
        // зона ВНЕ регионов (нотис «The files are identical») живёт всегда.
        const plaqueAnchors = new Set(
            sideLayout.decorations.zones
                ?.filter((zone) => zone.text !== undefined)
                /* v8 ignore start -- ?? недостижим: computeSide всегда отдаёт массив зон-декораций */
                .map((zone) => zone.afterLine) ?? [],
            /* v8 ignore stop */
        );
        const insideRegion = new Set<number>();
        const collapsedPlaques = new Set<number>();
        for (let i = 0; i < sideLayout.foldingRegions.length; i++) {
            for (const anchor of plaqueAnchors) {
                if (anchor >= folding[i].startLine && anchor <= folding[i].endLine) {
                    insideRegion.add(anchor);
                    if (folding[i].isCollapsed) collapsedPlaques.add(anchor);
                }
            }
        }
        const plaqueVisible = (anchor: number): boolean => !insideRegion.has(anchor) || collapsedPlaques.has(anchor);
        viewState.setViewZones(
            sideLayout.zones.filter((zone) => !plaqueAnchors.has(zone.afterLine) || plaqueVisible(zone.afterLine)),
        );
        // Плашка и зона-призрак inline-ганка могут делить якорь — содержимое
        // склеивается в одну многострочную декорацию (setViewZones сливает
        // такие зоны, а рендер адресует декорации по якорю).
        this.sides[side].component.setDecorations({
            ...sideLayout.decorations,
            zones: mergeZoneDecorationsByAnchor(
                sideLayout.decorations.zones?.filter(
                    (zone) => zone.text === undefined || plaqueVisible(zone.afterLine),
                ) ?? [],
            ),
        });
    }

    private wireSync(): void {
        for (const side of ["original", "modified"] as const) {
            this.wireViewSync(side);
            // Активная сторона — по фокусу внутри её view (ScrollBarDecorator
            // переживает пересоздание EditorElement, слушатель ставится один раз).
            this.sides[side].component.view.addEventListener(
                "focus",
                () => {
                    this.activeSideValue = side;
                },
                { capture: true },
            );
        }
    }

    /** Перечитка документа пересоздаёт view-state — без перевешивания синк молча отваливается. */
    private wireViewSync(side: DiffSide): void {
        const other: DiffSide = side === "original" ? "modified" : "original";
        this.viewSyncSubscriptions[side]?.dispose();
        this.viewSyncSubscriptions[side] = this.sides[side].viewState.onDidChangeView(() => {
            if (this.syncing) return;
            this.syncing = true;
            try {
                this.syncFoldingFrom(side);
                this.sides[other].viewState.scrollTop = this.sides[side].viewState.scrollTop;
                this.sides[other].viewState.scrollLeft = this.sides[side].viewState.scrollLeft;
            } finally {
                this.syncing = false;
            }
        });
    }

    private syncFoldingFrom(side: DiffSide): void {
        const own = this.sides[side].viewState.foldedRegions;
        let changed = false;
        for (const pair of this.regionPairs) {
            const region = own.find((r) => r.startLine === pair[side]);
            if (region !== undefined && region.isCollapsed !== pair.collapsed) {
                pair.collapsed = region.isCollapsed;
                changed = true;
            }
        }
        if (changed) {
            this.applySideLayout("original");
            this.applySideLayout("modified");
        }
    }

    public get isModified(): boolean {
        return this.sides.original.isModified || this.sides.modified.isModified;
    }

    /** Замок на табе — только когда заперты обе стороны (чистый снимок). */
    public get readOnly(): boolean {
        return this.sides.original.readOnly && this.sides.modified.readOnly;
    }

    /** Сторона, в которой живут каретка и команды; в inline это всегда modified. */
    public get activeSide(): DiffSide {
        return this.paneElement.mode === "inline" ? "modified" : this.activeSideValue;
    }

    public get activeTextPane(): TextEditorPane {
        return this.sides[this.activeSide];
    }

    public onDidChangeState(cb: () => void): IDisposable {
        const subscriptions = [this.sides.original.onDidChangeState(cb), this.sides.modified.onDidChangeState(cb)];
        return {
            dispose: () => {
                for (const subscription of subscriptions) subscription.dispose();
            },
        };
    }

    public focusEditor(): void {
        this.sides[this.activeSide].component.focus();
    }

    public get viewState(): EditorViewState {
        return this.sides[this.activeSide].viewState;
    }

    public getSelectedTexts(): string[] {
        // Плейсхолдеров и филлеров в тексте сторон нет — фильтровать нечего.
        return this.viewState.getSelectedTexts();
    }
}

function rangeOverlap(a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }): number {
    return Math.max(0, Math.min(a.endLine, b.endLine) - Math.max(a.startLine, b.startLine) + 1);
}

/**
 * 1-based LineRange движка → символьный ITextEdit. Удаление съедает ровно один
 * разделитель строк, вставка добавляет свой.
 */
function buildLineReplaceEdit(
    document: { lineCount: number; getLineLength(line: number): number },
    range: { startLineNumber: number; endLineNumberExclusive: number },
    lines: readonly string[],
): ITextEdit {
    const start = range.startLineNumber - 1;
    const endExclusive = range.endLineNumberExclusive - 1;
    const at = (line: number, character: number): { line: number; character: number } => ({ line, character });

    if (endExclusive === start) {
        // Вставка перед строкой start; за концом файла — в хвост последней строки.
        if (start < document.lineCount) {
            return { range: { start: at(start, 0), end: at(start, 0) }, text: `${lines.join("\n")}\n` };
        }
        const last = document.lineCount - 1;
        const lastLength = document.getLineLength(last);
        return { range: { start: at(last, lastLength), end: at(last, lastLength) }, text: `\n${lines.join("\n")}` };
    }

    if (lines.length === 0) {
        // Удаление строк [start..endExclusive): у хвостового блока разделитель
        // съедается слева, иначе — справа.
        if (endExclusive < document.lineCount) {
            return { range: { start: at(start, 0), end: at(endExclusive, 0) }, text: "" };
        }
        /* v8 ignore start -- start === 0 недостижим: удаление всего файла означало бы
           пустой original-диапазон при пустом original-файле, а у TextDocument минимум
           одна строка — такой ганк движок строит как замену, не вставку */
        const from = start > 0 ? at(start - 1, document.getLineLength(start - 1)) : at(0, 0);
        /* v8 ignore stop */
        return {
            range: { start: from, end: at(endExclusive - 1, document.getLineLength(endExclusive - 1)) },
            text: "",
        };
    }

    return {
        range: { start: at(start, 0), end: at(endExclusive - 1, document.getLineLength(endExclusive - 1)) },
        text: lines.join("\n"),
    };
}
