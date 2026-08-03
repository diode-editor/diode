import { describe, expect, it } from "vitest";

import { commandFor, LANGUAGE_SERVERS, resolveServerCommand } from "./resolveServer.ts";

const TS_SPEC = LANGUAGE_SERVERS[0];

describe("vexx-lsp-typescript — resolveServer", () => {
    it("таблица серверов декларативна: typescript-спека покрывает TS/JS-семейство", () => {
        expect(LANGUAGE_SERVERS).toHaveLength(1);
        expect(TS_SPEC.id).toBe("vexxTypescript");
        expect(TS_SPEC.languageIds).toEqual(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
    });

    it("commandFor: JS-энтрипоинты спавнятся через node из PATH, бинари — как есть", () => {
        expect(commandFor("/x/cli.mjs")).toEqual({ command: "node", args: ["/x/cli.mjs", "--stdio"] });
        expect(commandFor("/x/cli.js")).toEqual({ command: "node", args: ["/x/cli.js", "--stdio"] });
        expect(commandFor("/x/cli.cjs", [])).toEqual({ command: "node", args: ["/x/cli.cjs"] });
        expect(commandFor("/usr/bin/tsserver-wrap")).toEqual({ command: "/usr/bin/tsserver-wrap", args: ["--stdio"] });
    });

    it("приоритет: настройка → workspace node_modules → PATH", () => {
        // Настройка задана и существует — побеждает.
        expect(resolveServerCommand(TS_SPEC, "/custom/server.mjs", ["/ws"], (p) => p === "/custom/server.mjs")).toEqual({
            command: "node",
            args: ["/custom/server.mjs", "--stdio"],
        });

        // Настройки нет — берём workspace-шим, если существует.
        const wsShim = "/ws/node_modules/.bin/typescript-language-server";
        expect(resolveServerCommand(TS_SPEC, "", ["/ws"], (p) => p === wsShim)).toEqual({
            command: wsShim,
            args: ["--stdio"],
        });

        // Ничего на диске нет — PATH-кандидат без проверки существования.
        expect(resolveServerCommand(TS_SPEC, "", ["/ws"], () => false)).toEqual({
            command: "typescript-language-server",
            args: ["--stdio"],
        });

        // Несуществующая настройка пропускается в пользу следующего кандидата.
        expect(resolveServerCommand(TS_SPEC, "/gone/server", ["/ws"], (p) => p === wsShim)).toEqual({
            command: wsShim,
            args: ["--stdio"],
        });
    });

    it("спека без PATH-fallback'а может не отрезолвиться — null", () => {
        const spec = { ...TS_SPEC, resolveCandidates: () => ["/nowhere/bin"] };
        expect(resolveServerCommand(spec, "", [], () => false)).toBeNull();
    });
});
