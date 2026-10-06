import { DEFAULT_COLOR } from "@tuidom/core/common/colorUtils";
import { StyleFlags } from "@tuidom/core/common/styleFlags";
import type { CellSnapshot, GridSnapshot } from "@tuidom/core/rendering/gridSnapshot";
import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import { $$ } from "../../e2e/helpers/query.ts";

// Текстовые представления для вывода `npm run drive`. Чистые функции: всё, что
// печатает CLI, проходит через них — тестируются без живого редактора.

/** Packed RGB → `#rrggbb`; сентинел «цвет терминала по умолчанию» → `default`. */
export function colorHex(color: number): string {
    if (color === DEFAULT_COLOR) return "default";
    return `#${color.toString(16).padStart(6, "0")}`;
}

/** Битовая маска стиля → имена флагов (`bold+underline`), пустая → `none`. */
export function styleNames(style: number): string {
    const names = Object.entries(StyleFlags)
        .filter(([, bit]) => bit !== 0 && (style & bit) !== 0)
        .map(([name]) => name.toLowerCase());
    return names.length === 0 ? "none" : names.join("+");
}

export interface CellInfo {
    readonly x: number;
    readonly y: number;
    readonly char: string;
    readonly codePoint: string;
    readonly fg: string;
    readonly bg: string;
    readonly style: string;
    readonly width: number;
}

/** Ячейка кадра в читаемом виде. Глифы codicon'ов неразличимы на глаз — отсюда код-пойнт. */
export function cellInfo(frame: GridSnapshot, x: number, y: number): CellInfo {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= frame.cols || y >= frame.rows) {
        throw new Error(`ячейка ${String(x)},${String(y)} вне кадра ${String(frame.cols)}x${String(frame.rows)}`);
    }
    const cell: CellSnapshot = frame.cells[y * frame.cols + x];
    const cp = cell.char.codePointAt(0);
    return {
        x,
        y,
        char: cell.char,
        codePoint: cp === undefined ? "" : `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`,
        fg: colorHex(cell.fg),
        bg: colorHex(cell.bg),
        style: styleNames(cell.style),
        width: cell.width,
    };
}

export function formatCell(info: CellInfo): string {
    return `${String(info.x)},${String(info.y)} ${JSON.stringify(info.char)} ${info.codePoint} fg=${info.fg} bg=${info.bg} style=${info.style} width=${String(info.width)}`;
}

/**
 * Строки кадра с отрезанными хвостовыми пробелами. `numbered` — с номером
 * строки (`y`) слева и линейкой колонок сверху: координаты для `click`/`cell`
 * читаются прямо с экрана.
 */
export function screenText(frame: GridSnapshot, numbered: boolean): string {
    const lines: string[] = [];
    for (let y = 0; y < frame.rows; y++) {
        let line = "";
        for (let x = 0; x < frame.cols; x++) line += frame.cells[y * frame.cols + x].char;
        lines.push(line.replace(/\s+$/u, ""));
    }
    if (!numbered) return lines.join("\n");
    const ruler = Array.from({ length: frame.cols }, (_, x) =>
        x % 10 === 0 ? String((x / 10) % 10) : x % 5 === 0 ? "+" : "·",
    );
    return [`  |${ruler.join("")}`, ...lines.map((line, y) => `${String(y).padStart(2, " ")}|${line}`)].join("\n");
}

export interface TreeOptions {
    /** Глубина от корня (или от каждого совпадения `selector`). */
    readonly depth?: number;
    /** Печатать `state` узлов. */
    readonly state?: boolean;
}

function nodeLine(node: NodeSnapshot, state: boolean): string {
    const id = node.id !== undefined ? `#${node.id}` : "";
    const role = node.role !== undefined ? `@${node.role}` : "";
    const box = `[${String(node.box.x)},${String(node.box.y)} ${String(node.box.width)}x${String(node.box.height)}]`;
    const focus = node.focused ? " *focus" : "";
    const st = state && node.state !== undefined ? ` ${JSON.stringify(node.state)}` : "";
    return `${node.type}${id}${role} ${box}${focus}${st}`;
}

/** Дерево узлов отступами: тип#id@role [x,y wxh] *focus {state}. */
export function treeText(root: NodeSnapshot | null, options: TreeOptions = {}): string {
    if (root === null) return "<нет документа>";
    const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
    const lines: string[] = [];
    const visit = (node: NodeSnapshot, depth: number): void => {
        lines.push(`${"  ".repeat(depth)}${nodeLine(node, options.state === true)}`);
        if (depth < maxDepth) for (const child of node.children) visit(child, depth + 1);
    };
    visit(root, 0);
    return lines.join("\n");
}

/** Поддеревья всех совпадений селектора; пусто — сообщение, а не тишина. */
export function selectedTreesText(root: NodeSnapshot | null, selector: string, options: TreeOptions = {}): string {
    const matches = $$(root, selector);
    if (matches.length === 0) return `<нет узлов по селектору ${selector}>`;
    return matches.map((node) => treeText(node, options)).join("\n");
}

/**
 * Путь от корня до сфокусированного листа: `Тип#id > … > Лист`. Флаг `focused`
 * в снимке стоит только на самом листе, поэтому путь — поиском, а не спуском
 * по флагам (как `focusPath` e2e).
 */
export function focusText(root: NodeSnapshot | null): string {
    const path = root === null ? null : pathToFocused(root);
    if (path === null) return "<нет фокуса>";
    return path.map((n) => `${n.type}${n.id !== undefined ? `#${n.id}` : ""}`).join(" > ");
}

function pathToFocused(node: NodeSnapshot): NodeSnapshot[] | null {
    // Самый глубокий: сперва ищем в детях, сам узел — только если глубже никого.
    for (const child of node.children) {
        const sub = pathToFocused(child);
        if (sub !== null) return [node, ...sub];
    }
    return node.focused ? [node] : null;
}
