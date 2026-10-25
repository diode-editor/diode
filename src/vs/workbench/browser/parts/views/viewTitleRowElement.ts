import type { Point } from "@tuidom/core/common/geometryPromitives";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { FillerElement } from "@tuidom/elements/layout/fillerElement";
import { HFlexElement, hflexFill, hflexFit, hflexFixed } from "@tuidom/elements/layout/hFlexElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

const ICON_EXPANDED = ""; //  nf-fa-angle_down
const ICON_COLLAPSED = ""; //  nf-fa-angle_right

const MENU_ICON = "⋯";

/** Space-glyph-space: the hover background reads as a button, and adjacent buttons don't run together. */
const BUTTON_WIDTH = 3;

/**
 * A bar, not a border: a border around each button in a single row is too heavy, and without any
 * boundary the glyph doesn't look clickable.
 */
const SEPARATOR = "\u2502"; // │

/** Inline title button: a `navigation` group menu item that has an icon. */
export interface IViewTitleAction {
    /** What {@link ViewTitleRowElement.hitZone} returns; usually the command id. */
    readonly id: string;
    readonly icon: string;
    /** `false`: the button stays in place but is dimmed and does nothing (the item's `enablement`). */
    readonly enabled?: boolean;
}

export type ViewTitleZone =
    | { kind: "title" }
    | { kind: "action"; actionId: string }
    | { kind: "menu" }
    | { kind: "switcher" };

/** The section chevron's glyph: the title then reads as "opens something below". */
const SWITCHER_ICON = ICON_EXPANDED;

export interface IViewTitleRowOptions {
    readonly chevron?: boolean;
}

/**
 * `[ ␣chevron? ␣TITLE ][ ␣description? ][ fill ][ widget? ][ inline buttons ][ ⋯ ]`
 *
 * The owner handles gestures: it takes mouse input on the labels (otherwise pointer capture for the
 * boundary drag won't work), so which button was hit is zone arithmetic in {@link hitZone}.
 * The exception is {@link hitTestWidget}: the widget is a real control.
 */
export class ViewTitleRowElement extends HFlexElement {
    private readonly titleLabel: TextLabelElement;
    /** Upstream `TreeView.description`: dimmed after the title, clipped first on a narrow header. */
    // Stryker disable next-line StringLiteral: equivalent — the label joins the row only after setDescription sets its text
    private readonly descriptionLabel = new TextLabelElement("");
    private description: string | null = null;
    private readonly filler = new FillerElement();
    private readonly menuLabel: TextLabelElement;
    private readonly chevron: boolean;

    private title: string;
    private expanded = true;
    private spinner: string | null = null;
    private actions: readonly IViewTitleAction[] = [];
    private actionLabels: TextLabelElement[] = [];
    private titleWidget: TUIElement | null = null;
    private menuVisible = true;
    private switcher = false;

    public constructor(title: string, options?: IViewTitleRowOptions) {
        super();
        this.title = title;
        this.chevron = options?.chevron ?? true;
        this.titleLabel = new TextLabelElement(this.composeTitle());
        this.descriptionLabel.style = { fg: "descriptionForeground" };
        this.menuLabel = new TextLabelElement(buttonLabel(MENU_ICON));
        // "⋯" is always enabled: it opens a popup rather than running a command.
        this.menuLabel.style = buttonStyle(true);
        this.syncChildren();
    }

    public getTitle(): string {
        return this.title;
    }

    public setTitle(title: string): void {
        if (this.title === title) return;
        this.title = title;
        this.titleLabel.setText(this.composeTitle());
    }

    /** `null` or empty — no description. */
    public setDescription(description: string | null): void {
        const next = description === "" ? null : description;
        if (this.description === next) return;
        this.description = next;
        // Stryker disable next-line ConditionalExpression: equivalent — with no description the label is out of the row, its text unseen
        if (next !== null) this.descriptionLabel.setText(` ${next}`);
        this.syncChildren();
    }

    public getDescription(): string | null {
        return this.description;
    }

    public get isExpanded(): boolean {
        return this.expanded;
    }

    public setExpanded(expanded: boolean): void {
        if (this.expanded === expanded) return;
        this.expanded = expanded;
        this.titleLabel.setText(this.composeTitle());
    }

    public setActions(actions: readonly IViewTitleAction[]): void {
        if (sameActions(this.actions, actions)) return;
        this.actions = [...actions];
        this.syncChildren();
    }

    /** In the panel tab row an empty "⋯" sits next to the tabs and only gets in the way. */
    public setMenuVisible(visible: boolean): void {
        if (this.menuVisible === visible) return;
        this.menuVisible = visible;
        this.syncChildren();
    }

    /**
     * Right after the title so the button row doesn't jump: the filler absorbs the extra columns, and
     * `hitZone` works from the laid-out widths.
     */
    public setSpinnerFrame(frame: string | null): void {
        this.spinner = frame;
        this.titleLabel.setText(this.composeTitle());
    }

    /** For the inspector/e2e; the spinner frame itself keeps changing, so it isn't exposed. */
    public get isBusy(): boolean {
        return this.spinner !== null;
    }

    public setTitleWidget(widget: TUIElement | null): void {
        if (this.titleWidget === widget) return;
        this.titleWidget = widget;
        this.syncChildren();
    }

    /**
     * The title becomes the container switcher: a chevron after it, and the title label is a
     * button of its own (zone `switcher`, hover background).
     */
    public setSwitcher(enabled: boolean): void {
        // Stryker disable next-line ConditionalExpression: without the early return the same text and style are set again — nothing changes in the frame
        if (this.switcher === enabled) return;
        this.switcher = enabled;
        this.titleLabel.setText(this.composeTitle());
        this.titleLabel.style = enabled ? { when: [{ states: ["hover"], bg: "toolbar.hoverBackground" }] } : {};
    }

    public get hasSwitcher(): boolean {
        return this.switcher;
    }

    /** A button that layout collapsed to zero columns on a narrow header has no zone. */
    public hitZone(localX: number): ViewTitleZone {
        for (let i = 0; i < this.actionLabels.length; i++) {
            if (inZone(this.actionLabels[i], localX)) return { kind: "action", actionId: this.actions[i].id };
        }
        // A hidden "⋯" has no zone: it is left outside the tree with its stale layout,
        // and without this check its old columns would still be clickable.
        if (this.menuVisible && inZone(this.menuLabel, localX)) return { kind: "menu" };
        if (this.switcher && inZone(this.titleLabel, localX)) return { kind: "switcher" };
        return { kind: "title" };
    }

    /** Local X of the "⋯" button; the anchor for a menu opened from the keyboard. */
    public get menuAnchorX(): number {
        return this.menuLabel.localPosition.dx;
    }

    /**
     * Labels don't take part in hit testing (the header takes the mouse), so the owner sets
     * their `hover` on mousemove.
     */
    public setHoveredZone(zone: ViewTitleZone | null): void {
        const hoveredAction = zone?.kind === "action" ? zone.actionId : null;
        this.actionLabels.forEach((label, i) => {
            label.setStyleState("hover", this.actions[i].id === hoveredAction);
        });
        this.menuLabel.setStyleState("hover", zone?.kind === "menu");
        this.titleLabel.setStyleState("hover", zone?.kind === "switcher");
    }

    /** Only the widget: labels are presentational, but the widget must receive clicks or it can't be pressed. */
    public hitTestWidget(point: Point): TUIElement | null {
        return this.titleWidget?.elementFromPoint(point) ?? null;
    }

    private composeTitle(): string {
        const switcher = this.switcher ? ` ${SWITCHER_ICON} ` : "";
        const tail = (this.spinner === null ? "" : ` ${this.spinner}`) + switcher;
        if (!this.chevron) return ` ${this.title}${tail}`;
        return ` ${this.expanded ? ICON_EXPANDED : ICON_COLLAPSED} ${this.title}${tail}`;
    }

    private syncChildren(): void {
        this.actionLabels = this.actions.map((action) => {
            const label = new TextLabelElement(buttonLabel(action.icon));
            label.style = buttonStyle(action.enabled !== false);
            label.layoutStyle = { width: hflexFixed(BUTTON_WIDTH), height: 1 };
            return label;
        });
        this.titleLabel.layoutStyle = { width: hflexFit(), height: 1 };
        this.descriptionLabel.layoutStyle = { width: hflexFit(), height: 1 };
        this.filler.layoutStyle = { width: hflexFill(), height: 1 };
        this.menuLabel.layoutStyle = { width: hflexFixed(BUTTON_WIDTH), height: 1 };
        const children: TUIElement[] = [this.titleLabel];
        if (this.description !== null) children.push(this.descriptionLabel);
        children.push(this.filler);
        if (this.titleWidget !== null) {
            this.titleWidget.layoutStyle = { width: hflexFit(), height: 1 };
            children.push(this.titleWidget);
        }
        // Bars only BETWEEN controls: a leading/trailing one would turn the row into a border.
        const controls: TUIElement[] = [...this.actionLabels];
        if (this.menuVisible) controls.push(this.menuLabel);
        controls.forEach((control, index) => {
            if (index > 0) children.push(separatorLabel());
            children.push(control);
        });
        this.replaceChildren(children);
    }
}

/** Dimmed but always visible (there may be no mouse at all); the owner sets `hover`. */
function buttonStyle(enabled: boolean): TUIElement["style"] {
    // A disabled button has no hover variant at all: a highlighted background would read
    // as clickable, and it isn't.
    if (!enabled) return { fg: "disabledForeground" };
    return {
        fg: "descriptionForeground",
        when: [{ states: ["hover"], bg: "toolbar.hoverBackground" }],
    };
}

/** Separator between buttons; uses the same muted color as menu separators. */
function separatorLabel(): TextLabelElement {
    const label = new TextLabelElement(SEPARATOR);
    label.style = { fg: "menu.separatorBackground" };
    label.layoutStyle = { width: hflexFixed(1), height: 1 };
    return label;
}

function buttonLabel(icon: string): string {
    return ` ${icon} `;
}

function inZone(label: TextLabelElement, localX: number): boolean {
    const width = label.layoutSize.width;
    if (width === 0) return false;
    const start = label.localPosition.dx;
    return localX >= start && localX < start + width;
}

// Stryker disable next-line BlockStatement: an empty body means "sets always differ", i.e. an extra rebuild not observable in the frame
function sameActions(a: readonly IViewTitleAction[], b: readonly IViewTitleAction[]): boolean {
    // Stryker disable next-line ConditionalExpression: "treat sets as always different" gives an extra rebuild with the same buttons; skipping a needed one is covered by the tests
    if (a.length !== b.length) return false;
    // Stryker disable next-line ConditionalExpression,ArrowFunction: a weaker comparison gives an extra rebuild with the same buttons; the opposite mutation (skipping a needed one) is covered by the tests
    return a.every((action, index) => sameAction(action, b[index]));
}

/**
 * Enabled state is compared along with id and icon: otherwise the early return in `setActions` would
 * swallow its change, and the button would stay as it was first built.
 */
function sameAction(a: IViewTitleAction, b: IViewTitleAction): boolean {
    // Stryker disable next-line ConditionalExpression: "buttons always differ" is an extra rebuild not observable in the frame; skipping a needed one is covered by the id, icon and enabled-change tests
    return a.id === b.id && a.icon === b.icon && (a.enabled !== false) === (b.enabled !== false);
}
