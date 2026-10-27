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
import type { LanguageFeatureRegistry } from "../../../../editor/common/languageFeatureRegistry.ts";
import type { DocumentColorProvider } from "../../../../editor/common/languages/iColorSource.ts";
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
import { DEFAULT_EDITOR_ID, type IEditorPane } from "./iEditorPane.ts";
import { TextEditorPane } from "./textEditorPane.ts";

/** Time budget for the diff; past it we take a coarse result instead of a hung tab. */
const MAX_DIFF_COMPUTATION_MS = 2000;

const EOL_SPLIT = /\r\n|\n/;

/** Same value as upstream `diffEditorViewModel`; matches QuickDiff. */
export const DIFF_RECOMPUTE_DEBOUNCE_MS = 200;

/**
 * `shared` — the file model from the `EditorService` registry: edits and undo are shared with
 * regular tabs; `owned` — a model owned by the pane (untitled sides); `snapshot` — a
 * read-only snapshot, changed only by {@link DiffEditorPane2.replaceSnapshotContent}.
 */
export type DiffV2SideSource =
    | { readonly kind: "shared"; readonly ref: ITextFileModelReference }
    | { readonly kind: "owned"; readonly model: TextFileModel }
    | { readonly kind: "snapshot"; readonly text: string };

export interface IDiffEditorPane2Input {
    /** Also the tab's identity within the group. */
    readonly uri: Uri;
    readonly label: string;
    readonly originalLabel: string;
    readonly modifiedLabel: string;
    readonly original: DiffV2SideSource;
    readonly modified: DiffV2SideSource;
    /** Only for snapshot sides: models carry their own language. */
    readonly languageId: string;
    /** A side may not exist as a resource (Clipboard). */
    readonly originalUri?: Uri;
    readonly modifiedUri?: Uri;
    readonly debounceMs?: number;
    readonly modeOverride?: DiffPaneModeOverride;
}

const EMPTY_SIDE_LAYOUT: IDiffV2SideLayout = { zones: [], foldingRegions: [], decorations: {} };

/**
 * Composes two real editors (one `TextEditorPane` per side): alignment is view zones,
 * collapsing unchanged regions is folding, highlighting is external decorations. So the cursor,
 * copying and commands are the editor's own code, not a second implementation.
 */
export class DiffEditorPane2 extends Component implements IEditorPane {
    public readonly uri: Uri;
    public readonly label: string;
    public readonly view: TUIElement;
    // Upstream: both sides share the editor id; ours are always text sides.
    public readonly editorId = DEFAULT_EDITOR_ID;
    public readonly originalUri: Uri | null;
    public readonly modifiedUri: Uri | null;

    private readonly sides: Record<DiffSide, TextEditorPane>;
    private readonly sideKinds: Record<DiffSide, DiffV2SideSource["kind"]>;
    private readonly snapshotModels: Partial<Record<DiffSide, SyntheticTextModel>> = {};
    private activeSideValue: DiffSide = "modified";
    private regionPairs: { original: number; modified: number; collapsed: boolean }[] = [];
    private layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null = null;
    private changes: readonly DetailedLineRangeMapping[] = [];
    /** Reentrancy guard for scroll mirroring and folding sync. */
    private syncing = false;
    private readonly viewSyncSubscriptions: Record<DiffSide, IDisposable | null> = { original: null, modified: null };
    private recomputeTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly debounceMs: number;
    private readonly paneElement: DiffPaneElement;
    private paneDisposed = false;

    public constructor(
        private readonly languageService: ILanguageService,
        private readonly undoRedoService: UndoRedoService,
        // Snapshot sides are synthetic and never write to disk; the model needs the service by contract.
        private readonly files: IFileService,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPane2Input,
        colorProviders?: LanguageFeatureRegistry<DocumentColorProvider>,
    ) {
        super();
        this.uri = input.uri;
        this.label = input.label;
        this.originalUri = input.originalUri ?? null;
        this.modifiedUri = input.modifiedUri ?? null;
        this.debounceMs = input.debounceMs ?? DIFF_RECOMPUTE_DEBOUNCE_MS;
        this.sideKinds = { original: input.original.kind, modified: input.modified.kind };

        this.sides = {
            original: this.createSide("original", tokenizationRegistry, tokenStyleResolver, input, colorProviders),
            modified: this.createSide("modified", tokenizationRegistry, tokenStyleResolver, input, colorProviders),
        };
        this.paneElement = new DiffPaneElement(this.sides.original.component.view, this.sides.modified.component.view, {
            original: input.originalLabel,
            modified: input.modifiedLabel,
        });
        this.view = this.paneElement;
        this.view.id = "diffEditorV2";
        this.view.style = { fg: "editor.foreground", bg: "editor.background" };
        // One scrollbar per pair: scrolling is synced, so a left one would be a duplicate
        // eating a text column.
        this.sides.original.component.view.verticalScrollBar = "never";
        // The element reports mode changes from layout — re-lay out zones
        // DEFERRED: changing zones right inside layout would leave the root
        // layout-dirty after the frame (TuiApplication dirty gate).
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
                // Each side disposes its own component and model (or registry reference).
                this.sides.original.dispose();
                this.sides.modified.dispose();
                // Do NOT detach the view from the tree: as with the first pane, the group's
                // content slot does that when the content changes.
            },
        });
    }

    private createSide(
        side: DiffSide,
        tokenizationRegistry: TokenizationRegistry,
        tokenStyleResolver: ITokenStyleResolver,
        input: IDiffEditorPane2Input,
        colorProviders: LanguageFeatureRegistry<DocumentColorProvider> | undefined,
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
        const component = new EditorComponent(
            tokenizationRegistry,
            tokenStyleResolver,
            model,
            undefined,
            undefined,
            undefined,
            undefined,
            colorProviders,
        );
        component.foldingOwnedExternally = true;
        const pane = new TextEditorPane(model, component, ownership);
        pane.detached = true;
        // Sides are aligned by view lines via zones — wrapping would misalign them
        // (docs/TODO/WordWrap.md); wrap in the diff is a non-goal (docs/TODO/Diff.md).
        pane.wordWrapForcedOff = true;
        pane.labelOverride = side === "original" ? input.originalLabel : input.modifiedLabel;
        pane.readOnly = source.kind === "snapshot";
        return pane;
    }

    public snapshotSides(): DiffSide[] {
        return (["original", "modified"] as const).filter((side) => this.sideKinds[side] === "snapshot");
    }

    /** Unchanged text is a no-op: replacing recreates the view state and would lose the cursor. */
    public replaceSnapshotContent(side: DiffSide, text: string): void {
        const snapshot = this.snapshotModels[side];
        if (snapshot === undefined || snapshot.getText() === text) return;
        // wireLiveness recomputes the layout on a full content replace.
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

    /** `hidden` does not move focus — move it explicitly, or input would go to an invisible editor. */
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
     * Like upstream `diffEditor.revert`. A range that is empty on this side is anchored at
     * the line before the change, same as a filler zone.
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

    /** Subscribes on the side models so it survives Save As with a uri change. */
    private wireLiveness(): void {
        for (const side of ["original", "modified"] as const) {
            this.register(
                this.sides[side].model.onDidChangeContent(() => {
                    this.scheduleRecompute();
                }),
            );
            // A full content replace recomputes the layout right away, without the typing debounce:
            // the old layout says nothing about the new text.
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
     * `preserveView`: collapsed state carries over from the old pairs, scroll is anchored to
     * a document line (the doc↔view projection changes along with zones), cursors are left
     * alone — their positions are in document coordinates.
     */
    private recomputeLayout({ preserveView }: { preserveView: boolean }): void {
        const originalLines = this.sides.original.model.document.getLinesContent();
        const modifiedLines = this.sides.modified.model.document.getLinesContent();

        this.syncing = true;
        try {
            // A viewport at the very top stays at the very top: anchoring to a
            // document line would push it BELOW a zone above the first line
            // (the "The files are identical" notice) that this recompute added.
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
            // The hidden side gets an empty layout so that switching back to side-by-side
            // does not hit stale zones/folds.
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
     * Collapsed state carries over by range overlap; new regions start collapsed.
     * A region covering the cursor is expanded: `setFoldingRegions` does not move the cursor.
     */
    private buildRegionPairs(
        previous: {
            pairs: { original: number; modified: number; collapsed: boolean }[];
            layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null;
        } | null,
    ): { original: number; modified: number; collapsed: boolean }[] {
        const layout = this.layout;
        /* v8 ignore start -- defensive: only called after computeDiffV2Layout */
        if (layout === null) return [];
        /* v8 ignore stop */
        // Modified regions are primary: in inline mode original has none at all (the side
        // is hidden, its layout empty) — the pair then degenerates to modified coordinates.
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
     * Original is compared only when both generations have its coordinates:
     * inline mode keeps no original regions.
     */
    private carryCollapsed(
        previous: {
            pairs: { original: number; modified: number; collapsed: boolean }[];
            layout: { original: IDiffV2SideLayout; modified: IDiffV2SideLayout } | null;
        },
        originalRegion: { startLine: number; endLine: number } | null,
        modifiedRegion: { startLine: number; endLine: number },
    ): boolean {
        /* v8 ignore start -- defensive: every live pane has a previous layout */
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

    /** The side's cursor is strictly inside the hidden part of the region (the header line is visible). */
    private caretInsideHiddenPart(side: DiffSide, region: { startLine: number; endLine: number }): boolean {
        const caret = this.sides[side].primaryCursorLine;
        return caret > region.startLine && caret <= region.endLine;
    }

    private applySideLayout(side: DiffSide): void {
        const layout = this.layout;
        /* v8 ignore start -- defensive: only called after recomputeLayout */
        if (layout === null) return;
        /* v8 ignore stop */
        const sideLayout = layout[side];
        const viewState = this.sides[side].viewState;

        const collapsedByStart = new Map(this.regionPairs.map((pair) => [pair[side], pair.collapsed]));
        const folding = sideLayout.foldingRegions.map((region) => ({
            startLine: region.startLine,
            endLine: region.endLine,
            /* v8 ignore start -- ?? unreachable: the pairs are built from these same regions */
            isCollapsed: collapsedByStart.get(region.startLine) ?? true,
            /* v8 ignore stop */
        }));
        viewState.setFoldingRegions(folding);

        // A plaque exists only on a collapsed region: an expanded one shows the lines
        // themselves, and the paired zone disappears on both sides together. A text
        // zone OUTSIDE regions (the "The files are identical" notice) is always shown.
        const plaqueAnchors = new Set(
            sideLayout.decorations.zones
                ?.filter((zone) => zone.text !== undefined)
                /* v8 ignore start -- ?? unreachable: computeSide always returns a zone decoration array */
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
        // A plaque and an inline hunk's ghost zone may share an anchor — their content
        // is merged into one multi-line decoration (setViewZones merges such
        // zones, and rendering looks decorations up by anchor).
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
            // The active side follows focus inside its view (ScrollBarDecorator
            // survives EditorElement recreation, so the listener is added once).
            this.sides[side].component.view.addEventListener(
                "focus",
                () => {
                    this.activeSideValue = side;
                },
                { capture: true },
            );
        }
    }

    /** Reloading the document recreates the view state — without re-subscribing, sync silently breaks. */
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

    /** Lock icon on the tab only when both sides are locked (a pure snapshot). */
    public get readOnly(): boolean {
        return this.sides.original.readOnly && this.sides.modified.readOnly;
    }

    /** The side that owns the cursor and commands; in inline mode it is always modified. */
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
        // Side text has no placeholders or fillers — nothing to filter out.
        return this.viewState.getSelectedTexts();
    }
}

function rangeOverlap(a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }): number {
    return Math.max(0, Math.min(a.endLine, b.endLine) - Math.max(a.startLine, b.startLine) + 1);
}

/**
 * Diff engine's 1-based LineRange → character-based ITextEdit. A deletion consumes exactly one
 * line separator; an insertion adds its own.
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
        // Insert before line `start`; past the end of file — append to the last line.
        if (start < document.lineCount) {
            return { range: { start: at(start, 0), end: at(start, 0) }, text: `${lines.join("\n")}\n` };
        }
        const last = document.lineCount - 1;
        const lastLength = document.getLineLength(last);
        return { range: { start: at(last, lastLength), end: at(last, lastLength) }, text: `\n${lines.join("\n")}` };
    }

    if (lines.length === 0) {
        // Delete lines [start..endExclusive): for a trailing block the separator
        // is consumed on the left, otherwise on the right.
        if (endExclusive < document.lineCount) {
            return { range: { start: at(start, 0), end: at(endExclusive, 0) }, text: "" };
        }
        /* v8 ignore start -- start === 0 is unreachable: deleting the whole file would mean
           an empty original range with an empty original file, but a TextDocument has at least
           one line — the engine builds such a hunk as a replacement, not an insertion */
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
