import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import { createNodeExtHostDisk } from "../node/extHostDisk.ts";

import { DocumentRegistry, DocumentSyncTracker } from "./extHostDocuments.ts";
import { createLanguagesNamespace } from "./languagesNamespace.ts";
import { type IStubRpc, makeStubRpc } from "./testStubRpc.ts";
import { ExtensionOwner, type IVscodeHostContext } from "./vscodeHostContext.ts";
import { Diagnostic, DiagnosticSeverity, Range, Uri } from "./vscodeTypes.ts";
import { WorkspaceConfigStore } from "./workspaceConfigStore.ts";

function makeLanguages(stub: IStubRpc = makeStubRpc()) {
    const registry = new DocumentRegistry();
    const ctx: IVscodeHostContext = {
        rpc: stub.rpc,
        registry,
        documentSync: new DocumentSyncTracker(registry),
        configStore: new WorkspaceConfigStore(),
        disk: createNodeExtHostDisk(),
        owner: new ExtensionOwner(),
    };
    return { stub, languages: createLanguagesNamespace(ctx).languages };
}

const A = Uri.file("/proj/a.ts") as unknown as vscode.Uri;
const B = Uri.file("/proj/b.ts") as unknown as vscode.Uri;
const WIRE_RANGE = { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } };

function diag(message: string): vscode.Diagnostic {
    return new Diagnostic(new Range(0, 0, 0, 1), message) as unknown as vscode.Diagnostic;
}

describe("languages.getDiagnostics", () => {
    it("resource: diagnostics of all collections in order, same objects; a disposed collection drops out", () => {
        const { languages } = makeLanguages();
        const ts = languages.createDiagnosticCollection("ts");
        const lint = languages.createDiagnosticCollection("lint");
        const typeError = diag("type");
        const lintError = diag("lint");
        ts.set(A, [typeError]);
        lint.set(A, [lintError]);
        lint.set(B, [diag("other file")]);

        const all = languages.getDiagnostics(A);
        expect(all).toHaveLength(2);
        expect(all[0]).toBe(typeError);
        expect(all[1]).toBe(lintError);

        lint.dispose();
        expect(languages.getDiagnostics(A)).toEqual([typeError]);
        expect(languages.getDiagnostics(Uri.file("/none") as unknown as vscode.Uri)).toEqual([]);
    });

    it("without a resource (and with null from JS): one row per resource, collection diagnostics merged", () => {
        const { languages } = makeLanguages();
        const ts = languages.createDiagnosticCollection("ts");
        const lint = languages.createDiagnosticCollection("lint");
        ts.set(A, [diag("a1")]);
        lint.set(B, [diag("b1")]);
        lint.set(A, [diag("a2")]);

        const summary = (rows: [vscode.Uri, vscode.Diagnostic[]][]) =>
            rows.map(([uri, diags]) => [uri.toString(), diags.map((d) => d.message)]);
        const expected = [
            [A.toString(), ["a1", "a2"]],
            [B.toString(), ["b1"]],
        ];
        expect(summary(languages.getDiagnostics())).toEqual(expected);
        const viaNull = (languages.getDiagnostics as (r: null) => [vscode.Uri, vscode.Diagnostic[]][])(null);
        expect(summary(viaNull)).toEqual(expected);
    });

    it("foreign host markers (diagnostics.markersChanged) become Diagnostic with marker fields; an empty set clears them", () => {
        const { stub, languages } = makeLanguages();
        const own = languages.createDiagnosticCollection("ts");
        own.set(A, [diag("own")]);

        stub.fire("diagnostics.markersChanged", {
            entries: [
                {
                    resource: A.toString(),
                    markers: [
                        { severity: 1, range: WIRE_RANGE, message: "Unknown setting", code: "S1", source: "json" },
                    ],
                },
                // Non-string code/source are dropped, the marker stays.
                {
                    resource: B.toString(),
                    markers: [{ severity: 3, range: WIRE_RANGE, message: "hint", code: 5, source: 7 }],
                },
            ],
        });

        const [first, mirrored] = languages.getDiagnostics(A);
        expect(first.message).toBe("own");
        expect(mirrored).toBeInstanceOf(Diagnostic);
        expect(mirrored).toMatchObject({
            message: "Unknown setting",
            severity: DiagnosticSeverity.Warning,
            code: "S1",
            source: "json",
            range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } },
        });
        expect(languages.getDiagnostics(B)[0]?.code).toBeUndefined();
        expect(languages.getDiagnostics(B)[0]?.source).toBeUndefined();

        stub.fire("diagnostics.markersChanged", { entries: [{ resource: A.toString(), markers: [] }] });
        expect(languages.getDiagnostics(A).map((d) => d.message)).toEqual(["own"]);
    });

    it("garbage in diagnostics.markersChanged is dropped without crashing the handler", () => {
        const { stub, languages } = makeLanguages();
        const good = { severity: 0, range: WIRE_RANGE, message: "ok" };

        stub.fire("diagnostics.markersChanged", null);
        stub.fire("diagnostics.markersChanged", { entries: "junk" });
        stub.fire("diagnostics.markersChanged", {
            entries: [
                null,
                { resource: 5, markers: [good] },
                { resource: B.toString(), markers: "junk" },
                {
                    resource: A.toString(),
                    markers: [
                        good,
                        null,
                        { ...good, range: { start: { line: 0 } } },
                        { ...good, severity: "0" },
                        { ...good, message: 1 },
                    ],
                },
            ],
        });

        expect(languages.getDiagnostics().map(([uri, diags]) => [uri.toString(), diags.length])).toEqual([
            [A.toString(), 1],
        ]);
    });
});

describe("languages.onDidChangeDiagnostics", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("50 ms window from the first change: one event with unique resources in order of appearance", () => {
        const { stub, languages } = makeLanguages();
        const events: (readonly vscode.Uri[])[] = [];
        languages.onDidChangeDiagnostics((e) => events.push(e.uris));
        const ts = languages.createDiagnosticCollection("ts");

        ts.set(B, [diag("b")]);
        vi.advanceTimersByTime(30);
        ts.set([[A, [diag("a")]]]);
        ts.delete(B);
        stub.fire("diagnostics.markersChanged", { entries: [{ resource: A.toString(), markers: [] }] });
        vi.advanceTimersByTime(19);
        expect(events).toEqual([]);

        vi.advanceTimersByTime(1);
        expect(events.map((uris) => uris.map(String))).toEqual([[B.toString(), A.toString()]]);
        expect(Object.isFrozen(events[0])).toBe(true);

        // The next change opens a new window.
        ts.clear();
        vi.advanceTimersByTime(50);
        expect(events.map((uris) => uris.map(String))).toEqual([[B.toString(), A.toString()], [A.toString()]]);
    });

    it("delete is a change of its resource, even if it was absent", () => {
        const { languages } = makeLanguages();
        const events: string[][] = [];
        languages.onDidChangeDiagnostics((e) => events.push(e.uris.map(String)));
        const ts = languages.createDiagnosticCollection("ts");

        ts.delete(A);
        vi.advanceTimersByTime(50);

        expect(events).toEqual([[A.toString()]]);
    });

    it("disposing a collection is also a change of its resources", () => {
        const { languages } = makeLanguages();
        const events: string[][] = [];
        languages.onDidChangeDiagnostics((e) => events.push(e.uris.map(String)));
        const ts = languages.createDiagnosticCollection("ts");
        ts.set(A, [diag("a")]);
        vi.advanceTimersByTime(50);

        ts.dispose();
        vi.advanceTimersByTime(50);

        expect(events).toEqual([[A.toString()], [A.toString()]]);
    });
});
