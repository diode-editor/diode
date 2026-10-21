import { describe, expect, it } from "vitest";

import { commandFor, LANGUAGE_SERVERS, resolveServerCommand } from "./resolveServer.ts";

const TS_SPEC = LANGUAGE_SERVERS[0];
const NODE = { command: "/opt/dist/node", runAsNodeFlag: false };
const DIODE_SEA = { command: "/opt/dist/diode", runAsNodeFlag: true };
const BUNDLED = "/cache/diode/ts-server/1.0-abc/typescript-language-server/lib/run-cli.cjs";

describe("diode-lsp-typescript — resolveServer", () => {
    it("the server table is declarative: the typescript spec covers the TS/JS family", () => {
        expect(LANGUAGE_SERVERS).toHaveLength(1);
        expect(TS_SPEC.id).toBe("diodeTypescript");
        expect(TS_SPEC.languageIds).toEqual(["typescript", "typescriptreact", "javascript", "javascriptreact"]);
    });

    it("commandFor: JS entry points run on our runtime; env always removes DIODE_EXTENSION_HOST", () => {
        expect(commandFor("/x/cli.mjs", NODE)).toEqual({
            command: "/opt/dist/node",
            args: ["/x/cli.mjs", "--stdio"],
            env: { DIODE_EXTENSION_HOST: undefined },
        });
        expect(commandFor("/x/run-cli.cjs", DIODE_SEA, [])).toEqual({
            command: "/opt/dist/diode",
            args: ["/x/run-cli.cjs"],
            // Grandchildren inherit the flag: tsserver forks via process.execPath.
            env: { DIODE_EXTENSION_HOST: undefined, DIODE_RUN_AS_NODE: "1" },
        });
        expect(commandFor("/usr/bin/tls-wrap", DIODE_SEA)).toEqual({
            command: "/usr/bin/tls-wrap",
            args: ["--stdio"],
            env: { DIODE_EXTENSION_HOST: undefined },
        });
    });

    it("priority: setting → workspace node_modules → bundled → PATH", () => {
        const resolve = (settingPath: string, exists: (p: string) => boolean) =>
            resolveServerCommand(TS_SPEC, settingPath, ["/ws"], BUNDLED, NODE, exists);
        const wsEntry = "/ws/node_modules/typescript-language-server/lib/cli.mjs";

        const fromSetting = resolve("/custom/server.mjs", (p) => p === "/custom/server.mjs");
        expect(fromSetting?.command.args[0]).toBe("/custom/server.mjs");
        expect(fromSetting?.isBundled).toBe(false);

        // A JS entry point, NOT a `.bin` shim: the shebang would require a system node
        // (a real failure: env: 'node': No such file, 127).
        const fromWorkspace = resolve("", (p) => p === wsEntry);
        expect(fromWorkspace?.command).toMatchObject({ command: "/opt/dist/node", args: [wsEntry, "--stdio"] });
        expect(fromWorkspace?.isBundled).toBe(false);

        const fromBundled = resolve("", (p) => p === BUNDLED);
        expect(fromBundled?.command.args[0]).toBe(BUNDLED);
        expect(fromBundled?.command.command).toBe("/opt/dist/node");
        expect(fromBundled?.isBundled).toBe(true);

        const fromPath = resolve("", () => false);
        expect(fromPath?.command).toMatchObject({ command: "typescript-language-server", args: ["--stdio"] });
        expect(fromPath?.isBundled).toBe(false);

        expect(resolve("/gone/server", (p) => p === BUNDLED)?.isBundled).toBe(true);
    });

    it("an empty bundledServerPath drops out of the candidates; a spec without a PATH fallback may yield null", () => {
        const noPath = { ...TS_SPEC, resolveCandidates: () => ["/nowhere/bin"] };
        expect(resolveServerCommand(noPath, "", [], "", NODE, () => false)).toBeNull();

        const resolved = resolveServerCommand(TS_SPEC, "", [], "", NODE, () => false);
        expect(resolved?.command.command).toBe("typescript-language-server");
        expect(resolved?.isBundled).toBe(false);
    });
});
