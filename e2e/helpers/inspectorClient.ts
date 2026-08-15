import * as net from "node:net";

import WebSocket from "ws";

import {
    type GetDocumentResult,
    InspectorMethod,
    type InspectorResponse,
    type InspectorSuccessResponse,
    type NodeSnapshot,
} from "@tuidom/inspector/protocol";

/** Pick an ephemeral free TCP port on the loopback interface. */
export function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => {
            const addr = srv.address();
            const port = typeof addr === "object" && addr !== null ? addr.port : 0;
            srv.close(() => resolve(port));
        });
    });
}

/** Connect to a WebSocket URL, retrying until it opens or `timeoutMs` elapses. */
export function connectWithRetry(url: string, timeoutMs: number): Promise<WebSocket> {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve, reject) => {
        const attempt = (): void => {
            const ws = new WebSocket(url);
            ws.once("open", () => resolve(ws));
            ws.once("error", () => {
                if (Date.now() > deadline) reject(new Error(`ws connect to ${url} timed out`));
                else setTimeout(attempt, 100);
            });
        };
        attempt();
    });
}

/** Send `TUIDom.getDocument` and resolve with the result (rejects on protocol error). */
export function getDocument(ws: WebSocket, id = 1): Promise<GetDocumentResult> {
    return new Promise((resolve, reject) => {
        const onMessage = (data: WebSocket.RawData): void => {
            const res = JSON.parse(data.toString()) as InspectorResponse;
            if (res.id !== id) return; // not our reply
            ws.off("message", onMessage);
            ws.off("error", onError);
            if ("error" in res) {
                reject(new Error(res.error.message));
                return;
            }
            resolve((res as InspectorSuccessResponse).result as GetDocumentResult);
        };
        const onError = (err: Error): void => {
            ws.off("message", onMessage);
            reject(err);
        };
        ws.on("message", onMessage);
        ws.once("error", onError);
        ws.send(JSON.stringify({ id, method: InspectorMethod.getDocument }));
    });
}

/** Pre-order collect every node in the snapshot tree matching `predicate`. */
export function findNodes(root: NodeSnapshot | null, predicate: (node: NodeSnapshot) => boolean): NodeSnapshot[] {
    const out: NodeSnapshot[] = [];
    const visit = (node: NodeSnapshot): void => {
        if (predicate(node)) out.push(node);
        for (const child of node.children) visit(child);
    };
    if (root !== null) visit(root);
    return out;
}

/** First node (pre-order) matching `predicate`, or `null`. */
export function findNode(root: NodeSnapshot | null, predicate: (node: NodeSnapshot) => boolean): NodeSnapshot | null {
    return findNodes(root, predicate)[0] ?? null;
}
