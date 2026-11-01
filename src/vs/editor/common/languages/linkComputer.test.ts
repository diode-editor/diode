import { describe, expect, it } from "vitest";

import { computeLinks, type ILinkComputerTarget } from "./linkComputer.ts";

function target(lines: readonly string[]): ILinkComputerTarget {
    return { lineCount: lines.length, getLineContent: (line) => lines[line] };
}

/** Upstream's helper: `extractedLink` is the text with everything but the link blanked out. */
function assertLink(text: string, extractedLink: string): void {
    const start = extractedLink.search(/[^ \t]/);
    const end = extractedLink.trimEnd().length;
    expect(computeLinks(target([text]))).toEqual([
        {
            range: { start: { line: 0, character: start }, end: { line: 0, character: end } },
            url: extractedLink.substring(start, end),
        },
    ]);
}

describe("linkComputer — upstream's cases", () => {
    it("Parsing", () => {
        assertLink('x = "http://foo.bar";', "     http://foo.bar  ");

        assertLink("x = (http://foo.bar);", "     http://foo.bar  ");

        assertLink("x = [http://foo.bar];", "     http://foo.bar  ");

        assertLink("x = 'http://foo.bar';", "     http://foo.bar  ");

        assertLink("x =  http://foo.bar ;", "     http://foo.bar  ");

        assertLink("x = <http://foo.bar>;", "     http://foo.bar  ");

        assertLink("x = {http://foo.bar};", "     http://foo.bar  ");

        assertLink("(see http://foo.bar)", "     http://foo.bar  ");
        assertLink("[see http://foo.bar]", "     http://foo.bar  ");
        assertLink("{see http://foo.bar}", "     http://foo.bar  ");
        assertLink("<see http://foo.bar>", "     http://foo.bar  ");
        assertLink("<url>http://mylink.com</url>", "     http://mylink.com      ");
        assertLink(
            "// Click here to learn more. https://go.microsoft.com/fwlink/?LinkID=513275&clcid=0x409",
            "                             https://go.microsoft.com/fwlink/?LinkID=513275&clcid=0x409",
        );
        assertLink(
            "// Click here to learn more. https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx",
            "                             https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx",
        );
        assertLink(
            "// https://github.com/projectkudu/kudu/blob/master/Kudu.Core/Scripts/selectNodeVersion.js",
            "   https://github.com/projectkudu/kudu/blob/master/Kudu.Core/Scripts/selectNodeVersion.js",
        );
        assertLink(
            "<!-- !!! Do not remove !!!   WebContentRef(link:https://go.microsoft.com/fwlink/?LinkId=166007, area:Admin, updated:2015, nextUpdate:2016, tags:SqlServer)   !!! Do not remove !!! -->",
            "                                                https://go.microsoft.com/fwlink/?LinkId=166007                                                                                        ",
        );
        assertLink(
            "For instructions, see https://go.microsoft.com/fwlink/?LinkId=166007.</value>",
            "                      https://go.microsoft.com/fwlink/?LinkId=166007         ",
        );
        assertLink(
            "For instructions, see https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx.</value>",
            "                      https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx         ",
        );
        assertLink('x = "https://en.wikipedia.org/wiki/Zürich";', "     https://en.wikipedia.org/wiki/Zürich  ");
        assertLink(
            "請參閱 http://go.microsoft.com/fwlink/?LinkId=761051。",
            "    http://go.microsoft.com/fwlink/?LinkId=761051 ",
        );
        assertLink(
            "（請參閱 http://go.microsoft.com/fwlink/?LinkId=761051）",
            "     http://go.microsoft.com/fwlink/?LinkId=761051 ",
        );

        assertLink('x = "file:///foo.bar";', "     file:///foo.bar  ");
        assertLink('x = "file://c:/foo.bar";', "     file://c:/foo.bar  ");

        assertLink('x = "file://shares/foo.bar";', "     file://shares/foo.bar  ");

        assertLink('x = "file://shäres/foo.bar";', "     file://shäres/foo.bar  ");
        assertLink("Some text, then http://www.bing.com.", "                http://www.bing.com ");
        assertLink(
            "let url = `http://***/_api/web/lists/GetByTitle('Teambuildingaanvragen')/items`;",
            "           http://***/_api/web/lists/GetByTitle('Teambuildingaanvragen')/items  ",
        );
    });

    it("issue #7855", () => {
        assertLink(
            "7. At this point, ServiceMain has been called.  There is no functionality presently in ServiceMain, but you can consult the [MSDN documentation](https://msdn.microsoft.com/en-us/library/windows/desktop/ms687414(v=vs.85).aspx) to add functionality as desired!",
            "                                                                                                                                                 https://msdn.microsoft.com/en-us/library/windows/desktop/ms687414(v=vs.85).aspx                                  ",
        );
    });

    it('issue #62278: "Ctrl + click to follow link" for IPv6 URLs', () => {
        assertLink('let x = "http://[::1]:5000/connect/token"', "         http://[::1]:5000/connect/token  ");
    });

    it("issue #70254: bold links dont open in markdown file using editor mode with ctrl + click", () => {
        assertLink("2. Navigate to **https://portal.azure.com**", "                 https://portal.azure.com  ");
    });

    it("issue #86358: URL wrong recognition pattern", () => {
        assertLink("POST|https://portal.azure.com|2019-12-05|", "     https://portal.azure.com            ");
    });

    it("issue #67022: Space as end of hyperlink isn't always good idea", () => {
        assertLink("aa  https://foo.bar/[this is foo site]  aa", "    https://foo.bar/[this is foo site]    ");
    });

    it("issue #100353: Link detection stops at ＆(double-byte)", () => {
        assertLink(
            "aa  http://tree-mark.chips.jp/レーズン＆ベリーミックス  aa",
            "    http://tree-mark.chips.jp/レーズン＆ベリーミックス    ",
        );
    });

    it("issue #121438: Link detection stops at【...】", () => {
        assertLink(
            "aa  https://zh.wikipedia.org/wiki/【我推的孩子】 aa",
            "    https://zh.wikipedia.org/wiki/【我推的孩子】   ",
        );
    });

    it("issue #121438: Link detection stops at《...》", () => {
        assertLink(
            "aa  https://zh.wikipedia.org/wiki/《新青年》编辑部旧址 aa",
            "    https://zh.wikipedia.org/wiki/《新青年》编辑部旧址   ",
        );
    });

    it("issue #121438: Link detection stops at “...”", () => {
        assertLink(
            "aa  https://zh.wikipedia.org/wiki/“常凯申”误译事件 aa",
            "    https://zh.wikipedia.org/wiki/“常凯申”误译事件   ",
        );
    });

    it("issue #150905: Colon after bare hyperlink is treated as its part", () => {
        assertLink("https://site.web/page.html: blah blah blah", "https://site.web/page.html                ");
    });

    it("issue #156875: Links include quotes ", () => {
        assertLink(
            `"This file has been converted from https://github.com/jeff-hykin/better-c-syntax/blob/master/autogenerated/c.tmLanguage.json",`,
            `                                   https://github.com/jeff-hykin/better-c-syntax/blob/master/autogenerated/c.tmLanguage.json  `,
        );
    });

    it("issue #225513: Cmd-Click doesn't work on JSDoc {@link URL|LinkText} format ", () => {
        assertLink(
            ` * {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers|Promise.withResolvers}`,
            `          https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/withResolvers                       `,
        );
    });
});

describe("linkComputer", () => {
    it("finds no link in plain text, in an empty line or in a scheme with nothing after it", () => {
        expect(computeLinks(target(["no links here", "", "http://", "https:/", "ftp://foo.bar", "file:foo"]))).toEqual(
            [],
        );
    });

    it("a scheme is matched in any case", () => {
        assertLink("HTTP://FOO.BAR", "HTTP://FOO.BAR");
        assertLink("hTtPs://foo.bar", "hTtPs://foo.bar");
        assertLink("FILE:///foo.bar", "FILE:///foo.bar");
    });

    it("a terminator right after the scheme is not a link", () => {
        expect(computeLinks(target(["http:// foo", "http://<foo"]))).toEqual([]);
    });

    it("a link starts after a broken scheme, not with it", () => {
        assertLink("xhttp://foo.bar", " http://foo.bar");
        assertLink("httpx http://foo.bar", "      http://foo.bar");
    });

    it("finds several links on a line and on different lines", () => {
        const links = computeLinks(target(["a http://x.y b https://z.w", "", "  file:///p"]));
        expect(links.map((link) => [link.range.start.line, link.range.start.character, link.url])).toEqual([
            [0, 2, "http://x.y"],
            [0, 15, "https://z.w"],
            [2, 2, "file:///p"],
        ]);
    });

    it("scans only the lines [from, to), with document positions", () => {
        const links = computeLinks(target(["http://a.b", "http://c.d", "http://e.f"]), 1, 2);
        expect(links).toEqual([
            {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
                url: "http://c.d",
            },
        ]);
    });

    it("drops every trailing character a link cannot end in, but keeps the scheme's first character", () => {
        assertLink("http://foo.bar.,;:", "http://foo.bar");
        expect(computeLinks(target(["http://.,;:"]))[0].url).toBe("http://");
    });

    it("keeps a closing bracket opened inside the link, and cuts one opened before it", () => {
        assertLink("http://a.b/(c)", "http://a.b/(c)");
        assertLink("http://a.b/[c]", "http://a.b/[c]");
        assertLink("http://a.b/{c}", "http://a.b/{c}");
        assertLink("(http://a.b/(c))", " http://a.b/(c)");
        assertLink("[http://a.b/[c]]", " http://a.b/[c]");
        assertLink("{http://a.b/{c}}", " http://a.b/{c}");
    });

    it("an unopened closing bracket ends the link", () => {
        assertLink("http://a.b)c", "http://a.b");
        assertLink("http://a.b]c", "http://a.b");
        assertLink("http://a.b}c", "http://a.b");
    });

    it("the brackets of one link do not open anything for the next one", () => {
        const links = computeLinks(target(["http://a.b/(c http://d.e)f"]));
        expect(links.map((link) => link.url)).toEqual(["http://a.b/(c", "http://d.e"]);
        const square = computeLinks(target(["http://a.b/[c] http://d.e]f"]));
        expect(square.map((link) => link.url)).toEqual(["http://a.b/[c]", "http://d.e"]);
        const curly = computeLinks(target(["http://a.b/{c http://d.e}f"]));
        expect(curly.map((link) => link.url)).toEqual(["http://a.b/{c", "http://d.e"]);
    });

    it("a quote ends the link it wraps, and lives inside a link wrapped by another one", () => {
        assertLink("'http://a.b'c", " http://a.b");
        assertLink('"http://a.b"c', " http://a.b");
        assertLink("`http://a.b`c", " http://a.b");
        assertLink("'http://a.b\"c'", ' http://a.b"c');
        assertLink('"http://a.b`c"', " http://a.b`c");
        assertLink("`http://a.b'c`", " http://a.b'c");
        assertLink("http://a.b`c", "http://a.b");
    });

    it("an asterisk ends only a link that began with one", () => {
        assertLink("*http://a.b*c", " http://a.b");
        assertLink("http://a*b", "http://a*b");
    });

    it("a space lives only between square brackets", () => {
        assertLink("http://a.b/[c d", "http://a.b/[c d");
        assertLink("http://a.b/[c] d", "http://a.b/[c]");
    });
});
