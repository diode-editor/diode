import { describe, expect, it, vi } from "vitest";

import type { IDisposable } from "../../../../../../tuidom/common/disposable.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IGutterChangeDecoration } from "../../../../editor/common/model/iGutterChangeDecoration.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { FileSystemProviderRegistry } from "../../../../platform/files/common/fileSystemProviderRegistry.ts";
import type { IReadOnlyFileSystemProvider } from "../../../../platform/files/common/iFileSystemProviderRegistry.ts";
import type { ThemeService } from "../../../services/themes/common/themeService.ts";

import type { IOriginalResourceProvider, IQuickDiffEditor, IQuickDiffEditorSource } from "./quickDiffService.ts";
import { QuickDiffService } from "./quickDiffService.ts";

const ADDED = 0x00ff00;
const MODIFIED = 0x0000ff;
const DELETED = 0xff0000;

const FILE = Uri.file("/repo/a.ts");
const ORIGINAL = Uri.from({ scheme: "git", path: "/repo/a.ts", query: '{"path":"/repo/a.ts","ref":"HEAD"}' });

/** Редактор-фейк: текст задаётся тестом, декорации копятся. */
function fakeEditor(uri: Uri, text: string) {
    const listeners: (() => void)[] = [];
    const pushed: (readonly IGutterChangeDecoration[])[] = [];
    let current = text;
    const editor: IQuickDiffEditor = {
        uri,
        getText: () => current,
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
        get: <T>(key: string): T | undefined => values[key] as T | undefined,
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
            for (const key of Object.keys(colors)) delete colors[key];
            Object.assign(colors, next);
            for (const cb of [...listeners]) cb();
        },
    };
}

/** Провайдер `git:`-содержимого с ручным управлением. */
function fakeProvider(content: string) {
    const listeners: ((uris: readonly Uri[]) => void)[] = [];
    let current = content;
    const provider: IReadOnlyFileSystemProvider = {
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
    const registry = new FileSystemProviderRegistry();
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

/** Ждёт, пока отработают debounce (0 мс) и асинхронное чтение оригинала. */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 5));
}

describe("QuickDiffService", () => {
    it("без правок баров нет", async () => {
        const { ed } = setup({ text: "a\nb\nc", original: "a\nb\nc" });
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("правка буфера БЕЗ сохранения даёт бар — это и есть починенный дефект", async () => {
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

    it("вставленная строка красится цветом added", async () => {
        const { ed } = setup({ text: "a\nc", original: "a\nc" });
        await settle();

        ed.type("a\nb\nc");
        await settle();

        expect(ed.last).toEqual([
            { range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } }, color: ADDED },
        ]);
    });

    it("серия правок схлопывается в один пересчёт (debounce)", async () => {
        const { ed } = setup({ config: { "git.refreshDebounce": 20 } });
        await settle();
        const before = ed.pushed.length;

        ed.type("a\nb1\nc");
        ed.type("a\nb2\nc");
        ed.type("a\nb3\nc");
        await new Promise((resolve) => setTimeout(resolve, 40));

        expect(ed.pushed.length).toBe(before + 1);
    });

    it("нет оригинала (untracked) — баров нет и ничего не падает", async () => {
        const { ed } = setup({ original: null });
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("провайдера схемы нет (расширение не поднялось) — баров нет", async () => {
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, new FileSystemProviderRegistry(), cfg.service, theme.service);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("ошибка чтения оригинала не роняет сервис", async () => {
        const ed = fakeEditor(FILE, "a");
        const src = fakeSource(ed.editor);
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", {
            readFile: () => Promise.reject(new Error("git недоступен")),
            onDidChangeFile: () => ({ dispose: () => undefined }),
        });
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({});
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("сдвиг HEAD инвалидирует кэш и пересчитывает", async () => {
        const { ed, prov } = setup({ text: "a\nb\nc", original: "a\nb\nc" });
        await settle();
        expect(ed.last).toEqual([]);

        // Закоммитили другую версию — буфер теперь отличается от HEAD.
        prov.commit("a\nZZZ\nc");
        await settle();

        expect(ed.last).toHaveLength(1);
    });

    it("смена темы перекрашивает существующие бары", async () => {
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

    it("git.gutter.enabled=false снимает бары", async () => {
        const { ed, cfg } = setup({ text: "a\nX\nc", original: "a\nb\nc" });
        await settle();
        expect(ed.last).toHaveLength(1);

        cfg.set("git.gutter.enabled", false);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("git.enabled=false тоже снимает бары", async () => {
        const { ed, cfg } = setup({ text: "a\nX\nc", original: "a\nb\nc" });
        await settle();

        cfg.set("git.enabled", false);
        await settle();

        expect(ed.last).toEqual([]);
    });

    it("настройка вне секции git пересчёт не триггерит", async () => {
        const { ed, cfg } = setup();
        await settle();
        const before = ed.pushed.length;

        cfg.set("editor.tabSize", 8);
        await settle();

        expect(ed.pushed.length).toBe(before);
    });

    it("смена активного редактора пересчитывает бары для нового", async () => {
        const { src } = setup();
        await settle();

        const other = fakeEditor(Uri.file("/repo/b.ts"), "a\nX\nc");
        src.activate(other.editor);
        await settle();

        expect(other.last).toHaveLength(1);
    });

    it("без активного редактора ничего не делает", async () => {
        const src = fakeSource(null);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({});
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        expect(
            () =>
                new QuickDiffService(
                    src.source,
                    originals,
                    new FileSystemProviderRegistry(),
                    cfg.service,
                    theme.service,
                ),
        ).not.toThrow();
        await settle();
    });

    it("устаревший асинхронный ответ не применяется поверх свежего", async () => {
        // Оригинал резолвится с задержкой; за это время редактор сменился.
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileSystemProviderRegistry();
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

        // Первый (устаревший) расчёт не должен был положить бары в старый редактор.
        expect(ed.pushed).toEqual([]);
    });

    it("расширение активировалось ПОЗЖЕ открытия файла — бары появляются без правки", async () => {
        // Регрессия, пойманная на живом запуске: git-расширение поднимается
        // асинхронно, поэтому первый пересчёт видит «поставщика нет». Раньше этот
        // отрицательный ответ кэшировался, и бары не появлялись до первой правки.
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileSystemProviderRegistry();
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const theme = fakeTheme({ "editorGutter.modifiedBackground": MODIFIED });
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, registry, cfg.service, theme.service);
        await settle();
        expect(ed.last).toEqual([]);

        // Расширение поднялось и зарегистрировало схему.
        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        await settle();

        expect(ed.last).toHaveLength(1);
    });

    it("отсутствие оригинала не кэшируется — иначе не пережить позднюю активацию", async () => {
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileSystemProviderRegistry();
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

        // Расширение ответило позже — повторный пересчёт обязан спросить заново.
        available = true;
        ed.type("a\nY\nc");
        await settle();

        expect(ed.last).toHaveLength(1);
    });
    it("dispose снимает подписки и таймер", async () => {
        const { ed, service } = setup({ config: { "git.refreshDebounce": 50 } });
        await settle();
        const before = ed.pushed.length;

        ed.type("a\nZ\nc");
        service.dispose();
        await new Promise((resolve) => setTimeout(resolve, 80));

        expect(ed.pushed.length).toBe(before);
    });

    it("невалидный debounce откатывается на дефолт", async () => {
        const { ed } = setup({ text: "a\nX\nc", original: "a\nb\nc", config: { "git.refreshDebounce": -5 } });
        await settle();

        // Дефолт 200 мс: сразу после правки пересчёта ещё нет.
        const before = ed.pushed.length;
        ed.type("a\nY\nc");
        await settle();
        expect(ed.pushed.length).toBe(before);

        await new Promise((resolve) => setTimeout(resolve, 250));
        expect(ed.pushed.length).toBe(before + 1);
    });

    it("огромный debounce ограничивается сверху", async () => {
        const { ed } = setup({ config: { "git.refreshDebounce": 10_000_000 } });
        await settle();
        const before = ed.pushed.length;

        ed.type("a\nZ\nc");
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Ограничение — 5 с, поэтому за 50 мс пересчёта нет, но и не «никогда».
        expect(ed.pushed.length).toBe(before);
    });

    it("цвет, которого нет в теме, не роняет расчёт", async () => {
        const ed = fakeEditor(FILE, "a\nX\nc");
        const src = fakeSource(ed.editor);
        const registry = new FileSystemProviderRegistry();
        registry.registerProvider("git", fakeProvider("a\nb\nc").provider);
        const cfg = fakeConfig({ "git.refreshDebounce": 0 });
        const originals: IOriginalResourceProvider = { provideOriginalResource: () => Promise.resolve(ORIGINAL) };

        new QuickDiffService(src.source, originals, registry, cfg.service, fakeTheme({}).service);
        await settle();

        expect(ed.last?.[0].color).toBe(0);
    });
});
