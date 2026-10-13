import { describe, expect, it } from "vitest";

import { CliArgsError, DEFAULT_INSPECT_TUI, parseCliArgs, relaunchArgs, relaunchWorkspace } from "./cliArgs.ts";

describe("parseCliArgs", () => {
    it("returns empty result for empty argv", () => {
        const r = parseCliArgs([]);
        expect(r.positional).toEqual([]);
        expect(r.userDataDir).toBeUndefined();
        expect(r.profile).toBeUndefined();
        expect(r.inspectTui).toBeUndefined();
        expect(r.help).toBe(false);
    });

    it("collects positional arguments", () => {
        const r = parseCliArgs(["a.ts", "b.ts", "src/"]);
        expect(r.positional).toEqual(["a.ts", "b.ts", "src/"]);
    });

    it("parses --user-data-dir with separate value", () => {
        const r = parseCliArgs(["--user-data-dir", "/tmp/diode", "file.ts"]);
        expect(r.userDataDir).toBe("/tmp/diode");
        expect(r.positional).toEqual(["file.ts"]);
    });

    it("parses --user-data-dir=<path>", () => {
        const r = parseCliArgs(["--user-data-dir=/tmp/diode", "file.ts"]);
        expect(r.userDataDir).toBe("/tmp/diode");
        expect(r.positional).toEqual(["file.ts"]);
    });

    it("parses --profile", () => {
        expect(parseCliArgs(["--profile", "compact"]).profile).toBe("compact");
        expect(parseCliArgs(["--profile=compact"]).profile).toBe("compact");
    });

    it("supports -h and --help", () => {
        expect(parseCliArgs(["-h"]).help).toBe(true);
        expect(parseCliArgs(["--help"]).help).toBe(true);
    });

    it("supports -v and --version", () => {
        expect(parseCliArgs(["-v"]).version).toBe(true);
        expect(parseCliArgs(["--version"]).version).toBe(true);
        expect(parseCliArgs([]).version).toBe(false);
    });

    it("treats arguments after -- as positional", () => {
        const r = parseCliArgs(["--user-data-dir", "/tmp/v", "--", "--profile", "x"]);
        expect(r.userDataDir).toBe("/tmp/v");
        expect(r.profile).toBeUndefined();
        expect(r.positional).toEqual(["--profile", "x"]);
    });

    it("throws on unknown option", () => {
        expect(() => parseCliArgs(["--nope"])).toThrow(CliArgsError);
        expect(() => parseCliArgs(["-x"])).toThrow(CliArgsError);
    });

    it("throws when option value missing", () => {
        expect(() => parseCliArgs(["--profile"])).toThrow(/requires a value/);
        expect(() => parseCliArgs(["--user-data-dir="])).toThrow(/non-empty value/);
    });

    it("combines flags and positional in any order", () => {
        const r = parseCliArgs(["file.ts", "--profile", "compact", "another.ts"]);
        expect(r.positional).toEqual(["file.ts", "another.ts"]);
        expect(r.profile).toBe("compact");
    });

    it("treats `-` as positional (stdin convention)", () => {
        const r = parseCliArgs(["-"]);
        expect(r.positional).toEqual(["-"]);
    });

    it("parses bare --inspect-tui to the default host:port", () => {
        const [host, port] = DEFAULT_INSPECT_TUI.split(":");
        const r = parseCliArgs(["--inspect-tui", "file.ts"]);
        expect(r.inspectTui).toEqual({ host, port: Number(port) });
        expect(r.positional).toEqual(["file.ts"]);
    });

    it("parses --inspect-tui=host:port", () => {
        expect(parseCliArgs(["--inspect-tui=127.0.0.1:0"]).inspectTui).toEqual({ host: "127.0.0.1", port: 0 });
        expect(parseCliArgs(["--inspect-tui=0.0.0.0:9300"]).inspectTui).toEqual({ host: "0.0.0.0", port: 9300 });
    });

    it("throws on malformed --inspect-tui", () => {
        expect(() => parseCliArgs(["--inspect-tui=localhost"])).toThrow(/host:port/);
        expect(() => parseCliArgs(["--inspect-tui=:9300"])).toThrow(/non-empty host/);
        expect(() => parseCliArgs(["--inspect-tui=host:notaport"])).toThrow(/port in 0\.\.65535/);
        expect(() => parseCliArgs(["--inspect-tui=host:70000"])).toThrow(/port in 0\.\.65535/);
    });

    it("defaults headless to undefined", () => {
        expect(parseCliArgs(["file.ts"]).headless).toBeUndefined();
    });

    it("parses bare --headless to the default size (with --inspect-tui)", () => {
        expect(parseCliArgs(["--headless", "--inspect-tui", "file.ts"]).headless).toEqual({ cols: 120, rows: 32 });
    });

    it("parses --headless=<cols>x<rows>", () => {
        expect(parseCliArgs(["--headless=160x48", "--inspect-tui"]).headless).toEqual({ cols: 160, rows: 48 });
        expect(parseCliArgs(["--headless=80X24", "--inspect-tui"]).headless).toEqual({ cols: 80, rows: 24 });
    });

    it("throws on malformed --headless size", () => {
        expect(() => parseCliArgs(["--headless=120", "--inspect-tui"])).toThrow(/<cols>x<rows>/);
        expect(() => parseCliArgs(["--headless=0x24", "--inspect-tui"])).toThrow(/positive dimensions/);
    });

    it("requires --inspect-tui alongside --headless", () => {
        expect(() => parseCliArgs(["--headless"])).toThrow(/--headless requires --inspect-tui/);
        expect(() => parseCliArgs(["--headless=100x40"])).toThrow(/--headless requires --inspect-tui/);
    });

    it("parses --install-extension with separate value and =form", () => {
        expect(parseCliArgs(["--install-extension", "/tmp/ext.vsix"]).installExtension).toBe("/tmp/ext.vsix");
        expect(parseCliArgs(["--install-extension=/tmp/ext.vsix"]).installExtension).toBe("/tmp/ext.vsix");
        expect(parseCliArgs([]).installExtension).toBeUndefined();
    });

    it("parses --uninstall-extension", () => {
        expect(parseCliArgs(["--uninstall-extension", "acme.hello"]).uninstallExtension).toBe("acme.hello");
        expect(parseCliArgs(["--uninstall-extension=acme.hello"]).uninstallExtension).toBe("acme.hello");
        expect(parseCliArgs([]).uninstallExtension).toBeUndefined();
    });

    it("parses --registry with separate value and =form", () => {
        expect(parseCliArgs(["--registry", "/tmp/registry"]).registry).toBe("/tmp/registry");
        expect(parseCliArgs(["--registry=/tmp/registry"]).registry).toBe("/tmp/registry");
        expect(parseCliArgs([]).registry).toBeUndefined();
    });

    it("parses --list-extensions", () => {
        expect(parseCliArgs(["--list-extensions"]).listExtensions).toBe(true);
        expect(parseCliArgs([]).listExtensions).toBe(false);
    });

    it("throws when extension-management flags miss their value", () => {
        expect(() => parseCliArgs(["--install-extension"])).toThrow(/requires a value/);
        expect(() => parseCliArgs(["--uninstall-extension="])).toThrow(/non-empty value/);
    });
});

describe("relaunchArgs", () => {
    it("снимает прежний --profile в обеих формах и ставит явный", () => {
        expect(relaunchArgs(["--profile", "old", "/work"], { profile: "work" })).toEqual([
            "--profile",
            "work",
            "--",
            "/work",
        ]);
        expect(relaunchArgs(["/work", "--profile=old"], { profile: "Default" })).toEqual([
            "--profile",
            "Default",
            "--",
            "/work",
        ]);
    });

    it("без смены воркспейса позиционные и прочие флаги едут как были", () => {
        const args = [
            "--user-data-dir",
            "/u",
            "--headless=80x24",
            "--inspect-tui=127.0.0.1:0",
            "--log",
            "debug",
            "--verbose",
            "-g",
            "a.ts:3:4",
            "b.ts",
        ];
        expect(relaunchArgs(args, { profile: "work" })).toEqual([
            "--user-data-dir",
            "/u",
            "--headless=80x24",
            "--inspect-tui=127.0.0.1:0",
            "--log",
            "debug",
            "--verbose",
            "-g",
            "--profile",
            "work",
            "--",
            "a.ts:3:4",
            "b.ts",
        ]);
    });

    it("смена воркспейса замещает позиционные и режимы --goto/--diff", () => {
        expect(
            relaunchArgs(["--diff", "a", "b", "--user-data-dir=/u"], { profile: "work", workspace: "/other" }),
        ).toEqual(["--user-data-dir=/u", "--profile", "work", "--", "/other"]);
        expect(
            relaunchArgs(["--goto", "a.ts:1", "--", "-x"], { profile: "work", workspace: "/p/web.code-workspace" }),
        ).toEqual(["--profile", "work", "--", "/p/web.code-workspace"]);
    });

    it("короткие -g/-d при смене воркспейса снимаются так же, как длинные", () => {
        expect(relaunchArgs(["-g", "a.ts:1", "-d", "a", "b"], { profile: "work", workspace: "/o" })).toEqual([
            "--profile",
            "work",
            "--",
            "/o",
        ]);
    });

    it("одиночный `-` — позиционный аргумент, а не флаг", () => {
        expect(relaunchArgs(["-"], { profile: "work" })).toEqual(["--profile", "work", "--", "-"]);
    });

    it("позиционные после `--` сохраняются; без позиционных `--` не ставится", () => {
        expect(relaunchArgs(["--", "-weird", "x"], { profile: "work" })).toEqual([
            "--profile",
            "work",
            "--",
            "-weird",
            "x",
        ]);
        expect(relaunchArgs(["--profile", "old"], { profile: "work" })).toEqual(["--profile", "work"]);
        expect(relaunchArgs([], { profile: "work" })).toEqual(["--profile", "work"]);
    });

    it("флаг со значением в хвосте без значения не роняет и не тянет мусор", () => {
        expect(relaunchArgs(["/work", "--log"], { profile: "work" })).toEqual(["--profile", "work", "--", "/work"]);
    });

    it("результат разбирается обратно: профиль, воркспейс и флаги на месте", () => {
        const parsed = parseCliArgs(
            relaunchArgs(["--headless=80x24", "--inspect-tui", "/old", "--profile", "x"], {
                profile: "My Work",
                workspace: "/new",
            }),
        );
        expect(parsed.profile).toBe("My Work");
        expect(parsed.positional).toEqual(["/new"]);
        expect(parsed.headless).toEqual({ cols: 80, rows: 24 });
        expect(parsed.inspectTui).toBeDefined();
    });
});

describe("relaunchWorkspace", () => {
    it("запрошенный воркспейс побеждает", () => {
        expect(relaunchWorkspace("/next", "/start", "/current")).toBe("/next");
    });

    it("окно сменило воркспейс после старта — следующее окно поднимается с текущим", () => {
        expect(relaunchWorkspace(undefined, "/start", "/current")).toBe("/current");
        expect(relaunchWorkspace(undefined, undefined, "/current")).toBe("/current");
    });

    it("воркспейс тот же — позиционные этого окна не трогаются", () => {
        expect(relaunchWorkspace(undefined, "/start", "/start")).toBeUndefined();
        expect(relaunchWorkspace(undefined, undefined, undefined)).toBeUndefined();
    });
});
