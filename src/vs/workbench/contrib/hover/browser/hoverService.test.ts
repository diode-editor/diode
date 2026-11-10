import { Size } from "@tuidom/core/common/geometryPromitives";
import type { MouseToken } from "@tuidom/core/input/rawTerminalToken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { HoverProvider, ICoreHover } from "../../../../editor/common/languages/iHoverSource.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { MarkerSeverity } from "../../../../platform/markers/common/iMarker.ts";
import { MarkerServiceDIToken } from "../../../../platform/markers/common/markerService.ts";
import { MarkdownString } from "../../../api/common/vscodeTypes.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { HoverComponentDIToken } from "./hoverComponent.ts";
import { HoverServiceDIToken, splitMarkdownSections, stripMarkdown } from "./hoverService.ts";

/** What ShellCheck 0.48.4 sends with `shellcheck.markdownDiagnostics` (src/markdown-diagnostics.ts). */
const SHELLCHECK_HEADER =
    '<span style="color:var(--vscode-editorWarning-foreground);"><span class="codicon codicon-warning"></span> <strong>Warning</strong></span> <span style="color:var(--vscode-descriptionForeground);">(SC2086)</span> <a href="https://www.shellcheck.net/wiki/SC2086" title="Open ShellCheck rule documentation"><span class="codicon codicon-link-external"></span></a> <span class="codicon codicon-none"></span>';
const SHELLCHECK_HOVER = SHELLCHECK_HEADER + "\n\nDouble quote to prevent globbing and word splitting\\.";

describe("stripMarkdown — plain text for the TUI popup", () => {
    it("strips code fences, inline code, bold/italic and links", () => {
        expect(stripMarkdown("```ts\nconst a: number\n```")).toBe("const a: number");
        expect(stripMarkdown("Call `compute()` **always**")).toBe("Call compute() always");
        expect(stripMarkdown("*italic* and __bold__")).toBe("italic and bold");
        expect(stripMarkdown("See [the docs](https://example.com) here")).toBe("See the docs here");
        expect(stripMarkdown("escaped \\*symbol\\*")).toBe("escaped *symbol*");
    });

    it("code keeps its emphasis characters: Tailwind's CSS hover", () => {
        expect(stripMarkdown("```css\n.p-4 {\n  padding: calc(var(--spacing) * 4) /* 1rem = 16px */;\n}\n```")).toBe(
            ".p-4 {\n  padding: calc(var(--spacing) * 4) /* 1rem = 16px */;\n}",
        );
        expect(stripMarkdown("`a * b * c` and *x*")).toBe("a * b * c and x");
        expect(stripMarkdown("`snake_case_ish_` [x](y)")).toBe("snake_case_ish_ x");
        expect(stripMarkdown("`a \\* b`")).toBe("a \\* b");
        expect(stripMarkdown("\\`not code\\` and \\*x\\*")).toBe("`not code` and *x*");
    });

    it("`_italic_` is stripped only at a word boundary — snake_case is left alone", () => {
        // terraform-ls marks the type like this: "`var.region` _string_".
        expect(stripMarkdown("`var.region`\n_string_")).toBe("var.region\nstring");
        expect(stripMarkdown("type (_string_), see aws_instance_type")).toBe("type (string), see aws_instance_type");
        expect(stripMarkdown("a_b_c and _x_y")).toBe("a_b_c and _x_y");
        expect(stripMarkdown("_ not italic _ and __")).toBe("_ not italic _ and __");
        // A non-ASCII letter after the closing `_` is a word character too (\p{L}, not \w).
        expect(stripMarkdown("_\u0441\u043b\u043e\u0432\u043e_\u044b")).toBe("_\u0441\u043b\u043e\u0432\u043e_\u044b"); // "_slovo_y"
        expect(stripMarkdown("_a_")).toBe("a");
        expect(stripMarkdown("escaped \\_symbol\\_")).toBe("escaped _symbol_");
    });

    it("multi-line tsserver hover: signature + documentation", () => {
        expect(stripMarkdown("```typescript\nconst answer: number\n```\nThe answer to the ultimate question.")).toBe(
            "const answer: number\nThe answer to the ultimate question.",
        );
    });

    it("surrounding whitespace and newlines are trimmed", () => {
        // tsserver returns documentation with a trailing newline; in the popup
        // frame it would turn into an empty line.
        expect(stripMarkdown("\n  const a: number  \n\n")).toBe("const a: number");
    });

    it("fenced block without a newline before the closing backticks", () => {
        // tsserver closes the block right after the text; the optional `\n?` in
        // the regex is exactly for this case.
        expect(stripMarkdown("```ts\nconst a: number```")).toBe("const a: number");
    });

    it("more than nine escaped characters in a row are each restored", () => {
        // The hiding index is two-digit: the restore regex must read `\d+`, not `\d`.
        const source = Array.from({ length: 12 }, (_, i) => `\\*${String(i)}\\*`).join(" ");
        expect(stripMarkdown(source)).toBe("*0* *1* *2* *3* *4* *5* *6* *7* *8* *9* *10* *11*");
    });

    it("an ATX heading loses its `#`s: the YAML server's hover starts with `#### <schema title>`", () => {
        expect(stripMarkdown("#### Person\n\nFull name")).toBe("Person\n\nFull name");
        expect(stripMarkdown("intro\n   # Indented\n##\tTab\n###### Six")).toBe("intro\nIndented\nTab\nSix");
        expect(stripMarkdown("intro\n#\nend")).toBe("intro\n\nend");
    });

    it("an ATX heading loses its closing `#` sequence too, a `#` inside the text stays", () => {
        // JSON Schema `markdownDescription: "## Name ##"` showed `Name ##` in the YAML hover
        expect(stripMarkdown("## Name ##\nPet name")).toBe("Name\nPet name");
        expect(stripMarkdown("# Title #####")).toBe("Title");
        expect(stripMarkdown("# C# language")).toBe("C# language");
        expect(stripMarkdown("# Tag #1")).toBe("Tag #1");
        expect(stripMarkdown("a\n### ###\nb")).toBe("a\n\nb");
        expect(stripMarkdown("# Spaced ##  \nb")).toBe("Spaced\nb");
    });

    it("not a heading: seven `#`s, no space after them, indent 4, an escaped `#`", () => {
        expect(stripMarkdown("####### seven\n#tag\n    # code\n\\# literal")).toBe(
            "####### seven\n#tag\n    # code\n# literal",
        );
    });

    it("a `#` comment inside a fenced block stays, and headings after the block are stripped again", () => {
        expect(stripMarkdown("```yaml\n# comment\n```\n# After")).toBe("# comment\nAfter");
        expect(stripMarkdown("~~~~\n# a\n~~~\n# b\n~~~~\n# c")).toBe("~~~~\n# a\n~~~\n# b\n~~~~\nc");
        expect(stripMarkdown("```\n# a\n~~~\n# b\n```\n# c")).toBe("# a\n~~~\n# b\nc");
    });

    it("the ShellCheck `markdownDiagnostics` header loses its tags, the text between them stays", () => {
        expect(stripMarkdown(SHELLCHECK_HOVER)).toMatch(
            /^Warning \(SC2086\) *\n\nDouble quote to prevent globbing and word splitting\.$/,
        );
        expect(stripMarkdown("Fix\\:  \n&nbsp;&nbsp;`` echo `date` ``  \n&nbsp;`$1`")).toBe(
            "Fix:  \n  echo `date`  \n $1",
        );
    });

    it("tags of every CommonMark form go: attributes, self-closing, wrapped onto the next line, comments", () => {
        expect(stripMarkdown("<strong>Warning</strong>")).toBe("Warning");
        expect(stripMarkdown('a<a href="x" title=\'y\' data-z=w hidden><span class="c"></span></a>b')).toBe("ab");
        expect(stripMarkdown('a<br/>b<br />c<hr\n  class="x"\n>d</p\n>e')).toBe("abcde");
        expect(stripMarkdown("a<!-- note -->b<!---->c<!-->d<!--->e")).toBe("abcde");
        expect(stripMarkdown("a<!-- multi\nline -->b")).toBe("ab");
        expect(stripMarkdown('<x-tag a:b_c.d-e = "1">t</x-tag>')).toBe("t");
    });

    it("not tags stay as they are", () => {
        for (const text of [
            "a < b",
            "x <3",
            "<>",
            "< span>",
            "<1abc>",
            "->",
            "a <- b",
            "<https://example.com>",
            "<user@host>",
            '<a href="x>',
            "<a b='c>",
            "<span\n\nclass=x>",
            "<a\tb=c=d>",
            "<?php ?>",
            "<!X >",
            "<![CDATA[x]]>",
            "</ a>",
            "<-x>",
            "<a/ >",
        ]) {
            expect(stripMarkdown(text)).toBe(text);
        }
    });

    it("code is untouchable: tags, entities and escapes inside it stay", () => {
        expect(stripMarkdown("`Array<string>`")).toBe("Array<string>");
        expect(stripMarkdown("```typescript\nconst a: Array<string>\n```")).toBe("const a: Array<string>");
        expect(stripMarkdown("`<span>` and `&amp;` and `\\*`")).toBe("<span> and &amp; and \\*");
        expect(stripMarkdown("```\n**bold** &lt;\n```")).toBe("**bold** &lt;");
        expect(stripMarkdown("\\<span\\>")).toBe("<span>");
    });

    it("a backslash escapes any ASCII punctuation, and nothing else", () => {
        expect(stripMarkdown("splitting\\. Don\\'t \\$var \\: \\\" \\/ \\@ \\~ \\` \\\\")).toBe(
            "splitting. Don't $var : \" / @ ~ ` \\",
        );
        expect(stripMarkdown("\\a \\1 \\ \\")).toBe("\\a \\1 \\ \\");
        expect(stripMarkdown("\\`not code`")).toBe("`not code`");
    });

    it("a code span of N backticks closes with a run of the same length; one space each side is trimmed", () => {
        expect(stripMarkdown("``a `b` c``")).toBe("a `b` c");
        expect(stripMarkdown("`` `x` ``")).toBe("`x`");
        expect(stripMarkdown("x`  a  `y")).toBe("x a y");
        expect(stripMarkdown("x`   `y")).toBe("x   y");
        expect(stripMarkdown("x` a`y")).toBe("x ay");
        expect(stripMarkdown("x`a `y")).toBe("xa y");
        expect(stripMarkdown("`a``b`")).toBe("a``b");
        expect(stripMarkdown("``a`b```c``")).toBe("a`b```c");
        expect(stripMarkdown("``a`b```c")).toBe("``a`b```c");
        expect(stripMarkdown("a ` b")).toBe("a ` b");
        expect(stripMarkdown("``a` <b>x</b>")).toBe("``a` x");
    });

    it("entities are decoded outside code, after the tags are gone", () => {
        expect(stripMarkdown("&lt;span&gt; &amp; &quot;q&quot; &apos;a&#39; x&nbsp;&nbsp;y")).toBe(
            "<span> & \"q\" 'a' x  y",
        );
        expect(stripMarkdown("&#65;&#x42;&#X43; &#0; &#x110000; &#9999999;")).toBe("ABC \uFFFD \uFFFD \uFFFD");
        expect(stripMarkdown("&#x10FFFF;")).toBe("\u{10ffff}");
        expect(stripMarkdown("&foo; &AMP; &#12345678; &#x1234567; &; &#;")).toBe(
            "&foo; &AMP; &#12345678; &#x1234567; &; &#;",
        );
        expect(stripMarkdown("&#42;not italic&#42;")).toBe("*not italic*");
    });
});

describe("splitMarkdownSections — sections by thematic break", () => {
    it("`---`, `***`, `___` (with spaces and indent up to 3) split into sections; empty ones stay", () => {
        expect(splitMarkdownSections("a\n\n---\n\nb\n\n***\n\nc\n\n_ _ _\n\nd")).toEqual(["a", "b", "c", "d"]);
        expect(splitMarkdownSections("---\n\n   - - - -  \n\ntext only\n\n---")).toEqual(["", "", "text only", ""]);
    });

    it("not a separator: two dashes, mixed characters, indent 4, trailing character", () => {
        expect(splitMarkdownSections("a\n\n--\n\n-*-\n\n    ---\n\n---x")).toEqual([
            "a\n\n--\n\n-*-\n\n    ---\n\n---x",
        ]);
    });

    it("`---` inside a fenced block is content; the closing fence is of the same kind and no shorter", () => {
        expect(splitMarkdownSections("```yaml\n---\nkey: 1\n```\n\n---\n\ndocs")).toEqual(["---\nkey: 1", "docs"]);
        // Inside a ````-block neither ``` nor ~~~~ closes it: one split, after the block.
        // (stripMarkdown strips the ```` themselves imprecisely, a known limitation; here we only check the split.)
        const sections = splitMarkdownSections("````\n```\n---\n~~~~\n````\n---\nx");
        expect(sections).toHaveLength(2);
        expect(sections[1]).toBe("x");
    });

    it("`---` under a paragraph line is a setext heading: the line drops out; `***` under a paragraph is a separator", () => {
        expect(splitMarkdownSections("Heading\n---\ntext")).toEqual(["Heading\ntext"]);
        expect(splitMarkdownSections("paragraph\n***\ntext")).toEqual(["paragraph", "text"]);
        // Below a separator and below a whitespace-only line there's no paragraph, so `---` is a separator again.
        expect(splitMarkdownSections("paragraph\n***\n---\ntext")).toEqual(["paragraph", "", "text"]);
        expect(splitMarkdownSections("paragraph\n   \n---\ntext")).toEqual(["paragraph", "text"]);
        expect(splitMarkdownSections("Heading\n  ---\ntext")).toEqual(["Heading\ntext"]);
    });

    it("sections are stripped separately", () => {
        expect(splitMarkdownSections("**a**\n\n---\n\n[b](https://x)")).toEqual(["a", "b"]);
    });
});

describe("HoverService — showing and closing the popup", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-hover-",
            files: {
                "main.ts": "const answer = compute();\nconst other = 1;\n",
                "other.ts": "export const other = 1;\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    const service = () => h.container.get(HoverServiceDIToken);
    const component = () => h.container.get(HoverComponentDIToken);

    const hoverOf = (contents: string[]): ICoreHover => ({ contents });

    let providers: IDisposable[] = [];
    const useProvider = (provideHover: HoverProvider["provideHover"]): void => {
        for (const provider of providers) provider.dispose();
        providers = [h.container.get(LanguageFeaturesServiceDIToken).hoverProvider.register("*", { provideHover })];
    };
    /** Register in reverse: with equal score the registry puts the later registration first. */
    const useHovers = (...hovers: ICoreHover[]): void => {
        for (const provider of providers) provider.dispose();
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        providers = hovers
            .toReversed()
            .map((hover) => registry.register("*", { provideHover: () => Promise.resolve(hover) }));
    };

    it("shows the popup with markdown-stripped content at the cursor", async () => {
        useHovers(hoverOf(["```ts\nconst answer: number\n```", "Documentation for **answer**"]));

        const keys = new ContextKeyService();
        service().updateContextKeys(keys);
        expect(keys.get("editorHoverVisible")).toBe(false);

        await service().showHover();

        expect(service().isOpen()).toBe(true);
        service().updateContextKeys(keys);
        expect(keys.get("editorHoverVisible")).toBe(true);
        const lines = component().view.linesFor(60);
        expect(lines).toContain("const answer: number");
        expect(lines).toContain("Documentation for answer");
        expect(group().getActiveEditor()).not.toBeNull();
    });

    it("closing the popup cancels the request at the provider too", async () => {
        const tokens: ICancellationToken[] = [];
        useProvider((_request, token) => {
            tokens.push(token);
            return new Promise(() => undefined);
        });

        void service().showHover();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        service().close();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    describe("diagnostics under the caret (upstream MarkerHoverParticipant)", () => {
        const mark = (startCharacter: number, endCharacter: number, extra = {}): void => {
            const uri = group().getActiveEditor()?.uri.toString() ?? "";
            h.container.get(MarkerServiceDIToken).changeOne("shellcheck", uri, [
                {
                    severity: MarkerSeverity.Info,
                    range: createRange(0, startCharacter, 0, endCharacter),
                    message: "Double quote it.",
                    ...extra,
                },
            ]);
        };

        it("with no provider at all the popup reaches the frame: message and source(code)", async () => {
            mark(0, 5, { source: "shellcheck", code: "SC2086" });

            await service().showHover();
            h.testApp.render();

            expect(h.testApp.backend.screenToString()).toContain("Double quote it. shellcheck(SC2086)");
        });

        describe("in a terminal narrower than the popup", () => {
            // 66 characters: one row at the popup's full width, two rows in a 50-column terminal.
            const message = "Iterating over ls output is fragile. Use globs.";

            beforeEach(() => {
                h.dispose();
                h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(50, 20) });
                h.workbench.openFile(ws.path("main.ts"));
                h.workbench.focusEditor();
            });

            it("a diagnostic keeps the end of its message and its code in the frame", async () => {
                mark(0, 5, { message, source: "shellcheck", code: "SC2045" });

                await service().showHover();
                h.testApp.render();

                const frame = h.testApp.backend.screenToString();
                expect(frame).toContain("globs.");
                expect(frame).toContain("shellcheck(SC2045)");
            });

            it("a provider's answer keeps its end in the frame", async () => {
                useHovers(hoverOf(["Iterating over ls output is fragile. Use globs. shellcheck(SC2045)"]));

                await service().showHover();
                h.testApp.render();

                expect(h.testApp.backend.screenToString()).toContain("shellcheck(SC2045)");
            });
        });

        it("ShellCheck's markdownDiagnostics block reaches the frame as text below the diagnostic", async () => {
            mark(0, 5, { source: "shellcheck", code: "SC2086" });
            useHovers(hoverOf([SHELLCHECK_HOVER]));

            await service().showHover();
            h.testApp.render();

            const rows = h.testApp.backend
                .screenToString()
                .split("\n")
                .map((row) => row.trim());
            const header = rows.findIndex((row) => row.includes("Warning (SC2086)"));
            expect(header).toBeGreaterThan(
                rows.findIndex((row) => row.includes("Double quote it. shellcheck(SC2086)")),
            );
            expect(rows[header + 2]).toContain("Double quote to prevent globbing and word splitting.");
            const frame = rows.join("\n");
            for (const raw of ["<", ">", "codicon", "&nbsp;", "\\."]) expect(frame).not.toContain(raw);
        });

        it("a bare message has no trailing origin", async () => {
            mark(0, 5);

            await service().showHover();

            expect(component().view.linesFor(30)).toEqual(["Double quote it."]);
        });

        it("goes above the answers of the providers", async () => {
            useHovers(hoverOf(["from provider"]));
            mark(0, 5);

            await service().showHover();

            expect(component().view.linesFor(20)).toEqual(["Double quote it.", "─".repeat(20), "from provider"]);
        });

        it("a marker away from the caret stays out, as does one of another file", async () => {
            mark(3, 5);
            h.container
                .get(MarkerServiceDIToken)
                .changeOne("other", "file:///elsewhere.ts", [
                    { severity: MarkerSeverity.Info, range: createRange(0, 0, 0, 5), message: "elsewhere" },
                ]);

            await service().showHover();

            expect(service().isOpen()).toBe(false);
        });
    });

    it("several providers: one block each, separated by a line", async () => {
        useHovers(hoverOf(["first provider"]), hoverOf(["second provider"]));

        await service().showHover();

        const lines = component().view.linesFor(30);
        expect(lines[0]).toBe("first provider");
        expect(lines[1]).toBe("─".repeat(30));
        expect(lines[2]).toBe("second provider");
    });

    it("a separator at a content's edge splits it from its neighbor; without one contents share a block", async () => {
        useHovers(hoverOf(["signature\n\n---", "docs", "more", "***\n\nlink"]));

        await service().showHover();

        expect(component().view.linesFor(20)).toEqual([
            "signature",
            "─".repeat(20),
            "docs",
            "",
            "more",
            "─".repeat(20),
            "link",
        ]);
    });

    it("a thematic break inside a hover (gopls) is drawn in the frame as a line, like a block boundary", async () => {
        useHovers(
            hoverOf([
                "```go\nfunc greet.Hello(name string) string\n```\n\n---\n\nHello greets.\n\n\n---\n\n[`greet.Hello` on pkg.go.dev](https://pkg.go.dev/x/greet#Hello)",
            ]),
        );

        await service().showHover();
        h.testApp.render();

        const frame = h.testApp.backend.screenToString();
        expect(frame).not.toContain("---");
        const rows = frame.split("\n");
        const at = rows.findIndex((row) => row.includes("func greet.Hello(name string) string"));
        expect(rows[at + 1]).toMatch(/│ ─{20,} │/u);
        expect(rows[at + 2]).toContain("│ Hello greets.");
        expect(rows[at + 3]).toMatch(/│ ─{20,} │/u);
        expect(rows[at + 4]).toContain("│ greet.Hello on pkg.go.dev");
    });

    /** Tailwind CSS IntelliSense's hover on `bg-[#ff0000]`, verbatim from the extension host. */
    const TAILWIND_ARBITRARY_HOVER = "\n```css\n.bg-\\[\\#ff0000\\] {\n    background-color: #ff0000;\n}\n```\n";

    it("a backslash inside a code block reaches the frame: Tailwind's escaped selector", async () => {
        // CommonMark has no escapes inside code: upstream shows `.bg-\[\#ff0000\]`, the selector as CSS has it.
        useHovers(hoverOf([TAILWIND_ARBITRARY_HOVER]));

        await service().showHover();
        h.testApp.render();

        expect(h.testApp.backend.screenToString()).toContain("│ .bg-\\[\\#ff0000\\] {");
    });

    it("[api:MarkdownString.appendText] text appended by an extension reaches the frame literally", async () => {
        const text = new MarkdownString("Literal: ").appendText("**x** > a `b` [c](d)\n- e");
        useHovers(hoverOf([text.value]));

        await service().showHover();
        h.testApp.render();

        const frame = h.testApp.backend.screenToString();
        expect(frame).toContain("Literal: **x** > a `b` [c](d)");
        expect(frame).toContain("│ - e");
    });

    it("[api:MarkdownString.appendText] with supportThemeIcons an icon appended as text shows as `$(zap)`, without a backslash", async () => {
        // Upstream: appendText escapes the icon (`\$(zap)`), the markdown renderer drops the escape's
        // backslash and renderLabelWithIcons shows an escaped icon as its literal `$(zap)`.
        const text = new MarkdownString("", true).appendText("icon $(zap) end");
        useHovers(hoverOf([text.value]));

        await service().showHover();
        h.testApp.render();

        const frame = h.testApp.backend.screenToString();
        expect(frame).toContain("│ icon $(zap) end");
        expect(frame).not.toContain("\\$(zap)");
    });

    it("a code block keeps its indentation in the frame: Tailwind's CSS declaration", async () => {
        useHovers(hoverOf([TAILWIND_ARBITRARY_HOVER]));

        await service().showHover();
        h.testApp.render();

        expect(h.testApp.backend.screenToString()).toContain("│     background-color: #ff0000;");
    });

    it("an empty result, empty after stripping, or no providers — the popup doesn't open", async () => {
        // No providers.
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // The provider answered "no hover".
        useProvider(() => Promise.resolve(undefined));
        await service().showHover();
        expect(service().isOpen()).toBe(false);

        // There is content, but it's empty after stripping (an empty fenced block).
        useHovers(hoverOf(["```ts\n\n```"]));
        await service().showHover();
        expect(service().isOpen()).toBe(false);
    });

    it("a provider for another language isn't asked at all", async () => {
        let asked = false;
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        providers = [
            registry.register("python", {
                provideHover: () => {
                    asked = true;
                    return Promise.resolve(hoverOf(["python"]));
                },
            }),
        ];

        await service().showHover();

        expect(asked).toBe(false);
        expect(service().isOpen()).toBe(false);
    });

    it("block order follows selector score: an exact language ranks above `*` even if registered earlier", async () => {
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        const languageId = group().getActiveEditor()!.languageId;
        providers = [
            registry.register(languageId, { provideHover: () => Promise.resolve(hoverOf(["exact"])) }),
            registry.register("*", { provideHover: () => Promise.resolve(hoverOf(["any"])) }),
        ];

        await service().showHover();

        const lines = component().view.linesFor(30);
        expect(lines[0]).toBe("exact");
        expect(lines[2]).toBe("any");
    });

    it("a failing provider doesn't break the others", async () => {
        const registry = h.container.get(LanguageFeaturesServiceDIToken).hoverProvider;
        providers = [
            registry.register("*", { provideHover: () => Promise.resolve(hoverOf(["alive"])) }),
            registry.register("*", { provideHover: () => Promise.reject(new Error("boom")) }),
        ];

        await service().showHover();

        expect(component().view.linesFor(30)).toEqual(["alive"]);
    });

    it("the request carries the document version and cursor position, but not the text", async () => {
        const seen: { uri?: string; line?: number; character?: number; versionId?: number } = {};
        useProvider((request) => {
            Object.assign(seen, request);
            return Promise.resolve(hoverOf(["x"]));
        });
        group().getActiveEditor()?.goToPosition(1, 6);

        await service().showHover();

        expect(seen).toMatchObject({ line: 1, character: 6 });
        expect(seen.versionId).toBe(group().getActiveEditor()?.model.document.versionId);
        expect(seen).not.toHaveProperty("text");
    });

    it("Ctrl+K Ctrl+U opens the popup, Escape closes it — focus stays in the editor", async () => {
        useHovers(hoverOf(["const answer: number"]));

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+U");
        await flushMicrotasks();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
        expect(group().getActiveEditor()?.viewState.selections[0].active).toMatchObject({ line: 0, character: 0 });
    });

    it("cursor movement and edits close the popup", async () => {
        useHovers(hoverOf(["x"]));

        await service().showHover();
        expect(service().isOpen()).toBe(true);
        h.testApp.sendKey("ArrowRight");
        expect(service().isOpen()).toBe(false);

        await service().showHover();
        expect(service().isOpen()).toBe(true);
        h.testApp.sendKey("a");
        expect(service().isOpen()).toBe(false);
    });

    it("a stale response doesn't reopen a closed popup", async () => {
        let release: (hover: ICoreHover) => void = () => undefined;
        useProvider(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );

        const pending = service().showHover();
        // While the response is in flight the popup was closed (Escape), so seq is stale.
        service().close();
        release(hoverOf(["late"]));
        await pending;

        expect(service().isOpen()).toBe(false);
    });

    it("showHover again with the popup open updates the content and re-anchors the session", async () => {
        let text = "first version";
        useProvider(() => Promise.resolve(hoverOf([text])));

        await service().showHover();
        expect(service().isOpen()).toBe(true);

        text = "second version";
        await service().showHover();

        expect(service().isOpen()).toBe(true);
        expect(component().view.linesFor(60)).toContain("second version");
    });

    it("no active editor — the source isn't called", async () => {
        let called = false;
        useProvider(() => {
            called = true;
            return Promise.resolve(hoverOf(["x"]));
        });
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();

        await service().showHover();

        expect(called).toBe(false);
        expect(service().isOpen()).toBe(false);
    });

    it("the cursor left the viewport during the request — the popup doesn't open", async () => {
        useHovers(hoverOf(["x"]));
        const editor = group().getActiveEditor()!;
        // The anchor is gone (cursor outside the visible area): same contract as
        // suggest: getCaretAnchor() === null.
        editor.getCaretAnchor = () => null;

        await service().showHover();

        expect(service().isOpen()).toBe(false);
    });

    it("a click outside the popup closes it (overlay session pointer policy)", async () => {
        useHovers(hoverOf(["const answer: number"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        const click = (action: "press" | "release"): MouseToken => ({
            kind: "mouse",
            button: "left",
            action,
            x: 2,
            y: 20,
            shiftKey: false,
            altKey: false,
            ctrlKey: false,
            raw: "",
        });
        h.testApp.backend.simulateMouse(click("press"));
        h.testApp.backend.simulateMouse(click("release"));

        expect(service().isOpen()).toBe(false);
    });

    it("focus really moving to another widget closes the popup", async () => {
        useHovers(hoverOf(["const answer: number"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // Not a direct FocusTracker.fire call but the real path: focus moves into the
        // Explorer tree, WorkbenchContextKeys catches the change, the service dismisses the popup.
        h.commands.execute("workbench.view.explorer");
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("focus leaving the editor closes the popup, focus returning doesn't", async () => {
        useHovers(hoverOf(["x"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        const focusTracker = h.container.get(FocusTrackerDIToken);
        // Focus stayed in the editor (typing in the editor itself), so the popup lives.
        focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
        expect(service().isOpen()).toBe(true);

        focusTracker.fire(null);
        expect(service().isOpen()).toBe(false);
    });

    it("empty blocks inside one hover don't produce empty lines in the popup", async () => {
        useHovers(hoverOf(["```ts\nconst a: number\n```", "```\n\n```", "documentation"]));

        await service().showHover();

        // The block that's empty after stripping is dropped: exactly one empty line
        // between the signature and the docs, not two.
        expect(component().view.linesFor(60)).toEqual(["const a: number", "", "documentation"]);
    });

    it("switching the active editor closes the popup and moves subscriptions to the new one", async () => {
        useHovers(hoverOf(["x"]));
        const first = group().getActiveEditor()!;
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        group().openFile(ws.path("other.ts"));
        expect(service().isOpen()).toBe(false);

        // An edit in the PREVIOUS editor no longer affects the new one's popup.
        await service().showHover();
        expect(service().isOpen()).toBe(true);
        first.viewState.insertText("x");
        expect(service().isOpen()).toBe(true);

        group().getActiveEditor()?.viewState.insertText("y");
        expect(service().isOpen()).toBe(false);
    });

    it("an edit below the cursor closes the popup (the text under it is stale)", async () => {
        useHovers(hoverOf(["x"]));
        await service().showHover();
        expect(service().isOpen()).toBe(true);

        // An edit below the cursor: the cursor stays, but the content changed.
        const editor = group().getActiveEditor()!;
        editor.applyExternalEdits([createTextEdit(createRange(1, 0, 1, 0), "// added\n")], "test");
        expect(service().isOpen()).toBe(false);
    });
});
