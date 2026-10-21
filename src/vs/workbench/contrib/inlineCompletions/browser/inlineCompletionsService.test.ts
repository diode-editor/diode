import { describe, expect, it, vi } from "vitest";

import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type {
    ICoreInlineCompletionItem,
    IInlineCompletionRequest,
} from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import { InlineCompletionTriggerKind } from "../../../../editor/common/languages/iInlineCompletionSource.ts";
import type { IGhostText } from "../../../../editor/common/model/iGhostText.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { ICursorStateComputer } from "../../../../editor/common/viewModel/trackedSelections.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { isValidConfigurationValue } from "../../../../platform/configuration/common/configurationValidation.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IContextKeyContributor } from "../../../../platform/contextkey/common/contextKeyContributor.ts";
import type { ContextKey } from "../../../../platform/contextkey/common/contextKeys.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { CompletionService, IInlineSuggestionsState } from "../../suggest/browser/completionService.ts";

import { computeIndentationLessThanTabSize, InlineCompletionsService } from "./inlineCompletionsService.ts";

function contextKey(contributor: IContextKeyContributor, key: ContextKey): unknown {
    const keys = new ContextKeyService();
    contributor.updateContextKeys(keys, null);
    return keys.get(key);
}

/** A pause longer than the zero debounce — the auto request has time to go out and come back. */
async function tick(ms = 5): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface FakeEditor {
    editor: TextEditorPane;
    applyExternalEdits: ReturnType<
        typeof vi.fn<(edits: ITextEdit[], label: string, computeCursorState?: ICursorStateComputer) => void>
    >;
    setGhostText: ReturnType<typeof vi.fn<(ghost: IGhostText | null) => void>>;
    /** Updates the line/cursor and sends content+cursor, as real typing does. */
    type: (line: string, character: number) => void;
    /** A pure cursor move: sends only cursor (no content marker). */
    move: (lineNo: number, character: number) => void;
    setSelection: (anchorChar: number, activeChar: number) => void;
    setCursorCount: (count: number) => void;
    setReadOnly: (value: boolean) => void;
}

function makeEditor(lineContent: string, character: number): FakeEditor {
    const state = { line: lineContent, lineNo: 0, anchorChar: character, activeChar: character, versionId: 1 };
    let cursorCount = 1;
    let readOnly = false;
    const contentListeners: (() => void)[] = [];
    const cursorListeners: (() => void)[] = [];
    const applyExternalEdits =
        vi.fn<(edits: ITextEdit[], label: string, computeCursorState?: ICursorStateComputer) => void>();
    const setGhostText = vi.fn<(ghost: IGhostText | null) => void>();

    const editor = {
        get viewState() {
            return {
                selections: Array.from({ length: cursorCount }, (_, i) => ({
                    anchor: { line: state.lineNo + i, character: state.anchorChar },
                    active: { line: state.lineNo + i, character: state.activeChar },
                })),
                document: {
                    getLineContent: (_line: number) => state.line,
                    versionId: state.versionId,
                },
                tabSize: 4,
            };
        },
        get readOnly() {
            return readOnly;
        },
        getText: () => state.line,
        get model() {
            // The model version is the same as viewState's: the request carries it instead of the text.
            return { document: { versionId: state.versionId } };
        },
        uri: Uri.file("/proj/sample.ts"),
        languageId: "typescript",
        applyExternalEdits,
        setGhostText,
        onDidChangeContent: (l: () => void) => {
            contentListeners.push(l);
            return { dispose: () => contentListeners.splice(contentListeners.indexOf(l), 1) };
        },
        onDidChangeCursorPosition: (l: () => void) => {
            cursorListeners.push(l);
            return { dispose: () => cursorListeners.splice(cursorListeners.indexOf(l), 1) };
        },
    } as unknown as TextEditorPane;

    const fireContent = (): void => {
        for (const l of [...contentListeners]) l();
    };
    const fireCursor = (): void => {
        for (const l of [...cursorListeners]) l();
    };

    return {
        editor,
        applyExternalEdits,
        setGhostText,
        type: (line, ch) => {
            state.line = line;
            state.anchorChar = ch;
            state.activeChar = ch;
            state.versionId++;
            fireContent();
            fireCursor();
        },
        move: (lineNo, ch) => {
            state.lineNo = lineNo;
            state.anchorChar = ch;
            state.activeChar = ch;
            fireCursor();
        },
        setSelection: (anchorChar, activeChar) => {
            state.anchorChar = anchorChar;
            state.activeChar = activeChar;
            fireCursor();
        },
        setCursorCount: (count) => {
            cursorCount = count;
            fireCursor();
        },
        setReadOnly: (value) => {
            readOnly = value;
        },
    };
}

interface FakeGroup {
    group: IEditorService;
    setActiveEditor: (editor: TextEditorPane | null) => void;
    /** Active editor change WITHOUT an event — the window between closing a tab and the event. */
    setActiveEditorSilently: (editor: TextEditorPane | null) => void;
}

type FakeInlineSource =
    | ((request: IInlineCompletionRequest, token: ICancellationToken) => Promise<readonly ICoreInlineCompletionItem[]>)
    | undefined;

const sources = new WeakMap<IEditorService, FakeInlineSource>();

function makeGroup(editor: TextEditorPane | null, source: FakeInlineSource): FakeGroup {
    let active = editor;
    const listeners: ((editor: TextEditorPane | null) => void)[] = [];
    const group = {
        getActiveEditor: () => active,
        onActiveEditorChanged: (l: (editor: TextEditorPane | null) => void) => {
            listeners.push(l);
            return { dispose: () => listeners.splice(listeners.indexOf(l), 1) };
        },
    } as unknown as IEditorService;
    sources.set(group, source);
    return {
        group,
        setActiveEditor: (next) => {
            active = next;
            for (const l of [...listeners]) l(next);
        },
        setActiveEditorSilently: (next) => {
            active = next;
        },
    };
}

interface ServiceOptions {
    popupOpen?: () => boolean;
    /** `undefined` means the key is absent from the model. */
    enabled?: boolean;
    /** Defaults to 0 — a deterministic auto request. */
    delay?: unknown;
    /** `undefined` means the key is absent from the model. */
    requestTimeout?: unknown;
    languageFeatures?: LanguageFeaturesService;
    languages?: Readonly<Record<string, Omit<ServiceOptions, "popupOpen" | "languages" | "languageFeatures">>>;
}

type TestInlineService = InlineCompletionsService & {
    firePopupClose: () => void;
    firePopupShow: () => void;
    /** `null` means removed on dispose. */
    inlineState: () => IInlineSuggestionsState | null;
};

const APP_SCHEMAS = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getConfigurationProperties();

function makeService(group: IEditorService, options: ServiceOptions = {}): TestInlineService {
    const closeListeners: (() => void)[] = [];
    const showListeners: (() => void)[] = [];
    let inlineState: IInlineSuggestionsState | null = null;
    const completion = {
        isOpen: options.popupOpen ?? (() => false),
        onDidClose: (l: () => void) => {
            closeListeners.push(l);
            return { dispose: () => closeListeners.splice(closeListeners.indexOf(l), 1) };
        },
        onDidShow: (l: () => void) => {
            showListeners.push(l);
            return { dispose: () => showListeners.splice(showListeners.indexOf(l), 1) };
        },
        setInlineSuggestionsState: (state: IInlineSuggestionsState) => {
            inlineState = state;
            return {
                dispose: () => {
                    inlineState = null;
                },
            };
        },
    } as unknown as CompletionService;
    // Live: values come from `options` at read time; out-of-schema and missing values fall back to the schema default.
    const configuration = {
        get: (key: string, overrides?: IConfigurationOverrides): unknown => {
            const language =
                overrides?.overrideIdentifier === undefined
                    ? undefined
                    : options.languages?.[overrides.overrideIdentifier];
            const layer = { ...options, ...language };
            const raw =
                key === "editor.inlineSuggest.enabled"
                    ? layer.enabled
                    : key === "editor.inlineSuggest.delay"
                      ? (layer.delay ?? 0)
                      : key === "editor.inlineSuggest.requestTimeout"
                        ? layer.requestTimeout
                        : undefined;
            const schema = APP_SCHEMAS.get(key);
            if (schema === undefined) return raw;
            return raw !== undefined && isValidConfigurationValue(schema, raw) ? raw : schema.default;
        },
    } as unknown as IConfigurationService;
    // A provider under `*` on top of the group source — like the extension proxy in production.
    const languageFeatures = options.languageFeatures ?? new LanguageFeaturesService();
    const source = sources.get(group);
    if (source !== undefined)
        languageFeatures.inlineCompletionsProvider.register("*", { provideInlineCompletions: source });
    const service = new InlineCompletionsService(
        group,
        completion,
        configuration,
        languageFeatures,
    ) as TestInlineService;
    service.firePopupClose = () => {
        for (const l of [...closeListeners]) l();
    };
    service.firePopupShow = () => {
        for (const l of [...showListeners]) l();
    };
    service.inlineState = () => inlineState;
    return service;
}

function items(...list: ICoreInlineCompletionItem[]): () => Promise<readonly ICoreInlineCompletionItem[]> {
    return () => Promise.resolve(list);
}

function recordingItems(
    into: IInlineCompletionRequest[],
    ...list: ICoreInlineCompletionItem[]
): (req: IInlineCompletionRequest) => Promise<readonly ICoreInlineCompletionItem[]> {
    return (req) => {
        into.push(req);
        return Promise.resolve(list);
    };
}

/** Holds the answer until `respond` and exposes request tokens — the cancellation tests check them. */
function pendingSource(): {
    source: FakeInlineSource;
    tokens: ICancellationToken[];
    respond: (index: number, list?: ICoreInlineCompletionItem[]) => void;
} {
    const tokens: ICancellationToken[] = [];
    const resolvers: ((list: readonly ICoreInlineCompletionItem[]) => void)[] = [];
    return {
        source: (_request, token) => {
            tokens.push(token);
            return new Promise<readonly ICoreInlineCompletionItem[]>((resolve) => resolvers.push(resolve));
        },
        tokens,
        respond: (index, list = []) => {
            resolvers[index](list);
        },
    };
}

describe("InlineCompletionsService — showing", () => {
    it("typing a character auto-requests the source and shows the suggestion's tail", async () => {
        const fake = makeEditor("const x", 7);
        const requests: IInlineCompletionRequest[] = [];
        const source = (req: IInlineCompletionRequest): Promise<readonly ICoreInlineCompletionItem[]> => {
            requests.push(req);
            return Promise.resolve([{ insertText: " = 42;" }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);
        expect(contextKey(service, "inlineSuggestionVisible")).toBe(false);

        fake.type("const x ", 8);
        await tick();

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({
            languageId: "typescript",
            line: 0,
            character: 8,
            triggerKind: InlineCompletionTriggerKind.Automatic,
        });
        // The model version after the edit instead of the document text.
        expect(requests[0].versionId).toBe(2);
        expect(requests[0]).not.toHaveProperty("text");
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 8, lines: [" = 42;"] });
        expect(service.isOpen()).toBe(true);
        expect(contextKey(service, "inlineSuggestionVisible")).toBe(true);
    });

    it("a multi-line insertText is split into ghost text lines", async () => {
        const fake = makeEditor("function fib", 12);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "(n) {\n    return n;\n}" })).group);

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({
            line: 0,
            character: 12,
            lines: ["(n) {", "    return n;", "}"],
        });
        expect(service.isOpen()).toBe(true);
    });

    it("a manual trigger sends Invoke and works without the typing heuristic", async () => {
        const fake = makeEditor("abc", 3);
        const requests: IInlineCompletionRequest[] = [];
        const source = (req: IInlineCompletionRequest): Promise<readonly ICoreInlineCompletionItem[]> => {
            requests.push(req);
            return Promise.resolve([{ insertText: "def" }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        await service.trigger(InlineCompletionTriggerKind.Invoke);

        expect(requests[0].triggerKind).toBe(InlineCompletionTriggerKind.Invoke);
        expect(service.isOpen()).toBe(true);
    });

    it("provider range: the typed text is a filterText prefix, the ghost text is the insertText tail", async () => {
        const fake = makeEditor("con", 3);
        const item: ICoreInlineCompletionItem = {
            insertText: "console.log()",
            filterText: "console",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
        };
        const service = makeService(makeGroup(fake.editor, items(item)).group);

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["sole.log()"] });
        expect(service.isOpen()).toBe(true);
    });

    it("non-matching items are skipped — the first matching one is taken", async () => {
        const fake = makeEditor("con", 3);
        const service = makeService(
            makeGroup(
                fake.editor,
                items(
                    // insertText does not start with what is typed in range.
                    {
                        insertText: "log()",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // range on another line.
                    {
                        insertText: "confuse",
                        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } },
                    },
                    // start on another line (end on the cursor line).
                    {
                        insertText: "con-BAD1",
                        range: { start: { line: 1, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // end on another line (start on the cursor line).
                    {
                        insertText: "con-BAD2",
                        range: { start: { line: 0, character: 0 }, end: { line: 1, character: 3 } },
                    },
                    // range starts RIGHT of the cursor.
                    {
                        insertText: "-BAD3",
                        range: { start: { line: 0, character: 4 }, end: { line: 0, character: 5 } },
                    },
                    // range does not cover the cursor.
                    {
                        insertText: "control",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    },
                    // filterText matched, but insertText does not start with the typed text.
                    {
                        insertText: "xyz",
                        filterText: "console",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // insertText is longer than typed, filterText matched — but insertText does not start with typed.
                    {
                        insertText: "xyzabc",
                        filterText: "console",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // filterText did NOT match — insertText matches, but the filterText gate drops it.
                    {
                        insertText: "con-BAD4",
                        filterText: "nope",
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    },
                    // fully typed text — no tail.
                    { insertText: "con", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } },
                    { insertText: "st y = 1;" },
                ),
            ).group,
        );

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["st y = 1;"] });
    });

    it("a range starting exactly at the cursor is a valid insertion", async () => {
        const fake = makeEditor("con", 3);
        const item: ICoreInlineCompletionItem = {
            insertText: "tinue;",
            range: { start: { line: 0, character: 3 }, end: { line: 0, character: 3 } },
        };
        const service = makeService(makeGroup(fake.editor, items(item)).group);

        await service.trigger();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["tinue;"] });
    });

    it("a repeat request with an empty response hides the shown suggestion", async () => {
        const fake = makeEditor("ab", 2);
        let empty = false;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> =>
            Promise.resolve(empty ? [] : [{ insertText: "cde" }]);
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        empty = true;
        await service.trigger();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("an empty response and a source error show nothing", async () => {
        const fake = makeEditor("abc", 3);
        const service = makeService(makeGroup(fake.editor, items()).group);
        await service.trigger();
        expect(service.isOpen()).toBe(false);

        const failing = makeService(makeGroup(fake.editor, () => Promise.reject(new Error("boom"))).group);
        await failing.trigger();
        expect(failing.isOpen()).toBe(false);
        expect(fake.setGhostText).not.toHaveBeenCalled();
    });
});

describe("InlineCompletionsService — gates", () => {
    it("does not request: selection, multi-cursor, read-only", async () => {
        const source = vi.fn(items({ insertText: "x" }));

        const withSelection = makeEditor("abc", 3);
        withSelection.setSelection(1, 3);
        await makeService(makeGroup(withSelection.editor, source).group).trigger();

        const multiCursor = makeEditor("abc", 3);
        multiCursor.setCursorCount(2);
        await makeService(makeGroup(multiCursor.editor, source).group).trigger();

        const readOnly = makeEditor("abc", 3);
        readOnly.setReadOnly(true);
        await makeService(makeGroup(readOnly.editor, source).group).trigger();

        expect(source).not.toHaveBeenCalled();
    });

    it("no active editor and no source — no-op", async () => {
        const noEditor = makeService(makeGroup(null, items({ insertText: "x" })).group);
        await noEditor.trigger();
        expect(noEditor.isOpen()).toBe(false);

        const fake = makeEditor("abc", 3);
        const noSource = makeService(makeGroup(fake.editor, undefined).group);
        await noSource.trigger();
        expect(noSource.isOpen()).toBe(false);
    });

    it("a call with no matching providers touches nothing: the request in flight survives", async () => {
        const fake = makeEditor("a", 1);
        const languageFeatures = new LanguageFeaturesService();
        let resolveLate!: (v: readonly ICoreInlineCompletionItem[]) => void;
        const registration = languageFeatures.inlineCompletionsProvider.register("*", {
            provideInlineCompletions: () =>
                new Promise((resolve) => {
                    resolveLate = resolve;
                }),
        });
        const service = makeService(makeGroup(fake.editor, undefined).group, { languageFeatures });

        const first = service.trigger();
        registration.dispose();
        await service.trigger();
        resolveLate([{ insertText: "-late" }]);
        await first;

        expect(fake.setGhostText).toHaveBeenLastCalledWith(expect.objectContaining({ lines: ["-late"] }));
    });

    it("a stale response is dropped: a new request overtakes the old one", async () => {
        const fake = makeEditor("a", 1);
        let resolveFirst!: (v: readonly ICoreInlineCompletionItem[]) => void;
        let calls = 0;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> => {
            calls++;
            if (calls === 1) {
                return new Promise((resolve) => {
                    resolveFirst = resolve;
                });
            }
            return Promise.resolve([{ insertText: "-second" }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        const first = service.trigger();
        await service.trigger();
        resolveFirst([{ insertText: "-first" }]);
        await first;

        expect(fake.setGhostText).toHaveBeenLastCalledWith(expect.objectContaining({ lines: ["-second"] }));
        expect(fake.setGhostText).not.toHaveBeenCalledWith(expect.objectContaining({ lines: ["-first"] }));
    });

    it("revalidation after await: editor change / versionId / multi-cursor / cursor / popup", async () => {
        const deferred = (): {
            source: () => Promise<readonly ICoreInlineCompletionItem[]>;
            resolvers: ((v: readonly ICoreInlineCompletionItem[]) => void)[];
        } => {
            const resolvers: ((v: readonly ICoreInlineCompletionItem[]) => void)[] = [];
            return {
                resolvers,
                source: () =>
                    new Promise<readonly ICoreInlineCompletionItem[]>((resolve) => {
                        resolvers.push(resolve);
                    }),
            };
        };
        const ITEM = [{ insertText: "-tail" }];

        // The active editor silently changed while awaiting the answer.
        const switched = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const d1 = deferred();
        const g1 = makeGroup(switched.editor, d1.source);
        const s1 = makeService(g1.group);
        const p1 = s1.trigger();
        g1.setActiveEditorSilently(other.editor);
        d1.resolvers[0](ITEM);
        await p1;
        expect(s1.isOpen()).toBe(false);

        // An edit bumped versionId (the answer resolves BEFORE the debounced re-request).
        const edited = makeEditor("ab", 2);
        const d2 = deferred();
        const s2 = makeService(makeGroup(edited.editor, d2.source).group);
        const p2 = s2.trigger();
        edited.type("ab", 2); // same content, different versionId
        d2.resolvers[0](ITEM);
        await p2;
        expect(s2.isOpen()).toBe(false);

        // Multi-cursor appeared during the request.
        const multi = makeEditor("ab", 2);
        const d3 = deferred();
        const s3 = makeService(makeGroup(multi.editor, d3.source).group);
        const p3 = s3.trigger();
        multi.setCursorCount(2);
        d3.resolvers[0](ITEM);
        await p3;
        expect(s3.isOpen()).toBe(false);

        // The cursor moved (without an edit).
        const moved = makeEditor("ab", 2);
        const d4 = deferred();
        const s4 = makeService(makeGroup(moved.editor, d4.source).group);
        const p4 = s4.trigger();
        moved.move(0, 1);
        d4.resolvers[0](ITEM);
        await p4;
        expect(s4.isOpen()).toBe(false);

        // The suggest popup opened during the request: the answer is not dropped but waits invisibly for it to close.
        const popup = makeEditor("ab", 2);
        const d5 = deferred();
        let popupOpen = false;
        const s5 = makeService(makeGroup(popup.editor, d5.source).group, { popupOpen: () => popupOpen });
        const p5 = s5.trigger();
        popupOpen = true;
        d5.resolvers[0](ITEM);
        await p5;
        expect(s5.isOpen()).toBe(false);
        expect(popup.setGhostText).toHaveBeenLastCalledWith(null);

        // The cursor moved to another line (same column — only the line check catches it).
        const movedLine = makeEditor("ab", 2);
        const d6 = deferred();
        const s6 = makeService(makeGroup(movedLine.editor, d6.source).group);
        const p6 = s6.trigger();
        movedLine.move(1, 2);
        d6.resolvers[0](ITEM);
        await p6;
        expect(s6.isOpen()).toBe(false);
    });

    it("a response outlived by a document edit is not shown", async () => {
        const fake = makeEditor("a", 1);
        const resolvers: ((v: readonly ICoreInlineCompletionItem[]) => void)[] = [];
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> =>
            new Promise((resolve) => {
                resolvers.push(resolve);
            });
        const service = makeService(makeGroup(fake.editor, source).group);

        const pending = service.trigger();
        // Edit + cursor back to the same position: versionId is already different (the edit
        // also schedules its own auto request — its resolver is second in the array).
        fake.type("a", 1);
        await tick();
        resolvers[0]([{ insertText: "-stale" }]);
        await pending;

        expect(fake.setGhostText).not.toHaveBeenCalledWith(expect.objectContaining({ lines: ["-stale"] }));
        expect(service.isOpen()).toBe(false);
    });
});

describe("InlineCompletionsService — session lifetime", () => {
    it("typing a matching character shrinks the ghost text locally, without a new request", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 2, lines: ["cde"] });

        fake.type("abc", 3);
        await tick();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["de"] });
        expect(source).toHaveBeenCalledTimes(1);
        expect(service.isOpen()).toBe(true);
    });

    it("Backspace grows the ghost text back (the typed text is still a prefix)", async () => {
        const fake = makeEditor("abc", 3);
        const source = vi.fn(
            items({ insertText: "cde", range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } } }),
        );
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["de"] });

        fake.type("ab", 2);
        await tick();

        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 2, lines: ["cde"] });
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("diverging typing hides the suggestion and re-requests", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();

        fake.type("abx", 3);
        await tick();

        expect(fake.setGhostText).toHaveBeenCalledWith(null);
        expect(source).toHaveBeenCalledTimes(2); // auto re-request after the mismatch
    });

    it("a suggestion typed out in full is hidden (a re-request afterwards is legitimate)", async () => {
        const fake = makeEditor("ab", 2);
        let calls = 0;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> => {
            calls++;
            return Promise.resolve(calls === 1 ? [{ insertText: "c" }] : []);
        };
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.type("abc", 3);
        await tick();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        expect(calls).toBe(2); // a new auto request goes out after typing more
    });

    it("cursor movement without an edit hides the suggestion", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();

        fake.move(0, 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("the cursor moved back INSIDE the suggestion without an edit — the suggestion is hidden", async () => {
        const fake = makeEditor("abc", 3);
        const source = items({
            insertText: "cde",
            range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } },
        });
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Cursor inside the replaced range: the typed text ("") is still a prefix of
        // the suggestion, but there was no edit — the move dismisses it (Backspace would grow it).
        fake.move(0, 2);

        expect(service.isOpen()).toBe(false);
    });

    it("the cursor on another line (same column) hides the suggestion", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // The column matches the old one — only the line check sees the mismatch.
        fake.move(1, 2);

        expect(service.isOpen()).toBe(false);
    });

    it("the line got shorter than the session start — the suggestion is hidden instead of shifting", async () => {
        const fake = makeEditor("ab", 2);
        let calls = 0;
        const source = (): Promise<readonly ICoreInlineCompletionItem[]> => {
            calls++;
            return Promise.resolve(calls === 1 ? [{ insertText: "cde" }] : []);
        };
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Backspace past the session start: the cursor is at the end of the line, but LEFT of start.
        fake.type("a", 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("under an open suggest popup the response is hidden, and Esc on the popup shows it right away, without a re-request", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(items({ insertText: "sole.log();" }));
        let popupOpen = true;
        const service = makeService(makeGroup(fake.editor, source).group, { popupOpen: () => popupOpen });

        // The popup is open — the request still goes out (as upstream), but the ghost text is
        // not drawn, and Tab/Escape do not go to it.
        fake.type("con", 3);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);
        expect(service.isOpen()).toBe(false);
        expect(contextKey(service, "inlineSuggestionVisible")).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        service.acceptCurrent();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();

        // Esc closed the popup: the ready answer goes on screen in the same tick.
        popupOpen = false;
        service.firePopupClose();
        expect(service.isOpen()).toBe(true);
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 3, lines: ["sole.log();"] });
        await tick();
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("an opening suggest popup hides the shown ghost text, a closing one brings it back", async () => {
        const fake = makeEditor("con", 3);
        let popupOpen = false;
        const service = makeService(makeGroup(fake.editor, items({ insertText: "sole" })).group, {
            popupOpen: () => popupOpen,
        });
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        popupOpen = true;
        service.firePopupShow();
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        expect(service.isOpen()).toBe(false);

        // Typing that matches the suggestion keeps the session under the popup, but does not draw it.
        fake.type("cons", 4);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);

        popupOpen = false;
        service.firePopupClose();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 4, lines: ["ole"] });
    });

    it("closing the popup does not show a session that went stale without an event (silent editor change)", async () => {
        const fake = makeEditor("con", 3);
        let popupOpen = false;
        const g = makeGroup(fake.editor, items({ insertText: "sole" }));
        const service = makeService(g.group, { popupOpen: () => popupOpen });
        await service.trigger();
        popupOpen = true;
        service.firePopupShow();

        g.setActiveEditorSilently(null);
        popupOpen = false;
        service.firePopupClose();
        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("closing the popup with a broken session hides it and re-requests", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(items({ insertText: "sole" }));
        let popupOpen = false;
        const service = makeService(makeGroup(fake.editor, source).group, { popupOpen: () => popupOpen });
        await service.trigger();
        popupOpen = true;
        service.firePopupShow();

        // The cursor was moved under the popup — the session is no longer valid.
        fake.move(0, 1);
        popupOpen = false;
        service.firePopupClose();
        expect(service.isOpen()).toBe(false);
        await tick();
        expect(source).toHaveBeenCalledTimes(2);
    });

    it("closing the popup without an active editor is a no-op (trigger gates by itself)", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(items({ insertText: "x" }));
        const g = makeGroup(fake.editor, source);
        const service = makeService(g.group);
        g.setActiveEditor(null);

        service.firePopupClose();
        await tick();

        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("the first cursor event without an edit requests nothing", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        makeService(makeGroup(fake.editor, source).group);

        fake.move(0, 2); // a pure move right after the service is created
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("two edits in a row — two auto requests (suppression does not stick)", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items());
        const service = makeService(makeGroup(fake.editor, source).group);

        fake.type("ab ", 3);
        await tick();
        fake.type("ab x", 4);
        await tick();

        expect(source).toHaveBeenCalledTimes(2);
        expect(service.isOpen()).toBe(false);
    });

    it("an edit over a pending request restarts the debounce instead of piling up timers", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items());
        makeService(makeGroup(fake.editor, source).group, { delay: 5 });

        fake.type("ab ", 3); // schedules t1
        fake.type("ab x", 4); // schedules t2, t1 must be cancelled
        await tick(30);

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("a manual trigger cancels the pending auto request (not two RPCs)", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const service = makeService(makeGroup(fake.editor, source).group);

        fake.type("ab ", 3); // schedules an auto request
        await service.trigger(); // manual — must cancel the timer
        await tick();

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("a pure cursor movement cancels the pending auto request", async () => {
        const fake = makeEditor("ab\ncd", 2);
        const source = vi.fn(items({ insertText: "xyz" }));
        const service = makeService(makeGroup(fake.editor, source).group);
        expect(service.isOpen()).toBe(false);

        fake.type("ab ", 3); // schedules an auto request
        fake.move(1, 3); // a move without an edit — the pending request is cancelled
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("multi-cursor during a live session hides the suggestion", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.setCursorCount(2);

        expect(service.isOpen()).toBe(false);
    });

    it("the active editor silently changed — a cursor event of the old one hides the suggestion", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const fakeGroup = makeGroup(fake.editor, items({ insertText: "cde" }));
        const service = makeService(fakeGroup.group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fakeGroup.setActiveEditorSilently(other.editor);
        fake.move(0, 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("the cursor moved when there is no active editor anymore — the suggestion is hidden", async () => {
        const fake = makeEditor("ab", 2);
        const fakeGroup = makeGroup(fake.editor, items({ insertText: "cde" }));
        const service = makeService(fakeGroup.group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // The window between closing a tab and the onActiveEditorChanged event:
        // the old editor's cursor event arrives with active === null.
        fakeGroup.setActiveEditorSilently(null);
        fake.move(0, 1);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("an active editor change hides the suggestion", async () => {
        const fake = makeEditor("ab", 2);
        const fakeGroup = makeGroup(fake.editor, items({ insertText: "cde" }));
        const service = makeService(fakeGroup.group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fakeGroup.setActiveEditor(null);

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("after an editor change, the old one's events start no requests (subscriptions removed)", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        const service = makeService(g.group);

        g.setActiveEditor(other.editor);
        fake.type("ab ", 3);
        await tick();

        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("an editor change drops the old one's pending auto request", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        makeService(g.group);

        fake.type("ab ", 3); // schedules an auto request on the old one
        g.setActiveEditor(other.editor); // bindEditor must cancel the timer
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("an editor change does not carry `had an edit` over to the new one: a pure movement does not request", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        makeService(g.group);

        g.setActiveEditor(other.editor);
        other.move(0, 2); // a move without an edit on the new editor
        await tick();

        expect(source).not.toHaveBeenCalled();
    });

    it("hide() hides the suggestion (Escape)", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();

        service.hide();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        // A repeated hide is a no-op, no second setGhostText(null).
        const calls = fake.setGhostText.mock.calls.length;
        service.hide();
        expect(fake.setGhostText.mock.calls.length).toBe(calls);
    });

    it("dispose hides the visible suggestion", async () => {
        const fake = makeEditor("ab", 2);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "cde" })).group);
        await service.trigger();
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 2, lines: ["cde"] });

        service.dispose();

        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
    });

    it("dispose hides the suggestion and removes subscriptions", async () => {
        const fake = makeEditor("ab", 2);
        const other = makeEditor("zz", 2);
        const source = vi.fn(items({ insertText: "cde" }));
        const g = makeGroup(fake.editor, source);
        const service = makeService(g.group);
        await service.trigger();

        fake.type("ab ", 3); // a pending auto request…
        service.dispose(); // …dispose must cancel it too
        expect(fake.setGhostText).toHaveBeenLastCalledWith(null);
        await tick();
        expect(source).toHaveBeenCalledTimes(1); // only the original trigger

        fake.type("ab x", 4);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        // And an active editor change no longer rebinds the subscriptions.
        g.setActiveEditor(other.editor);
        other.type("zz ", 3);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        // The popup close subscription is gone too.
        service.firePopupClose();
        await tick();
        expect(source).toHaveBeenCalledTimes(1);
    });
});

describe("InlineCompletionsService — accept", () => {
    it("acceptCurrent replaces the range with the whole insertText in one edit and does not re-request", async () => {
        const fake = makeEditor("con", 3);
        const source = vi.fn(
            items({
                insertText: "console.log()",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            }),
        );
        const service = makeService(makeGroup(fake.editor, source).group);
        await service.trigger();

        service.acceptCurrent();

        expect(service.isOpen()).toBe(false);
        expect(fake.applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [
                {
                    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                    text: "console.log()",
                },
            ],
            "Accept Inline Suggestion",
            expect.any(Function),
        );
        // A single cursor at the end of the insertion (the inverse edit covers the inserted text).
        const computeCursorState = fake.applyExternalEdits.mock.calls[0][2];
        expect(
            computeCursorState?.([
                { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 13 } }, text: "con" },
            ]),
        ).toEqual([{ anchor: { line: 0, character: 13 }, active: { line: 0, character: 13 } }]);

        // The accept edit sends content+cursor — the suppressed auto request does not go out.
        fake.type("console.log()", 13);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("acceptCurrent without a shown suggestion is a no-op", () => {
        const fake = makeEditor("con", 3);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "x" })).group);
        service.acceptCurrent();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();
    });
});

describe("InlineCompletionsService — cursor in the middle of a line", () => {
    it("typing in the middle of a line requests the source and shows ghost text before the tail", async () => {
        const fake = makeEditor(";", 0);
        const requests: IInlineCompletionRequest[] = [];
        const source = (req: IInlineCompletionRequest): Promise<readonly ICoreInlineCompletionItem[]> => {
            requests.push(req);
            return Promise.resolve([{ insertText: ' = "Hello"' }]);
        };
        const service = makeService(makeGroup(fake.editor, source).group);

        // Typed `const greeting` before an existing `;` — cursor at 14, tail `;`.
        fake.type("const greeting;", 14);
        await tick();

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ line: 0, character: 14 });
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 14, lines: [' = "Hello"'] });
        expect(service.isOpen()).toBe(true);
    });

    it("Tab inserts the suggestion in the middle of the line without touching the tail", async () => {
        const fake = makeEditor("const greeting;", 14);
        const service = makeService(makeGroup(fake.editor, items({ insertText: ' = "Hello"' })).group);

        await service.trigger();
        expect(service.isOpen()).toBe(true);

        service.acceptCurrent();

        // The edit is an insertion at the cursor position: the `;` tail stays after it.
        expect(fake.applyExternalEdits).toHaveBeenCalledExactlyOnceWith(
            [
                {
                    range: { start: { line: 0, character: 14 }, end: { line: 0, character: 14 } },
                    text: ' = "Hello"',
                },
            ],
            "Accept Inline Suggestion",
            expect.any(Function),
        );
        expect(service.isOpen()).toBe(false);
    });

    it("typing a matching character in the middle of a line shrinks the ghost text instead of hiding it", async () => {
        const fake = makeEditor("const greeting;", 14);
        const service = makeService(makeGroup(fake.editor, items({ insertText: ' = "Hello"' })).group);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        // Typed a space, the first character of the suggestion: the suggestion tail shrinks.
        fake.type("const greeting ;", 15);

        expect(service.isOpen()).toBe(true);
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 15, lines: ['= "Hello"'] });
    });
});

describe("InlineCompletionsService — request cancellation", () => {
    it("a new request cancels the previous one: only the last one survives", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();
        expect(pending.tokens).toHaveLength(1);
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(true);

        fake.type("const x =", 9);
        await tick();

        expect(pending.tokens).toHaveLength(2);
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(pending.tokens[1].isCancellationRequested).toBe(false);

        // A late answer of a cancelled request does not touch someone else's wait:
        // the latest request is still in flight.
        pending.respond(0, [{ insertText: "= 42;" }]);
        await tick();
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(true);
        expect(service.isOpen()).toBe(false);
    });

    it("a repeat trigger without an edit cancels the previous request too", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        // Two explicit triggers in a row: no edit, so onCaretChanged does not
        // fire — trigger itself must cancel the old request.
        void service.trigger();
        void service.trigger();
        await tick();

        expect(pending.tokens).toHaveLength(2);
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(pending.tokens[1].isCancellationRequested).toBe(false);
    });

    it("hide (Escape) cancels a request that has no ghost text yet, and a late response does not pop up", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(true);
        expect(service.isOpen()).toBe(false); // no ghost text yet

        service.hide();
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(false);

        // A stubborn provider answered despite the cancellation — it does not reach the screen.
        pending.respond(0, [{ insertText: "= 42;" }]);
        await tick();
        expect(service.isOpen()).toBe(false);
        expect(fake.setGhostText).not.toHaveBeenCalledWith(expect.objectContaining({ lines: ["= 42;"] }));
    });

    it("hide drops the pending auto request too — ghost text does not pop up right after Escape", async () => {
        const fake = makeEditor("const x", 7);
        const source = vi.fn(items({ insertText: " = 42;" }));
        const service = makeService(makeGroup(fake.editor, source).group);

        // The edit schedules an auto request; Escape arrives BEFORE the debounce
        // fires — no request must happen at all.
        fake.type("const x ", 8);
        service.hide();
        await tick();

        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("the cursor moving away cancels the request", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();

        fake.move(0, 3);

        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(false);
    });

    it("an active editor change (tab switch) cancels the request", async () => {
        const fake = makeEditor("const x", 7);
        const other = makeEditor("other", 5);
        const pending = pendingSource();
        const fakeGroup = makeGroup(fake.editor, pending.source);
        const service = makeService(fakeGroup.group);

        fake.type("const x ", 8);
        await tick();
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(true);

        fakeGroup.setActiveEditor(other.editor);

        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(false);
    });

    it("a request that got its response is not cancelled — the normal path is intact", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        const triggered = service.trigger();
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(true);
        pending.respond(0, [{ insertText: " = 42;" }]);
        await triggered;

        expect(pending.tokens[0].isCancellationRequested).toBe(false);
        expect(contextKey(service, "inlineSuggestionRequestPending")).toBe(false);
        expect(service.isOpen()).toBe(true);
        expect(fake.setGhostText).toHaveBeenLastCalledWith({ line: 0, character: 7, lines: [" = 42;"] });
    });

    it("disposing the service cancels the request in flight", async () => {
        const fake = makeEditor("const x", 7);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);

        fake.type("const x ", 8);
        await tick();
        service.dispose();

        expect(pending.tokens[0].isCancellationRequested).toBe(true);
    });
});

describe("InlineCompletionsService — Tab gate versus indentation", () => {
    it("a suggestion with ≥ a tab of indentation while the cursor is in the indentation turns the key off", async () => {
        const fake = makeEditor("    ", 4);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "    return n;" })).group);
        expect(contextKey(service, "inlineSuggestionHasIndentationLessThanTabSize")).toBe(true); // default without a session

        await service.trigger();

        expect(service.isOpen()).toBe(true);
        expect(contextKey(service, "inlineSuggestionHasIndentationLessThanTabSize")).toBe(false);
    });

    it("a suggestion after the line's text leaves the key alone", async () => {
        const fake = makeEditor("if (x) {", 8);
        const service = makeService(makeGroup(fake.editor, items({ insertText: "    }" })).group);
        await service.trigger();

        expect(contextKey(service, "inlineSuggestionHasIndentationLessThanTabSize")).toBe(true);
    });
});

describe("InlineCompletionsService — settings", () => {
    it("enabled:false suppresses the auto request but not an explicit trigger (manual mode)", async () => {
        const fake = makeEditor("ab", 2);
        const requests: IInlineCompletionRequest[] = [];
        const service = makeService(makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group, {
            enabled: false,
        });

        fake.type("ab ", 3);
        await tick();
        expect(requests).toHaveLength(0);
        expect(service.isOpen()).toBe(false);

        // Alt+\ (explicit Invoke) — the suggestion arrives despite the setting.
        fake.type("ab", 2);
        await tick();
        expect(requests).toHaveLength(0);
        await service.trigger(InlineCompletionTriggerKind.Invoke);

        expect(requests).toHaveLength(1);
        expect(requests[0]).toMatchObject({ triggerKind: InlineCompletionTriggerKind.Invoke });
        expect(service.isOpen()).toBe(true);
    });

    it("after an explicit trigger with enabled:false, divergence hides the ghost text for good", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "abc" }));
        const service = makeService(makeGroup(fake.editor, source).group, { enabled: false });
        await service.trigger(InlineCompletionTriggerKind.Invoke);
        expect(service.isOpen()).toBe(true);

        // A character off the suggestion: the session dies and does NOT come back by itself —
        // auto request is off, no second call to the source.
        fake.type("abX", 3);
        await tick();

        expect(service.isOpen()).toBe(false);
        expect(source).toHaveBeenCalledTimes(1);
    });

    it("enabled is read on every request — a setting change applies without recreating the service", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items({ insertText: "abc" }));
        const options: ServiceOptions = { enabled: true };
        const service = makeService(makeGroup(fake.editor, source).group, options);

        fake.type("ab ", 3);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        options.enabled = false; // like saving settings.json on a live editor
        fake.type("ab x", 4);
        await tick();
        expect(source).toHaveBeenCalledTimes(1);

        options.enabled = true;
        fake.type("ab xy", 5);
        await tick();
        expect(source).toHaveBeenCalledTimes(2);
        expect(service.isOpen()).toBe(true);
    });

    it("delay sets the pause before the auto request and is read on every edit", async () => {
        const fake = makeEditor("ab", 2);
        const source = vi.fn(items());
        const options: ServiceOptions = { delay: 40 };
        makeService(makeGroup(fake.editor, source).group, options);

        fake.type("ab ", 3);
        await tick(10);
        expect(source).not.toHaveBeenCalled(); // 40 ms have not passed yet
        await tick(60);
        expect(source).toHaveBeenCalledTimes(1);

        options.delay = 0; // new setting — new pause, without recreating the service
        fake.type("ab x", 4);
        await tick(10);
        expect(source).toHaveBeenCalledTimes(2);
    });

    it("settings are read for the document's language: the `[typescript]` section beats the flat ones", async () => {
        const fake = makeEditor("ab", 2); // the document is typescript
        const requests: IInlineCompletionRequest[] = [];
        const options: ServiceOptions = {
            enabled: true,
            delay: 0,
            requestTimeout: 5000,
            languages: { typescript: { enabled: false, delay: 40, requestTimeout: 777 }, go: { enabled: true } },
        };
        const service = makeService(
            makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group,
            options,
        );

        // Auto request is disabled by the language section.
        fake.type("ab ", 3);
        await tick(60);
        expect(requests).toHaveLength(0);

        // Explicit request — the timeout comes from the language section.
        await service.trigger();
        expect(requests[0]).toMatchObject({ timeoutMs: 777 });

        // Auto request is enabled again in the section — the pause comes from it too (40 ms, not 0).
        options.languages = { typescript: { enabled: true, delay: 40 } };
        fake.type("ab x", 4);
        await tick(10);
        expect(requests).toHaveLength(1);
        await tick(60);
        expect(requests).toHaveLength(2);
    });

    it("requestTimeout goes to the source with every request", async () => {
        const fake = makeEditor("ab", 2);
        const requests: IInlineCompletionRequest[] = [];
        const options: ServiceOptions = { requestTimeout: 20000 };
        const service = makeService(
            makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group,
            options,
        );

        await service.trigger();
        expect(requests[0]).toMatchObject({ timeoutMs: 20000 });

        options.requestTimeout = 1234;
        await service.trigger();
        expect(requests[1]).toMatchObject({ timeoutMs: 1234 });
    });

    it("invalid setting values fall back to defaults instead of breaking the editor", async () => {
        // Exactly what a person can write by hand.
        const fake = makeEditor("ab", 2);
        const requests: IInlineCompletionRequest[] = [];
        const service = makeService(makeGroup(fake.editor, recordingItems(requests, { insertText: "abc" })).group, {
            delay: -5,
            requestTimeout: "lots",
        });

        await service.trigger();
        expect(requests[0]).toMatchObject({ timeoutMs: 5000 });
        expect(service.isOpen()).toBe(true);

        // Default 50 ms debounce: no request after 10 ms, one after 70.
        fake.type("abc ", 4);
        await tick(10);
        expect(requests).toHaveLength(1);
        await tick(70);
        expect(requests).toHaveLength(2);
    });
});

describe("computeIndentationLessThanTabSize", () => {
    it("measures the visible width of spaces and tabs against tabSize", () => {
        expect(computeIndentationLessThanTabSize("  ", 2, "    x", 4)).toBe(false);
        // A tab pads up to the tabSize boundary → false.
        expect(computeIndentationLessThanTabSize("", 0, "\tx", 4)).toBe(false);
        expect(computeIndentationLessThanTabSize("  ", 2, "  x", 4)).toBe(true);
        // Cursor not in the indentation — always true.
        expect(computeIndentationLessThanTabSize("ab  ", 4, "    x", 4)).toBe(true);
        expect(computeIndentationLessThanTabSize("    ", 4, "x", 4)).toBe(true);
        // The suggestion indent scan stops at the first non-space
        // character — a long non-space tail does not accumulate width.
        expect(computeIndentationLessThanTabSize("    ", 4, "xxxx", 4)).toBe(true);
        // "In the indentation" is about the text BEFORE the cursor: a non-space tail right of the cursor
        // does not take it out of the indentation.
        expect(computeIndentationLessThanTabSize("  xx", 2, "    y", 4)).toBe(false);
    });
});

describe("InlineCompletionsService — state for quick suggest", () => {
    it("registers with suggest and unregisters on dispose", () => {
        const fake = makeEditor("a", 1);
        const service = makeService(makeGroup(fake.editor, items()).group);
        expect(service.inlineState()).not.toBeNull();
        service.dispose();
        expect(service.inlineState()).toBeNull();
    });

    it("loading: a pending and an in-flight request; an event on completion; visible means shown ghost text", async () => {
        const fake = makeEditor("con", 3);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group, { delay: 20 });
        const state = service.inlineState()!;
        const changed = vi.fn();
        state.onDidChange(changed);
        expect(state.isLoading()).toBe(false);

        fake.type("cons", 4); // the request is delayed by the debounce
        expect(state.isLoading()).toBe(true);
        await tick(30); // sent to the provider
        expect(pending.tokens).toHaveLength(1);
        expect(state.isLoading()).toBe(true);
        expect(state.isVisible()).toBe(false);
        changed.mockClear();

        pending.respond(0, [{ insertText: "ole" }]);
        await tick();
        expect(state.isLoading()).toBe(false);
        expect(state.isVisible()).toBe(true);
        expect(changed).toHaveBeenCalled();
    });

    it("an empty response is a completion too: an event, but no ghost text", async () => {
        const fake = makeEditor("con", 3);
        const service = makeService(makeGroup(fake.editor, items()).group);
        const state = service.inlineState()!;
        const changed = vi.fn();
        state.onDidChange(changed);
        await service.trigger();
        expect(changed).toHaveBeenCalled();
        expect(state.isVisible()).toBe(false);
        expect(state.isLoading()).toBe(false);
    });

    it("stopAutomatic cancels the in-flight request (suggest's wait timeout)", () => {
        const fake = makeEditor("con", 3);
        const pending = pendingSource();
        const service = makeService(makeGroup(fake.editor, pending.source).group);
        const state = service.inlineState()!;
        const changed = vi.fn();
        state.onDidChange(changed);
        void service.trigger();
        expect(state.isLoading()).toBe(true);
        state.stopAutomatic();
        expect(pending.tokens[0].isCancellationRequested).toBe(true);
        expect(state.isLoading()).toBe(false);
        expect(changed).toHaveBeenCalled();
    });

    it("opening the popup is a state event (ghost text left the screen)", async () => {
        const fake = makeEditor("con", 3);
        let popupOpen = false;
        const service = makeService(makeGroup(fake.editor, items({ insertText: "sole" })).group, {
            popupOpen: () => popupOpen,
        });
        await service.trigger();
        const state = service.inlineState()!;
        const changed = vi.fn();
        state.onDidChange(changed);
        popupOpen = true;
        service.firePopupShow();
        expect(changed).toHaveBeenCalledTimes(1);
        expect(state.isVisible()).toBe(false);
    });

    it("opening the popup without a session draws nothing", () => {
        const fake = makeEditor("con", 3);
        const service = makeService(makeGroup(fake.editor, items()).group, { popupOpen: () => true });
        service.firePopupShow();
        expect(fake.setGhostText).not.toHaveBeenCalled();
    });
});
