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
        throw new Error("the provider must not be called");
    };
    return {
        onDidChangeSessions: vi.fn(fail),
        getSessions: fail,
        createSession: fail,
        removeSession: fail,
    };
}

describe("authenticationNoop — vscode.authentication without sign-in", () => {
    it("the namespace exists on `vscode` — without it `activate()` crashed reading from undefined", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(typeof namespace.authentication.getSession).toBe("function");
    });

    it("getSession without createIfNone is undefined: the user has not signed in", async () => {
        const { auth } = makeAuth();
        await expect(auth.getSession("github", ["repo"])).resolves.toBeUndefined();
        await expect(auth.getSession("github", [], { createIfNone: false })).resolves.toBeUndefined();
        await expect(auth.getSession("github", [], { silent: true })).resolves.toBeUndefined();
    });

    it("createIfNone/forceNewSession reject with a reason instead of undefined for the promised session", async () => {
        const { auth } = makeAuth();
        const reason = new Error('sign-in with "HashiCorpTerraformCloud" is not supported in TUI yet');
        await expect(auth.getSession("HashiCorpTerraformCloud", [], { createIfNone: true })).rejects.toThrow(reason);
        await expect(
            auth.getSession("HashiCorpTerraformCloud", [], { createIfNone: { detail: "sign in" } }),
        ).rejects.toThrow(reason);
        await expect(
            auth.getSession("HashiCorpTerraformCloud", [], { createIfNone: false, forceNewSession: { detail: "x" } }),
        ).rejects.toThrow(reason);
    });

    it("options incompatible with silent throw the upstream errors", async () => {
        const { auth } = makeAuth();
        await expect(auth.getSession("p", [], { silent: true, forceNewSession: true })).rejects.toThrow(
            "Invalid combination of options. Please remove one of the following: forceNewSession, silent",
        );
        await expect(auth.getSession("p", [], { silent: true, createIfNone: true })).rejects.toThrow(
            "Invalid combination of options. Please remove one of the following: createIfNone, silent",
        );
    });

    it("getAccounts returns an empty list", async () => {
        const { auth } = makeAuth();
        await expect(auth.getAccounts("github")).resolves.toEqual([]);
    });

    it("onDidChangeSessions is a valid event; subscribing and unsubscribing do not throw", () => {
        const { auth } = makeAuth();
        const listener = vi.fn();
        const sub = auth.onDidChangeSessions(listener);
        sub.dispose();
        expect(listener).not.toHaveBeenCalled();
    });

    it("registerAuthenticationProvider returns a Disposable; nobody calls the provider", () => {
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

    it("registering a provider writes one warn line to Output, the key point first", () => {
        const { auth, stub } = makeAuth();

        auth.registerAuthenticationProvider("HashiCorpTerraformCloud", "HCP Terraform", silentProvider());

        expect(outputLines(stub)).toEqual([
            {
                channel: "extensions",
                label: "Extensions",
                level: "warn",
                value: 'sign-in with "HCP Terraform" (HashiCorpTerraformCloud) is not supported in TUI yet — no sessions, the rest of the extension works',
            },
        ]);
    });

    it("the same id again adds no second line; another provider gets its own line", () => {
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
