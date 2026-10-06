import type { NodeSnapshot } from "@tuidom/inspector/protocol";

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

/** Сколько пост-мортем ждёт ответа редактора на каждый свой запрос. */
const PROBE_TIMEOUT_MS = 10_000;

/** Что пост-мортему нужно от сессии (сужено до используемого — фейкается в тесте). */
export type DumpableSession = Pick<HeadlessSession, "captureFrame" | "getDocument" | "getStderr">;

/**
 * Снимок состояния сессии для отчёта о падении: нумерованный кадр, путь фокуса,
 * скелет дерева, stderr и (если задан) путь к сохранённому temp-корню. Ничего не
 * бросает и не ждёт дольше `probeTimeoutMs` на запрос — вызывается из хука
 * упавшего теста, где диагностика не имеет права ни уронить репортер, ни
 * съесть прогон: редактор, из-за которого тест упал, может и не ответить
 * (завис, умер), а без срока хук молчал бы весь `hookTimeout`.
 */
export async function dumpSession(
    session: DumpableSession,
    opts: { root?: string; label?: string; probeTimeoutMs?: number } = {},
): Promise<string> {
    const probeTimeoutMs = opts.probeTimeoutMs ?? PROBE_TIMEOUT_MS;
    const parts: string[] = [];
    if (opts.label !== undefined) parts.push(`# ${opts.label}`);
    try {
        parts.push("── frame ──", dumpFrame(await within(session.captureFrame(), probeTimeoutMs)));
    } catch (err) {
        parts.push(`── frame ── <capture failed: ${errMsg(err)}>`);
    }
    try {
        const { root } = await within(session.getDocument(), probeTimeoutMs);
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

/** `promise` наперегонки со сроком: не ответил за `timeoutMs` — отказ с понятной причиной. */
function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`no reply in ${String(timeoutMs)}ms`));
        }, timeoutMs);
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve(value);
            },
            (error: unknown) => {
                clearTimeout(timer);
                reject(error instanceof Error ? error : new Error(String(error)));
            },
        );
    });
}

function errMsg(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
