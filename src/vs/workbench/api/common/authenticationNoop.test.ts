import { describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { createAuthenticationNoop } from "./authenticationNoop.ts";
import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";

function makeAuth() {
    const stub = makeStubRpc();
    return { stub, auth: createAuthenticationNoop(stub.rpc) };
}

function outputLines(
    stub: ReturnType<typeof makeStubRpc>,
): { channel: string; label: string; level: string; value: string }[] {
    return stub.notifies
        .filter((n) => n.method === "output.append")
        .map((n) => n.params as { channel: string; label: string; level: string; value: string });
}

function silentProvider(): vscode.AuthenticationProvider {
    const fail = (): never => {
        throw new Error("провайдер не должен вызываться");
    };
    return {
        onDidChangeSessions: vi.fn(fail),
        getSessions: fail,
        createSession: fail,
        removeSession: fail,
    };
}

describe("authenticationNoop — vscode.authentication без входа", () => {
    it("namespace есть в `vscode` — без него `activate()` падал на чтении у undefined", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(typeof namespace.authentication.getSession).toBe("function");
    });

    it("getSession без createIfNone — undefined: человек не входил", async () => {
        const { auth } = makeAuth();
        await expect(auth.getSession("github", ["repo"])).resolves.toBeUndefined();
        await expect(auth.getSession("github", [], { createIfNone: false })).resolves.toBeUndefined();
        await expect(auth.getSession("github", [], { silent: true })).resolves.toBeUndefined();
    });

    it("createIfNone/forceNewSession — отказ с причиной, а не undefined вместо обещанной сессии", async () => {
        const { auth } = makeAuth();
        const reason = new Error('вход через "HashiCorpTerraformCloud" в TUI пока не поддержан');
        await expect(auth.getSession("HashiCorpTerraformCloud", [], { createIfNone: true })).rejects.toThrow(reason);
        await expect(
            auth.getSession("HashiCorpTerraformCloud", [], { createIfNone: { detail: "войдите" } }),
        ).rejects.toThrow(reason);
        await expect(
            auth.getSession("HashiCorpTerraformCloud", [], { createIfNone: false, forceNewSession: { detail: "x" } }),
        ).rejects.toThrow(reason);
    });

    it("несовместимые с silent опции — эталонные ошибки", async () => {
        const { auth } = makeAuth();
        await expect(auth.getSession("p", [], { silent: true, forceNewSession: true })).rejects.toThrow(
            "Invalid combination of options. Please remove one of the following: forceNewSession, silent",
        );
        await expect(auth.getSession("p", [], { silent: true, createIfNone: true })).rejects.toThrow(
            "Invalid combination of options. Please remove one of the following: createIfNone, silent",
        );
    });

    it("getAccounts — пустой список", async () => {
        const { auth } = makeAuth();
        await expect(auth.getAccounts("github")).resolves.toEqual([]);
    });

    it("onDidChangeSessions — валидное событие, подписка и отписка не падают", () => {
        const { auth } = makeAuth();
        const listener = vi.fn();
        const sub = auth.onDidChangeSessions(listener);
        sub.dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("registerAuthenticationProvider — Disposable, провайдера никто не зовёт", () => {
        const { auth } = makeAuth();
        const provider = silentProvider();
        const registration = auth.registerAuthenticationProvider("p", "P", provider, {
            supportsMultipleAccounts: false,
        });
        expect(() => {
            registration.dispose();
            registration.dispose();
        }).not.toThrow();
        expect(provider.onDidChangeSessions).not.toHaveBeenCalled();
    });

    it("регистрация провайдера пишет в Output одну warn-строку: главное — в начале", () => {
        const { auth, stub } = makeAuth();

        auth.registerAuthenticationProvider("HashiCorpTerraformCloud", "HCP Terraform", silentProvider());

        expect(outputLines(stub)).toEqual([
            {
                channel: "extensions",
                label: "Extensions",
                level: "warn",
                value: 'вход через "HCP Terraform" (HashiCorpTerraformCloud) в TUI пока не поддержан — сессий не будет, остальное расширение работает',
            },
        ]);
    });

    it("повтор того же id — без второй строки; другой провайдер — своя строка", () => {
        const { auth, stub } = makeAuth();

        auth.registerAuthenticationProvider("a", "A", silentProvider());
        auth.registerAuthenticationProvider("a", "A", silentProvider());
        auth.registerAuthenticationProvider("b", "B", silentProvider());

        expect(outputLines(stub).map((l) => l.value)).toEqual([
            expect.stringContaining("(a)"),
            expect.stringContaining("(b)"),
        ]);
    });
});
