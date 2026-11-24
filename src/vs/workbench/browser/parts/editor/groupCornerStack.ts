import { TAB_HEIGHT } from "@tuidom/elements/editorgroup/editorTabItemElement";

import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { GroupId } from "../../../services/editor/browser/editorGroupModel.ts";

export const GroupCornerStackDIToken = token<GroupCornerStack>("GroupCornerStack");

/** Who sits in the corner, top to bottom. */
export const CORNER_ORDER = { debugToolbar: 0, find: 1 } as const;

/** The row under the tab strip: a group's overlay host starts with its tabs (docs/arch/workbench/Frames.md). */
const FIRST_ROW = TAB_HEIGHT;

export interface IGroupCornerSlot extends IDisposable {
    /** Rows the widget takes while shown; 0 while hidden. */
    setHeight(rows: number): void;
    /** The row of the widget's top in its group. */
    top(): number;
}

interface ISlot {
    readonly groupId: GroupId;
    readonly order: number;
    height: number;
}

/**
 * Widgets docked in the top right corner of an editor group (the debug toolbar, find) stack down in their
 * {@link CORNER_ORDER}, the first right under the tab strip; a hidden one gives its rows to those under it. A widget
 * that pushes others down takes a slot and reports its height; the bottom one (find) only asks {@link topOf}. Ours:
 * upstream's debug toolbar floats over the window, here it sits on top of find (owner's decision 2026-11-14).
 */
export class GroupCornerStack {
    private readonly slots = new Set<ISlot>();
    private readonly onDidChangeEmitter = new Emitter<GroupId>();
    /** The tops in the group may have moved: their owners reposition. */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    /** The top row of a widget of `order` in the group: under the shown slots of the lower orders. */
    public topOf(groupId: GroupId, order: number): number {
        let row = FIRST_ROW;
        for (const slot of this.slots) {
            if (slot.groupId === groupId && slot.order < order) row += slot.height;
        }
        return row;
    }

    public addSlot(groupId: GroupId, order: number): IGroupCornerSlot {
        const slot: ISlot = { groupId, order, height: 0 };
        this.slots.add(slot);
        const setHeight = (rows: number): void => {
            if (slot.height === rows) return;
            slot.height = rows;
            this.onDidChangeEmitter.fire(groupId);
        };
        return {
            setHeight,
            top: () => this.topOf(groupId, order),
            dispose: () => {
                setHeight(0);
                this.slots.delete(slot);
            },
        };
    }
}
