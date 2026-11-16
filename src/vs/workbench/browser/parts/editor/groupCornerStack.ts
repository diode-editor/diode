import { Emitter } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { GroupId } from "../../../services/editor/browser/editorGroupModel.ts";

export const GroupCornerStackDIToken = token<GroupCornerStack>("GroupCornerStack");

/** Who sits in the corner, top to bottom. */
export const CORNER_ORDER = { debugToolbar: 0, find: 1 } as const;

/** The row under the tab strip: a group's overlay host starts with its tabs. */
const FIRST_ROW = 1;

export interface IGroupCornerSlot extends IDisposable {
    /** Rows the widget takes while shown; 0 while hidden. */
    setHeight(rows: number): void;
    /** The row of the widget's top in its group. */
    top(): number;
}

interface ISlot {
    readonly order: number;
    height: number;
}

/**
 * Widgets docked in the top right corner of an editor group (the debug toolbar, find) stack down in their
 * {@link CORNER_ORDER}, the first right under the tab strip; a hidden one gives its rows to those under it. Ours:
 * upstream's debug toolbar floats over the window, here it sits on top of find (owner's decision 2026-11-14).
 */
export class GroupCornerStack {
    private readonly groups = new Map<GroupId, ISlot[]>();
    private readonly onDidChangeEmitter = new Emitter<GroupId>();
    /** The tops of the group's slots may have moved: their owners reposition. */
    public readonly onDidChange = this.onDidChangeEmitter.event;

    public addSlot(groupId: GroupId, order: number): IGroupCornerSlot {
        const slot: ISlot = { order, height: 0 };
        const slots = this.groups.get(groupId) ?? [];
        slots.push(slot);
        slots.sort((a, b) => a.order - b.order);
        this.groups.set(groupId, slots);
        return {
            setHeight: (rows) => {
                if (slot.height === rows) return;
                slot.height = rows;
                this.onDidChangeEmitter.fire(groupId);
            },
            top: () => {
                let row = FIRST_ROW;
                for (const other of slots) {
                    if (other === slot) break;
                    row += other.height;
                }
                return row;
            },
            dispose: () => {
                const index = slots.indexOf(slot);
                if (index < 0) return;
                slots.splice(index, 1);
                if (slots.length === 0) this.groups.delete(groupId);
                if (slot.height > 0) this.onDidChangeEmitter.fire(groupId);
            },
        };
    }
}
