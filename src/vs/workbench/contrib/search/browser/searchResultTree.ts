/** Лист дерева результатов поиска — файл (его матчи вешает потребитель). */
export interface ISearchTreeFile<T> {
    readonly kind: "file";
    readonly item: T;
    /** Имя файла (последний сегмент relPath) — метка строки в tree-режиме. */
    readonly name: string;
}

/** Папка (возможно, компакт-цепочка) с детьми в порядке показа. */
export interface ISearchTreeFolder<T> {
    readonly kind: "folder";
    /** Полный путь узла от корня воркспейса ("src/vs/workbench") — идентичность строки. */
    readonly path: string;
    /** Метка: компакт-цепочка ("src/vs/workbench") либо один сегмент. */
    readonly label: string;
    readonly children: readonly SearchTreeNode<T>[];
}

export type SearchTreeNode<T> = ISearchTreeFile<T> | ISearchTreeFolder<T>;

/** Промежуточный узел trie при сборке (до компакции и сортировки). */
interface TrieNode<T> {
    readonly folders: Map<string, TrieNode<T>>;
    readonly files: ISearchTreeFile<T>[];
}

/**
 * Иерархия результатов поиска с VS Code-компакцией: папка с единственным
 * ребёнком-папкой и без файлов сливается с ним в один узел ("src/vs/workbench")
 * — на глубоких путях узкого сайдбара отступы не съедают ширину. Порядок на
 * каждом уровне: папки раньше файлов, внутри групп — по алфавиту. Близнец
 * {@link import("../../scm/browser/scmChangeTree.ts").buildScmTree} (тот ходит
 * по IScmChange); при третьем потребителе стоит вынести общий хелпер.
 */
export function buildSearchTree<T extends { readonly relPath: string }>(
    items: Iterable<T>,
): readonly SearchTreeNode<T>[] {
    const root: TrieNode<T> = { folders: new Map(), files: [] };

    for (const item of items) {
        const segments = item.relPath.split("/");
        const name = segments.pop()!;
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

/** Превращает trie-уровень в отсортированные узлы, компактируя одиночные цепочки. */
function convert<T extends { readonly relPath: string }>(node: TrieNode<T>, pathPrefix: string): SearchTreeNode<T>[] {
    const folders: ISearchTreeFolder<T>[] = [...node.folders.entries()]
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
