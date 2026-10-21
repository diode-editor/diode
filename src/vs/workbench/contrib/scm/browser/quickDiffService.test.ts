import { describe, expect, it, vi } from "vitest";

import { Event } from "../../../../base/common/event.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { FileSystemProviderCapabilities, type IFileSystemProvider } from "../../../../platform/files/common/files.ts";
import { FileService } from "../../../../platform/files/common/fileService.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";

import type { IOriginalResourceProvider, IQuickDiffEditor, IQuickDiffEditorSource } from "./quickDiffService.ts";
import { QuickDiffService } from "./quickDiffService.ts";

const ADDED = 0x00ff00;
const MODIFIED = 0x0000ff;
const DELETED = 0xff0000;

const FILE = Uri.file("/repo/a.ts");
const ORIGINAL = Uri.from({ scheme: "git", path: "/repo/a.ts", query: '{"path":"/repo/a.ts","ref":"HEAD"}' });

function fakeEditor(uri: Uri, text: string) {
    const listeners: (() => void)[] = [];
    const pushed: (readonly IGutterChangeDecoration[])[] = [];
    let current = text;
    const editor: IQuickDiffEditor = {
        uri,
        getLinesContent: () => current.split("\n"),
        onDidChangeContent: (cb) => {
            listeners.push(cb);
            return { dispose: () => listeners.splice(listeners.indexOf(cb), 1) };
        },
        setGutterChangeDecorations: (d) => pushed.push(d),
    };
    return {
        editor,
        pushed,
        type: (next: string) => {
            current = next;
            for (const cb of [...listeners]) cb();
        },
        get last() {
            return pushed.at(-1);
        },
    };
}

function fakeSource(editor: IQuickDiffEditor | null) {
    const listeners: ((e: IQuickDiffEditor | null) => void)[] = [];
    let active = editor;
    const source: IQuickDiffEditorSource = {
        getActiveEditor: () => active,
        onActiveEditorChanged: (cb) => {
            listeners.push(cb);
            return { dispose: () => listeners.splice(listeners.indexOf(cb), 1) };
        },
    };
    return {
        source,
        activate: (next: IQuickDiffEditor | null) => {
            active = next;
            for (const cb of [...listeners]) cb(next);
        },
    };
}

function fakeConfig(values: Record<string, unknown> = {}) {
    const listeners: ((e: { affectsConfiguration(s: string): boolean }) => void)[] = [];
    const service = {
        // The service signature is generic, but the fake can just return the value as is.
        get: (key: string): never => values[key] as never,
        onDidChangeConfiguration: (cb: (e: { affectsConfiguration(s: string): boolean }) => void): IDisposable => {
            listeners.push(cb);
            return { dispose: () => listeners.splice(listeners.indexOf(cb), 1) };
        },
    } as unknown as IConfigurationService;
    return {
        service,
        set: (key: string, value: unknown) => {
            values[key] = value;
            const section = key.split(".")[0];
            for (const cb of [...listeners]) cb({ affectsConfiguration: (s) => s === section });
        },
    };
}

function fakeTheme(colors: Record<string, number>) {
    const listeners: (() => void)[] = [];
    const service = {
        theme: { getColor: (id: string) => colors[id] },
        onThemeChange: (cb: () => void): IDisposable => {
            listeners.push(cb);
            return { dispose: () => listeners.splice(listeners.indexOf(cb), 1) };
        },
    } as unknown as ThemeService;
    return {
        service,
        recolor: (next: Record<string, number>) => {
            for (const key of Object.keys(colors)) Reflect.deleteProperty(colors, key);
            Object.assign(colors, next);
            for (const cb of [...listeners]) cb();
        },
    };
}

function fakeProvider(content: string) {
    const listeners: ((uris: readonly Uri[]) => void)[] = [];
    let current = content;
    const provider: IFileSystemProvider = {
        capabilities: FileSystemProviderCapabilities.Readonly,
        readFile: () => Promise.resolve(new TextEncoder().encode(current)),
        onDidChangeFile: (cb) => {
            listeners.push(cb);
            return { dispose: () => listeners.splice(listeners.indexOf(cb), 1) };
        },
    };
    return {
        provider,
        commit: (next: string) => {
            current = next;
            for (const cb of [...listeners]) cb([ORIGINAL]);
        },
    };
}

interface ISetupOptions {
    readonly text?: string;
    readonly original?: string | null;
    readonly config?: Record<string, unknown>;
}

function setup(options: ISetupOptions = {}) {
    const ed = fakeEditor(FILE, options.text ?? "a\nb\nc");
    const src = fakeSource(ed.editor);
    const registry = new FileService();
    const prov = fakeProvider(options.original ?? "a\nb\nc");
    registry.registerProvider("git", prov.provider);
    const cfg = fakeConfig({ "git.refreshDebounce": 0, ...options.config });
    const theme = fakeTheme({
        "editorGutter.addedBackground": ADDED,
        "editorGutter.modifiedBackground": MODIFIED,
        "editorGutter.deletedBackground": DELETED,
    });
    const originals: IOriginalResourceProvider = {
        provideOriginalResource: () => Promise.resolve(options.original === null ? null : ORIGINAL),
    };
    const service = new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
    return { ed, src, registry, prov, cfg, theme, service, originals };
}

async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("QuickDiffService", () => {
    it("no edits, no bars", async () => {
        const { ed } = setup({ text: "a\nb\nc", original: "a\nb\nc" });
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("editing the buffer WITHOUT saving gives a bar: this is the fixed defect", async () => {
        const { ed } = setup({ text: "a\nb\nc", original: "a\nb\nc" });
        await settle();

        ed.type("a\nB2\nc");
        await settle();

        expect(ed.last).toEqual([
            {
                range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
                color: MODIFIED,
                dashed: true,
            },
        ]);
    });

    it("an inserted line is painted with the added color", async () => {
        const { ed } = setup({ text: "a\nc", original: "a\nc" });
        await settle();

        ed.type("a\nb\nc");
        await settle();

        expect(ed.last).toEqual([
            { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, color: ADDED },
        ]);
    });

    it("a series of edits collapses into one recompute (debounce)", async () => {
        const { ed } = setup({ config: { "git.refreshDebounce": 20 } });
        await settle();
        const before = ed.pushed.length;

        ed.type("a\nb1\nc");
        ed.type("a\nb2\nc");
        ed.type("a\nb3\nc");
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(ed.pushed.length).toBe(before + 1);
    });

    it("no original (untracked): no bars and nothing breaks", async () => {
        const { ed } = setup({ original: null });
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("no provider for the scheme (the extension did not start): no bars", async () => {
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, new FileService(), cfg.service, theme.service);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("an error reading the original does not crash the service", async () => {
        const ed = fakeEditor(FILE, "a");
        const src = fakeSource(ed.editor);
        const registry = new FileService();
        registry.registerProvider("git", {
            capabilities: FileSystemProviderCapabilities.Readonly,
            readFile: () => Promise.reject(new Error("git unavailable")),
            onDidChangeFile: Event.None,
        });
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({});
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("a HEAD move invalidates the cache and recomputes", async () => {
        const { ed, prov } = setup({ text: "a\nb\nc", original: "a\nb\nc" });
        await settle();
        expect(ed.last).toEqual([]);

        prov.commit("a\nZZZ\nc");
        await settle();

        expect(ed.last).toHaveLength(1);
    });

    it("a theme change recolors existing bars", async () => {
        const { ed, theme } = setup({ text: "a\nX\nc", original: "a\nb\nc" });
        await settle();
        expect(ed.last?.[0].color).toBe(MODIFIED);

        theme.recolor({
            "editorGutter.addedBackground": 1,
            "editorGutter.modifiedBackground": 0x123456,
            "editorGutter.deletedBackground": 3,
        });
        await settle();

        expect(ed.last?.[0].color).toBe(0x123456);
    });

    it("git.gutter.enabled=false removes the bars", async () => {
        const { ed, cfg } = setup({ text: "a\nX\nc", original: "a\nb\nc" });
        await settle();
        expect(ed.last).toHaveLength(1);

        cfg.set("git.gutter.enabled", false);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("git.enabled=false removes the bars too", async () => {
        const { ed, cfg } = setup({ text: "a\nX\nc", original: "a\nb\nc" });
        await settle();

        cfg.set("git.enabled", false);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("a setting outside the git section does not trigger a recompute", async () => {
        const { ed, cfg } = setup();
        await settle();
        const before = ed.pushed.length;

        cfg.set("editor.tabSize", 8);
        await settle();

        expect(ed.pushed.length).toBe(before);
    });

    it("an active editor change recomputes bars for the new one", async () => {
        const { src } = setup();
        await settle();

        const other = fakeEditor(Uri.file("/repo/b.ts"), "a\nX\nc");
        src.activate(other.editor);
        await settle();

        expect(other.last).toHaveLength(1);
    });

    it("does nothing without an active editor", async () => {
        const src = fakeSource(null);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({});
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        expect(
            () => new QuickDiffService(src.source, originals, new FileService(), cfg.service, theme.service),
        ).not.toThrow();
        await settle();
    });

    it("a stale async response is not applied over a fresh one", async () => {
        // The original resolves with a delay; the editor changes meanwhile.
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileService();
        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        const originals: IOriginalResourceProvider = {
            provideOriginalResource: () =>
                new Promise((resolve) =>
                    setTimeout(() => {
                        resolve(ORIGINAL);
                    }, 20),
                ),
        };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        const other = fakeEditor(Uri.file("/repo/b.ts"), "a\nb\nc");
        src.activate(other.editor);
        await new Promise((resolve) => setTimeout(resolve, 60));

        expect(ed.pushed).toEqual([]);
    });

    it("the extension activated AFTER the file was opened: bars appear without an edit", async () => {
        // Regression from a live run: the git extension starts after the first recompute,
        // and a cached "no provider" kept bars away until the first edit.
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileService();
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        await settle();
        expect(ed.last).toEqual([]);

        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        await settle();

        expect(ed.last).toHaveLength(1);
    });

    it("a missing original is not cached, otherwise late activation cannot be survived", async () => {
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileService();
        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        let available = false;
        const originals: IOriginalResourceProvider = {
            provideOriginalResource: () => Promise.resolve(available ? ORIGINAL : null),
        };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        await settle();
        expect(ed.last).toEqual([]);

        // The extension answered later — the next recompute must ask again.
        available = true;
        ed.type("a\nY\nc");
        await settle();

        expect(ed.last).toHaveLength(1);
    });
    it("a read original is cached: an edit does not reread it", async () => {
        const ed = fakeEditor(FILE, "a\nb\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileService();
        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        let asked = 0;
        const originals: IOriginalResourceProvider = {
            provideOriginalResource: () => {
                asked++;
                return Promise.resolve(ORIGINAL);
            },
        };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        await settle();
        ed.type("a\nY\nc");
        await settle();

        expect(ed.last).toHaveLength(1);
        expect(asked).toBe(1);
    });

    it("dispose removes subscriptions and the timer", async () => {
        const { ed, service } = setup({ config: { "git.refreshDebounce": 50 } });
        await settle();
        const before = ed.pushed.length;

        ed.type("a\nZ\nc");
        service.dispose();
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(ed.pushed.length).toBe(before);
    });

    it("an invalid debounce falls back to the default", async () => {
        const { ed } = setup({ text: "a\nX\nc", original: "a\nb\nc", config: { "git.refreshDebounce": -5 } });
        await settle();

        // Default is 200 ms: right after an edit there is no recompute yet.
        const before = ed.pushed.length;
        ed.type("a\nY\nc");
        await settle();
        expect(ed.pushed.length).toBe(before);

        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(ed.pushed.length).toBe(before + 1);
    });

    it("a huge debounce is capped", async () => {
        const { ed } = setup({ config: { "git.refreshDebounce": 10_000_000 } });
        await settle();
        const before = ed.pushed.length;

        ed.type("a\nZ\nc");
        await new Promise((resolve) => setTimeout(resolve, 50));

        // The limit is 5 s, so no recompute within 50 ms, but not "never" either.
        expect(ed.pushed.length).toBe(before);
    });

    it("a color missing from the theme does not break the computation", async () => {
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileService();
        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, registry, cfg.service, fakeTheme({}).service);
        await settle();

        expect(ed.last?.[0].color).toBe(0);
    });
});
