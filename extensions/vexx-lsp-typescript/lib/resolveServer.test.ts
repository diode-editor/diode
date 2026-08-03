import { describe, expect, it } from "vitest";

import { commandFor, LANGUAGE_SERVERS, resolveServerCommand } from "./resolveServer.ts";

const TS_SPEC = LANGUAGE_SERVERS[0];
const NODE = { command: "/opt/dist/node", runAsNodeFlag: false };
const VEXX_SEA = { command: "/opt/dist/vexx", runAsNodeFlag: true };
const BUNDLED = "/cache/vexx/ts-server/1.0-abc/typescript-language-server/lib/run-cli.cjs";

describe("vexx-lsp-typescript — resolveServer", () => {
    it("таблица серверов декларативна: typescript-спека покрывает TS/JS-семейство", () => {
        expect(LANGUAGE_SERVERS).toHaveLength(1);
        expect(TS_SPEC.id).toBe("vexxTypescript");
        expect(TS_SPEC.languageIds).toEqual(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
    });

    it("commandFor: JS-энтрипоинты — нашим рантаймом; env всегда снимает VEXX_EXTENSION_HOST", () => {
        expect(commandFor("/x/cli.mjs", NODE)).toEqual({
            command: "/opt/dist/node",
            args: ["/x/cli.mjs", "--stdio"],
            env: { VEXX_EXTENSION_HOST: undefined },
        });
        expect(commandFor("/x/run-cli.cjs", VEXX_SEA, [])).toEqual({
            command: "/opt/dist/vexx",
            args: ["/x/run-cli.cjs"],
            // SEA: бинарь уходит в node-режим; флаг наследуется внуками
            // (tsserver форкается сервером через process.execPath).
            env: { VEXX_EXTENSION_HOST: undefined, VEXX_RUN_AS_NODE: "1" },
        });
        expect(commandFor("/usr/bin/tls-wrap", VEXX_SEA)).toEqual({
            command: "/usr/bin/tls-wrap",
            args: ["--stdio"],
            env: { VEXX_EXTENSION_HOST: undefined },
        });
    });

    it("приоритет: настройка → workspace node_modules → bundled → PATH", () => {
        const resolve = (settingPath: string, exists: (p: string) => boolean) =>
            resolveServerCommand(TS_SPEC, settingPath, ["/ws"], BUNDLED, NODE, exists);
        const wsShim = "/ws/node_modules/.bin/typescript-language-server";

        // Настройка задана и существует — побеждает.
        const fromSetting = resolve("/custom/server.mjs", (p) => p === "/custom/server.mjs");
        expect(fromSetting?.command.args[0]).toBe("/custom/server.mjs");
        expect(fromSetting?.isBundled).toBe(false);

        // Настройки нет — workspace-шим, если существует.
        const fromWorkspace = resolve("", (p) => p === wsShim);
        expect(fromWorkspace?.command).toMatchObject({ command: wsShim, args: ["--stdio"] });
        expect(fromWorkspace?.isBundled).toBe(false);

        // Дефолт — вшитый сервер из поставки.
        const fromBundled = resolve("", (p) => p === BUNDLED);
        expect(fromBundled?.command.args[0]).toBe(BUNDLED);
        expect(fromBundled?.command.command).toBe("/opt/dist/node");
        expect(fromBundled?.isBundled).toBe(true);

        // Ничего на диске нет — PATH-кандидат без проверки существования.
        const fromPath = resolve("", () => false);
        expect(fromPath?.command).toMatchObject({ command: "typescript-language-server", args: ["--stdio"] });
        expect(fromPath?.isBundled).toBe(false);

        // Несуществующая настройка пропускается в пользу следующего кандидата.
        expect(resolve("/gone/server", (p) => p === BUNDLED)?.isBundled).toBe(true);
    });

    it("пустой bundledServerPath выпадает из кандидатов; спека без PATH-fallback'а может дать null", () => {
        const noPath = { ...TS_SPEC, resolveCandidates: () => ["/nowhere/bin"] };
        expect(resolveServerCommand(noPath, "", [], "", NODE, () => false)).toBeNull();

        const resolved = resolveServerCommand(TS_SPEC, "", [], "", NODE, () => false);
        expect(resolved?.command.command).toBe("typescript-language-server");
        expect(resolved?.isBundled).toBe(false);
    });
});
