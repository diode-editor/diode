import { describe, expect, it } from "vitest";

import { parseLinkedText } from "./linkedText.ts";

/** Upstream `linkedText.test.ts`, case for case. */
describe("parseLinkedText", () => {
    it.each([
        ["", []],
        ["hello", ["hello"]],
        ["hello there", ["hello there"]],
        [
            "Some message with [link text](http://link.href).",
            ["Some message with ", { label: "link text", href: "http://link.href" }, "."],
        ],
        [
            'Some message with [link text](http://link.href "and a title").',
            ["Some message with ", { label: "link text", href: "http://link.href", title: "and a title" }, "."],
        ],
        [
            "Some message with [link text](http://link.href 'and a title').",
            ["Some message with ", { label: "link text", href: "http://link.href", title: "and a title" }, "."],
        ],
        [
            "Some message with [link text](http://link.href \"and a 'title'\").",
            ["Some message with ", { label: "link text", href: "http://link.href", title: "and a 'title'" }, "."],
        ],
        [
            "Some message with [link text](http://link.href 'and a \"title\"').",
            ["Some message with ", { label: "link text", href: "http://link.href", title: 'and a "title"' }, "."],
        ],
        ["Some message with [link text](random stuff).", ["Some message with [link text](random stuff)."]],
        [
            "Some message with [https link](https://link.href).",
            ["Some message with ", { label: "https link", href: "https://link.href" }, "."],
        ],
        ["Some message with [https link](https:).", ["Some message with [https link](https:)."]],
        [
            "Some message with [a command](command:foobar).",
            ["Some message with ", { label: "a command", href: "command:foobar" }, "."],
        ],
        ["Some message with [a command](command:).", ["Some message with [a command](command:)."]],
        ["Open [a file](file:///tmp/a.txt).", ["Open ", { label: "a file", href: "file:///tmp/a.txt" }, "."]],
        [
            'link [one](command:foo "nice") and link [two](http://foo)...',
            [
                "link ",
                { label: "one", href: "command:foo", title: "nice" },
                " and link ",
                { label: "two", href: "http://foo" },
                "...",
            ],
        ],
        [
            'link\n[one](command:foo "nice")\nand link [two](http://foo)...',
            [
                "link\n",
                { label: "one", href: "command:foo", title: "nice" },
                "\nand link ",
                { label: "two", href: "http://foo" },
                "...",
            ],
        ],
        [
            'a [link text 1](http://link.href "title1") b [link text 2](http://link.href "title2") c',
            [
                "a ",
                { label: "link text 1", href: "http://link.href", title: "title1" },
                " b ",
                { label: "link text 2", href: "http://link.href", title: "title2" },
                " c",
            ],
        ],
        ["[UPPER](COMMAND:foo)", [{ label: "UPPER", href: "COMMAND:foo" }]],
        // diode: adjacent links have no empty text between them.
        [
            "x [a](command:a)[b](command:b)",
            ["x ", { label: "a", href: "command:a" }, { label: "b", href: "command:b" }],
        ],
    ])("%j", (text, nodes) => {
        // Strict: a link without a title has no `title` key at all.
        expect(parseLinkedText(text).nodes).toStrictEqual(nodes);
    });

    it("toString is the text with links replaced by their labels", () => {
        expect(parseLinkedText("Run [the build](command:build) now").toString()).toBe("Run the build now");
    });
});
