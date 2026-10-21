import { describe, expect, it } from "vitest";

import { curatedConfigInjection } from "./curatedConfigInjection.ts";

describe("curatedConfigInjection", () => {
    it("basedpyright: bundled server instead of searching for a pip install", () => {
        expect(curatedConfigInjection("detachhead.basedpyright")).toEqual({
            "basedpyright.importStrategy": "useBundled",
        });
    });

    it("ruff: bundled native server instead of scanning the environment", () => {
        expect(curatedConfigInjection("charliermarsh.ruff")).toEqual({ "ruff.importStrategy": "useBundled" });
    });

    it("redhat.java: lombok agent is off — with it jdt.ls 1.57 on JDK 21 does not compile", () => {
        expect(curatedConfigInjection("redhat.java")).toEqual({ "java.jdt.ls.lombokSupport.enabled": false });
    });

    it("redhat.java: updateBuildConfiguration is NOT touched — we answer the user prompt", () => {
        expect(curatedConfigInjection("redhat.java")).not.toHaveProperty("java.configuration.updateBuildConfiguration");
    });

    it("Anthropic.claude-code: terminal mode instead of the webview chat the TUI lacks", () => {
        expect(curatedConfigInjection("anthropic.claude-code")).toEqual({ "claudeCode.useTerminal": true });
    });

    it("id is compared case-insensitively — as in the publisher manifest", () => {
        expect(curatedConfigInjection("Anthropic.claude-code")).toEqual({ "claudeCode.useTerminal": true });
        expect(curatedConfigInjection("DetachHead.basedpyright")).toEqual({
            "basedpyright.importStrategy": "useBundled",
        });
    });

    it("unknown extension — empty layer, manifest defaults untouched", () => {
        expect(curatedConfigInjection("vscjava.vscode-java-dependency")).toEqual({});
        expect(curatedConfigInjection("")).toEqual({});
    });

    it("id is compared whole, not by prefix", () => {
        expect(curatedConfigInjection("redhat.java-debug")).toEqual({});
        expect(curatedConfigInjection("charliermarsh.ruff-lsp")).toEqual({});
    });
});
