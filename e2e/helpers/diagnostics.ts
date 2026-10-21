import type { NodeSnapshot } from "@tuidom/inspector/protocol";

import { dumpFrame } from "./frame.ts";
import type { HeadlessSession } from "./headlessSession.ts";
import { focusPath } from "./query.ts";


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

/** How long the post-mortem waits for the editor to answer each of its requests. */
const PROBE_TIMEOUT_MS = 10_000;

/** Narrowed to what is used — faked in tests. */
export type DumpableSession = Pick<HeadlessSession, "captureFrame" | "getDocument" | "getStderr">;

/**
 * Never throws and never waits longer than `probeTimeoutMs` per request: it is called from a failed test's hook,
 * and the editor that caused the failure may not answer — without a deadline the hook would hang for the whole
 * `hookTimeout`.
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
