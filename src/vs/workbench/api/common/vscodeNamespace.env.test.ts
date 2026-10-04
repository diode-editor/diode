import { describe, expect, it } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { makeStubRpc } from "./testStubRpc.ts";
import { buildVscodeNamespace } from "./vscodeNamespace.ts";
import { UIKind } from "./vscodeTypes.ts";

/**
 * Константы окружения `vscode.env`, которые расширение читает прямо в
 * `activate()`. Первое падение стокового `redhat.java` было именно здесь:
 * `Cannot read properties of undefined (reading 'Desktop')` — расширение
 * разбирает `switch (env.uiKind) { case UIKind.Desktop: … }`.
 */

function makeEnv(): typeof vscode.env {
    return buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk()).namespace.env;
}

describe("vscode.env — окружение и телеметрия", () => {
    it("uiKind — Desktop (терминальный редактор остаётся настольным)", () => {
        expect(makeEnv().uiKind).toBe(UIKind.Desktop);
    });

    it("UIKind — настоящий runtime-enum в namespace, а не только тип", () => {
        const { namespace } = buildVscodeNamespace(makeStubRpc().rpc, createNodeExtHostDisk());
        expect(namespace.UIKind.Desktop).toBe(1);
        expect(namespace.UIKind.Web).toBe(2);
        // Ровно это сравнение и делает расширение.
        expect(namespace.env.uiKind === namespace.UIKind.Desktop).toBe(true);
        expect(namespace.env.uiKind === namespace.UIKind.Web).toBe(false);
    });

    it("телеметрии нет: флаг false, событие валидное и не стреляет", () => {
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

    it("remoteName — undefined: удалённого extension host'а нет", () => {
        expect(makeEnv().remoteName).toBeUndefined();
    });

    it("sessionId — непустая строка, стабильная внутри одного шима", () => {
        const env = makeEnv();
        expect(env.sessionId).toMatch(/\S/u);
        // Расширение сравнивает сохранённый id с текущим — геттер обязан быть стабилен.
        expect(env.sessionId).toBe(env.sessionId);
    });

    it("sessionId различается у двух сеансов extension host'а", () => {
        expect(makeEnv().sessionId).not.toBe(makeEnv().sessionId);
    });

    it("прежние константы окружения на месте", () => {
        const env = makeEnv();
        expect(env.appName).toBe("Diode");
        expect(env.appHost).toBe("desktop");
        expect(env.uriScheme).toBe("diode");
        expect(env.language).toBe("en");
    });
});
