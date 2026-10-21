import { afterEach, describe, expect, it, vi } from "vitest";

import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import { Emitter } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IExtension } from "../../../../platform/extensions/common/iExtension.ts";

import {
    confirmMessage,
    ExtensionUrlHandler,
    type IExtensionUrlHandlerOptions,
    installedExtensionDisplayName,
} from "./extensionUrlHandler.ts";

function fakeHandlers() {
    const registered = new Set<string>();
    const onDidRegister = new Emitter<string>();
    const handled: { extensionId: string; uri: string }[] = [];
    return {
        handled,
        has: (id: string) => registered.has(id.toLowerCase()),
        handle: vi.fn((extensionId: string, uri: string) => {
            handled.push({ extensionId, uri });
            return Promise.resolve();
        }),
        onDidRegister: onDidRegister.event,
        register(id: string) {
            registered.add(id.toLowerCase());
            onDidRegister.fire(id);
        },
    };
}

function setup(overrides: Partial<IExtensionUrlHandlerOptions> = {}) {
    const handlers = fakeHandlers();
    let clock = 1_000_000;
    const options = {
        handlers,
        activateByEvent: vi.fn((_event: string) => Promise.resolve()),
        extensionDisplayName: vi.fn((id: string) => (id.toLowerCase() === "pub.ext" ? "Pub Ext" : undefined)),
        confirm: vi.fn((_message: readonly string[]) => Promise.resolve(true)),
        confirmedExtensionIds: vi.fn((): unknown => []),
        notifyNotInstalled: vi.fn(),
        logger: { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), isEnabled: () => true },
        now: () => clock,
        ...overrides,
    };
    const handler = new ExtensionUrlHandler(options);
    return {
        handler,
        handlers,
        options,
        advance(ms: number) {
            clock += ms;
            vi.advanceTimersByTime(ms);
        },
    };
}

const URI = Uri.parse("diode://pub.ext/install-plugin?name=x");

afterEach(() => {
    vi.useRealTimers();
});

describe("ExtensionUrlHandler", () => {
    it.each(["diode://not-an-id/x", "diode:///x", "diode://a.b.c/x", "diode://-a.b/x"])(
        "authority — не id расширения: не наш URL (%s)",
        async (raw) => {
            const { handler, options } = setup();
            await expect(handler.handleURL(Uri.parse(raw))).resolves.toBe(false);
            expect(options.extensionDisplayName).not.toHaveBeenCalled();
        },
    );

    it("неустановленное расширение: человеку сказано, URL забран", async () => {
        const { handler, options } = setup();
        const uri = Uri.parse("diode://other.ext/x");
        await expect(handler.handleURL(uri)).resolves.toBe(true);
        expect(options.notifyNotInstalled).toHaveBeenCalledWith("other.ext", uri);
        expect(options.confirm).not.toHaveBeenCalled();
        expect(options.activateByEvent).not.toHaveBeenCalled();
    });

    it("есть обработчик, человек согласился — URI уходит расширению строкой", async () => {
        const { handler, handlers, options } = setup();
        handlers.register("pub.ext");
        await expect(handler.handleURL(URI)).resolves.toBe(true);
        expect(options.confirm).toHaveBeenCalledWith(confirmMessage("Pub Ext", URI));
        expect(handlers.handled).toEqual([{ extensionId: "pub.ext", uri: URI.toString() }]);
        expect(options.activateByEvent).not.toHaveBeenCalled();
    });

    it("человек отказался — URI никуда не уходит, но забран", async () => {
        const { handler, handlers, options } = setup({ confirm: vi.fn(() => Promise.resolve(false)) });
        handlers.register("pub.ext");
        await expect(handler.handleURL(URI)).resolves.toBe(true);
        expect(handlers.handled).toEqual([]);
        expect(options.activateByEvent).not.toHaveBeenCalled();
    });

    it("trusted-опция — без вопроса", async () => {
        const { handler, handlers, options } = setup();
        handlers.register("pub.ext");
        await handler.handleURL(URI, { trusted: true });
        expect(options.confirm).not.toHaveBeenCalled();
        expect(handlers.handled).toHaveLength(1);
    });

    it("расширение в настройке доверия (без учёта регистра) — без вопроса", async () => {
        const { handler, handlers, options } = setup({ confirmedExtensionIds: () => ["other.one", "PUB.Ext"] });
        handlers.register("pub.ext");
        await handler.handleURL(URI);
        expect(options.confirm).not.toHaveBeenCalled();
        expect(handlers.handled).toHaveLength(1);
    });

    it.each([undefined, "pub.ext", { "pub.ext": true }, [1, null]])(
        "настройка доверия не списком строк — вопрос (%j)",
        async (value) => {
            const { handler, options } = setup({ confirmedExtensionIds: () => value });
            await handler.handleURL(URI);
            expect(options.confirm).toHaveBeenCalledOnce();
        },
    );

    it("в списке доверия мусор рядом с id — id всё равно засчитан", async () => {
        const { handler, options } = setup({ confirmedExtensionIds: () => [1, null, "pub.ext"] });
        await handler.handleURL(URI);
        expect(options.confirm).not.toHaveBeenCalled();
    });

    it("trusted: false и чужие id в настройке — вопрос", async () => {
        const { handler, options } = setup({ confirmedExtensionIds: () => ["other.one"] });
        await handler.handleURL(URI, { trusted: false });
        expect(options.confirm).toHaveBeenCalledOnce();
    });

    it("обработчика ещё нет: активация onUri:<id в нижнем регистре>, буфер уходит при регистрации", async () => {
        const { handler, handlers, options } = setup();
        const uri = Uri.parse("diode://Pub.Ext/a");
        await expect(handler.handleURL(uri)).resolves.toBe(true);
        expect(options.activateByEvent).toHaveBeenCalledWith("onUri:pub.ext");
        expect(handlers.handled).toEqual([]);
        await handler.handleURL(Uri.parse("diode://pub.ext/b"));
        handlers.register("PUB.EXT");
        expect(handlers.handled).toEqual([
            { extensionId: "PUB.EXT", uri: "diode://pub.ext/a" },
            { extensionId: "PUB.EXT", uri: "diode://pub.ext/b" },
        ]);
        handlers.register("pub.ext");
        expect(handlers.handled).toHaveLength(2);
    });

    it("регистрация расширения без буфера — ничего не шлёт", () => {
        const { handlers } = setup();
        handlers.register("pub.ext");
        expect(handlers.handle).not.toHaveBeenCalled();
    });

    it("сбой доставки из буфера — в лог, остальные URI доставлены", async () => {
        const { handler, handlers, options } = setup();
        await handler.handleURL(Uri.parse("diode://pub.ext/a"));
        await handler.handleURL(Uri.parse("diode://pub.ext/b"));
        const boom = new Error("boom");
        handlers.handle.mockImplementationOnce(() => Promise.reject(boom));
        handlers.register("pub.ext");
        await flushMicrotasks();
        expect(handlers.handle).toHaveBeenCalledTimes(2);
        expect(options.logger.error).toHaveBeenCalledExactlyOnceWith(
            'failed to hand buffered uri to extension "pub.ext"',
            boom,
        );
    });

    it("буфер: URI старше пяти минут забывается сборкой каждые 30 с, свежие остаются", async () => {
        vi.useFakeTimers();
        const { handler, handlers, advance } = setup();
        await handler.handleURL(Uri.parse("diode://pub.ext/old"));
        advance(4 * 60 * 1000);
        await handler.handleURL(Uri.parse("diode://pub.ext/fresh"));
        advance(60 * 1000);
        handlers.register("pub.ext");
        expect(handlers.handled.map((h) => h.uri)).toEqual(["diode://pub.ext/fresh"]);
    });

    it("сборка ровно на пятой минуте уже забывает", async () => {
        vi.useFakeTimers();
        const { handler, handlers, advance } = setup();
        await handler.handleURL(Uri.parse("diode://pub.ext/old"));
        advance(5 * 60 * 1000);
        handlers.register("pub.ext");
        expect(handlers.handled).toEqual([]);
    });

    it("до первой сборки (меньше 30 с) буфер цел; после dispose сборки нет", async () => {
        vi.useFakeTimers();
        const { handler, handlers, advance } = setup();
        await handler.handleURL(Uri.parse("diode://pub.ext/a"));
        handler.dispose();
        advance(10 * 60 * 1000);
        expect(vi.getTimerCount()).toBe(0);
        handlers.register("pub.ext");
        expect(handlers.handled).toEqual([]);
    });
});

describe("confirmMessage", () => {
    it("короткий URI — целиком, с эталонной фразой и подсказкой про настройку", () => {
        expect(confirmMessage("Claude Code", Uri.parse("diode://a.b/x"))).toEqual([
            "Allow 'Claude Code' extension to open this URI?",
            "diode://a.b/x",
            'To stop asking, add the extension to "extensions.confirmedUriHandlerExtensionIds".',
        ]);
    });

    it("длиннее 40 символов — 30 первых, многоточие, 5 последних", () => {
        const uri = Uri.parse("diode://anthropic.claude-code/install-plugin?name=abcdef");
        const s = uri.toString();
        expect(s.length).toBeGreaterThan(40);
        expect(confirmMessage("C", uri)[1]).toBe(`${s.substring(0, 30)}...${s.substring(s.length - 5)}`);
    });

    it("ровно 40 символов — целиком", () => {
        const uri = Uri.parse("diode://a.b/" + "x".repeat(28));
        expect(uri.toString()).toHaveLength(40);
        expect(confirmMessage("C", uri)[1]).toBe(uri.toString());
    });
});

describe("installedExtensionDisplayName", () => {
    const extension = (id: string, displayName?: string): IExtension => ({
        id,
        manifest: {
            name: id.split(".")[1] ?? id,
            publisher: "p",
            engines: { vscode: "*" },
            version: "1.0.0",
            ...(displayName === undefined ? {} : { displayName }),
        },
        location: "",
        isBuiltin: false,
    });

    it("по id без учёта регистра — displayName, без него — id", () => {
        const extensions = [
            extension("other.ext", "Other"),
            extension("Anthropic.claude-code", "Claude Code"),
            extension("a.b"),
        ];
        expect(installedExtensionDisplayName(extensions, "anthropic.CLAUDE-code")).toBe("Claude Code");
        expect(installedExtensionDisplayName(extensions, "a.b")).toBe("a.b");
    });

    it("неустановленное — undefined", () => {
        expect(installedExtensionDisplayName([extension("a.b")], "c.d")).toBeUndefined();
    });
});
