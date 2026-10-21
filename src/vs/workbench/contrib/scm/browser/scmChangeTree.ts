import type { IScmChange } from "./changesService.ts";

export interface IScmTreeFile {
    readonly kind: "file";
    readonly change: IScmChange;
    readonly name: string;
}

export interface IScmTreeFolder {
    readonly kind: "folder";
    /** От корня репозитория — идентичность строки. */
    readonly path: string;
    /** Компакт-цепочка ("src/vs/workbench") либо один сегмент. */
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
 * Компакция VS Code: папка с единственной папкой-ребёнком и без файлов сливается с ней —
 * отступы не съедают узкий сайдбар. Папки раньше файлов, внутри — по алфавиту.
 */
export function buildScmTree(changes: readonly IScmChange[]): readonly ScmTreeNode[] {
    const root: TrieNode = { folders: new Map(), files: [] };

    for (const change of changes) {
        // Имя и папки режем по последнему «/», а не через split+pop: так имя
        // получается строкой по построению, без утверждения «массив непуст».
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
