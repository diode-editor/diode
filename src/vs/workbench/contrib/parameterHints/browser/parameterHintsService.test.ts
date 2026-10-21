import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { flushMicrotasks } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type {
    ICoreSignature,
    ICoreSignatureHelp,
    ISignatureHelpRequest,
    SignatureHelpProvider,
} from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { SignatureHelpTriggerKind } from "../../../../editor/common/languages/iSignatureHelpSource.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesServiceDIToken } from "../../../../editor/common/services/languageFeatures.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKey } from "../../../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import { EditorServiceDIToken } from "../../../services/editor/common/editorService.ts";
import { FocusTrackerDIToken } from "../../../services/focus/browser/focusTracker.ts";
import { CompletionServiceDIToken } from "../../suggest/browser/completionService.ts";

import { ParameterHintsComponentDIToken } from "./parameterHintsComponent.ts";
import { ParameterHintsServiceDIToken } from "./parameterHintsService.ts";

function contextKey(contributor: IContextKeyContributor, key: ContextKey): unknown {
    const keys = new ContextKeyService();
    contributor.updateContextKeys(keys, null);
    return keys.get(key);
}

function flushTimers(): Promise<void> {
    return new Promise((res) => setTimeout(res, 5));
}

function waitPastDelay(ms: number): Promise<void> {
    return new Promise((res) => setTimeout(res, ms));
}

const GREET: ICoreSignature = {
    label: "greet(name: string, age: number): void",
    parameters: [{ label: "name: string" }, { label: "age: number" }],
};
const GREET_SHORT: ICoreSignature = {
    label: "greet(name: string): void",
    parameters: [{ label: "name: string" }],
};
const GREET_EMPTY: ICoreSignature = { label: "greet(): void", parameters: [] };

function help(patch: Partial<ICoreSignatureHelp> = {}): ICoreSignatureHelp {
    return { signatures: [GREET], activeSignature: 0, activeParameter: 0, ...patch };
}

describe("ParameterHintsService — showing, auto-trigger and overloads", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-hints-",
            files: {
                "main.ts": "greet\nconst other = 1;\n",
                "other.ts": "export const other = 1;\n",
            },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        service().triggerDelayMs = 0;
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = () => h.container.get(EditorServiceDIToken);
    let registration: IDisposable | undefined;
    /** Removes the previous one; tsserver triggers: "(", ",", "<" open, ")" re-requests. */
    const useSource = (provideSignatureHelp: SignatureHelpProvider["provideSignatureHelp"]): void => {
        registration?.dispose();
        registration = h.container.get(LanguageFeaturesServiceDIToken).signatureHelpProvider.register("*", {
            triggerCharacters: ["(", ",", "<"],
            retriggerCharacters: [")"],
            provideSignatureHelp,
        });
    };
    /** A second matching provider with no triggers and no answer: characters come from any matching provider. */
    const addSilentProvider = (): void => {
        h.container.get(LanguageFeaturesServiceDIToken).signatureHelpProvider.register("*", {
            triggerCharacters: [],
            retriggerCharacters: [],
            provideSignatureHelp: () => Promise.resolve(null),
        });
    };
    const service = () => h.container.get(ParameterHintsServiceDIToken);
    const component = () => h.container.get(ParameterHintsComponentDIToken);
    const lines = () => component().view.linesFor(60);

    it("closing the hint cancels the request at the provider too", () => {
        const tokens: ICancellationToken[] = [];
        useSource((_request, token) => {
            tokens.push(token);
            return new Promise(() => undefined);
        });

        void service().trigger();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        service().close();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    it("no providers left for the document — the call is a no-op and leaves the open popup alone (like upstream)", async () => {
        useSource(() => Promise.resolve(help()));
        await service().trigger();
        expect(service().isOpen()).toBe(true);

        registration?.dispose();
        registration = undefined;
        await service().trigger();

        expect(service().isOpen()).toBe(true);
    });

    it("the command shows a popup with the signature label at the cursor", async () => {
        useSource(() => Promise.resolve(help()));

        await service().trigger();

        expect(service().isOpen()).toBe(true);
        expect(lines()).toEqual(["greet(name: string, age: number): void"]);
        expect(group().getActiveEditor()).not.toBeNull();
    });

    it("the request carries the snapshot, the cursor position and the manual trigger context", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help());
        });
        group().getActiveEditor()?.goToPosition(1, 6);

        await service().trigger();

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({
            line: 1,
            character: 6,
            triggerKind: SignatureHelpTriggerKind.Invoke,
            isRetrigger: false,
        });
        expect(seen[0].versionId).toBe(group().getActiveEditor()?.model.document.versionId);
        // No empty keys in the request at all: it goes over RPC on every keystroke.
        expect(Object.keys(seen[0]).sort()).toEqual([
            "character",
            "isRetrigger",
            "languageId",
            "line",
            "triggerKind",
            "uri",
            "versionId",
        ]);
    });

    it("a manual trigger cancels the pending auto request", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);
        service().triggerDelayMs = 20;

        h.testApp.sendKey("End");
        h.testApp.sendKey("("); // scheduled an auto request
        await service().trigger(); // the manual call overtakes it
        await waitPastDelay(60);
        await flushMicrotasks();

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("popup closed bypassing the service (click outside) — the next request goes without an echo", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help());
        });

        await service().trigger();
        // The overlay session closed by itself (pointerPolicy) — the service does not know
        // and keeps the old result; the request must still be a "first" one.
        component().close();
        await service().trigger();

        expect(seen[1].isRetrigger).toBe(false);
        expect(Object.keys(seen[1])).not.toContain("activeSignatureHelp");
    });

    it("a trigger character of another language's provider does not wake the hint", async () => {
        const provide = vi.fn(() => Promise.resolve(help()));
        registration = h.container.get(LanguageFeaturesServiceDIToken).signatureHelpProvider.register("python", {
            triggerCharacters: ["("],
            retriggerCharacters: [")"],
            provideSignatureHelp: provide,
        });

        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(provide).not.toHaveBeenCalled();
        expect(service().isOpen()).toBe(false);
    });

    it("providers in turn: an empty or failing first one yields to the next", async () => {
        const registry = h.container.get(LanguageFeaturesServiceDIToken).signatureHelpProvider;
        const meta = { triggerCharacters: [], retriggerCharacters: [] };
        registry.register("*", { ...meta, provideSignatureHelp: () => Promise.resolve(help()) });
        registry.register("*", { ...meta, provideSignatureHelp: () => Promise.reject(new Error("boom")) });
        registry.register("*", { ...meta, provideSignatureHelp: () => Promise.resolve(null) });

        await service().trigger();

        expect(service().isOpen()).toBe(true);
        expect(lines()[0]).toContain("greet");
    });

    it("typing a server trigger character opens the hint by itself", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help());
        });
        addSilentProvider();

        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(service().isOpen()).toBe(true);
        expect(seen[0]).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: "(",
            isRetrigger: false,
        });
    });

    it("a character not in the server's list does not open the hint", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);

        h.testApp.sendKey("End");
        h.testApp.sendKey("x");
        await flushTimers();
        await flushMicrotasks();

        expect(source).not.toHaveBeenCalled();
        expect(service().isOpen()).toBe(false);
    });

    it("while the popup is open, an edit re-requests the hint and moves the active parameter", async () => {
        const seen: ISignatureHelpRequest[] = [];
        let activeParameter = 0;
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help({ activeParameter }));
        });

        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();
        expect(component().view.linesFor(60)).toEqual([GREET.label]);

        // The comma is also a tsserver trigger character, but now it is a retrigger.
        activeParameter = 1;
        h.testApp.sendKey(",");
        await flushTimers();
        await flushMicrotasks();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ",",
            isRetrigger: true,
        });
        expect(seen[1].activeSignatureHelp).toEqual({ ...help(), activeSignature: 0 });
    });

    it("the hint opens on a line other than the first too", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);

        // The cursor cache stores the line NUMBER: if it were reset on the second line,
        // the insertion would no longer be recognized as typing.
        group().getActiveEditor()?.goToPosition(1, 0);
        h.testApp.sendKey("End");
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(source).toHaveBeenCalledTimes(1);
        expect(service().isOpen()).toBe(true);
    });

    it("a regular character with the popup open is a ContentChange retrigger, not a trigger character", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help());
        });

        await service().trigger();
        h.testApp.sendKey("End");
        h.testApp.sendKey("x");
        await flushTimers();
        await flushMicrotasks();

        // "x" is declared by the server neither as a trigger nor as a retrigger — it must not
        // appear in the context, otherwise the server would think "x(" was typed.
        expect(seen.at(-1)).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.ContentChange,
            isRetrigger: true,
        });
        expect(seen.at(-1)?.triggerCharacter).toBeUndefined();
    });

    it("multi-cursor: there is no call to show a hint for", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);

        await service().trigger();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("Ctrl+Alt+ArrowDown");
        expect(group().getActiveEditor()?.viewState.selections).toHaveLength(2);
        await flushTimers();
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("cursor movement with the popup open is a ContentChange retrigger", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help());
        });

        await service().trigger();
        h.testApp.sendKey("ArrowRight");
        await flushTimers();
        await flushMicrotasks();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.ContentChange,
            isRetrigger: true,
        });
        expect(seen[1].triggerCharacter).toBeUndefined();
        expect(service().isOpen()).toBe(true);
    });

    it("a closing paren dismisses the popup: the server answers with nothing", async () => {
        const seen: ISignatureHelpRequest[] = [];
        let answer: ICoreSignatureHelp | null = help();
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(answer);
        });
        addSilentProvider();

        await service().trigger();
        expect(service().isOpen()).toBe(true);

        answer = null;
        h.testApp.sendKey("End");
        h.testApp.sendKey(")");
        await flushTimers();
        await flushMicrotasks();

        expect(seen.at(-1)).toMatchObject({
            triggerKind: SignatureHelpTriggerKind.TriggerCharacter,
            triggerCharacter: ")",
            isRetrigger: true,
        });
        expect(service().isOpen()).toBe(false);
    });

    it("a retrigger character with the popup closed requests nothing", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);

        h.testApp.sendKey("End");
        h.testApp.sendKey(")");
        await flushTimers();
        await flushMicrotasks();

        expect(source).not.toHaveBeenCalled();
    });

    it("a selection instead of a cursor closes the popup", async () => {
        useSource(() => Promise.resolve(help()));

        // A selection while the popup is closed simply does nothing.
        h.testApp.sendKey("Shift+ArrowRight");
        await flushTimers();
        expect(service().isOpen()).toBe(false);

        h.testApp.sendKey("ArrowLeft");
        await service().trigger();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("Shift+ArrowRight");
        await flushTimers();
        await flushMicrotasks();

        expect(service().isOpen()).toBe(false);
    });

    it("pasting a block of text is not typing: it does not open the hint but re-requests an open one", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help());
        });

        // Inserting a chunk with a trigger character inside is not typing (as with suggest and in VS Code).
        group().getActiveEditor()?.viewState.insertText("greet(");
        await flushTimers();
        await flushMicrotasks();
        expect(seen).toHaveLength(0);
        expect(service().isOpen()).toBe(false);

        await service().trigger();
        group().getActiveEditor()?.viewState.insertText("abc");
        await flushTimers();
        await flushMicrotasks();

        expect(seen).toHaveLength(2);
        expect(seen[1]).toMatchObject({ triggerKind: SignatureHelpTriggerKind.ContentChange, isRetrigger: true });
    });

    it("three overloads: next and prev go in opposite directions", async () => {
        useSource(() => Promise.resolve(help({ signatures: [GREET, GREET_SHORT, GREET_EMPTY] })));

        await service().trigger();
        expect(lines()[0]).toBe("1/3 greet(name: string, age: number): void");

        service().nextSignature();
        expect(lines()[0]).toBe("2/3 greet(name: string): void");

        service().previousSignature();
        expect(lines()[0]).toBe("1/3 greet(name: string, age: number): void");

        // Back from the first goes to the last, not to the second.
        service().previousSignature();
        expect(lines()[0]).toBe("3/3 greet(): void");
    });

    it("the overload chosen by the server is shown right away, an out-of-range one is reset", async () => {
        let activeSignature = 1;
        useSource(() => Promise.resolve(help({ signatures: [GREET, GREET_SHORT], activeSignature })));

        await service().trigger();
        expect(lines()[0]).toBe("2/2 greet(name: string): void");

        // Exactly the list length is already out of bounds.
        activeSignature = 2;
        service().close();
        await service().trigger();
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");
    });

    it("close() clears the popup contents and the pending request", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);
        service().triggerDelayMs = 20;

        await service().trigger();
        expect(component().view.hint).not.toBeNull();

        h.testApp.sendKey("End");
        h.testApp.sendKey("("); // scheduled a re-request
        service().close();
        await waitPastDelay(60);
        await flushMicrotasks();

        // Otherwise the content flashes on the next open.
        expect(component().view.hint).toBeNull();
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("no active parameter (-1): no highlight and no parameter documentation either", async () => {
        useSource(() =>
            Promise.resolve(
                help({
                    activeParameter: -1,
                    signatures: [
                        {
                            label: "greet(name: string): void",
                            documentation: "Greets.",
                            parameters: [{ label: "name: string", documentation: "who" }],
                        },
                    ],
                }),
            ),
        );

        await service().trigger();

        expect(component().view.hint?.activeSpan).toEqual([0, 0]);
        // No parameter documentation is guessed — only the signature documentation.
        expect(component().view.hint?.documentation).toEqual(["Greets."]);
    });

    it("a signature without documentation yields no empty blocks", async () => {
        useSource(() => Promise.resolve(help({ signatures: [GREET_EMPTY] })));

        await service().trigger();

        expect(component().view.hint?.documentation).toEqual([]);
    });

    it("overloads are cycled locally, without asking the source", async () => {
        const source = vi.fn(() => Promise.resolve(help({ signatures: [GREET, GREET_SHORT] })));
        useSource(source);

        await service().trigger();
        expect(contextKey(service(), "parameterHintsMultipleSignatures")).toBe(true);
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");

        service().nextSignature();
        expect(lines()[0]).toBe("2/2 greet(name: string): void");
        service().nextSignature();
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");
        service().previousSignature();
        expect(lines()[0]).toBe("2/2 greet(name: string): void");

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("cycling without a shown hint is a no-op", () => {
        // The arrow command lives under `parameterHintsVisible`, but the service must
        // also survive a direct call (command palette, user keybinding).
        expect(() => {
            service().nextSignature();
            service().previousSignature();
        }).not.toThrow();
        expect(contextKey(service(), "parameterHintsMultipleSignatures")).toBe(false);
    });

    it("one signature: no counter, the popup is not even rebuilt", async () => {
        useSource(() => Promise.resolve(help({ signatures: [GREET_SHORT] })));

        await service().trigger();
        const shown = component().view.hint;

        expect(contextKey(service(), "parameterHintsMultipleSignatures")).toBe(false);
        service().nextSignature();
        service().previousSignature();

        // The same object, not an equal one: nothing to page through, nothing to repaint.
        expect(component().view.hint).toBe(shown);
        expect(lines()).toEqual(["greet(name: string): void"]);
    });

    it("the overload chosen with the arrows goes to the server in the echo of the next request", async () => {
        const seen: ISignatureHelpRequest[] = [];
        useSource((request) => {
            seen.push(request);
            return Promise.resolve(help({ signatures: [GREET, GREET_SHORT] }));
        });

        await service().trigger();
        service().nextSignature();
        await service().trigger();

        expect(seen[1].activeSignatureHelp?.activeSignature).toBe(1);
    });

    it("parameter and signature documentation arrive as plain text", async () => {
        useSource(() =>
            Promise.resolve(
                help({
                    signatures: [
                        {
                            label: "greet(name: string): void",
                            documentation: "Greets **a person**.",
                            parameters: [{ label: "name: string", documentation: "`who` to greet" }],
                        },
                    ],
                }),
            ),
        );

        await service().trigger();

        expect(lines()).toContain("who to greet");
        expect(lines()).toContain("Greets a person.");
    });

    it("a thematic break in the documentation splits it into popup blocks, an empty edge block yields no separator", async () => {
        useSource(() =>
            Promise.resolve(
                help({
                    signatures: [
                        {
                            label: "greet(name: string): void",
                            documentation: "Greets.\n\n---\n\nSee the docs.\n\n---",
                            parameters: [{ label: "name: string", documentation: "who" }],
                        },
                    ],
                }),
            ),
        );

        await service().trigger();

        expect(component().view.hint?.documentation).toEqual(["who", "Greets.", "See the docs."]);
    });

    it("the signature's own active parameter wins over the shared one", async () => {
        useSource(() =>
            Promise.resolve(
                help({
                    activeParameter: 0,
                    signatures: [{ ...GREET, activeParameter: 1 }],
                }),
            ),
        );

        await service().trigger();

        expect(component().view.linesFor(60)).toEqual([GREET.label]);
        const start = GREET.label.indexOf("age: number");
        expect(component().view.hint?.activeSpan).toEqual([start, start + "age: number".length]);
    });

    it("an active signature out of the list's range does not crash the popup", async () => {
        let activeSignature = 7;
        useSource(() => Promise.resolve(help({ activeSignature })));

        await service().trigger();
        expect(service().isOpen()).toBe(true);
        expect(lines()).toEqual([GREET.label]);

        // A negative index also misses the list: without the clamp, accessing
        // signatures[-1] would crash the render.
        activeSignature = -1;
        service().close();
        await service().trigger();
        expect(service().isOpen()).toBe(true);
        expect(lines()).toEqual([GREET.label]);
    });

    it("no source — the popup does not open", async () => {
        await service().trigger();

        expect(service().isOpen()).toBe(false);
    });

    it("no active editor — the source is not called", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);
        h.commands.execute("workbench.action.closeActiveEditor");
        expect(group().getActiveEditor()).toBeNull();

        await service().trigger();

        expect(source).not.toHaveBeenCalled();
        expect(service().isOpen()).toBe(false);
    });

    it("the cursor left the viewport during the request — the popup does not open and is closed", async () => {
        useSource(() => Promise.resolve(help()));
        const editor = group().getActiveEditor()!;

        await service().trigger();
        expect(service().isOpen()).toBe(true);
        editor.getCaretAnchor = () => null;
        await service().trigger();
        expect(service().isOpen()).toBe(false);

        await service().trigger();
        expect(service().isOpen()).toBe(false);
    });

    it("a stale response does not reopen a closed popup", async () => {
        let release: (value: ICoreSignatureHelp | null) => void = () => undefined;
        useSource(
            () =>
                new Promise((resolve) => {
                    release = resolve;
                }),
        );

        const pending = service().trigger();
        service().close();
        release(help());
        await pending;

        expect(service().isOpen()).toBe(false);
    });

    it("the editor losing focus closes the popup, regaining it does not", async () => {
        useSource(() => Promise.resolve(help()));
        await service().trigger();

        const focusTracker = h.container.get(FocusTrackerDIToken);
        focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
        expect(service().isOpen()).toBe(true);
        expect(contextKey(service(), "parameterHintsVisible")).toBe(true);

        focusTracker.fire(null);
        expect(service().isOpen()).toBe(false);
        expect(contextKey(service(), "parameterHintsVisible")).toBe(false);
    });

    it("changing the active editor closes the popup and moves the subscriptions", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);
        const first = group().getActiveEditor()!;
        await service().trigger();
        expect(service().isOpen()).toBe(true);

        group().openFile(ws.path("other.ts"));
        expect(service().isOpen()).toBe(false);

        // An edit in the PREVIOUS editor no longer reaches the service: the subscriptions are gone.
        await service().trigger();
        const before = source.mock.calls.length;
        first.viewState.insertText("x");
        await flushTimers();
        await flushMicrotasks();
        expect(source).toHaveBeenCalledTimes(before);
        expect(service().isOpen()).toBe(true);
    });

    it("typing a trigger character right after an editor change opens the hint", async () => {
        const source = vi.fn(() => Promise.resolve(help()));
        useSource(source);

        // The cursor cache belongs to the previous editor: without a rebuild on binding,
        // the very first keystroke in the new file would mismatch on line length.
        group().openFile(ws.path("other.ts"));
        h.workbench.focusEditor();
        h.testApp.sendKey("(");
        await flushTimers();
        await flushMicrotasks();

        expect(source).toHaveBeenCalledTimes(1);
        expect(service().isOpen()).toBe(true);
    });

    it("Escape closes the popup, arrows cycle the overloads", async () => {
        useSource(() => Promise.resolve(help({ signatures: [GREET, GREET_SHORT] })));

        await service().trigger();
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("ArrowDown");
        expect(lines()[0]).toBe("2/2 greet(name: string): void");
        h.testApp.sendKey("ArrowUp");
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");

        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
        // Escape did not leak into the editor: the cursor stays put.
        expect(group().getActiveEditor()?.viewState.selections[0].active).toMatchObject({ line: 0, character: 0 });
    });

    it("with the suggest popup open, Escape and the arrows belong to it", async () => {
        useSource(() => Promise.resolve(help({ signatures: [GREET, GREET_SHORT] })));
        h.container.get(LanguageFeaturesServiceDIToken).completionProvider.register("*", {
            triggerCharacters: [],
            provideCompletionItems: () =>
                Promise.resolve({ items: [{ label: "greet", insertText: "greet" }], isIncomplete: false }),
        });
        const completion = h.container.get(CompletionServiceDIToken);

        await service().trigger();
        await completion.trigger();
        expect(completion.isOpen()).toBe(true);
        expect(service().isOpen()).toBe(true);

        h.testApp.sendKey("ArrowDown");
        expect(lines()[0]).toBe("1/2 greet(name: string, age: number): void");

        // The first Escape dismisses suggest, the hint stays.
        h.testApp.sendKey("Escape");
        expect(completion.isOpen()).toBe(false);
        expect(service().isOpen()).toBe(true);

        // The second one dismisses the hint.
        h.testApp.sendKey("Escape");
        expect(service().isOpen()).toBe(false);
    });

    it("the Ctrl+K Ctrl+Space chord opens the hint", async () => {
        useSource(() => Promise.resolve(help()));

        h.testApp.sendKey("Ctrl+K");
        h.testApp.sendKey("Ctrl+Space");
        await flushMicrotasks();

        expect(service().isOpen()).toBe(true);
    });
});
