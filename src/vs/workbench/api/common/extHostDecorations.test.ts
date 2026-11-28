import { afterEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { CancellationTokenSource } from "../../../base/common/cancellation.ts";

import { capDecorationEvent, createFileDecorations, MAX_DECORATION_EVENT_SIZE } from "./extHostDecorations.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner } from "./vscodeHostContext.ts";
import { EventEmitter, FileDecoration, ThemeColor, Uri } from "./vscodeTypes.ts";
import type { IWireProvideFileDecorations, WireFileDecorationReply } from "./wireTypes.ts";

function setup() {
    const stub = makeStubRpc();
    const owner = new ExtensionOwner();
    const register = createFileDecorations(stub.rpc, owner);
    return {
        stub,
        /** Registers as the extension `ext.id`, as the API overlay does. */
        register: (provider: vscode.FileDecorationProvider) => owner.runAs("ext.id", () => register(provider)),
        provide: (params: IWireProvideFileDecorations, token = new CancellationTokenSource().token) =>
            stub.callRequest("window.provideFileDecorations", params, token) as Promise<WireFileDecorationReply>,
        notifiesOf: (method: string) => stub.notifies.filter((n) => n.method === method).map((n) => n.params),
    };
}

const A = Uri.file("/proj/a.pull").toString();
const B = Uri.file("/proj/b.txt").toString();

afterEach(() => {
    vi.restoreAllMocks();
});

describe("registerFileDecorationProvider — registration", () => {
    it("a provider without onDidChangeFileDecorations is registered too, each with its own handle and the owner", () => {
        const h = setup();
        h.register({ provideFileDecoration: () => undefined });
        h.register({ provideFileDecoration: () => undefined });
        expect(h.notifiesOf("window.registerFileDecorationProvider")).toEqual([
            { handle: 0, extensionId: "ext.id" },
            { handle: 1, extensionId: "ext.id" },
        ]);
    });

    it("dispose unregisters the handle and stops forwarding its events", () => {
        const h = setup();
        const emitter = new EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
        const registration = h.register({ onDidChangeFileDecorations: emitter.event, provideFileDecoration: () => undefined });
        registration.dispose();
        emitter.fire(undefined);
        expect(h.notifiesOf("window.unregisterFileDecorationProvider")).toEqual([{ handle: 0 }]);
        expect(h.notifiesOf("window.fileDecorationsChanged")).toEqual([]);
    });
});

describe("registerFileDecorationProvider — change events", () => {
    function withEvent() {
        const h = setup();
        const emitter = new EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
        h.register({ onDidChangeFileDecorations: emitter.event, provideFileDecoration: () => undefined });
        return { ...h, emitter };
    }

    it("undefined (and null) means every resource: `uris: null`", () => {
        const h = withEvent();
        h.emitter.fire(undefined);
        h.emitter.fire(null as unknown as undefined);
        expect(h.notifiesOf("window.fileDecorationsChanged")).toEqual([
            { handle: 0, uris: null },
            { handle: 0, uris: null },
        ]);
    });

    it("a single uri and an array go as uri strings, the uri whole (query and authority kept)", () => {
        const h = withEvent();
        const withQuery = Uri.file("/proj/a.pull").with({ authority: "host", query: "hasConflict" });
        h.emitter.fire(Uri.parse(A));
        h.emitter.fire([Uri.parse(B), withQuery]);
        expect(h.notifiesOf("window.fileDecorationsChanged")).toEqual([
            { handle: 0, uris: [A] },
            { handle: 0, uris: [B, withQuery.toString()] },
        ]);
    });

    it("exactly the cap goes as is, in the provider's order", () => {
        const h = withEvent();
        const uris = Array.from({ length: MAX_DECORATION_EVENT_SIZE }, (_, i) => Uri.file(`/z/${String(i)}.ts`));
        h.emitter.fire(uris);
        const [change] = h.notifiesOf("window.fileDecorationsChanged") as { uris: string[] }[];
        expect(change.uris).toEqual(uris.map((uri) => uri.toString()));
    });

    it("over the cap: capped with a warning, the shallowest first", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const h = withEvent();
        const deep = Array.from({ length: 300 }, (_, i) => Uri.file(`/r/deep/${String(i).padStart(3, "0")}.ts`));
        const top = Uri.file("/r/top.ts");
        h.emitter.fire([...deep, top]);
        const [change] = h.notifiesOf("window.fileDecorationsChanged") as { uris: string[] }[];
        expect(change.uris).toHaveLength(MAX_DECORATION_EVENT_SIZE);
        expect(change.uris[0]).toBe(top.toString());
        expect(change.uris[1]).toBe(deep[0].toString());
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("CAPPING events from decorations provider ext.id 301"));
    });
});

describe("capDecorationEvent", () => {
    it("sorts by depth, then by path, and drops repeats of a path (upstream's groupBy)", () => {
        const uris = [
            Uri.file("/a/b/c.ts"),
            Uri.file("/a/z.ts"),
            Uri.file("/a/b.ts"),
            Uri.file("/a/b.ts").with({ query: "x" }),
            Uri.file("/a/a.ts"),
        ];
        expect(capDecorationEvent(uris).map((uri) => uri.toString())).toEqual([
            "file:///a/a.ts",
            "file:///a/b.ts",
            "file:///a/z.ts",
            "file:///a/b/c.ts",
        ]);
    });
});

describe("window.provideFileDecorations", () => {
    it("answers by request id: badge, tooltip, color id and propagate; an empty answer has no key", async () => {
        const h = setup();
        h.register({
            provideFileDecoration: (uri) => {
                if (!uri.path.endsWith(".pull")) return undefined;
                const d = new FileDecoration("P", "pulled", new ThemeColor("charts.red"));
                d.propagate = true;
                return d;
            },
        });
        const reply = await h.provide({ handle: 0, requests: [{ id: 1, uri: A }, { id: 2, uri: B }] });
        expect(reply).toEqual({ 1: { propagate: true, tooltip: "pulled", badge: "P", colorId: "charts.red" } });
    });

    it("asks the provider about every uri at once, with the revived uri", async () => {
        const h = setup();
        const pending: { uri: string; resolve: (d: vscode.FileDecoration | undefined) => void }[] = [];
        h.register({
            provideFileDecoration: (uri) =>
                new Promise((resolve) => {
                    pending.push({ uri: uri.toString(), resolve });
                }),
        });
        const reply = h.provide({ handle: 0, requests: [{ id: 1, uri: A }, { id: 2, uri: B }] });
        await vi.waitFor(() => {
            expect(pending.map((p) => p.uri)).toEqual([A, B]);
        });
        pending[1].resolve(new FileDecoration("B"));
        pending[0].resolve(new FileDecoration("A"));
        expect(await reply).toEqual({ 1: { badge: "A" }, 2: { badge: "B" } });
    });

    it("a throwing or rejecting uri is logged and left out; the others answer", async () => {
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const h = setup();
        h.register({
            provideFileDecoration: (uri) => {
                if (uri.toString() === A) throw new Error("boom");
                if (uri.path.endsWith("c.txt")) return Promise.reject(new Error("later"));
                return new FileDecoration("B");
            },
        });
        const C = Uri.file("/proj/c.txt").toString();
        const reply = await h.provide({ handle: 0, requests: [{ id: 1, uri: A }, { id: 2, uri: B }, { id: 3, uri: C }] });
        expect(reply).toEqual({ 2: { badge: "B" } });
        expect(error).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledWith(expect.stringContaining("[ext.id] provideFileDecoration failed: Error: boom"));
    });

    it("an invalid decoration is dropped with a warning", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const h = setup();
        h.register({ provideFileDecoration: () => new FileDecoration("ABC") });
        expect(await h.provide({ handle: 0, requests: [{ id: 1, uri: A }] })).toEqual({});
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("INVALID decoration from extension 'ext.id'"));
    });

    it("an unknown or removed handle answers {} without asking anyone", async () => {
        const h = setup();
        const provideFileDecoration = vi.fn(() => new FileDecoration("A"));
        h.register({ provideFileDecoration }).dispose();
        expect(await h.provide({ handle: 0, requests: [{ id: 1, uri: A }] })).toEqual({});
        expect(await h.provide({ handle: 7, requests: [{ id: 1, uri: A }] })).toEqual({});
        expect(provideFileDecoration).not.toHaveBeenCalled();
    });

    it("the provider's token follows the request's cancellation", async () => {
        const h = setup();
        let token: vscode.CancellationToken | undefined;
        h.register({
            provideFileDecoration: (_uri, t) => {
                token = t;
                return new Promise(() => undefined);
            },
        });
        const source = new CancellationTokenSource();
        void h.provide({ handle: 0, requests: [{ id: 1, uri: A }] }, source.token);
        await vi.waitFor(() => {
            expect(token).toBeDefined();
        });
        expect(token!.isCancellationRequested).toBe(false);
        source.cancel();
        expect(token!.isCancellationRequested).toBe(true);
    });
});

describe("FileDecoration.validate", () => {
    const valid = (badge: unknown, tooltip?: string, color?: ThemeColor): boolean => {
        const d = new FileDecoration(undefined, tooltip, color);
        (d as { badge?: unknown }).badge = badge;
        return FileDecoration.validate(d);
    };

    it("a badge of up to two characters, a grapheme counting as one", () => {
        expect(valid("M")).toBe(true);
        expect(valid("10")).toBe(true);
        expect(valid("😀")).toBe(true);
        expect(valid("👍🏽!")).toBe(true);
        expect(() => valid("ABC")).toThrow("short character");
    });

    it("a non-string badge (a codicon, proposed API) is invalid", () => {
        expect(() => valid({ id: "check" })).toThrow("not a valid ThemeIcon");
    });

    it("an empty decoration is invalid; a tooltip or a color alone is enough", () => {
        expect(() => valid(undefined)).toThrow("The decoration is empty");
        expect(() => valid("")).toThrow("The decoration is empty");
        expect(valid(undefined, "tip")).toBe(true);
        expect(valid(undefined, undefined, new ThemeColor("charts.red"))).toBe(true);
    });
});
