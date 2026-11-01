import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { codicon } from "../../../../base/common/codicons.ts";
import type { IPosition } from "../../../../editor/common/core/iPosition.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type {
    CallHierarchyProvider,
    ICallHierarchyItem,
} from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";
import type { CallHierarchyMode } from "../../../common/stateKeys.ts";

/** `vscode.SymbolTag.Deprecated`. */
const SYMBOL_TAG_DEPRECATED = 1;

/** Upstream references-view `utils.ts:_themeIconIds`, indexed by `vscode.SymbolKind`. */
const SYMBOL_KIND_ICONS: readonly string[] = [
    "symbol-file",
    "symbol-module",
    "symbol-namespace",
    "symbol-package",
    "symbol-class",
    "symbol-method",
    "symbol-property",
    "symbol-field",
    "symbol-constructor",
    "symbol-enum",
    "symbol-interface",
    "symbol-function",
    "symbol-variable",
    "symbol-constant",
    "symbol-string",
    "symbol-number",
    "symbol-boolean",
    "symbol-array",
    "symbol-object",
    "symbol-key",
    "symbol-null",
    "symbol-enum-member",
    "symbol-struct",
    "symbol-event",
    "symbol-operator",
    "symbol-type-parameter",
];

export interface ICallNode {
    readonly item: ICallHierarchyItem;
    /** Where the call is made; a root has none. */
    readonly fromRanges?: readonly IRange[];
    /** The promise, not its value: expanding a root and the tree's own reread must not ask twice. */
    children?: Promise<ICallNode[]>;
}

function compareNodes(a: ICallNode, b: ICallNode): number {
    // Stryker disable next-line EqualityOperator: the uris are different here, `<` and `<=` agree
    if (a.item.uri !== b.item.uri) return a.item.uri < b.item.uri ? -1 : 1;
    return comparePositions(a.item.range.start, b.item.range.start);
}

/** One tree: the roots, the direction and the session its items live in. Children are asked once, on expansion. */
export class CallsModel {
    public readonly roots: readonly ICallNode[];

    public constructor(
        private readonly provider: CallHierarchyProvider,
        private readonly sessionId: number,
        public readonly direction: CallHierarchyMode,
        roots: readonly ICallHierarchyItem[],
        private readonly token: ICancellationToken,
    ) {
        this.roots = roots.map((item) => ({ item }));
    }

    public getChildren(node: ICallNode): Promise<ICallNode[]> {
        node.children ??= this.resolveChildren(node);
        return node.children;
    }

    private async resolveChildren(node: ICallNode): Promise<ICallNode[]> {
        const { itemId } = node.item;
        const children: ICallNode[] =
            this.direction === "incoming"
                ? (await this.provider.provideIncomingCalls(this.sessionId, itemId, this.token)).map((call) => ({
                      item: call.from,
                      fromRanges: call.fromRanges,
                  }))
                : (await this.provider.provideOutgoingCalls(this.sessionId, itemId, this.token)).map((call) => ({
                      item: call.to,
                      fromRanges: call.fromRanges,
                  }));
        return children.sort(compareNodes);
    }
}

/**
 * Upstream `CallItemDataProvider.getTreeItem`: outgoing opens the target, incoming the earliest call inside the
 * caller. `fromRanges` of an incoming call are inside `item.uri` by the API's contract.
 */
export function callNodeTarget(direction: CallHierarchyMode, node: ICallNode): IPosition {
    const start = node.item.selectionRange.start;
    if (direction === "outgoing") return start;
    let first: IPosition | undefined;
    // Stryker disable next-line ArrayDeclaration: a junk element has no `start`, so `first` stays empty just the same
    for (const range of node.fromRanges ?? []) {
        // Stryker disable next-line EqualityOperator: equal positions are the same answer
        if (first === undefined || comparePositions(range.start, first) < 0) first = range.start;
    }
    return first ?? start;
}

export class CallHierarchyTreeProvider implements ITreeDataProvider<ICallNode> {
    public onChange?: (element?: ICallNode) => void;

    private model: CallsModel | null = null;
    /** Rerooting shows items with the same ids: the tree must not take them for the rows it already expanded. */
    private generation = 0;

    public constructor(private readonly icons: IProductIconService) {}

    public setModel(model: CallsModel | null): void {
        this.model = model;
        // Stryker disable next-line UpdateOperator: any step gives new keys
        this.generation++;
    }

    public getChildren(element?: ICallNode): ICallNode[] | Promise<ICallNode[]> {
        if (this.model === null) return [];
        return element === undefined ? [...this.model.roots] : this.model.getChildren(element);
    }

    public getKey(element: ICallNode): string {
        return `${String(this.generation)}:${String(element.item.itemId)}`;
    }

    public getTreeItem(element: ICallNode): ITreeItem {
        const { name, detail, kind, tags } = element.item;
        const icon = SYMBOL_KIND_ICONS.at(kind);
        return {
            label: tags?.includes(SYMBOL_TAG_DEPRECATED) === true ? `${name} (deprecated)` : name,
            collapsible: true,
            // Upstream's row carries a command: the mouse opens it, the chevron only expands.
            openable: true,
            ...(detail === undefined ? {} : { description: detail }),
            ...(icon === undefined ? {} : { icon: this.icons.glyph(codicon(icon)) }),
        };
    }
}
