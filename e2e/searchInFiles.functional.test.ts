import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { HeadlessApp } from "./helpers/appSession.ts";
import { getBinaryPath } from "./helpers/buildOnce.ts";
import { clickText } from "./outputPanel.shared.ts";
import { frameToText } from "./helpers/frame.ts";
import { useHeadlessApp } from "./helpers/useApp.ts";

// Search widgets have no inspectState(), so the tests observe the frame text and the #search node.

const FILES = {
    "alpha.ts": "const Foo = 1;\nconst foobar = 2;\n// FOO here\n",
    "beta.txt": "foo appears here\nplain line\n",
    "sub/gamma.md": "## Foo heading\nfoobar again\n",
    "unicode.txt": "\u041f\u0440\u0438\u0432\u0435\u0442 Foo \u043c\u0438\u0440\n", // "Privet Foo mir"
} as const;

const KEYS = [
    { key: "f6", command: "workbench.view.search" },
    { key: "f7", command: "workbench.view.explorer" },
    // The real key is Ctrl+Shift+J, which the e2e DSL can't encode (nor Ctrl+Shift+F).
    { key: "f8", command: "workbench.action.search.toggleQueryDetails" },
];

async function openSearch(files: Record<string, string> = FILES): Promise<HeadlessApp> {
    const app = await useHeadlessApp({ files, keybindings: KEYS, cols: 100, rows: 30 });
    const { session } = app;
    await session.waitForText((t) => t.includes("EXPLORER"));
    await session.key("F6");
    await session.waitForText((t) => t.includes("SEARCH"));
    return app;
}

function counts(text: string): { matches: number; files: number } | null {
    const m = /(\d+) results in (\d+) files?/u.exec(text);
    return m ? { matches: Number(m[1]), files: Number(m[2]) } : null;
}

describe("Search panel (functional e2e)", () => {
    beforeAll(async () => {
        await getBinaryPath();
    }, 300_000);

    it("swapping Explorer→Search focuses the query field and searches via rg", async () => {
        const app = await openSearch();
        const { session } = app;

        expect(await session.node("#searchView")).not.toBeNull();
        expect(await session.focusedType()).toBe("InputElement");

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));
        const text = frameToText(await session.captureFrame());

        expect(text).toContain("alpha.ts");
        expect(text).toContain("beta.txt");
        expect(text).toContain("sub/gamma.md");
        expect(text).toContain("foo appears here");

        // 4 fixture files contain foo/Foo/FOO (case-insensitive by default).
        expect(counts(text)).toEqual({ matches: 7, files: 4 });
    }, 120_000);

    it("'No results' for a missing query, an empty query clears the counter", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("zzqqxxnotathing");
        await session.waitForText((t) => t.includes("No results"));

        for (let i = 0; i < "zzqqxxnotathing".length; i++) await session.key("Backspace");
        await session.waitForText((t) => !t.includes("No results") && !t.includes("results in"));
        const text = frameToText(await session.captureFrame());
        expect(text).not.toContain("No results");
        expect(text).not.toMatch(/results in/u);
    }, 120_000);

    it("the Aa toggle makes search case-sensitive", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("FOO");
        await session.waitForText((t) => t.includes("results in"));
        const before = counts(frameToText(await session.captureFrame()));
        expect(before).toEqual({ matches: 7, files: 4 });

        // Click the Aa glyph in the sidebar (maxX restricts it to the left panel).
        await clickText(session, "Aa", { maxX: 40 });
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.files === 1;
        });
        const after = counts(frameToText(await session.captureFrame()));
        // Exact-case `FOO` occurs only in the alpha.ts comment.
        expect(after).toEqual({ matches: 1, files: 1 });
    }, 120_000);

    it("the \\b toggle excludes substrings (foo does not match foobar)", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));
        expect(frameToText(await session.captureFrame())).toContain("foobar");

        await clickText(session, "\\b", { maxX: 40 });
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.matches === 5;
        });
        expect(frameToText(await session.captureFrame())).not.toContain("foobar");
    }, 120_000);

    it("a metacharacter is searched literally, the .* toggle enables regex", async () => {
        const app = await openSearch();
        const { session } = app;

        // Without regex, `F.o` is a fixed string absent from the tree.
        await session.text("F.o");
        await session.waitForText((t) => t.includes("No results"));

        // With regex on, `F.o` matches Foo/FOO/foo(bar) across the tree.
        await clickText(session, ".*", { maxX: 40 });
        await session.waitForText((t) => t.includes("results in"));
        expect(counts(frameToText(await session.captureFrame()))?.matches).toBeGreaterThan(0);
    }, 120_000);

    // The include/exclude fields are behind "···" (F8 here = Ctrl+Shift+J); expanding moves focus to include.
    it("include glob narrows to .txt, exclude glob drops .ts", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));

        // *.txt → beta.txt and unicode.txt.
        await session.key("F8");
        await session.waitForText((t) => t.includes("files to include"));
        await session.text("*.txt");
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.files === 2;
        });
        let text = frameToText(await session.captureFrame());
        expect(text).toContain("beta.txt");
        expect(text).toContain("unicode.txt");
        expect(text).not.toContain("alpha.ts");
        expect(text).not.toContain("sub/gamma.md");

        for (let i = 0; i < "*.txt".length; i++) await session.key("Backspace");
        await session.key("Tab");
        await session.text("*.ts");
        await session.waitForText((t) => {
            const c = counts(t);
            return c !== null && c.files === 3;
        });
        text = frameToText(await session.captureFrame());
        expect(text).not.toContain("alpha.ts");
        expect(text).toContain("beta.txt");
        expect(text).toContain("sub/gamma.md");
    }, 120_000);

    it("clicking the include field focuses it, typing goes there and not to the query", async () => {
        const app = await openSearch();
        const { session } = app;
        await session.text("foo");
        await session.waitForText((t) => t.includes("results in"));

        // Expand the details and return focus to the query box (F6 = show search),
        // so that focus in include comes from the click itself.
        await session.key("F8");
        await session.waitForText((t) => t.includes("files to include"));
        await session.key("F6");

        await clickText(session, "files to include", { maxX: 60 });
        await session.text("XX");
        const text = frameToText(await session.captureFrame());
        expect(text).not.toContain("fooXX");
        expect(text).not.toContain("files to include");
        expect(text).toContain("XX");
    }, 120_000);

    it("the preview does not break on a non-ASCII line (byte offsets)", async () => {
        const app = await openSearch();
        const { session } = app;

        await session.text("Foo");
        await session.waitForText((t) => t.includes("results in"));
        const text = frameToText(await session.captureFrame());
        // The line has non-ASCII text before and after `Foo`; with a correct byte split it stays intact.
        expect(text).toContain("unicode.txt");
        expect(text).toContain("\u041f\u0440\u0438\u0432\u0435\u0442 Foo \u043c\u0438\u0440"); // "Privet Foo mir"
    }, 120_000);

    it("workbench.view.explorer returns Explorer to the sidebar", async () => {
        const app = await openSearch();
        const { session } = app;
        await session.key("F7");
        await session.waitForText((t) => t.includes("EXPLORER"));
        expect(await session.node("#searchView")).toBeNull();
    }, 120_000);
});
