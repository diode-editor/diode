import type { NodeSnapshot } from "@tuidom/all/inspector/protocol";

// Локаторы для e2e — селектор как адрес узла. `nodeId` эфемерен (виджеты
// пересоздают поддеревья при обновлении данных — id протухают между кадрами),
// поэтому целимся селектором, вычисляемым каждый раз заново. Синтаксис
// повторяет `tuidom/dom/tuiSelector.ts`, но матчит по снимку `NodeSnapshot`:
//
//     "EditorElement"          — по типу (имя класса)
//     "#greeting"              — по id
//     "@heading"               — по role
//     "PanelContainerElement SelectBoxElement" — потомок (через пробел)

interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface ParsedPart {
    tag?: string;
    id?: string;
    role?: string;
}

function parsePart(part: string): ParsedPart {
    const parsed: ParsedPart = {};
    let rest = part;
    const idMatch = /#([A-Za-z0-9_-]+)/.exec(rest);
    if (idMatch) {
        parsed.id = idMatch[1];
        rest = rest.replace(idMatch[0], "");
    }
    const roleMatch = /@([A-Za-z0-9_-]+)/.exec(rest);
    if (roleMatch) {
        parsed.role = roleMatch[1];
        rest = rest.replace(roleMatch[0], "");
    }
    if (rest.length > 0) parsed.tag = rest;
    return parsed;
}

function parseSelector(selector: string): ParsedPart[] {
    return selector
        .trim()
        .split(/\s+/u)
        .map(parsePart);
}

function matchesPart(node: NodeSnapshot, part: ParsedPart): boolean {
    if (part.tag !== undefined && node.type !== part.tag) return false;
    if (part.id !== undefined && node.id !== part.id) return false;
    if (part.role !== undefined && node.role !== part.role) return false;
    return true;
}

function collect(node: NodeSnapshot, parts: ParsedPart[], depth: number, out: NodeSnapshot[]): void {
    for (const child of node.children) {
        if (matchesPart(child, parts[depth])) {
            if (depth === parts.length - 1) out.push(child);
            else collect(child, parts, depth + 1, out);
        }
        // Тот же узел может начинать матч и глубже — потомок ищется на любом уровне.
        collect(child, parts, depth, out);
    }
}

/** Все узлы-потомки `root`, подходящие под селектор (pre-order). */
export function $$(root: NodeSnapshot | null, selector: string): NodeSnapshot[] {
    if (root === null) return [];
    const parts = parseSelector(selector);
    const out: NodeSnapshot[] = [];
    // Корень тоже участвует в матче первого сегмента.
    if (matchesPart(root, parts[0])) {
        if (parts.length === 1) out.push(root);
        else collect(root, parts, 1, out);
    }
    collect(root, parts, 0, out);
    // Дедуп: узел мог попасть и как корневой матч, и через collect.
    return [...new Set(out)];
}

/** Первый узел (pre-order), подходящий под селектор, или `null`. */
export function $(root: NodeSnapshot | null, selector: string): NodeSnapshot | null {
    return $$(root, selector)[0] ?? null;
}

/** Box первого узла по селектору; бросает, если не найден (локатор — обещание). */
export function boxOf(root: NodeSnapshot | null, selector: string): Box {
    const node = $(root, selector);
    if (node === null) throw new Error(`locator not found: ${selector}`);
    return node.box;
}

/** Центр box'а узла в 0-based ячейках — точка для клика. */
export function centerOf(root: NodeSnapshot | null, selector: string): { x: number; y: number } {
    const { x, y, width, height } = boxOf(root, selector);
    return { x: x + Math.floor(width / 2), y: y + Math.floor(height / 2) };
}

/** Самый глубокий узел с `focused` (в снимке их несколько по пути к листу). */
export function focusedLeaf(root: NodeSnapshot | null): NodeSnapshot | null {
    let leaf: NodeSnapshot | null = null;
    const visit = (n: NodeSnapshot): void => {
        if (n.focused) leaf = n;
        for (const c of n.children) visit(c);
    };
    if (root !== null) visit(root);
    return leaf;
}

/** Путь типов от корня до сфокусированного листа (для «где живёт фокус»). */
export function focusPath(root: NodeSnapshot | null): string[] {
    const path: string[] = [];
    let node = root;
    while (node !== null) {
        path.push(node.type);
        const next: NodeSnapshot | undefined = node.children.find((c) => c.focused);
        if (next === undefined) break;
        node = next;
    }
    return path;
}
