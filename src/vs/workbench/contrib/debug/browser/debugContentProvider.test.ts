// `debug:` documents: the content of a source an adapter gives by reference, asked from the session in the uri's
// query (else the focused one) with the `source` request; a failure is the document's text and marks the source
// unavailable. At the end of a session its `debug:` tabs can be closed.

import { describe, expect, it, vi } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IEditorPane } from "../../../browser/parts/editor/iEditorPane.ts";
import type { EditorGroup } from "../../../services/editor/browser/editorGroupModel.ts";
import type { IDebugService, IDebugSession } from "../common/debug.ts";

import { closeSessionEditors, DebugContentProvider } from "./debugContentProvider.ts";

const REF = Uri.from({ scheme: "debug", path: "/lib/futex.S", query: "session=s1&ref=7" });

function setup(sessions: Record<string, Partial<IDebugSession>>, focused?: Partial<IDebugSession>) {
    const sourceIsNotAvailable = vi.fn();
    const debugService = {
        getModel: () => ({ getSession: (id: string | undefined) => (id === undefined ? undefined : sessions[id]) }),
        getViewModel: () => ({ focusedSession: focused }),
        sourceIsNotAvailable,
    } as unknown as IDebugService;
    let provide: ((uri: Uri) => Promise<string | null>) | undefined;
    const registration: IDisposable = { dispose: vi.fn() };
    const provider = new DebugContentProvider(debugService, {
        registerDocumentSource: (scheme, source) => {
            expect(scheme).toBe("debug");
            provide = source;
            return registration;
        },
    });
    return {
        provider,
        registration,
        sourceIsNotAvailable,
        provide: (uri: Uri) => {
            if (provide === undefined) throw new Error("no document source");
            return provide(uri);
        },
    };
}

function session(loadSource: IDebugSession["loadSource"]): Partial<IDebugSession> {
    return { loadSource: vi.fn(loadSource) };
}

describe("DebugContentProvider", () => {
    it("asks the session of the uri for the source and gives its content; disposed, the scheme goes", async () => {
        const s1 = session(() => Promise.resolve({ body: { content: "mov eax, 1" } } as DebugProtocol.SourceResponse));
        const other = session(() => Promise.reject(new Error("not this one")));
        const t = setup({ s1 }, other);

        await expect(t.provide(REF)).resolves.toBe("mov eax, 1");
        expect(s1.loadSource).toHaveBeenCalledWith(REF);

        t.provider.dispose();
        expect(t.registration.dispose).toHaveBeenCalled();
    });

    it("without a session in the uri, or with a gone one, asks the focused session", async () => {
        const focused = session(() =>
            Promise.resolve({ body: { content: "focused" } } as DebugProtocol.SourceResponse),
        );
        const t = setup({}, focused);

        await expect(t.provide(Uri.from({ scheme: "debug", path: "/x.S" }))).resolves.toBe("focused");
        await expect(t.provide(REF)).resolves.toBe("focused");
    });

    it("without any session cannot resolve the document", async () => {
        const t = setup({});
        await expect(t.provide(REF)).rejects.toThrow("Unable to resolve the resource without a debug session");
    });

    it("a failed request is the document's text with the adapter's message; the source is unavailable", async () => {
        const s1 = session(() => Promise.reject(new Error("no such reference")));
        const t = setup({ s1 });

        await expect(t.provide(REF)).resolves.toBe("Could not load source '/lib/futex.S': no such reference.");
        expect(t.sourceIsNotAvailable).toHaveBeenCalledWith(REF);
    });

    it("an answer without a body is the document's text without a message", async () => {
        const s1 = session(() => Promise.resolve(undefined));
        const t = setup({ s1 });

        await expect(t.provide(REF)).resolves.toBe("Could not load source '/lib/futex.S'.");
        expect(t.sourceIsNotAvailable).toHaveBeenCalledWith(REF);
    });
});

describe("closeSessionEditors", () => {
    it("closes, in every group, the debug: tabs of the session and nothing else", () => {
        const pane = (uri: Uri): IEditorPane => ({ uri }) as IEditorPane;
        const ofS1 = pane(REF);
        const ofS2 = pane(Uri.from({ scheme: "debug", path: "/lib/a.S", query: "session=s2&ref=8" }));
        const file = pane(Uri.file("/lib/futex.S"));
        // Another scheme's document whose query names the session is not the session's.
        const other = pane(Uri.from({ scheme: "git", path: "/lib/futex.S", query: "session=s1&ref=7" }));
        const alsoOfS1 = pane(Uri.from({ scheme: "debug", path: "/lib/b.S", query: "session=s1&ref=9" }));
        const left = { getPanes: () => [ofS1, ofS2, file, other] } as unknown as EditorGroup;
        const right = { getPanes: () => [alsoOfS1] } as unknown as EditorGroup;
        const closeEditors = vi.fn(() => Promise.resolve(true));

        closeSessionEditors({ editorGroups: { groups: [left, right] } as never, closeEditors }, "s1");

        expect(closeEditors.mock.calls).toEqual([
            [left, [ofS1]],
            [right, [alsoOfS1]],
        ]);
    });
});
