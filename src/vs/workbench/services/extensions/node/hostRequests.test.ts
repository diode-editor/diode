import { describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import type { HostRpc } from "../../../api/common/extHostProtocol.ts";
import { createInProcessChannelPair } from "../../../api/common/inProcessChannelPair.ts";
import { RpcEndpoint } from "../../../api/common/rpcEndpoint.ts";
import type { WireTextEdit } from "../../../api/common/wireTypes.ts";

import { requestWillSaveEdits, wireToSaveEdits } from "./hostRequests.ts";

const PARAMS = {
    uri: Uri.file("/tmp/file.txt").toString(),
    languageId: "plaintext",
    version: 1,
    isDirty: true,
    reason: 1,
    eol: 1,
};

/**
 * Обработчик, который никогда не отвечает, и его токен: истёкший срок обязан
 * отменить запрос и на стороне субпроцесса (`$/cancelRequest`).
 */
function hangingHandler(): {
    handler: (params: unknown, token: ICancellationToken) => Promise<never>;
    token: () => ICancellationToken | undefined;
} {
    let seen: ICancellationToken | undefined;
    return {
        handler: (_params, token) => {
            seen = token;
            return new Promise<never>(() => undefined);
        },
        token: () => seen,
    };
}

/** Срок истёк — запрос отменён и у обработчика субпроцесса. */
async function expectCancelledOnPeer(hang: ReturnType<typeof hangingHandler>): Promise<void> {
    await vi.waitFor(() => {
        expect(hang.token()?.isCancellationRequested).toBe(true);
    });
}

describe("hostRequests — wireToSaveEdits", () => {
    it("текстовая правка → core ISaveEdit с 0-based диапазоном", () => {
        const wire: WireTextEdit[] = [
            { range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } }, text: "abc" },
        ];
        expect(wireToSaveEdits(wire)).toEqual([
            {
                kind: "text",
                range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
                text: "abc",
            },
        ]);
    });

    it("setEndOfLine 2 → CRLF, 1 → LF", () => {
        expect(wireToSaveEdits([{ setEndOfLine: 2 }])).toEqual([{ kind: "eol", eol: EndOfLine.CRLF }]);
        expect(wireToSaveEdits([{ setEndOfLine: 1 }])).toEqual([{ kind: "eol", eol: EndOfLine.LF }]);
    });
});

describe("hostRequests — requestWillSaveEdits (InProcessChannelPair)", () => {
    function connectPair(): { host: HostRpc; sub: RpcEndpoint; dispose: () => void } {
        const [a, b] = createInProcessChannelPair();
        const host: HostRpc = new RpcEndpoint(a);
        const sub = new RpcEndpoint(b);
        return {
            host,
            sub,
            dispose: () => {
                host.dispose();
                sub.dispose();
            },
        };
    }

    it("десериализует правки, вернувшиеся от subprocess'а", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("workspace.willSaveTextDocument", () => [
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "" },
                { setEndOfLine: 2 },
            ]);
            const edits = await requestWillSaveEdits((m, p, o) => host.request(m, p, o), PARAMS, 1000);
            expect(edits).toEqual([
                { kind: "text", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 2 } }, text: "" },
                { kind: "eol", eol: EndOfLine.CRLF },
            ]);
        } finally {
            dispose();
        }
    });

    it("возвращает пустой результат по таймауту, если participant никогда не резолвится", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            const hang = hangingHandler();
            sub.handleRequest("workspace.willSaveTextDocument", hang.handler);
            const edits = await requestWillSaveEdits((m, p, o) => host.request(m, p, o), PARAMS, 30);
            expect(edits).toEqual([]);
            await expectCancelledOnPeer(hang);
        } finally {
            dispose();
        }
    });

    it("возвращает пустой результат при ошибке RPC-хендлера", async () => {
        const { host, sub, dispose } = connectPair();
        try {
            sub.handleRequest("workspace.willSaveTextDocument", () => {
                throw new Error("boom");
            });
            const edits = await requestWillSaveEdits((m, p, o) => host.request(m, p, o), PARAMS, 1000);
            expect(edits).toEqual([]);
        } finally {
            dispose();
        }
    });
});
