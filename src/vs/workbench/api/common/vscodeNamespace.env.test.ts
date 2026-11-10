import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { UIKind, Uri } from "./vscodeTypes.ts";

/** First crash of the stock `redhat.java`: `reading 'Desktop'` in `switch (env.uiKind)` right inside `activate()`. */

function makeEnv(): typeof vscode.env {
    return buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk()).namespace.env;
}

describe("vscode.env — environment and telemetry", () => {
    it("uiKind is Desktop (a terminal editor is still a desktop one)", () => {
        expect(makeEnv().uiKind).toBe(UIKind.Desktop);
    });

    it("UIKind is a real runtime enum in the namespace, not just a type", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(namespace.UIKind.Desktop).toBe(1);
        expect(namespace.UIKind.Web).toBe(2);
        expect(namespace.env.uiKind === namespace.UIKind.Desktop).toBe(true);
        expect(namespace.env.uiKind === namespace.UIKind.Web).toBe(false);
    });

    it("no telemetry: flag is false, event is valid and never fires", () => {
        const env = makeEnv();
        expect(env.isTelemetryEnabled).toBe(false);

        let fired = 0;
        const sub = env.onDidChangeTelemetryEnabled(() => {
            fired++;
        });
        expect(fired).toBe(0);
        expect(() => {
            sub.dispose();
        }).not.toThrow();
    });

    it("remoteName is undefined: there is no remote extension host", () => {
        expect(makeEnv().remoteName).toBeUndefined();
    });

    it("sessionId is a non-empty string, stable within one shim", () => {
        const env = makeEnv();
        expect(env.sessionId).toMatch(/\S/u);
        // The extension compares a saved id with the current one — the getter must be stable.
        expect(env.sessionId).toBe(env.sessionId);
    });

    it("sessionId differs between two extension host sessions", () => {
        expect(makeEnv().sessionId).not.toBe(makeEnv().sessionId);
    });

    it("existing environment constants are in place", () => {
        const env = makeEnv();
        expect(env.appName).toBe("Diode");
        expect(env.appHost).toBe("desktop");
        expect(env.uriScheme).toBe("diode");
        expect(env.language).toBe("en");
    });
});

describe("[api:env.asExternalUri] desktop without a remote, as upstream", () => {
    it.each([
        "diode://pub.ext/did-authenticate?key=value&other=false",
        "https://example.com/path?q=1#frag",
        "file:///home/user/a.txt",
        "mailto:someone@example.com",
    ])("%s comes back as an equal copy, without the host being asked", async (text) => {
        const stub = makeStubRpc();
        const env = buildVscodeNamespace(stub.rpc, createNodeExtHostDisk()).namespace.env;
        const target = Uri.parse(text);

        const result = await env.asExternalUri(target);

        expect(result.toString()).toBe(target.toString());
        expect(result).toBeInstanceOf(Uri);
        expect(result).not.toBe(target);
        expect(stub.requests).toEqual([]);
    });

    it.each(["", "  "])("a plain object with the scheme %j is refused with upstream's message", async (scheme) => {
        const target = { scheme, authority: "", path: "/a", query: "", fragment: "" } as unknown as vscode.Uri;

        await expect(makeEnv().asExternalUri(target)).rejects.toThrow("Invalid scheme - cannot be empty");
    });
});
