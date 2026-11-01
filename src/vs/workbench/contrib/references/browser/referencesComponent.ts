import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { PaddingContainerElement } from "@tuidom/elements/layout/paddingContainerElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { ScrollBarDecorator } from "@tuidom/elements/scrollbar/scrollContainerElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Emitter } from "../../../../base/common/event.ts";
import { listRowId } from "../../../../base/common/listRowId.ts";
import type { Uri } from "../../../../base/common/uri.ts";
import { createRange, type IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { ContextKeyServiceDIToken } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { Component } from "../../../browser/component.ts";
import { HeaderBodyViewElement } from "../../../browser/parts/views/headerBodyViewElement.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import { ViewsServiceDIToken } from "../../../browser/parts/views/viewsService.ts";
import type { IJumpRecorder } from "../../../services/history/browser/historyService.ts";
import { JumpRecorderDIToken } from "../../../services/history/browser/historyService.ts";
import type { ITextMatch } from "../../../services/search/common/textSearch.ts";
import { buildFileRow, buildMatchRow, type ISearchRowStyles } from "../../search/browser/searchResultRows.ts";

import type { IReferenceGroup } from "./referencePreview.ts";
import { revealLocation } from "./revealLocation.ts";

export const ReferencesComponentDIToken = token<ReferencesComponent>("ReferencesComponent");

/** Same id as in VS Code. */
export const REFERENCES_VIEWLET_ID = "references-view";
export const REFERENCES_VIEW_ID = "references-view.tree";

export interface IReferencesRevealEditor {
    goToPosition(line: number, column?: number): void;
    revealRange(range: IRange): void;
}

export interface IReferencesRevealTarget {
    openUri(uri: Uri): Promise<void> | void;
    getActiveEditor(): IReferencesRevealEditor | null;
}

export interface IReferenceResultsOptions {
    /** The section's name; `undefined` returns the registered "REFERENCES". */
    readonly title?: string;
    /** The row the list cursor lands on, by uri and range start; not found or `undefined` — the first row. */
    readonly active?: ICoreReference;
}

export const ReferencesRevealTargetDIToken = token<IReferencesRevealTarget>("ReferencesRevealTarget");

interface IReferenceRow {
    readonly group: IReferenceGroup;
    readonly match: ITextMatch;
}

function fileRowId(group: IReferenceGroup): string {
    return `file:${group.relPath}`;
}

function referenceRowId(group: IReferenceGroup, index: number): string {
    return `ref:${group.relPath}:${String(index)}`;
}

/** Rows are shared with the search panel: we have one "file + highlighted lines" idiom. */
export class ReferencesComponent extends Component {
    public static dependencies = [
        ReferencesRevealTargetDIToken,
        ContextKeyServiceDIToken,
        ViewsServiceDIToken,
        JumpRecorderDIToken,
    ] as const;

    private readonly root: HeaderBodyViewElement;
    private readonly countLabel = new TextLabelElement("");
    private readonly scrollBars: ScrollBarDecorator;
    /**
     * Typeahead is on, unlike search (where letters go into the query): the panel has no input, and jumping
     * by file name is free navigation.
     */
    public readonly results = new ListViewElement();

    private readonly onDidRevealResultsEmitter = new Emitter<void>();
    /** The panel is about to show the list: the call hierarchy tree gives way to it. */
    public readonly onDidRevealResults = this.onDidRevealResultsEmitter.event;

    private referenceRows = new Map<string, IReferenceRow>();
    // Stryker disable next-line ArrayDeclaration: the initial value before the first rebuild is unobservable — nothing to collapse, and `rebuildRows` replaces it
    private fileRowIds: string[] = [];
    /** F4 traversal walks this, not the list projection. */
    private referenceRowIds: string[] = [];
    private referenceCount = 0;
    private fileCount = 0;
    // Stryker disable next-line BooleanLiteral: nobody recomputes the header before the first setResults/clear — the field value doesn't affect the frame
    private searched = false;

    public constructor(
        private readonly revealTarget: IReferencesRevealTarget,
        private readonly contextKeys: ContextKeyService,
        private readonly viewsService: ViewsService,
        private readonly jumps: IJumpRecorder,
    ) {
        super();

        this.results.id = "referenceResults";
        this.results.onActivate = (element) => {
            this.activateRow(listRowId(element));
        };
        this.results.onCollapsedChanged = () => {
            this.refreshResultKeys();
        };
        this.refreshResultKeys();
        this.scrollBars = new ScrollBarDecorator(this.results);

        const paddedHeader = new PaddingContainerElement(this.countLabel, { left: 1, right: 1 });
        this.root = new HeaderBodyViewElement(paddedHeader, this.scrollBars);
        this.root.id = "referencesView";
        this.root.style = { fg: "sideBar.foreground", bg: "sideBar.background" };
        this.countLabel.setColors("descriptionForeground", INHERITED_BG);

        // The container is empty until the first Find All References, so by default
        // it isn't shown in the sidebar.
        viewsService.registerContainer({
            id: REFERENCES_VIEWLET_ID,
            title: "REFERENCES",
            // Stryker disable next-line StringLiteral: ViewsService only distinguishes "panel"; any other value (including a mutated one) goes to the sidebar, so replacing the string has no observable effect
            location: "sidebar",
            order: 4,
            visibleContextKey: "referencesViewletVisible",
        });
        viewsService.registerView({
            id: REFERENCES_VIEW_ID,
            containerId: REFERENCES_VIEWLET_ID,
            // Stryker disable next-line StringLiteral: a container with a single visible view is drawn merged — the screen shows the CONTAINER title (set by registerContainer above), and the view's own title is visible nowhere (verified by replacing the string: the frame doesn't change)
            title: "REFERENCES",
            order: 10,
            body: this.root,
            focus: () => {
                this.focus();
            },
        });
    }

    public get view(): TUIElement {
        return this.root;
    }

    public focus(): void {
        this.results.focus();
    }

    /** An empty list is a valid result ("No results"), not a reason to keep the old references. */
    public setResults(groups: readonly IReferenceGroup[], options: IReferenceResultsOptions = {}): void {
        this.searched = true;
        this.fileCount = groups.length;
        this.referenceCount = groups.reduce((sum, group) => sum + group.matches.length, 0);
        this.viewsService.setViewTitle(REFERENCES_VIEW_ID, options.title, null);
        this.rebuildRows(groups, options.active);
        this.updateCount();
        this.refreshResultKeys();
    }

    public clear(): void {
        this.searched = false;
        this.fileCount = 0;
        this.referenceCount = 0;
        this.viewsService.setViewTitle(REFERENCES_VIEW_ID, undefined, null);
        this.rebuildRows([]);
        this.updateCount();
        this.refreshResultKeys();
    }

    /** Before the viewlet opens: the call hierarchy tree gives way, which brings this section back. */
    public revealResults(): void {
        this.onDidRevealResultsEmitter.fire();
    }

    public get resultCount(): number {
        return this.referenceCount;
    }

    /** Single level (files → references) — no need for VS Code's step-by-step behavior. */
    public collapseDeepestLevel(): void {
        for (const id of this.fileRowIds) this.results.setCollapsed(id, true);
    }

    public expandAll(): void {
        for (const id of this.results.getCollapsedIds()) {
            this.results.setCollapsed(id, false);
        }
    }

    /** Wraps from the last to the first (VS Code: references-view.next). */
    public goToNextReference(): void {
        this.stepReference(1);
    }

    public goToPreviousReference(): void {
        this.stepReference(-1);
    }

    private stepReference(delta: 1 | -1): void {
        const count = this.referenceRowIds.length;
        if (count === 0) return;
        // Cursor on a file row gives indexOf -1: "next" starts from the first reference, "previous" from the last.
        const cursor = this.results.getCursorElement();
        /* v8 ignore start -- a non-empty list always has a cursor (early return above) */
        // Stryker disable next-line ConditionalExpression: the branch is unreachable for the same reason as for coverage
        if (cursor === null) return;
        /* v8 ignore stop */
        const current = this.referenceRowIds.indexOf(listRowId(cursor));
        const next = current === -1 ? (delta === 1 ? 0 : count - 1) : (((current + delta) % count) + count) % count;
        // setCursorTo expands the row's collapsed ancestors itself, so no
        // separate expand is needed here.
        const id = this.referenceRowIds[next];
        this.results.setCursorTo(id);
        this.activateRow(id);
    }

    private rebuildRows(groups: readonly IReferenceGroup[], active?: ICoreReference): void {
        this.results.clear();
        this.referenceRows.clear();
        this.fileRowIds = [];
        this.referenceRowIds = [];

        for (const group of groups) {
            const fileId = fileRowId(group);
            const fileElement = buildFileRow(fileId, group.relPath, group.matches.length, ROW_STYLES);
            this.fileRowIds.push(fileId);
            // label is the typeahead label: typing a file name jumps to its row.
            this.results.appendRow(fileElement, { label: group.relPath });

            group.matches.forEach((match, index) => {
                const id = referenceRowId(group, index);
                const element = buildMatchRow(id, match, ROW_STYLES);
                this.referenceRows.set(id, { group, match });
                this.referenceRowIds.push(id);
                this.results.appendRow(element, { parentId: fileId });
            });
        }

        const first = this.findRow(active) ?? this.referenceRowIds.at(0);
        if (first !== undefined) this.results.setCursorTo(first);
    }

    private findRow(target: ICoreReference | undefined): string | undefined {
        if (target === undefined) return undefined;
        const { line, character } = target.range.start;
        for (const [id, { group, match }] of this.referenceRows) {
            if (group.uri === target.uri && match.lineNumber - 1 === line && match.startColumn === character) return id;
        }
        return undefined;
    }

    private activateRow(rowId: string): void {
        const row = this.referenceRows.get(rowId);
        if (row === undefined) {
            // Unknown row (from a previous, already cleared result) — do nothing.
            if (this.fileRowIds.includes(rowId)) this.results.toggleCollapsed(rowId);
            return;
        }
        // List row lineNumber is 1-based, the editor expects 0-based.
        const line = row.match.lineNumber - 1;
        revealLocation(
            this.revealTarget,
            this.jumps,
            row.group.uri,
            createRange(line, row.match.startColumn, line, row.match.endColumn),
        );
    }

    private updateCount(): void {
        this.countLabel.setText(this.countText());
    }

    private countText(): string {
        if (!this.searched) return "";
        if (this.referenceCount === 0) return "No results";
        const files = this.fileCount === 1 ? "file" : "files";
        return `${String(this.referenceCount)} results in ${String(this.fileCount)} ${files}`;
    }

    private refreshResultKeys(): void {
        this.contextKeys.set("hasReferenceResult", this.referenceCount > 0);
        this.contextKeys.set("referencesViewHasSomeCollapsibleResult", this.results.hasVisibleExpandedRow());
    }
}

const ROW_STYLES: ISearchRowStyles = {
    dimFg: "descriptionForeground",
    matchFg: "sideBar.foreground",
    matchBg: "editor.wordHighlightBackground",
};
