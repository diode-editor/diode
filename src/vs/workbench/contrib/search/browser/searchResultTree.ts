export interface ISearchTreeFile<T> {
    readonly kind: "file";
    readonly item: T;
    readonly name: string;
}

export interface ISearchTreeFolder<T> {
    readonly kind: "folder";
    /** Row identity. */
    readonly path: string;
    readonly label: string;
    readonly children: readonly SearchTreeNode<T>[];
}

export type SearchTreeNode<T> = ISearchTreeFile<T> | ISearchTreeFolder<T>;

interface TrieNode<T> {
    readonly folders: Map<string, TrieNode<T>>;
    readonly files: ISearchTreeFile<T>[];
}

/**
 * Twin of {@link import("../../scm/browser/scmChangeTree.ts").buildScmTree} (that one walks IScmChange);
 * with a third consumer, a shared helper is worth extracting.
 */
export function buildSearchTree<T extends { readonly relPath: string }>(
    items: Iterable<T>,
): readonly SearchTreeNode<T>[] {
    const root: TrieNode<T> = { folders: new Map(), files: [] };

    for (const item of items) {
        // Split the name and folders at the last "/", not via split+pop: this way the name
        // is a string by construction, with no "array is non-empty" assertion.
        const lastSlash = item.relPath.lastIndexOf("/");
        const name = item.relPath.slice(lastSlash + 1);
        const segments = lastSlash < 0 ? [] : item.relPath.slice(0, lastSlash).split("/");
        let node = root;
        for (const segment of segments) {
            let next = node.folders.get(segment);
            if (!next) {
                next = { folders: new Map(), files: [] };
                node.folders.set(segment, next);
            }
            node = next;
        }
        node.files.push({ kind: "file", item, name });
    }

    return convert(root, "");
}

function convert<T extends { readonly relPath: string }>(node: TrieNode<T>, pathPrefix: string): SearchTreeNode<T>[] {
    const folders: ISearchTreeFolder<T>[] = [...node.folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([segment, child]) => {
            let label = segment;
            let current = child;
            while (current.files.length === 0 && current.folders.size === 1) {
                const [nextSegment, nextChild] = [...current.folders.entries()][0];
                label = `${label}/${nextSegment}`;
                current = nextChild;
            }
            const path = pathPrefix === "" ? label : `${pathPrefix}/${label}`;
            return { kind: "folder", path, label, children: convert(current, path) };
        });

    const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
    return [...folders, ...files];
}
