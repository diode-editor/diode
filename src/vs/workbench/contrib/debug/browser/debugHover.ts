/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
//@diode:shim microsoft/vscode@1.127.0 src/vs/workbench/contrib/debug/browser/debugHover.ts
// Upstream's `DebugHoverWidget` and `DebugHoverComputer` with the hover part of `DebugEditorContribution.showHover`:
// the expression at the cursor (an extension's `EvaluatableExpressionProvider`, otherwise the text around it) is
// evaluated in the `hover` context when the adapter supports it, otherwise looked up in the frame's non-expensive
// scopes; a value with children is a tree under its value, expanded by the keyboard or the mouse and scrolled, a
// plain value is its text. The hover takes the focus, Escape or a click outside closes it and gives the focus back.
// Deviations: it is shown by `editor.debug.action.showDebugHover` only, there is no hover by the mouse in the
// editor yet (so no Alt to switch to the language hover, no safe triangle); the expression's range is not
// highlighted in the editor; the hover sits at the cursor, not at the start of the expression; it closes when the
// debugger moves on (a step, a continue), where upstream's contribution hides it on a focused frame (another frame
// is picked by a click outside, which closes it too); the debug keys work from it. Not here yet: the context menu of
// a row (`debug/variables/context` in the hover, #1150). Not planned: debug visualizers.

import type { OverlayAnchorPosition, OverlayLayer } from "@tuidom/core/dom/overlayLayer";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { FitContentElement } from "@tuidom/elements/layout/fitContentElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { LatestRequest } from "../../../../base/common/cancellation.ts";
import { onUnexpectedError } from "../../../../base/common/errors.ts";
import { Disposable } from "../../../../base/common/lifecycle.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import {
    type IProductIconService,
    ProductIconServiceDIToken,
} from "../../../../platform/theme/common/productIconService.ts";
import { CaretAnchoredOverlay } from "../../../browser/parts/editor/caretAnchoredOverlay.ts";
import { type IRowSpan, LazyTreeControl, spansText } from "../../../browser/parts/views/lazyTreeControl.ts";
import { LayoutServiceDIToken } from "../../../services/layout/browser/layoutService.ts";
import { naturalWidth } from "../../hover/browser/hoverBox.ts";
import type { IDebugService, IExpression, IExpressionContainer, IStackFrame } from "../common/debug.ts";
import { State } from "../common/debug.ts";
import { Expression, Variable } from "../common/debugModel.ts";
import { getEvaluatableExpressionAtPosition, type IEvaluatableExpressionModel } from "../common/debugUtils.ts";

import { DebugExpressionRenderer } from "./debugExpressionRenderer.ts";
import { DebugServiceDIToken } from "./debugService.ts";

// Stryker disable next-line StringLiteral: token() returns a new Token and dependencies resolve by reference to it; the string inside is only a debug label
export const DebugHoverWidgetDIToken = token<DebugHoverWidget>("DebugHoverWidget");

export enum ShowDebugHoverResult {
    NOT_AVAILABLE,
    CANCELLED,
}

/** Upstream's floor of the tree's height, 266px of 18px rows. */
const MAX_ROWS = 15;
/** Upstream clamps the tree to 400..550px: about 50..70 columns. */
const MIN_WIDTH = 50;
const MAX_WIDTH = 70;
/** The border on both sides, the tree's padding columns and its chevron. */
const TREE_CHROME_WIDTH = 6;

/** What the hover asks of the editor under it. */
export interface IDebugHoverEditor extends IEvaluatableExpressionModel {
    getCaretAnchor(): OverlayAnchorPosition | null;
}

async function doFindExpression(container: IExpressionContainer, namesToFind: string[]): Promise<IExpression | null> {
    const children = await container.getChildren();
    // look for our variable in the list. First find the parents of the hovered variable if there are any.
    const filtered = children.filter((v) => namesToFind[0] === v.name);
    if (filtered.length !== 1) {
        return null;
    }

    if (namesToFind.length === 1) {
        return filtered[0];
    } else {
        return doFindExpression(filtered[0], namesToFind.slice(1));
    }
}

export async function findExpressionInStackFrame(
    stackFrame: IStackFrame,
    namesToFind: string[],
): Promise<IExpression | undefined> {
    const scopes = await stackFrame.getScopes();
    const nonExpensive = scopes.filter((s) => !s.expensive);
    const expressions = (await Promise.all(nonExpensive.map((scope) => doFindExpression(scope, namesToFind)))).filter(
        (e) => e !== null,
    );

    // only show if all expressions found have the same value (none found: the first is undefined anyway)
    return expressions.every((e) => e.value === expressions[0].value) ? expressions[0] : undefined;
}

/**
 * Upstream `DebugHoverComputer`: the expression at the position, evaluated in the frame. The editor shows the frame's
 * source, so the frame's source is the location of the expression.
 */
async function computeExpression(
    languageFeatures: ILanguageFeaturesService,
    editor: IDebugHoverEditor,
    stackFrame: IStackFrame,
    position: IPosition,
    cancellation: ICancellationToken,
): Promise<IExpression | undefined> {
    const result = await getEvaluatableExpressionAtPosition(
        languageFeatures.evaluatableExpressionProvider,
        editor,
        position,
        cancellation,
    );
    if (result === null) return undefined;
    const session = stackFrame.thread.session;
    if (session.capabilities.supportsEvaluateForHovers) {
        const expression = new Expression(result.matchingExpression);
        await expression.evaluate(session, stackFrame, "hover", undefined, {
            line: result.range.start.line + 1,
            column: result.range.start.character + 1,
            source: stackFrame.source.raw,
        });
        return expression;
    }
    return findExpressionInStackFrame(
        stackFrame,
        result.matchingExpression
            .split(".")
            .map((word) => word.trim())
            .filter((word) => word !== ""),
    );
}

function spansWidth(spans: readonly IRowSpan[]): number {
    return naturalWidth(spansText(spans));
}

export class DebugHoverWidget extends Disposable {
    public static dependencies = [
        DebugServiceDIToken,
        LanguageFeaturesServiceDIToken,
        IConfigurationServiceDIToken,
        ProductIconServiceDIToken,
        LayoutServiceDIToken,
    ] as const;

    /** As large as the box: the overlay layer offers the whole screen. */
    public readonly view = new FitContentElement();
    private readonly box = new BoxContainerElement();
    public readonly tree: LazyTreeControl<IExpression>;
    /** The tree under a value with children; a plain value is its text in {@link valueBody}. */
    private readonly treeBody = new SizedBoxElement();
    private readonly valueBody = new SizedBoxElement();
    private readonly overlay: CaretAnchoredOverlay;
    private readonly renderer: DebugExpressionRenderer;
    private readonly latest = new LatestRequest();
    /** The evaluated expression whose children the tree shows: set before the tree's first refresh. */
    private root!: IExpression;
    /** The tree's height last applied: a rebuild with as many rows leaves the layout alone. */
    private treeRows = 0;

    public constructor(
        debugService: IDebugService,
        private readonly languageFeatures: ILanguageFeaturesService,
        configuration: IConfigurationService,
        icons: IProductIconService,
        layout: { readonly mainContainer: { readonly overlayLayer: OverlayLayer } },
    ) {
        super();
        this.view.id = "debugHoverWidget";
        // A plain value takes the focus itself, as upstream's value container: Escape reaches the overlay.
        this.view.focusable = true;
        this.view.setChild(this.box);
        this.box.setBg("editorHoverWidget.background");
        this.box.setBorderFg("editorHoverWidget.border");
        // Upstream's `listBackground: editorHoverBackground`: the rows inherit the colors of what holds them.
        this.box.style = { fg: "editorHoverWidget.foreground", bg: "editorHoverWidget.background" };
        this.renderer = this.register(
            new DebugExpressionRenderer({
                icons,
                showVariableTypes: () => configuration.get("debug.showVariableTypes"),
                onHighlightsExpired: () => {
                    this.tree.rerender();
                },
            }),
        );
        this.tree = new LazyTreeControl<IExpression>(
            {
                getRoots: () => this.root.getChildren(),
                getChildren: (element) => element.getChildren(),
                getKey: (element) => element.getId(),
                hasChildren: (element) => element.hasChildren,
                renderRow: (element) => this.renderer.renderVariable(element, { showChanged: true }),
            },
            // Stryker disable next-line StringLiteral: the row ids are the tree's own, any prefix keeps them apart
            { idPrefix: "debugHover" },
        );
        this.treeBody.setChild(this.tree.element);
        this.tree.onActivate = (element) => {
            if (element instanceof Variable && element.presentationHint?.lazy) {
                void debugService.getViewModel().evaluateLazyExpression(element).catch(onUnexpectedError);
            }
        };
        this.tree.onDidChangeRows = () => {
            this.layoutTree();
        };
        this.overlay = this.register(
            new CaretAnchoredOverlay(layout.mainContainer, this.view, {
                takesFocus: true,
                onClose: () => {
                    this.latest.cancel();
                },
            }),
        );
        const viewModel = debugService.getViewModel();
        this.register(
            viewModel.onDidEvaluateLazyExpression((e) => {
                this.tree.expand(e as IExpression);
            }),
        );
        this.register(
            debugService.onDidChangeState((state) => {
                if (state !== State.Stopped) this.hide();
            }),
        );
    }

    public isVisible(): boolean {
        return this.overlay.isOpen();
    }

    /** Upstream `showAt` with `focus`, over the source of `stackFrame`: the hover takes the focus once it is up. */
    public async showAt(
        editor: IDebugHoverEditor,
        position: IPosition,
        stackFrame: IStackFrame,
    ): Promise<ShowDebugHoverResult | undefined> {
        const ticket = this.latest.start();
        const expression = await computeExpression(this.languageFeatures, editor, stackFrame, position, ticket.token);
        if (ticket.isStale()) return ShowDebugHoverResult.CANCELLED;
        if (!expression || (expression instanceof Expression && !expression.available)) {
            this.hide();
            return ShowDebugHoverResult.NOT_AVAILABLE;
        }
        const anchor = editor.getCaretAnchor();
        if (anchor === null) return ShowDebugHoverResult.NOT_AVAILABLE;
        await this.doShow(expression);
        if (ticket.isStale()) return ShowDebugHoverResult.CANCELLED;
        this.overlay.openAt(anchor, "aboveElseBelow");
        if (expression.hasChildren) this.tree.list.focus();
        else this.view.focus();
        return undefined;
    }

    private async doShow(expression: IExpression): Promise<void> {
        const value = this.renderer.renderValue(expression, { colorize: true });
        if (!expression.hasChildren) {
            this.box.setTitle(undefined);
            this.box.setHasSeparator(false);
            const label = new TextLabelElement(spansText(value));
            label.wrap = true;
            label.style = { fg: value[0]?.fg ?? "editorHoverWidget.foreground" };
            this.valueBody.setChild(label);
            this.valueBody.setPreferredWidth(Math.min(spansWidth(value), MAX_WIDTH - 2));
            this.box.setChild(this.valueBody);
            return;
        }
        this.root = expression;
        this.treeRows = 0;
        // Upstream renders the title without colors.
        this.box.setTitle(spansText(value));
        this.box.setTitleFg("editorHoverWidget.foreground");
        this.box.setHasSeparator(true);
        this.box.setChild(this.treeBody);
        await this.tree.refresh();
        this.tree.list.scrollTo(0, 0);
        // The first screen of rows is enough: the width stops at MAX_WIDTH anyway.
        const rows = this.tree.shownItems
            .slice(0, MAX_ROWS)
            .map((item) => spansWidth(this.renderer.renderVariable(item)) + TREE_CHROME_WIDTH);
        const width = Math.max(spansWidth(value) + 2, ...rows);
        this.treeBody.setPreferredWidth(Math.min(Math.max(width, MIN_WIDTH), MAX_WIDTH) - 2);
    }

    /** Upstream `layoutTree`: as tall as the rows, up to the floor of the upstream tree. */
    private layoutTree(): void {
        const height = Math.min(Math.max(this.tree.shownItems.length, 1), MAX_ROWS);
        if (height === this.treeRows) return;
        this.treeRows = height;
        this.treeBody.setPreferredHeight(height);
        this.overlay.relayout();
    }

    public hide(): void {
        this.overlay.close();
    }
}
