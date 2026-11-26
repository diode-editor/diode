import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type {
    ITypeHierarchyItem,
    TypeHierarchyProvider,
} from "../../../../editor/common/languages/iTypeHierarchySource.ts";
import type { TypeHierarchyMode } from "../../../common/stateKeys.ts";

import { HierarchyModel, type IHierarchyNode } from "./hierarchyTree.ts";

/** Upstream `TypesModel`: one tree of types, the direction and the session its items live in. */
export class TypesModel extends HierarchyModel {
    public constructor(
        private readonly provider: TypeHierarchyProvider,
        private readonly sessionId: number,
        public readonly direction: TypeHierarchyMode,
        roots: readonly ITypeHierarchyItem[],
        private readonly token: ICancellationToken,
    ) {
        super(roots);
    }

    protected async resolveChildren(node: IHierarchyNode): Promise<IHierarchyNode[]> {
        const { itemId } = node.item;
        const items =
            this.direction === "supertypes"
                ? await this.provider.provideSupertypes(this.sessionId, itemId, this.token)
                : await this.provider.provideSubtypes(this.sessionId, itemId, this.token);
        return items.map((item) => ({ item }));
    }
}
