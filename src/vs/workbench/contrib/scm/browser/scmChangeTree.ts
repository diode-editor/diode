import type { IScmChange } from "./changesService.ts";

export interface IScmTreeFile {
    readonly kind: "file";
    readonly change: IScmChange;
    readonly name: string;
}

export interface IScmTreeFolder {
    readonly kind: "folder";
    /** Relative to the repository root — the row identity. */
    readonly path: string;
    /** Compacted chain ("src/vs/workbench") or a single segment. */
    readonly label: string;
    readonly children: readonly ScmTreeNode[];
}

export type ScmTreeNode = IScmTreeFile | IScmTreeFolder;

export function displayPath(change: IScmChange): string {
    if (change.path !== "") return change.path;
    const uriPath = change.uri.path;
    return uriPath.slice(uriPath.lastIndexOf("/") + 1);
}

export function sortChangesFlat(changes: readonly IScmChange[]): readonly IScmChange[] {
    return [...changes].sort((a, b) => displayPath(a).localeCompare(displayPath(b)));
}

interface TrieNode {
    readonly folders: Map<string, TrieNode>;
    readonly files: IScmTreeFile[];
}

/**
 * VS Code compaction: a folder with a single child folder and no files merges with it —
 * indentation does not eat the narrow sidebar. Folders before files, alphabetical within.
 */
export function buildScmTree(changes: readonly IScmChange[]): readonly ScmTreeNode[] {
    const root: TrieNode = { folders: new Map(), files: [] };

    for (const change of changes) {
        // Split name and folders at the last "/", not via split+pop: this way the name
        // is a string by construction, without asserting "array is non-empty".
        const full = displayPath(change);
        const lastSlash = full.lastIndexOf("/");
        const name = full.slice(lastSlash + 1);
        const segments = lastSlash < 0 ? [] : full.slice(0, lastSlash).split("/");
        let node = root;
        for (const segment of segments) {
            let next = node.folders.get(segment);
            if (!next) {
                next = { folders: new Map(), files: [] };
                node.folders.set(segment, next);
            }
            node = next;
        }
        node.files.push({ kind: "file", change, name });
    }

    return convert(root, "");
}

function convert(node: TrieNode, pathPrefix: string): ScmTreeNode[] {
    const folders: IScmTreeFolder[] = [...node.folders.entries()]
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
