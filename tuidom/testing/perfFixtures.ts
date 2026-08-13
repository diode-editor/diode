import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { ITreeDataProvider, ITreeItem } from "../ui/tree/iTreeDataProvider.ts";

// ─── Файловые фикстуры ──────────────────────────────────────────────────────

/** Создаёт уникальную временную директорию под os.tmpdir(). */
export function createTempDir(prefix = "vexx-perf-"): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Рекурсивно удаляет директорию (для afterAll/afterEach). */
export function cleanupDir(dirPath: string): void {
    fs.rmSync(dirPath, { recursive: true, force: true });
}

export interface GenerateFileTreeOptions {
    /** Сколько файлов всего сгенерировать. */
    files: number;
    /** Сколько файлов кладём в каждую директорию (default 50). */
    filesPerDir?: number;
    /** Сколько разных директорий на каждом уровне вложенности (default 8). */
    breadth?: number;
    /** Максимальная глубина вложенности директорий (default 4). */
    maxDepth?: number;
}

/**
 * Генерирует вложенное дерево пустых файлов под `root`.
 *
 * Файлы раскидываются по директориям разной глубины, чтобы фикстура была
 * похожа на реальный репозиторий (а не плоский список). Возвращает фактическое
 * число записанных файлов.
 */
export function generateFileTree(root: string, options: GenerateFileTreeOptions): number {
    const { files, filesPerDir = 50, breadth = 8, maxDepth = 4 } = options;

    let written = 0;
    let dirIndex = 0;

    while (written < files) {
        // Псевдослучайная (детерминированная) вложенность для разнообразия.
        const depth = (dirIndex % maxDepth) + 1;
        const segments: string[] = [];
        for (let level = 0; level < depth; level++) {
            const bucket = Math.floor(dirIndex / breadth ** level) % breadth;
            segments.push(`dir${level}_${bucket}`);
        }

        const dirAbs = path.join(root, ...segments);
        fs.mkdirSync(dirAbs, { recursive: true });

        for (let f = 0; f < filesPerDir && written < files; f++) {
            fs.writeFileSync(path.join(dirAbs, `module${written}.ts`), "");
            written++;
        }

        dirIndex++;
    }

    return written;
}

// ─── In-memory дерево для виджета TreeViewElement ─────────────────────────────

export interface PerfTreeNode {
    id: string;
    label: string;
    children?: PerfTreeNode[];
}

/**
 * Строит вложенное in-memory дерево примерно из `targetCount` узлов с заданным
 * ветвлением `fanout`. Без обращений к файловой системе — чтобы бенчмарки
 * виджета мерили стоимость flatten/сканов, а не диск.
 */
export function buildInMemoryTree(targetCount: number, fanout = 6): PerfTreeNode[] {
    let created = 0;
    const makeLevel = (prefix: string, depth: number): PerfTreeNode[] => {
        const nodes: PerfTreeNode[] = [];
        for (let i = 0; i < fanout && created < targetCount; i++) {
            const id = `${prefix}/${i}`;
            created++;
            const node: PerfTreeNode = { id, label: `node-${id}` };
            // Ветвимся, пока не набрали нужное число узлов и не ушли слишком глубоко.
            if (depth < 5 && created < targetCount) {
                node.children = makeLevel(id, depth + 1);
            }
            nodes.push(node);
        }
        return nodes;
    };
    return makeLevel("n", 0);
}

/** ITreeDataProvider поверх in-memory дерева PerfTreeNode. */
export function makeInMemoryTreeProvider(roots: PerfTreeNode[]): ITreeDataProvider<PerfTreeNode> {
    return {
        getTreeItem(element: PerfTreeNode): ITreeItem {
            return {
                label: element.label,
                collapsible: (element.children?.length ?? 0) > 0,
            };
        },
        getChildren(element?: PerfTreeNode): PerfTreeNode[] {
            if (!element) return roots;
            return element.children ?? [];
        },
        getKey(element: PerfTreeNode): string {
            return element.id;
        },
    };
}

/** Собирает все collapsible-узлы дерева (для массового раскрытия в бенче). */
export function collectCollapsibleNodes(roots: PerfTreeNode[]): PerfTreeNode[] {
    const out: PerfTreeNode[] = [];
    const walk = (nodes: PerfTreeNode[]): void => {
        for (const node of nodes) {
            if (node.children && node.children.length > 0) {
                out.push(node);
                walk(node.children);
            }
        }
    };
    walk(roots);
    return out;
}
