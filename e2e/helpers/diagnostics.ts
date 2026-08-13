import type { NodeSnapshot } from "@tuidom/all/inspector/protocol";

import { dumpFrame } from "./frame.ts";
import type { HeadlessSession } from "./headlessSession.ts";
import { focusPath } from "./query.ts";

// Пост-мортем для упавшего функционального e2e. Раньше при падении vitest печатал
// кадр одной простынёй; здесь — нумерованный кадр, путь фокуса и скелет дерева,
// чтобы падение сразу показывало, что было на экране и куда ушёл фокус.

/** Отступами — дерево типов с box и (если есть) state; обрезано по глубине. */
export function treeSkeleton(root: NodeSnapshot | null, maxDepth = 40): string {
    if (root === null) return "<no document>";
    const lines: string[] = [];
    const visit = (n: NodeSnapshot, depth: number): void => {
        const indent = "  ".repeat(depth);
        const mark = n.focused ? " *focus" : "";
        const state = n.state !== undefined ? ` ${JSON.stringify(n.state)}` : "";
        lines.push(`${indent}${n.type} [${String(n.box.x)},${String(n.box.y)} ${String(n.box.width)}x${String(n.box.height)}]${mark}${state}`);
        if (depth < maxDepth) for (const c of n.children) visit(c, depth + 1);
    };
    visit(root, 0);
    return lines.join("\n");
}

/**
 * Снимок состояния сессии для отчёта о падении: нумерованный кадр, путь фокуса,
 * скелет дерева, stderr и (если задан) путь к сохранённому temp-корню. Ничего не
 * бросает — вызывается из `onTestFailed`, где важно не уронить сам репортер.
 */
export async function dumpSession(session: HeadlessSession, opts: { root?: string; label?: string } = {}): Promise<string> {
    const parts: string[] = [];
    if (opts.label !== undefined) parts.push(`# ${opts.label}`);
    try {
        parts.push("── frame ──", dumpFrame(await session.captureFrame()));
    } catch (err) {
        parts.push(`── frame ── <capture failed: ${errMsg(err)}>`);
    }
    try {
        const { root } = await session.getDocument();
        parts.push(`── focus ── ${focusPath(root).join(" > ") || "<none>"}`);
        parts.push("── tree ──", treeSkeleton(root));
    } catch (err) {
        parts.push(`── tree ── <getDocument failed: ${errMsg(err)}>`);
    }
    const stderr = session.getStderr().trim();
    if (stderr.length > 0) parts.push("── stderr ──", stderr);
    if (opts.root !== undefined) parts.push(`── session root ── ${opts.root}`);
    return parts.join("\n");
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
