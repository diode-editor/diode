import { measureTextWidth } from "@tuidom/core/common/measureTextWidth";
import type { TUIElement } from "@tuidom/core/dom/tuiElement";
import { ListViewElement } from "@tuidom/elements/list/listViewElement";
import { TextLabelElement } from "@tuidom/elements/text/textLabelElement";

import { codicon, iconGlyph } from "../../../../base/common/codicons.ts";
import { listRowId } from "../../../../base/common/listRowId.ts";

import type { ITerminalInstance } from "./terminalService.ts";

export const TERMINAL_TABS_LIST_ID = "terminalTabsList";

/**
 * Default tab list width in columns, until the user drags the sash (`TerminalTabbedViewElement`).
 * Upstream defaults to 120px (≈15 chars) in the panel and to the narrow width at the side; we keep
 * 20 for both and have no "narrow" mode (icons only at ≤63px) — see docs/TODO/IntegratedTerminal.md.
 */
export const TERMINAL_TABS_WIDTH = 20;

export const SWITCH_TERMINAL_SHOW_TABS = "Show Tabs";

/** Upstream `tabs.defaultIcon`. */
const TERMINAL_ICON = codicon("terminal");

const ROW_ID_PREFIX = "terminalTab-";

export function terminalTabRowId(instanceId: number): string {
    return `${ROW_ID_PREFIX}${instanceId}`;
}

/** Like upstream `getSingleTabLabel`. */
export function terminalTabLabel(instance: ITerminalInstance, nerdFont: boolean): string {
    return `${iconGlyph(TERMINAL_ICON, nerdFont)} ${instance.title}`;
}

export function terminalIndexedLabel(index: number, instance: ITerminalInstance): string {
    return `${index + 1}: ${instance.title}`;
}

export interface ITerminalTabsListHandlers {
    /** The terminal becomes active without focus. */
    onDidSelectInstance(instanceId: number): void;
    /** By now the row is already active — chosen with arrows or the first click. */
    onDidActivateInstance(): void;
    onDidRequestContextMenu(instanceId: number, screenX: number, screenY: number): void;
}

/** List cursor = active terminal. Semantics (activate, focus, kill, menu) belong to the owner via callbacks. */
export class TerminalTabsList {
    public readonly list = new ListViewElement({ typeahead: false });

    /** While the list moves the cursor itself, its `onSelect` is an echo, not a user action. */
    // No rows before the first setInstances, so onSelect never fires — the initial value has no effect.
    // Stryker disable next-line BooleanLiteral: the initial value is unobservable — see above
    private syncing = false;
    /**
     * Upstream `_handleOnDidSashReset`: the widest row plus padding — a column on the right
     * to match the leading one.
     */
    public idealWidth = 0;
    public constructor(
        handlers: ITerminalTabsListHandlers,
        /** `diode.icons.nerdFont`; the owner re-syncs the rows after a change. */
        public nerdFont: boolean,
    ) {
        this.list.id = TERMINAL_TABS_LIST_ID;
        this.list.onSelect = (element) => {
            if (this.syncing) return;
            handlers.onDidSelectInstance(instanceIdOf(element));
        };
        this.list.onActivate = () => {
            handlers.onDidActivateInstance();
        };
        this.list.onContextMenu = (element, screenX, screenY) => {
            handlers.onDidRequestContextMenu(instanceIdOf(element), screenX, screenY);
        };
    }

    public setInstances(instances: readonly ITerminalInstance[], activeId: number | null): void {
        this.syncing = true;
        this.list.clear();
        this.idealWidth = 0;
        for (const instance of instances) {
            const label = ` ${terminalTabLabel(instance, this.nerdFont)}`;
            this.idealWidth = Math.max(this.idealWidth, measureTextWidth(label) + 1);
            const row = new TextLabelElement(label);
            row.id = terminalTabRowId(instance.id);
            // No `label`: only typeahead needs it, and typeahead is off.
            this.list.appendRow(row);
        }
        // No terminals — no row either (setCursorTo throws on an unknown one).
        if (activeId !== null) this.list.setCursorTo(terminalTabRowId(activeId));
        this.syncing = false;
    }

    public getCursorInstanceId(): number | undefined {
        const element = this.list.getCursorElement();
        return element === null ? undefined : instanceIdOf(element);
    }
}

/** List rows are only ours (`terminalTab-<id>`), so parse without checks. */
function instanceIdOf(element: TUIElement): number {
    return Number(listRowId(element).slice(ROW_ID_PREFIX.length));
}
