import { describe, expect, it } from "vitest";

import type { IClipboard } from "../../../../platform/clipboard/common/iClipboard.ts";

import {
    ExternalOpenerService,
    hasGraphicalSession,
    type IExternalOpenerEnvironment,
    isOpenableUrl,
    spawnDetached,
    systemHandler,
} from "./externalOpenerService.ts";

function fakeClipboard(): IClipboard & { written: string[] } {
    const written: string[] = [];
    return {
        written,
        readText: () => Promise.resolve(written.at(-1) ?? ""),
        writeText: (text) => {
            written.push(text);
            return Promise.resolve();
        },
    };
}

function makeEnv(patch: Partial<IExternalOpenerEnvironment> = {}): IExternalOpenerEnvironment & {
    clipboard: IClipboard & { written: string[] };
    shown: string[];
    launched: { command: string; args: readonly string[] }[];
} {
    const clipboard = fakeClipboard();
    const shown: string[] = [];
    const launched: { command: string; args: readonly string[] }[] = [];
    return {
        platform: "linux",
        env: { DISPLAY: ":0" },
        launch: (command, args) => {
            launched.push({ command, args });
            return Promise.resolve(true);
        },
        showInfo: (message) => shown.push(message),
        ...patch,
        // После `patch`: буфер и журналы всегда наши — их читают ассерты.
        clipboard,
        shown,
        launched,
    };
}

describe("isOpenableUrl", () => {
    it("http, https и mailto берёмся открывать", () => {
        expect(isOpenableUrl("https://example.com")).toBe(true);
        expect(isOpenableUrl("http://example.com")).toBe(true);
        expect(isOpenableUrl("mailto:me@example.com")).toBe(true);
    });

    it("остальные схемы и мусор — не наше дело", () => {
        expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
        expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
        expect(isOpenableUrl("vscode:extension/x")).toBe(false);
        expect(isOpenableUrl("не ссылка")).toBe(false);
        expect(isOpenableUrl("")).toBe(false);
    });
});

describe("hasGraphicalSession", () => {
    it("X11 и Wayland считаются графическим сеансом", () => {
        expect(hasGraphicalSession({ DISPLAY: ":0" })).toBe(true);
        expect(hasGraphicalSession({ WAYLAND_DISPLAY: "wayland-0" })).toBe(true);
    });

    it("пустое окружение — сеанса нет", () => {
        expect(hasGraphicalSession({})).toBe(false);
        expect(hasGraphicalSession({ DISPLAY: "" })).toBe(false);
    });

    it("ssh отсекается даже при проброшенном DISPLAY", () => {
        expect(hasGraphicalSession({ DISPLAY: ":0", SSH_CONNECTION: "1.2.3.4 1 5.6.7.8 22" })).toBe(false);
        expect(hasGraphicalSession({ DISPLAY: ":0", SSH_TTY: "/dev/pts/0" })).toBe(false);
    });
});

describe("systemHandler", () => {
    it("macOS — open, Windows — cmd /c start", () => {
        expect(systemHandler({ platform: "darwin", env: {} })).toEqual({ command: "open", args: [] });
        expect(systemHandler({ platform: "win32", env: {} })).toEqual({ command: "cmd", args: ["/c", "start", ""] });
    });

    it("Linux с графикой — xdg-open", () => {
        expect(systemHandler({ platform: "linux", env: { DISPLAY: ":0" } })).toEqual({
            command: "xdg-open",
            args: [],
        });
    });

    it("Linux без графики — открывать нечем", () => {
        expect(systemHandler({ platform: "linux", env: {} })).toBeNull();
    });
});

describe("ExternalOpenerService", () => {
    it("запускает системный обработчик и НЕ трогает буфер", async () => {
        const env = makeEnv();
        const opener = new ExternalOpenerService(env);

        await expect(opener.open("https://example.com/a?b=1")).resolves.toBe(true);
        expect(env.launched).toEqual([{ command: "xdg-open", args: ["https://example.com/a?b=1"] }]);
        expect(env.clipboard.written).toEqual([]);
        expect(env.shown).toEqual([]);
    });

    it("Windows: URL уезжает последним аргументом после пустого заголовка окна", async () => {
        const env = makeEnv({ platform: "win32", env: {} });
        const opener = new ExternalOpenerService(env);

        await opener.open("https://example.com");
        expect(env.launched).toEqual([{ command: "cmd", args: ["/c", "start", "", "https://example.com"] }]);
    });

    it("без графического сеанса отдаёт ссылку человеку: буфер плюс сообщение", async () => {
        const env = makeEnv({ env: {} });
        const opener = new ExternalOpenerService(env);

        await expect(opener.open("https://example.com/activate?token=42")).resolves.toBe(true);
        expect(env.launched).toEqual([]);
        expect(env.clipboard.written).toEqual(["https://example.com/activate?token=42"]);
        expect(env.shown).toEqual(["Ссылка скопирована в буфер обмена: https://example.com/activate?token=42"]);
    });

    it("обработчик есть, но запустить не удалось — тот же фоллбэк", async () => {
        const env = makeEnv({ launch: () => Promise.resolve(false) });
        const opener = new ExternalOpenerService(env);

        await expect(opener.open("https://example.com")).resolves.toBe(true);
        expect(env.clipboard.written).toEqual(["https://example.com"]);
        expect(env.shown).toHaveLength(1);
    });

    it("чужую схему не открываем и человеку не показываем", async () => {
        const env = makeEnv();
        const opener = new ExternalOpenerService(env);

        await expect(opener.open("file:///etc/passwd")).resolves.toBe(false);
        expect(env.launched).toEqual([]);
        expect(env.clipboard.written).toEqual([]);
        expect(env.shown).toEqual([]);
    });
});

describe("spawnDetached", () => {
    it("настоящий процесс запускается", async () => {
        await expect(spawnDetached("node", ["--version"])).resolves.toBe(true);
    });

    it("несуществующая команда даёт false, а не необработанный ENOENT", async () => {
        await expect(spawnDetached("diode-no-such-binary-xyz", [])).resolves.toBe(false);
    });
});
