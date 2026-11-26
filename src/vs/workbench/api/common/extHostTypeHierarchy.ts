import type * as vscode from "vscode";

import type { ITypeHierarchyItem } from "../../../editor/common/languages/iTypeHierarchySource.ts";

import { HierarchySessions } from "./extHostHierarchySessions.ts";

export class TypeHierarchySessions extends HierarchySessions<vscode.TypeHierarchyItem> {
    public constructor() {
        super("missing type hierarchy item");
    }

    /** The direct supertypes or subtypes of an item of this session. */
    public types(sessionId: number, raw: unknown): ITypeHierarchyItem[] {
        // Released while the provider was thinking: nothing asks about this answer any more.
        const cache = this.sessions.get(sessionId);
        if (cache === undefined || !Array.isArray(raw)) return [];
        const result: ITypeHierarchyItem[] = [];
        for (const item of raw as unknown[]) {
            const wire = this.remember(cache, item);
            if (wire !== null) result.push(wire);
        }
        return result;
    }
}
