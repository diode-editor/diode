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
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";

import { HoverComponentDIToken } from "./hoverComponent.ts";
import { HoverServiceDIToken, splitMarkdownSections, stripMarkdown } from "./hoverService.ts";

describe("stripMarkdown — plain text for the TUI popup", () => {
    it("strips code fences, inline code, bold/italic and links", () => {
        expect(stripMarkdown("```ts\nconst a: number\n```")).toBe("const a: number");
        expect(stripMarkdown("Call `compute()` **always**")).toBe("Call compute() always");
        expect(stripMarkdown("*italic* and __bold__")).toBe("italic and bold");
        expect(stripMarkdown("See [the docs](https://example.com) here")).toBe("See the docs here");
        expect(stripMarkdown("escaped \\*symbol\\*")).toBe("escaped *symbol*");
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
