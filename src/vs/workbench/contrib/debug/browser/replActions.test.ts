import { describe, expect, it } from "vitest";

import { ClipboardDIToken } from "../../../../platform/clipboard/common/iClipboard.ts";
import type { ServiceAccessor, Token } from "../../../../platform/instantiation/common/diContainer.ts";
import { ReplEvaluationResult } from "../common/replModel.ts";

import { DebugServiceDIToken } from "./debugService.ts";
import { ReplDIToken } from "./repl.ts";
import { replCopyAction, replPasteAction } from "./replActions.ts";

/** The console's services: the clipboard holds `clipboardText`, the focus is `focus`. */
function fixture(
    clipboardText: string,
    focus: { focusedStackFrame?: unknown; focusedSession?: unknown },
): { accessor: ServiceAccessor; written: string[]; pasted: string[] } {
    const written: string[] = [];
    const pasted: string[] = [];
    const services = new Map<unknown, unknown>([
        [
            ClipboardDIToken,
            {
                readText: () => Promise.resolve(clipboardText),
                writeText: (text: string) => Promise.resolve(void written.push(text)),
            },
        ],
        [DebugServiceDIToken, { getViewModel: () => focus }],
        [ReplDIToken, { paste: (text: string) => pasted.push(text) }],
    ]);
    return { accessor: { get: <T>(token: Token<T>) => services.get(token) as T }, written, pasted };
}

function result(): ReplEvaluationResult {
    const element = new ReplEvaluationResult("count");
    element.value = "0";
    return element;
}

describe("the Debug Console's menu commands", () => {
    it("Paste of an empty clipboard leaves the input alone", async () => {
        const fx = fixture("", {});
        await replPasteAction.run(fx.accessor);
        expect(fx.pasted).toEqual([]);
    });

    it("Copy of an evaluation without a frame copies the row as shown", async () => {
        const fx = fixture("", {});
        await replCopyAction.run(fx.accessor, result());
        expect(fx.written).toEqual(["0"]);
    });

    it("Copy of an evaluation of an adapter without the clipboard context asks nothing", async () => {
        let asked = 0;
        const session = {
            capabilities: {},
            evaluate: () => {
                asked++;
                return Promise.resolve({ body: { result: "x" } });
            },
        };
        const fx = fixture("", { focusedStackFrame: { frameId: 1 }, focusedSession: session });
        await replCopyAction.run(fx.accessor, result());
        expect(asked).toBe(0);
        expect(fx.written).toEqual(["0"]);
    });

    it("Copy of an evaluation with a frame but no session asks nothing", async () => {
        const fx = fixture("", { focusedStackFrame: { frameId: 1 } });
        await replCopyAction.run(fx.accessor, result());
        expect(fx.written).toEqual(["0"]);
    });

    it("Copy of an evaluation the adapter gives for the clipboard copies its answer", async () => {
        const session = {
            capabilities: { supportsClipboardContext: true },
            evaluate: () => Promise.resolve({ body: { result: "0x0" } }),
        };
        const fx = fixture("", { focusedStackFrame: { frameId: 1 }, focusedSession: session });
        await replCopyAction.run(fx.accessor, result());
        expect(fx.written).toEqual(["0x0"]);
    });

    it("Copy of an evaluation the adapter fails to give for the clipboard copies the row as shown", async () => {
        const session = {
            capabilities: { supportsClipboardContext: true },
            evaluate: () => Promise.reject(new Error("gone")),
        };
        const fx = fixture("", { focusedStackFrame: { frameId: 1 }, focusedSession: session });
        await replCopyAction.run(fx.accessor, result());
        expect(fx.written).toEqual(["0"]);
    });
});
