import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import { INHERITED_BG } from "@tuidom/core/dom/styles/tuiStyle";
import { ButtonElement } from "@tuidom/elements/button/buttonElement";
import type { OverlayHostElement } from "@tuidom/elements/contextview/overlayHostElement";
import { InputElement } from "@tuidom/elements/inputbox/inputElement";
import { BoxContainerElement } from "@tuidom/elements/layout/boxContainerElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { SizedBoxElement } from "@tuidom/elements/layout/sizedBoxElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { MATCHES_LIMIT } from "../../../../editor/contrib/find/findMatches.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { EditorPartComponentDIToken } from "../../../browser/parts/editor/editorPartComponent.ts";
import type { GroupId } from "../../../services/editor/browser/editorGroupModel.ts";

export const FindComponentDIToken = token<FindComponent>("FindComponent");

const PREV_GLYPH = "↑";
const NEXT_GLYPH = "↓";
const CLOSE_GLYPH = "✕";

const WIDGET_HEIGHT = 3;
const DEFAULT_WIDTH = 44;
const BUTTON_GAP = 1;
const COUNTER_GAP = 2;

/**
 * The tree is built once and mutated in place, so the query input is never reattached and doesn't
 * lose focus between keystrokes. Buttons are non-focusable: a click doesn't steal focus from the query input.
 */
export class FindWidget extends Disposable {
    public readonly view: SizedBoxElement;

    public onQueryChange: ((query: string) => void) | null = null;
    public onNext: (() => void) | null = null;
    public onPrev: (() => void) | null = null;
    public onClose: (() => void) | null = null;

    private readonly box: BoxContainerElement;
    private readonly input: InputElement;
    private readonly counterLabel: TextLabelElement;
    private readonly counterGap: TextLabelElement;
    private readonly prevButton: ButtonElement;
    private readonly nextButton: ButtonElement;
    private readonly closeButton: ButtonElement;

    private preferredWidth = DEFAULT_WIDTH;
    private matchCurrent = 0;
    private matchTotal = 0;
    private searching = false;

    private host: OverlayHostElement | null = null;
    private session: OverlaySessionHandle | null = null;

    public constructor() {
        super();

        this.view = new SizedBoxElement(this.preferredWidth, WIDGET_HEIGHT);
        this.view.id = "findWidget";

        this.input = new InputElement();
        this.input.showBorder = false;
        this.input.placeholder = "Find";
        this.input.onChange = (value) => {
            this.onQueryChange?.(value);
        };

        this.counterLabel = new TextLabelElement("");
        this.counterGap = new TextLabelElement("");
        this.prevButton = this.createButton(PREV_GLYPH, () => this.onPrev?.());
        this.nextButton = this.createButton(NEXT_GLYPH, () => this.onNext?.());
        this.closeButton = this.createButton(CLOSE_GLYPH, () => this.onClose?.());

        const row = new HFlexElement();
        row.addChild(this.input, { width: hflexFill(), height: 1 });
        row.addChild(this.counterLabel, { width: hflexFit(), height: 1 });
        row.addChild(this.counterGap, { width: hflexFixed(0), height: 1 });
        row.addChild(this.prevButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(BUTTON_GAP), height: 1 });
        row.addChild(this.nextButton, { width: hflexFit(), height: 1 });
        row.addChild(new TextLabelElement(""), { width: hflexFixed(BUTTON_GAP), height: 1 });
        row.addChild(this.closeButton, { width: hflexFit(), height: 1 });

        this.box = new BoxContainerElement();
        this.box.setBg("editorWidget.background");
        this.box.setBorderFg("editorWidget.border");
        this.box.setChild(row);
        this.view.setChild(this.box);

        this.register({
            dispose: () => {
                this.session?.dispose();
                this.session = null;
            },
        });
    }

    private createButton(label: string, onActivate: () => void): ButtonElement {
        const button = new ButtonElement(label);
        button.focusable = false;
        button.onActivate = onActivate;
        return button;
    }

    public getQuery(): string {
        return this.input.inputState.value;
    }

    public setQuery(value: string): void {
        this.input.inputState.value = value;
        this.input.markDirty();
        this.refreshCounter();
    }

    /** Call AFTER {@link setQuery}: the `InputState.value` setter resets the selection. */
    public selectQuery(): void {
        // An empty query has nothing to select, and selectAll on an empty string would leave
        // the selection anchor at 0, breaking the very first typed character.
        if (this.input.inputState.value.length === 0) return;
        this.input.inputState.selectAll();
        this.input.markDirty();
    }

    /**
     * Updates the match counter. `current` is 1-based, 0 when no match is current; `total` 0 means no matches.
     * `searching`: the walk over a document on disk is still running, the total is what it has found so far.
     */
    public setCounter(current: number, total: number, searching = false): void {
        this.matchCurrent = current;
        this.matchTotal = total;
        this.searching = searching;
        this.refreshCounter();
    }

    public focus(): void {
        this.input.focus();
    }

    /** Attaches the widget to its OWN group's overlay layer (once, before the first show). */
    public attachHost(host: OverlayHostElement): void {
        if (this.host === host) return;
        this.session?.dispose();
        this.host = host;
        this.session = host.overlayLayer.createSession(this.view, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            // Find is a docked widget: clicks outside it intentionally go to the editor (as in VS Code).
            pointerPolicy: "passthrough",
        });
    }

    public isOpen(): boolean {
        return this.session?.isOpen() ?? false;
    }

    public show(): void {
        this.updatePosition();
        this.session?.open();
        this.focus();
    }

    public hide(): void {
        if (this.session?.isOpen()) this.session.close();
    }

    private refreshCounter(): void {
        const counter = this.counterText();
        this.counterLabel.setText(counter);
        this.counterLabel.setColors(
            this.matchTotal === 0 && !this.searching ? "editorError.foreground" : "descriptionForeground",
            INHERITED_BG,
        );
        this.counterGap.layoutStyle = { width: hflexFixed(counter === "" ? 0 : COUNTER_GAP), height: 1 };
        this.counterGap.markDirty();
    }

    /**
     * Upstream's "{i} of {n}", "No results" and "19999+". The ellipsis is ours: upstream walks the whole model at
     * once and has no "still searching" state; on a document on disk the walk runs in the background and the
     * counter grows as it goes (docs/arch/Editor.md).
     */
    private counterText(): string {
        if (this.input.inputState.value.length === 0) return "";
        if (this.matchTotal === 0) return this.searching ? "Searching…" : "No results";
        // The collection stops at the limit (upstream "19999+"): the total is a floor, not a count.
        const total = this.matchTotal >= MATCHES_LIMIT ? `${String(MATCHES_LIMIT)}+` : String(this.matchTotal);
        // "?": matches so far, none of them after the cursor yet (upstream shows "?" when the cursor is off a match).
        const current = this.matchCurrent > 0 ? String(this.matchCurrent) : "?";
        return `${current} of ${total}${this.searching ? "…" : ""}`;
    }

    private updatePosition(): void {
        const group = this.host;
        if (group === null) return;
        const groupWidth = group.layoutSize.width;
        const widgetW = Math.min(60, Math.max(28, groupWidth - 2));
        this.preferredWidth = widgetW;
        this.view.setPreferredWidth(widgetW);
        const px = Math.max(0, groupWidth - widgetW - 1); // right-align with a 1-col margin to the group's edge
        const py = 1; // the host is the editor group; its row 0 is the tab strip
        this.session?.setPosition(new Point(px, py));
    }
}

export interface IGroupOverlayHosts {
    /** `null` if the view layer doesn't know the group. */
    groupOverlayHost(groupId: GroupId): OverlayHostElement | null;
}

/** One widget per group, created lazily; FindService disposes the widget of a collapsed group (`disposeWidget`). */
export class FindComponent extends Disposable {
    public static dependencies = [EditorPartComponentDIToken] as const;

    public onQueryChange: ((groupId: GroupId, query: string) => void) | null = null;
    public onNext: ((groupId: GroupId) => void) | null = null;
    public onPrev: ((groupId: GroupId) => void) | null = null;
    public onClose: ((groupId: GroupId) => void) | null = null;

    private readonly widgets = new Map<GroupId, FindWidget>();

    public constructor(private readonly hosts: IGroupOverlayHosts) {
        super();
    }

    /** `null` if the host is unavailable. */
    public widgetFor(groupId: GroupId): FindWidget | null {
        const existing = this.widgets.get(groupId);
        if (existing !== undefined) return existing;
        const host = this.hosts.groupOverlayHost(groupId);
        if (host === null) return null;
        const widget = this.register(new FindWidget());
        widget.attachHost(host);
        widget.onQueryChange = (query) => this.onQueryChange?.(groupId, query);
        widget.onNext = () => this.onNext?.(groupId);
        widget.onPrev = () => this.onPrev?.(groupId);
        widget.onClose = () => this.onClose?.(groupId);
        this.widgets.set(groupId, widget);
        return widget;
    }

    public widgetIfExists(groupId: GroupId): FindWidget | null {
        return this.widgets.get(groupId) ?? null;
    }

    public isOpen(groupId: GroupId): boolean {
        return this.widgets.get(groupId)?.isOpen() ?? false;
    }

    public disposeWidget(groupId: GroupId): void {
        const widget = this.widgets.get(groupId);
        if (widget === undefined) return;
        this.widgets.delete(groupId);
        widget.dispose();
    }
}
