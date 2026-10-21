import { describe, expect, it } from "vitest";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

function makeVscode() {
    const stub = makeStubRpc();
    const { namespace } = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk());
    return { stub, vscode: namespace };
}

function warnings(stub: ReturnType<typeof makeStubRpc>): string[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { value: string; level: string; channel: string })
        .map((p) => `${p.channel}/${p.level}: ${p.value}`);
}

describe("vscode.comments — инертные контроллер и треды", () => {
    it("контроллер несёт id и label; провайдеры не заданы", () => {
        const { vscode } = makeVscode();
        const controller = vscode.comments.createCommentController("hunks", "Proposed changes");
        expect(controller.id).toBe("hunks");
        expect(controller.label).toBe("Proposed changes");
        expect(controller.options).toBeUndefined();
        expect(controller.commentingRangeProvider).toBeUndefined();
        expect(controller.reactionHandler).toBeUndefined();
        expect(() => {
            controller.dispose();
        }).not.toThrow();
    });

    it("тред — с переданными uri/range/comments и эталонными дефолтами", () => {
        const { vscode } = makeVscode();
        const uri = vscode.Uri.parse("file:///a.ts");
        const range = new vscode.Range(3, 0, 3, 0);
        const comment = {
            body: "b",
            mode: vscode.CommentMode.Preview,
            author: { name: "Claude" },
        };
        const thread = vscode.comments.createCommentController("c", "l").createCommentThread(uri, range, [comment]);
        expect(thread.uri).toBe(uri);
        expect(thread.range).toBe(range);
        expect(thread.comments).toEqual([comment]);
        expect(thread.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Collapsed);
        expect(thread.canReply).toBe(true);
        expect(thread.contextValue).toBeUndefined();
        expect(thread.label).toBeUndefined();
        expect(thread.state).toBeUndefined();
    });

    it("поля треда записываемые — расширение правит их после создания", () => {
        const { vscode } = makeVscode();
        const thread = vscode.comments
            .createCommentController("c", "l")
            .createCommentThread(vscode.Uri.parse("file:///a.ts"), new vscode.Range(0, 0, 0, 0), []);
        thread.canReply = false;
        thread.label = " ";
        thread.contextValue = "hunk";
        thread.state = vscode.CommentThreadState.Resolved;
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
        expect(thread).toMatchObject({
            canReply: false,
            label: " ",
            contextValue: "hunk",
            state: 1,
            collapsibleState: 1,
        });
        expect(() => {
            thread.dispose();
        }).not.toThrow();
    });

    it("человеку — одна warn-строка на id контроллера за жизнь субпроцесса", () => {
        const { stub, vscode } = makeVscode();
        vscode.comments.createCommentController("hunks", "a");
        vscode.comments.createCommentController("hunks", "b");
        vscode.comments.createCommentController("other", "c");
        expect(warnings(stub)).toEqual([
            'extensions/warn: комментарии "hunks" в TUI пока не рисуются — тредов не будет, остальное расширение работает',
            'extensions/warn: комментарии "other" в TUI пока не рисуются — тредов не будет, остальное расширение работает',
        ]);
        expect(stub.notifies.find((n) => n.method === "output.append")?.params).toMatchObject({ label: "Extensions" });
    });

    it("enum'ы — значения эталона", () => {
        const { vscode } = makeVscode();
        expect([vscode.CommentThreadCollapsibleState.Collapsed, vscode.CommentThreadCollapsibleState.Expanded]).toEqual(
            [0, 1],
        );
        expect([vscode.CommentMode.Editing, vscode.CommentMode.Preview]).toEqual([0, 1]);
        expect([vscode.CommentThreadState.Unresolved, vscode.CommentThreadState.Resolved]).toEqual([0, 1]);
    });
});
