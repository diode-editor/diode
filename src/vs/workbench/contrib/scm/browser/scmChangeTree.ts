import type { IScmChange } from "./changesService.ts";

/** Лист дерева изменений — один изменённый файл. */
export interface IScmTreeFile {
    readonly kind: "file";
    readonly change: IScmChange;
    /** Имя файла (последний сегмент display-пути) — метка строки в tree-режиме. */
    readonly name: string;
}

/** Папка (возможно, компакт-цепочка) с детьми в порядке показа. */
export interface IScmTreeFolder {
    readonly kind: "folder";
    /** Полный путь узла от корня репозитория ("src/vs/workbench") — идентичность строки. */
    readonly path: string;
    /** Метка: компакт-цепочка ("src/vs/workbench") либо один сегмент. */
    readonly label: string;
    readonly children: readonly ScmTreeNode[];
}

export type ScmTreeNode = IScmTreeFile | IScmTreeFolder;

/** Путь для показа: относительный от git; если расширение его не прислало — basename из URI. */
export function displayPath(change: IScmChange): string {
    if (change.path !== "") return change.path;
    const uriPath = change.uri.path;
    return uriPath.slice(uriPath.lastIndexOf("/") + 1);
}

/** Плоский порядок — как у прежнего провайдера: стабильная сортировка display-пути. */
export function sortChangesFlat(changes: readonly IScmChange[]): readonly IScmChange[] {
    return [...changes].sort((a, b) => displayPath(a).localeCompare(displayPath(b)));
}

/** Промежуточный узел trie при сборке (до компакции и сортировки). */
interface TrieNode {
    readonly folders: Map<string, TrieNode>;
    readonly files: IScmTreeFile[];
}

/**
 * Иерархия изменений с VS Code-компакцией: папка с единственным ребёнком-папкой
 * и без файлов сливается с ним в один узел ("src/vs/workbench") — на глубоких
 * путях узкого сайдбара отступы не съедают ширину. Порядок на каждом уровне:
 * папки раньше файлов, внутри групп — по алфавиту.
 */
export function buildScmTree(changes: readonly IScmChange[]): readonly ScmTreeNode[] {
    const root: TrieNode = { folders: new Map(), files: [] };

    for (const change of changes) {
        const segments = displayPath(change).split("/");
        const name = segments.pop() as string;
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

/** Превращает trie-уровень в отсортированные узлы, компактируя одиночные цепочки. */
function convert(node: TrieNode, pathPrefix: string): ScmTreeNode[] {
    const folders: IScmTreeFolder[] = [...node.folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([segment, child]) => {
            // Компакция: пока у папки ровно один ребёнок-папка и нет файлов —
            // сливаем сегменты в одну метку.
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
