import type { ITreeDataProvider, ITreeItem } from "@tuidom/elements/tree/iTreeDataProvider";

import { codicon } from "../../../../base/common/codicons.ts";
import { comparePositions } from "../../../../editor/common/core/iPosition.ts";
import type { IRange } from "../../../../editor/common/core/iRange.ts";
import type { ICallHierarchyItem } from "../../../../editor/common/languages/iCallHierarchySource.ts";
import type { IProductIconService } from "../../../../platform/theme/common/productIconService.ts";

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

export interface IHierarchyNode {
    readonly item: ICallHierarchyItem;
    /** Call hierarchy only: where the call is made; a root has none. */
    readonly fromRanges?: readonly IRange[];
    /** The promise, not its value: expanding a root and the tree's own reread must not ask twice. */
    children?: Promise<IHierarchyNode[]>;
}

function compareNodes(a: IHierarchyNode, b: IHierarchyNode): number {
    // Stryker disable next-line EqualityOperator: the uris are different here, `<` and `<=` agree
    if (a.item.uri !== b.item.uri) return a.item.uri < b.item.uri ? -1 : 1;
    return comparePositions(a.item.range.start, b.item.range.start);
}

/** One tree: its roots and the way to ask for children. Children are asked once, on expansion. */
export abstract class HierarchyModel {
    public readonly roots: readonly IHierarchyNode[];

    protected constructor(roots: readonly ICallHierarchyItem[]) {
        this.roots = roots.map((item) => ({ item }));
    }

    public getChildren(node: IHierarchyNode): Promise<IHierarchyNode[]> {
        node.children ??= this.resolveChildren(node).then((children) => children.sort(compareNodes));
        return node.children;
    }

    protected abstract resolveChildren(node: IHierarchyNode): Promise<IHierarchyNode[]>;
}

export class HierarchyTreeProvider implements ITreeDataProvider<IHierarchyNode> {
    public onChange?: (element?: IHierarchyNode) => void;

    private model: HierarchyModel | null = null;
    /** Rerooting shows items with the same ids: the tree must not take them for the rows it already expanded. */
    private generation = 0;

    public constructor(private readonly icons: IProductIconService) {}

    public setModel(model: HierarchyModel | null): void {
        this.model = model;
        // Stryker disable next-line UpdateOperator: any step gives new keys
        this.generation++;
    }

    public getChildren(element?: IHierarchyNode): IHierarchyNode[] | Promise<IHierarchyNode[]> {
        if (this.model === null) return [];
        return element === undefined ? [...this.model.roots] : this.model.getChildren(element);
    }

    public getKey(element: IHierarchyNode): string {
        return `${String(this.generation)}:${String(element.item.itemId)}`;
    }

    public getTreeItem(element: IHierarchyNode): ITreeItem {
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
