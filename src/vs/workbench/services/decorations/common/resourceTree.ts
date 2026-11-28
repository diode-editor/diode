import type { Uri } from "../../../../base/common/uri.ts";

interface IResourceEntry<V> {
    readonly uri: Uri;
    readonly value: V;
}

interface INode<V> {
    readonly children: Map<string, INode<V>>;
    /** By the whole uri: the same path with another query or fragment is another key of the same node. */
    readonly values: Map<string, IResourceEntry<V>>;
}

function newNode<V>(): INode<V> {
    return { children: new Map(), values: new Map() };
}

function segmentsOf(uri: Uri): string[] {
    return [uri.scheme, uri.authority, ...uri.path.split("/").filter((segment) => segment !== "")];
}

/**
 * The part of upstream's `TernarySearchTree.forUris` the decorations need: the key is the whole uri (scheme,
 * authority, path, query, fragment), and {@link descendants} finds what lies below a resource.
 */
export class ResourceTree<V> {
    private readonly root: INode<V> = newNode();

    public get(uri: Uri): V | undefined {
        return this.nodeOf(uri)?.values.get(uri.toString())?.value;
    }

    public set(uri: Uri, value: V): void {
        let node = this.root;
        for (const segment of segmentsOf(uri)) {
            let child = node.children.get(segment);
            if (child === undefined) {
                child = newNode();
                node.children.set(segment, child);
            }
            node = child;
        }
        node.values.set(uri.toString(), { uri, value });
    }

    public *entries(): Generator<IResourceEntry<V>> {
        yield* walk(this.root);
    }

    /** Upstream `findSuperstr`: every key under `uri` but `uri` itself, the same path with a query included. */
    public *descendants(uri: Uri): Generator<IResourceEntry<V>> {
        const node = this.nodeOf(uri);
        if (node === undefined) return;
        const key = uri.toString();
        for (const [childKey, entry] of node.values) {
            if (childKey !== key) yield entry;
        }
        for (const child of node.children.values()) yield* walk(child);
    }

    private nodeOf(uri: Uri): INode<V> | undefined {
        let node: INode<V> | undefined = this.root;
        for (const segment of segmentsOf(uri)) {
            node = node.children.get(segment);
            if (node === undefined) return undefined;
        }
        return node;
    }
}

function* walk<V>(node: INode<V>): Generator<IResourceEntry<V>> {
    yield* node.values.values();
    for (const child of node.children.values()) yield* walk(child);
}
