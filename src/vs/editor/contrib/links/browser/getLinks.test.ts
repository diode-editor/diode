import { describe, expect, it, vi } from "vitest";

import { CancellationTokenNone } from "../../../../base/common/cancellation.ts";
import { setUnexpectedErrorHandler } from "../../../../base/common/errors.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../common/core/iRange.ts";
import { LanguageFeatureRegistry } from "../../../common/languageFeatureRegistry.ts";
import type { ILink, ILinkRequest, LinkProvider } from "../../../common/languages/iLinkSource.ts";
import { TextDocument } from "../../../common/model/textDocument.ts";

import { getLinks, resolveLinkTarget, unionLinks } from "./getLinks.ts";

function link(start: number, end: number, url = `${String(start)}-${String(end)}`): ILink {
    return { range: createRange(0, start, 0, end), url };
}

function urls(links: readonly ILink[]): (string | undefined)[] {
    return links.map((item) => item.url);
}

describe("unionLinks", () => {
    it("keeps both lists in position order when nothing meets", () => {
        expect(urls(unionLinks([link(0, 2), link(10, 12)], [link(4, 6), link(20, 22)]))).toEqual([
            "0-2",
            "4-6",
            "10-12",
            "20-22",
        ]);
    });

    it("a new link beats the old one it overlaps", () => {
        expect(urls(unionLinks([link(0, 10, "old")], [link(5, 15, "new")]))).toEqual(["new"]);
    });

    it("a new link beats the old one it only touches, on either side", () => {
        expect(urls(unionLinks([link(0, 5, "old")], [link(5, 9, "new")]))).toEqual(["new"]);
        expect(urls(unionLinks([link(5, 9, "old")], [link(0, 5, "new")]))).toEqual(["new"]);
    });

    it("one new link drops every old link it meets", () => {
        expect(urls(unionLinks([link(0, 2), link(4, 6), link(20, 22)], [link(1, 5, "new")]))).toEqual(["new", "20-22"]);
    });

    it("the tail of the longer list stays, whichever it is", () => {
        expect(urls(unionLinks([link(0, 1), link(2, 3)], []))).toEqual(["0-1", "2-3"]);
        expect(urls(unionLinks([], [link(0, 1), link(2, 3)]))).toEqual(["0-1", "2-3"]);
    });
});

describe("getLinks", () => {
    const document = new TextDocument("text");
    const target = { uri: Uri.file("/a.go"), languageId: "go" };
    const request: ILinkRequest = { uri: "file:///a.go", languageId: "go", versionId: 1, document };

    function provider(links: readonly ILink[] | null | undefined): LinkProvider {
        return { provideLinks: () => Promise.resolve(links) };
    }

    it("the links of a provider for the language beat those of `*`", async () => {
        const registry = new LanguageFeatureRegistry<LinkProvider>();
        registry.register({ language: "go" }, provider([link(0, 9, "go")]));
        registry.register("*", provider([link(2, 4, "builtin"), link(20, 24, "builtin2")]));

        expect(urls(await getLinks(registry, target, request, CancellationTokenNone))).toEqual(["go", "builtin2"]);
    });

    it("passes the request and the token to every provider", async () => {
        const registry = new LanguageFeatureRegistry<LinkProvider>();
        const one = vi.fn(() => Promise.resolve([]));
        registry.register("*", { provideLinks: one });

        await getLinks(registry, target, request, CancellationTokenNone);

        expect(one).toHaveBeenCalledWith(request, CancellationTokenNone);
    });

    it("no answer is no links", async () => {
        const registry = new LanguageFeatureRegistry<LinkProvider>();
        registry.register("*", provider(null));
        registry.register("*", provider(undefined));
        registry.register("*", provider([link(0, 1)]));

        expect(urls(await getLinks(registry, target, request, CancellationTokenNone))).toEqual(["0-1"]);
    });

    it("a failed provider is reported, the others answer", async () => {
        const errors: unknown[] = [];
        setUnexpectedErrorHandler((error) => errors.push(error));
        const boom = new Error("boom");
        const registry = new LanguageFeatureRegistry<LinkProvider>();
        registry.register("*", { provideLinks: () => Promise.reject(boom) });
        registry.register("*", provider([link(0, 1)]));

        expect(urls(await getLinks(registry, target, request, CancellationTokenNone))).toEqual(["0-1"]);
        expect(errors).toEqual([boom]);
    });
});

describe("resolveLinkTarget", () => {
    const range = createRange(0, 0, 0, 1);

    it("a link with a url needs no asking", async () => {
        const resolve = vi.fn(() => Promise.resolve("other"));
        await expect(resolveLinkTarget({ range, url: "u", resolve }, CancellationTokenNone)).resolves.toBe("u");
        expect(resolve).not.toHaveBeenCalled();
    });

    it("an empty url asks, as upstream's falsy check", async () => {
        const resolve = vi.fn(() => Promise.resolve("r"));
        await expect(resolveLinkTarget({ range, url: "", resolve }, CancellationTokenNone)).resolves.toBe("r");
    });

    it("without a url the resolver answers, with the token", async () => {
        const resolve = vi.fn(() => Promise.resolve("r"));
        await expect(resolveLinkTarget({ range, resolve }, CancellationTokenNone)).resolves.toBe("r");
        expect(resolve).toHaveBeenCalledWith(CancellationTokenNone);
    });

    it("no url and no answer is a missing target", async () => {
        await expect(resolveLinkTarget({ range }, CancellationTokenNone)).resolves.toBeNull();
        const resolve = () => Promise.resolve(null);
        await expect(resolveLinkTarget({ range, resolve }, CancellationTokenNone)).resolves.toBeNull();
    });
});
