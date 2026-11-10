import { describe, expect, it } from "vitest";

import { MarkdownString } from "./vscodeTypes.ts";

const appended = (text: string, supportThemeIcons = false): string =>
    new MarkdownString("", supportThemeIcons).appendText(text).value;

describe("[api:MarkdownString.appendText] escapes like upstream htmlContent.ts", () => {
    it("the reference case: emphasis markers are escaped", () => {
        expect(appended("**bold?**")).toBe("\\*\\*bold?\\*\\*");
    });

    it("every markdown syntax token gets a backslash", () => {
        expect(appended("\\`*_{}[]()#+!~")).toBe("\\\\\\`\\*\\_\\{\\}\\[\\]\\(\\)\\#\\+\\!\\~");
    });

    it("a dash is escaped only at a line start, after any indent", () => {
        expect(appended("- a-b\n\t- c")).toBe("\\-&nbsp;a-b\n\n&nbsp;\\-&nbsp;c");
    });

    it("each space and tab becomes &nbsp;, `>` is escaped, a newline starts a paragraph", () => {
        expect(appended("a  b\tc\n> q")).toBe("a&nbsp;&nbsp;b&nbsp;c\n\n\\>&nbsp;q");
    });

    it("appends to the existing value and returns the same object", () => {
        const md = new MarkdownString("**kept** ");
        expect(md.appendText("x*")).toBe(md);
        expect(md.value).toBe("**kept** x\\*");
    });

    describe("with supportThemeIcons an icon is escaped so it shows as text", () => {
        it("$(name) and $(name~modifier) get a backslash before the syntax escape", () => {
            expect(appended("$(zap) $(sync~spin)", true)).toBe("\\\\$\\(zap\\)&nbsp;\\\\$\\(sync\\~spin\\)");
        });

        it("an already escaped icon is not escaped twice", () => {
            expect(appended("\\$(zap)", true)).toBe(appended("$(zap)", true));
        });

        it("something that only resembles an icon stays as is", () => {
            expect(appended("$(a b) $() $(x~)", true)).toBe(appended("$(a b) $() $(x~)"));
        });

        it("without supportThemeIcons an icon is plain text", () => {
            expect(appended("$(zap)")).toBe("$\\(zap\\)");
        });
    });

    it("the constructor's second argument is supportThemeIcons, false by default", () => {
        expect(new MarkdownString("", true).supportThemeIcons).toBe(true);
        expect(new MarkdownString().supportThemeIcons).toBe(false);
    });

    it("appendMarkdown is not escaped", () => {
        expect(new MarkdownString().appendMarkdown("**x**").value).toBe("**x**");
    });
});
