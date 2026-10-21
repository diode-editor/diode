import { BoxConstraints, Size } from "@tuidom/core/common/geometryPromitives";
import { TUIMouseEvent } from "@tuidom/core/dom/events/tuiMouseEvent";
import { BodyElement } from "@tuidom/elements/body/bodyElement";
import { describe, expect, it, vi } from "vitest";

import { storedTokens, tokenMetadata } from "../../../../../TestUtils/encodedTokens.ts";
import { TestApp } from "../../../../../TestUtils/TestApp.ts";
import { testLayoutService } from "../../../../../TestUtils/testLayoutService.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Emitter, Event } from "../../../../base/common/event.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { EditorElement } from "../../../../editor/browser/editorElement.ts";
import type { ITextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import { StandardTokenType } from "../../../../editor/common/encodedTokenAttributes.ts";
import type { ILanguageIdCodec } from "../../../../editor/common/languages.ts";
import type {
    CompletionItemProvider,
    ICompletionRequest,
    ICoreCompletionItem,
    ICoreCompletionResult,
    ICoreResolvedCompletion,
} from "../../../../editor/common/languages/iCompletionSource.ts";
import { CompletionTriggerKind } from "../../../../editor/common/languages/iCompletionSource.ts";
import { TextDocument } from "../../../../editor/common/model/textDocument.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { LineTokens } from "../../../../editor/common/tokens/lineTokens.ts";
import { EditorViewState } from "../../../../editor/common/viewModel/editorViewState.ts";
import type { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import { ConfigurationRegistry } from "../../../../platform/configuration/common/configurationRegistry.ts";
import { isValidConfigurationValue } from "../../../../platform/configuration/common/configurationValidation.ts";
import type {
    IConfigurationOverrides,
    IConfigurationService,
} from "../../../../platform/configuration/common/iConfigurationService.ts";
import { ContextKeyService } from "../../../../platform/contextkey/common/contextKeyService.ts";
import type { IStateDescriptor, IStateService } from "../../../../platform/state/common/iStateService.ts";
import type { TextEditorPane } from "../../../browser/parts/editor/textEditorPane.ts";
import { CONFIGURATION_CONTRIBUTIONS } from "../../../common/configuration/configurationContributions.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import { FocusTracker } from "../../../services/focus/browser/focusTracker.ts";

import { CompletionService, type IInlineSuggestionsState } from "./completionService.ts";
import { SuggestComponent } from "./suggestComponent.ts";

interface FakeEditor {
    editor: TextEditorPane;
    applyExternalEdits: ReturnType<typeof vi.fn<(edits: ITextEdit[], label: string) => void>>;
    /** content+cursor, then `onDidType` with the character left of the cursor (like the editor after a typing edit). */
    type: (line: string, character: number, lineNo?: number) => void;
    /** An edit other than typing (paste, accept, delete): content+cursor without `onDidType`. */
    edit: (line: string, character: number, lineNo?: number) => void;
    /** Only `onDidType` — typing that left a selection (auto-surround). */
    fireTyped: (text: string) => void;
    /** A pure cursor move: sends only cursor (no content marker). */
    move: (lineNo: number, character: number) => void;
    setSelection: (anchorChar: number, activeChar: number) => void;
    setCursorCount: (count: number) => void;
    setAnchorNull: (value: boolean) => void;
    /** `[start, metadata]` pairs; `undefined` means no store. */
    setTokens: (tokens: TokenPairs | undefined) => void;
}

type TokenPairs = readonly (readonly [startIndex: number, metadata: number])[];

const LANGUAGE_ID_CODEC: ILanguageIdCodec = {
    encodeLanguageId: () => 0,
    decodeLanguageId: () => "editorconfig",
};

const STRING_TOKEN = tokenMetadata({ tokenType: StandardTokenType.String });
const COMMENT_TOKEN = tokenMetadata({ tokenType: StandardTokenType.Comment });
const CODE_TOKEN = tokenMetadata();

function makeEditor(lineContent: string, character: number, docText = lineContent, anchorChar = character): FakeEditor {
    const state: {
        line: string;
        lineNo: number;
        anchorChar: number;
        activeChar: number;
        tokens: TokenPairs | undefined;
    } = { line: lineContent, lineNo: 0, anchorChar, activeChar: character, tokens: undefined };
    // Model version: the provider request carries it instead of the text; typing bumps it.
    const document = { versionId: 1 };
    let anchorNull = false;
    let cursorCount = 1;
    const contentListeners: (() => void)[] = [];
    const cursorListeners: (() => void)[] = [];
    const typeListeners: ((text: string) => void)[] = [];
    const applyExternalEdits = vi.fn<(edits: ITextEdit[], label: string) => void>();

    const editor = {
        get viewState() {
            return {
                selections: Array.from({ length: cursorCount }, (_, i) => ({
                    anchor: { line: state.lineNo + i, character: state.anchorChar },
                    active: { line: state.lineNo + i, character: state.activeChar },
                })),
                document: { getLineContent: (_line: number) => state.line },
                tokenStore:
                    state.tokens === undefined
                        ? undefined
                        : {
                              tokenizeIfCheap: () => undefined,
                              getLineTokens: () =>
                                  state.tokens === undefined
                                      ? undefined
                                      : new LineTokens(
                                            storedTokens(state.tokens, state.line.length),
                                            state.line,
                                            LANGUAGE_ID_CODEC,
                                        ),
                          },
            };
        },
        getText: () => docText,
        model: { document },
        uri: Uri.file("/proj/.editorconfig"),
        languageId: "editorconfig",
        getCaretAnchor: () => (anchorNull ? null : { screenX: 5, screenY: 5, preferBelow: true }),
        applyExternalEdits,
        onDidChangeContent: (l: () => void) => {
            contentListeners.push(l);
            return { dispose: () => contentListeners.splice(contentListeners.indexOf(l), 1) };
        },
        onDidChangeCursorPosition: (l: () => void) => {
            cursorListeners.push(l);
            return { dispose: () => cursorListeners.splice(cursorListeners.indexOf(l), 1) };
        },
        onDidType: (l: (text: string) => void) => {
            typeListeners.push(l);
            return { dispose: () => typeListeners.splice(typeListeners.indexOf(l), 1) };
        },
    } as unknown as TextEditorPane;

    const fireContent = (): void => {
        for (const l of [...contentListeners]) l();
    };
    const fireCursor = (): void => {
        for (const l of [...cursorListeners]) l();
    };

    const fireTyped = (text: string): void => {
        for (const l of [...typeListeners]) l(text);
    };
    const edit = (line: string, ch: number, lineNo = 0): void => {
        state.line = line;
        state.lineNo = lineNo;
        state.anchorChar = ch;
        state.activeChar = ch;
        document.versionId++;
        fireContent();
        fireCursor();
    };

    return {
        editor,
        applyExternalEdits,
        type: (line, ch, lineNo = 0) => {
            edit(line, ch, lineNo);
            fireTyped(line.slice(ch - 1, ch));
        },
        edit,
        fireTyped,
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
        setAnchorNull: (value) => {
            anchorNull = value;
        },
        setTokens: (tokens) => {
            state.tokens = tokens;
        },
    };
}

function completionResult(items: readonly ICoreCompletionItem[], isIncomplete = false): ICoreCompletionResult {
    return { items, isIncomplete };
}

type FakeCompletionSource = CompletionItemProvider["provideCompletionItems"] | undefined;
type FakeCompletionResolver = ((id: string) => Promise<ICoreResolvedCompletion | null>) | undefined;

/**
 * Tests set the source, resolve and trigger characters on the group as they go; {@link createService} turns them
 * into a registry provider under `*`, like the extension proxy in production.
 */
interface IFakeLanguageSeams {
    completionSource?: FakeCompletionSource;
    completionResolver?: FakeCompletionResolver;
    completionTriggerCharacters?: readonly string[];
}

function languageFeaturesOf(group: IEditorService): LanguageFeaturesService {
    const seams = group as unknown as IFakeLanguageSeams;
    const languageFeatures = new LanguageFeaturesService();
    if (seams.completionSource === undefined && seams.completionResolver === undefined) return languageFeatures;
    languageFeatures.completionProvider.register("*", {
        get triggerCharacters() {
            return seams.completionTriggerCharacters ?? [];
        },
        provideCompletionItems: (request, token) =>
            seams.completionSource?.(request, token) ?? Promise.resolve(completionResult([])),
        get resolveCompletionItem() {
            return seams.completionResolver;
        },
    });
    return languageFeatures;
}

function makeGroup(
    editor: TextEditorPane,
    source: FakeCompletionSource,
    extraEditors: TextEditorPane[] = [],
): IEditorService {
    const all = [editor, ...extraEditors];
    return {
        getActiveEditor: () => editor,
        onActiveEditorChanged: () => ({ dispose: () => {} }),
        completionSource: source,
        completionTriggerCharacters: [],
        getEditors: () => all,
    } as unknown as IEditorService;
}

/** NULL_STATE_SERVICE always returns the default — no good for "the choice survives a restart". */
function makeStateService(): IStateService {
    const store = new Map<string, unknown>();
    return {
        get: <T>(descriptor: IStateDescriptor<T>): T =>
            (store.get(descriptor.key) as T | undefined) ?? descriptor.default,
        store: <T>(descriptor: IStateDescriptor<T>, value: T): void => {
            store.set(descriptor.key, value);
        },
        remove: () => undefined,
        openWorkspace: () => undefined,
        flushSync: () => undefined,
        dispose: () => undefined,
        onDidOpenWorkspace: Event.None,
    };
}

const APP_SCHEMAS = new ConfigurationRegistry(CONFIGURATION_CONTRIBUTIONS).getConfigurationProperties();

/** Live: the service reads them on every access, and a test may change them as it goes. */
type TestSettings = Record<string, unknown>;

const settingsOf = new WeakMap<CompletionService, TestSettings>();

/** A language section beats a flat key; off-schema and missing values give the schema default, like the real service. */
function makeConfiguration(settings: TestSettings): IConfigurationService {
    return {
        get: (key: string, overrides?: IConfigurationOverrides): unknown => {
            const section =
                overrides?.overrideIdentifier === undefined
                    ? undefined
                    : (settings[`[${overrides.overrideIdentifier}]`] as TestSettings | undefined);
            const raw = section?.[key] ?? settings[key];
            const schema = APP_SCHEMAS.get(key);
            if (schema === undefined) return raw;
            return raw !== undefined && isValidConfigurationValue(schema, raw) ? raw : schema.default;
        },
    } as unknown as IConfigurationService;
}

function setSetting(service: CompletionService, key: string, value: unknown): void {
    const settings = settingsOf.get(service);
    if (settings === undefined) throw new Error("service created bypassing createService");
    settings[key] = value;
}

/** Quick suggest delay is 0: auto suggest fires deterministically on the next tick. */
function newService(
    component: SuggestComponent,
    group: IEditorService,
    commands: CommandRegistry,
    state: IStateService,
    focusTracker: FocusTracker,
    languageFeatures: LanguageFeaturesService,
    initial: TestSettings = {},
): CompletionService {
    const settings: TestSettings = { "editor.quickSuggestionsDelay": 0, ...initial };
    const service = new CompletionService(
        component,
        group,
        commands,
        state,
        focusTracker,
        languageFeatures,
        makeConfiguration(settings),
    );
    settingsOf.set(service, settings);
    return service;
}

function createService(
    group: IEditorService,
    state: IStateService = makeStateService(),
    settings: TestSettings = {},
    languageFeatures: LanguageFeaturesService = languageFeaturesOf(group),
): {
    service: CompletionService;
    component: SuggestComponent;
    body: BodyElement;
    execute: ReturnType<typeof vi.fn>;
    focusTracker: FocusTracker;
} {
    const execute = vi.fn();
    const commands = { execute } as unknown as CommandRegistry;
    const body = new BodyElement();
    const component = new SuggestComponent(testLayoutService(body));
    const focusTracker = new FocusTracker();
    const service = newService(component, group, commands, state, focusTracker, languageFeatures, settings);
    return { service, component, body, execute, focusTracker };
}

function setup(items: readonly ICoreCompletionItem[], lineContent = "ind", character = 3, docText = lineContent) {
    const fake = makeEditor(lineContent, character, docText);
    const source = vi.fn(() => Promise.resolve(completionResult(items)));
    const group = makeGroup(fake.editor, source);

    const { service, component, execute, focusTracker, body } = createService(group);
    const testApp = TestApp.create(body, new Size(80, 24));
    return { service, component, body, testApp, fake, source, execute, focusTracker, editor: fake.editor };
}

function flushTimers(): Promise<void> {
    return new Promise((res) => setTimeout(res, 5));
}

const ITEMS: ICoreCompletionItem[] = [
    {
        label: "indent_style",
        insertText: "indent_style",
        kind: 9,
        detail: "EditorConfig",
        command: { command: "ec._retrigger", arguments: [] },
    },
    { label: "indent_size", insertText: "indent_size", kind: 9 },
    { label: "root", insertText: "root" },
];

describe("CompletionService", () => {
    it("no source and an empty document → trigger is a no-op (popup hidden)", async () => {
        const fake = makeEditor("", 0);
        const { service, component, body } = createService(makeGroup(fake.editor, undefined));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("an empty provider response → the popup does not open", async () => {
        const { service, body } = setup([]);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("opens the popup and filters by the prefix at the cursor without taking focus", async () => {
        const { service, component, body } = setup(ITEMS);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        expect(service.isOpen()).toBe(true);
        expect(component.view.isFocused).toBe(false);
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
    });

    it("the prefix is the word at the cursor, not the whole line before it", async () => {
        const { service, component, fake } = setup(ITEMS, "x = ind", 7);
        await service.trigger();
        // A filter over the whole line `x = ind` would find nothing and fall back to the full list with `root`.
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);

        service.acceptSelected();
        const [edits] = fake.applyExternalEdits.mock.calls[0];
        expect(edits[0].range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 7 } });
    });

    it("onDidClose fires when an OPEN popup closes and stays silent on idle close calls", async () => {
        const { service } = setup(ITEMS);
        const closed = vi.fn();
        const subscription = service.onDidClose(closed);

        service.close();
        expect(closed).not.toHaveBeenCalled();

        await service.trigger();
        expect(service.isOpen()).toBe(true);
        service.hide(); // the Esc path converges on close()
        expect(closed).toHaveBeenCalledTimes(1);

        service.close();
        expect(closed).toHaveBeenCalledTimes(1);

        // A repeated dispose must not affect other subscribers (splice(-1) would remove the last one).
        const other = vi.fn();
        service.onDidClose(other);
        await service.trigger();
        subscription.dispose();
        subscription.dispose();
        service.close();
        expect(closed).toHaveBeenCalledTimes(1);
        expect(other).toHaveBeenCalledTimes(1);
    });

    it("passes a correct request to the source: the document version instead of the text", async () => {
        const { service, source, fake } = setup(ITEMS);
        fake.type("ind", 3); // version 2: the request takes the current one, not the initial one
        service.close();
        source.mockClear();
        await service.trigger();
        expect(source).toHaveBeenCalledWith(
            {
                uri: Uri.file("/proj/.editorconfig").toString(),
                languageId: "editorconfig",
                versionId: 2,
                line: 0,
                character: 3,
                triggerKind: CompletionTriggerKind.Invoke,
            },
            expect.anything(),
        );
    });

    describe("details pane", () => {
        const RESOLVABLE: ICoreCompletionItem[] = [
            { label: "indent_style", insertText: "indent_style", id: "1.0", kind: 9 },
            { label: "indent_size", insertText: "indent_size", id: "1.1", kind: 9 },
        ];

        function setupWithResolver(
            resolver: FakeCompletionResolver,
            state = makeStateService(),
        ): ReturnType<typeof createService> & { fake: FakeEditor; body: BodyElement } {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            (group as unknown as IFakeLanguageSeams).completionResolver = resolver;
            const created = createService(group, state);
            const body = created.body;
            TestApp.create(body, new Size(120, 24));
            return { ...created, fake, body };
        }

        it("hidden by default and details are not requested", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "(property) indent_style" }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();

            expect(component.detailsVisible).toBe(false);
            expect(resolver).not.toHaveBeenCalled();
            expect(component.widget.showsDetails).toBe(false);
        });

        it("the toggle expands the pane and loads details of the selected item", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "(property) indent_style" }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(component.detailsVisible).toBe(true);
            expect(resolver).toHaveBeenCalledWith("1.0");
            expect(component.widget.showsDetails).toBe(true);
            expect(component.details.linesFor(40).join(" ")).toContain("(property) indent_style");
        });

        it("moving through the list shows details of the new item", async () => {
            const resolver = vi.fn((id: string) => Promise.resolve({ detail: `detail for ${id}` }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            await flushTimers();

            expect(resolver).toHaveBeenCalledWith("1.1");
            expect(component.details.linesFor(40).join(" ")).toContain("detail for 1.1");
        });

        it("the toggle state survives service re-creation", async () => {
            const state = makeStateService();
            const first = setupWithResolver(
                vi.fn(() => Promise.resolve(null)),
                state,
            );
            await first.service.trigger();
            first.service.toggleDetails();
            expect(first.component.detailsVisible).toBe(true);

            const second = setupWithResolver(
                vi.fn(() => Promise.resolve(null)),
                state,
            );
            expect(second.component.detailsVisible).toBe(true);
        });

        it("at the screen edge the pane moves to the left of the list", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            (group as unknown as IFakeLanguageSeams).completionResolver = () =>
                Promise.resolve({ detail: "(property) indent_style" });
            const { service, component, body } = createService(group);
            // Narrow screen: the widget with the panel doesn't fit right of the cursor (screenX=5).
            TestApp.create(body, new Size(30, 24));

            service.toggleDetails();
            await service.trigger();
            await flushTimers();

            expect(component.widget.detailsSide).toBe("left");
        });

        it("with zero root width the pane side is not recomputed", () => {
            const fake = makeEditor("ind", 3, "ind");
            const { component, body } = createService(makeGroup(fake.editor, undefined));
            // The root is laid out with width 0: "doesn't fit on the right" would be true
            // for any anchor, but the panel must not be flipped by such a width.
            body.layout(BoxConstraints.tight(new Size(0, 24)));
            component.openAt({ screenX: 5, screenY: 5, preferBelow: true });
            expect(component.widget.detailsSide).toBe("right");
        });

        it("an empty selection clears the pane", async () => {
            const { service, component } = setupWithResolver(() => Promise.resolve({ detail: "d" }));
            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            expect(component.details.isEmpty).toBe(false);

            component.view.setFilter("zzzz");
            expect(component.details.isEmpty).toBe(true);
        });

        it("revisiting an item takes details from the cache, parallel requests are merged", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "cached" }));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            await flushTimers();
            service.selectPrevious(); // back to the first one — already cached
            await flushTimers();

            expect(resolver).toHaveBeenCalledTimes(2);
        });

        it("a source without a resolver does not break the pane", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(RESOLVABLE))),
            );
            const { service, component, body } = createService(group); // completionResolver not set
            TestApp.create(body, new Size(120, 24));

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(component.widget.showsDetails).toBe(false);
        });

        it("the signature from labelDetail is shown, empty documentation is ignored", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const items: ICoreCompletionItem[] = [
                { label: "indent_style", insertText: "indent_style", labelDetail: "(property)", documentation: "" },
            ];
            const { service, component, body } = createService(
                makeGroup(
                    fake.editor,
                    vi.fn(() => Promise.resolve(completionResult(items))),
                ),
            );
            TestApp.create(body, new Size(120, 24));

            service.toggleDetails();
            await service.trigger();

            // An item with no id and no resolver: the description comes from the item itself.
            expect(component.details.linesFor(40).join(" ")).toContain("(property)");
            expect(component.details.linesFor(40).join(" ")).not.toContain("undefined");
        });

        it("accept with already loaded details takes edits from the cache, without another resolve", async () => {
            const resolver = vi.fn(() =>
                Promise.resolve({
                    detail: "(property) indent_style",
                    additionalEdits: [
                        {
                            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                            text: "# header\n",
                        },
                    ],
                }),
            );
            const { service, component, fake } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers(); // the description loaded and went into the cache

            service.acceptSelected();
            await flushTimers();

            expect(resolver).toHaveBeenCalledTimes(1);
            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(2);
            expect(edits[1].text).toBe("# header\n");
            expect(component.detailsVisible).toBe(true);
        });

        it("the resolver returned null — nothing is cached and the pane is empty", async () => {
            const resolver = vi.fn(() => Promise.resolve(null));
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            service.selectPrevious();
            await flushTimers();

            // Each display of the item tries to resolve again (only success is cached).
            expect(resolver.mock.calls.length).toBeGreaterThan(1);
            expect(component.details.isEmpty).toBe(true);
        });

        it("a failing resolver does not crash the popup", async () => {
            const { service, component } = setupWithResolver(() => Promise.reject(new Error("boom")));

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(service.isOpen()).toBe(true);
            expect(component.details.isEmpty).toBe(true);
        });

        it("moved to another item while details were loading — the stale details are not shown", async () => {
            let release: ((value: { detail: string }) => void) | null = null;
            const resolver = vi.fn((id: string) =>
                id === "1.0"
                    ? new Promise<{ detail: string }>((res) => {
                          release = res;
                      })
                    : Promise.resolve({ detail: "detail for 1.1" }),
            );
            const { service, component } = setupWithResolver(resolver);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.selectNext();
            await flushTimers();
            expect(component.details.linesFor(40).join(" ")).toContain("detail for 1.1");

            release!({ detail: "detail for 1.0" });
            await flushTimers();

            expect(component.details.linesFor(40).join(" ")).toContain("detail for 1.1");
        });

        it("documentation from the item itself is shown without a resolver", async () => {
            const fake = makeEditor("ind", 3, "ind");
            const items: ICoreCompletionItem[] = [
                {
                    label: "indent_style",
                    insertText: "indent_style",
                    detail: "EditorConfig",
                    documentation: "Indentation: tab or space.",
                },
            ];
            const { service, component, body } = createService(
                makeGroup(
                    fake.editor,
                    vi.fn(() => Promise.resolve(completionResult(items))),
                ),
            );
            TestApp.create(body, new Size(120, 24));

            service.toggleDetails();
            await service.trigger();

            const text = component.details.linesFor(40).join(" ");
            expect(text).toContain("EditorConfig");
            expect(text).toContain("Indentation");
        });

        it("no details — the pane is not shown even with the toggle on", async () => {
            const { service, component } = setupWithResolver(vi.fn(() => Promise.resolve(null)));

            await service.trigger();
            service.toggleDetails();
            await flushTimers();

            expect(component.detailsVisible).toBe(true);
            expect(component.widget.showsDetails).toBe(false);
        });
    });

    describe("insertion with additional edits (auto-import)", () => {
        const IMPORTABLE: ICoreCompletionItem[] = [{ label: "greet", insertText: "greet", id: "1.0", kind: 2 }];
        const IMPORT_EDIT: ITextEdit = {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            text: 'import { greet } from "./defs";\n',
        };

        function setupImportable(
            resolver: FakeCompletionResolver,
            items: readonly ICoreCompletionItem[] = IMPORTABLE,
        ): {
            service: CompletionService;
            fake: FakeEditor;
        } {
            const fake = makeEditor("gree", 4, "gree");
            const group = makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(items))),
            );
            (group as unknown as IFakeLanguageSeams).completionResolver = resolver;
            const { service, component, body } = createService(group);
            TestApp.create(body, new Size(120, 24));
            return { service, fake };
        }

        it("accept waits for resolve and applies the import in one transaction with the insertion", async () => {
            const { service, fake } = setupImportable(() =>
                Promise.resolve({ detail: "greet", additionalEdits: [IMPORT_EDIT] }),
            );

            await service.trigger();
            service.acceptSelected();
            await flushTimers();

            // The details panel is hidden (default): no resolve before accept, the insertion waits for it itself.
            expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
            const [edits, label] = fake.applyExternalEdits.mock.calls[0];
            expect(label).toBe("Accept Completion");
            expect(edits).toHaveLength(2);
            expect(edits[1].text).toContain("import { greet }");
        });

        it("a provider without resolve — inserts right away, without waiting", async () => {
            const { service, fake } = setupImportable(undefined);

            await service.trigger();
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(1);
            expect(edits[0].text).toBe("greet");
        });

        it("an item without an id calls resolve neither on selection nor on insertion", async () => {
            const resolver = vi.fn(() => Promise.resolve({ detail: "greet", additionalEdits: [IMPORT_EDIT] }));
            const { service, fake } = setupImportable(resolver, [{ label: "greet", insertText: "greet", kind: 2 }]);

            await service.trigger();
            service.toggleDetails();
            await flushTimers();
            service.acceptSelected();
            await flushTimers();

            expect(resolver).not.toHaveBeenCalled();
            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(1);
        });

        it("a silent resolve does not block insertion", async () => {
            const { service, fake } = setupImportable(() => new Promise(() => {}));

            await service.trigger();
            service.acceptSelected();
            await new Promise((res) => setTimeout(res, 350)); // longer than ACCEPT_RESOLVE_TIMEOUT_MS

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits).toHaveLength(1);
            expect(edits[0].text).toBe("greet");
        });
    });

    it("typing a source trigger character opens the popup as TriggerCharacter", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));

        fake.type("d.", 2);
        await flushTimers();

        expect(source).toHaveBeenCalledWith(
            expect.objectContaining({
                triggerKind: CompletionTriggerKind.TriggerCharacter,
                triggerCharacter: ".",
            }),
            expect.anything(),
        );
        expect(service.isOpen()).toBe(true);
    });

    it("a trigger character of another language's provider neither opens the popup nor triggers an RPC", async () => {
        const fake = makeEditor("d", 1, "d"); // an editorconfig document
        const provide = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const languageFeatures = new LanguageFeaturesService();
        languageFeatures.completionProvider.register("python", {
            triggerCharacters: ["."],
            provideCompletionItems: provide,
        });
        const group = makeGroup(fake.editor, undefined);
        const body = new BodyElement();
        const component = new SuggestComponent(testLayoutService(body));
        const commands = { execute: vi.fn() } as unknown as CommandRegistry;
        const service = newService(
            component,
            group,
            commands,
            makeStateService(),
            new FocusTracker(),
            languageFeatures,
        );
        TestApp.create(body, new Size(80, 24));

        fake.type("d.", 2);
        await flushTimers();

        expect(provide).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("only a single insertion of the character counts as a trigger character", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));

        // Pasting a block (not typing) is not a trigger, even though it ends with `.`.
        fake.edit("d.foo.", 6);
        await flushTimers();
        expect(service.isOpen()).toBe(false);

        // A single character, but not from the trigger list and not a word character.
        fake.type("d.foo.)", 7);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
        expect(source).not.toHaveBeenCalled();
    });

    it("diverging provider ranges → the core computes the prefix", async () => {
        const items: ICoreCompletionItem[] = [
            {
                label: "indent_style",
                insertText: "indent_style",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            },
            {
                label: "indent_size",
                insertText: "indent_size",
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 3 } },
            },
        ];
        const { service, component, fake } = setup(items);
        await service.trigger();

        expect(service.isOpen()).toBe(true);
        service.acceptSelected();
        const [edits] = fake.applyExternalEdits.mock.calls[0];
        // The range comes from the item itself (it is set), and the prefix from wordStart.
        expect(edits[0].range.start).toEqual({ line: 0, character: 0 });
        expect(component.view.items).toHaveLength(2);
    });

    it("server filterText/sortText and a shared range reach the widget", async () => {
        // The tsserver response shape after a dot: a common range for all items, the label
        // without the dot, filtering and sorting by their own fields.
        const items: ICoreCompletionItem[] = [
            {
                label: "toISOString",
                insertText: ".toISOString",
                filterText: ".toISOString",
                sortText: "11",
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
            },
            {
                label: "getTime",
                insertText: ".getTime",
                filterText: ".getTime",
                sortText: "11",
                range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } },
            },
        ];
        const { service, component } = setup(items, "d.", 2, "d.");
        await service.trigger();

        expect(component.view.items[0].filterText).toBe(".toISOString");
        expect(component.view.items[0].sortText).toBe("11");
        // With equal sortText the server order stays.
        expect(component.view.items.map((i) => i.label)).toEqual(["toISOString", "getTime"]);
    });

    it("a trigger character with the popup open reopens the list, cancelling the pending request", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, component, body } = createService(group);
        setSetting(service, "editor.quickSuggestionsDelay", 5);
        TestApp.create(body, new Size(80, 24));

        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.type("di", 2); // auto suggest scheduled…
        fake.type("di.", 3); // …and a trigger character typed right away
        await flushTimers();

        expect(source).toHaveBeenLastCalledWith(
            expect.objectContaining({ triggerKind: CompletionTriggerKind.TriggerCharacter, triggerCharacter: "." }),
            expect.anything(),
        );
    });

    it("an explicit Ctrl+Space cancels an already scheduled auto request", async () => {
        const { service, source, fake } = setup(ITEMS);
        setSetting(service, "editor.quickSuggestionsDelay", 50); // enough time to cancel

        fake.type("inde", 4);
        await service.trigger();
        // Wait well past the delay: without cancellation the pending one would have fired.
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(source).toHaveBeenCalledTimes(1);
    });

    it("a provider range starting AFTER the cursor leaves the prefix to the core", async () => {
        const items: ICoreCompletionItem[] = [
            {
                label: "indent_style",
                insertText: "indent_style",
                range: { start: { line: 0, character: 5 }, end: { line: 0, character: 7 } },
            },
        ];
        const { service, component } = setup(items);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        expect(component.view.items).toHaveLength(1);
    });

    it("an incomplete list is re-requested on further typing instead of being narrowed locally", async () => {
        const fake = makeEditor("ind", 3, "ind");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS, true)));
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        await service.trigger();
        expect(source).toHaveBeenCalledTimes(1);

        fake.type("inde", 4);
        await flushTimers();

        expect(source).toHaveBeenCalledTimes(2);
    });

    it("a stale source response does not override a fresh one", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let resolveSlow: ((value: ICoreCompletionResult) => void) | null = null;
        const source = vi
            .fn<() => Promise<ICoreCompletionResult>>()
            .mockImplementationOnce(
                () =>
                    new Promise<ICoreCompletionResult>((res) => {
                        resolveSlow = res;
                    }),
            )
            .mockImplementation(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        const slow = service.trigger();
        await service.trigger(); // the fresh request overtakes the slow one
        expect(service.isOpen()).toBe(true);

        service.hide();
        resolveSlow!(completionResult(ITEMS));
        await slow;

        expect(service.isOpen()).toBe(false);
    });

    it("a response arriving after close does not bring the popup up", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let resolveSlow: ((value: ICoreCompletionResult) => void) | null = null;
        const source = vi.fn<() => Promise<ICoreCompletionResult>>(
            () =>
                new Promise<ICoreCompletionResult>((res) => {
                    resolveSlow = res;
                }),
        );
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        const pending = service.trigger();
        // The request is in flight, the popup not open yet — closing cancels the request itself.
        service.close();
        resolveSlow!(completionResult(ITEMS));
        await pending;

        expect(service.isOpen()).toBe(false);
    });

    it("closing the popup cancels the request at the provider too", () => {
        const fake = makeEditor("ind", 3, "ind");
        const tokens: ICancellationToken[] = [];
        const source = vi.fn((_request: ICompletionRequest, token: ICancellationToken) => {
            tokens.push(token);
            return new Promise<ICoreCompletionResult>(() => undefined);
        });
        const { service, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));

        void service.trigger();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        service.close();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    // No response deadline (an LS on a cold start takes seconds): an in-flight request itself knows whether its answer is needed.
    describe("request in flight: no response yet, popup not open", () => {
        /** Request tokens are in `cancelled()`. */
        function pendingSetup(line: string, character: number) {
            const fake = makeEditor(line, character, line);
            const tokens: ICancellationToken[] = [];
            const answers: ((value: ICoreCompletionResult) => void)[] = [];
            const source = vi.fn((_request: ICompletionRequest, token: ICancellationToken) => {
                tokens.push(token);
                return new Promise<ICoreCompletionResult>((res) => {
                    answers.push(res);
                });
            });
            const group = makeGroup(fake.editor, source);
            const { service, component, body, focusTracker } = createService(group);
            // Re-requesting on typing isn't needed in these tests: we watch the fate of the FIRST request.
            setSetting(service, "editor.quickSuggestionsDelay", 10_000);
            TestApp.create(body, new Size(80, 24));
            const cancelled = (): boolean[] => tokens.map((token) => token.isCancellationRequested);
            return { fake, service, component, focusTracker, group, source, answers, cancelled };
        }

        it("a slow response is awaited and opens the popup with provider items, not buffer words", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            // However long the server thinks, no popup of buffer words appears instead.
            await new Promise((resolve) => setTimeout(resolve, 30));
            expect(h.service.isOpen()).toBe(false);
            expect(h.cancelled()).toEqual([false]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        });

        it("the cursor moved to another line — the request is cancelled, a late response does not bring the popup up", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.move(1, 3);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("a cursor step left of the request position cancels the request", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.move(0, 2);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("a selection and multiple cursors cancel the request", () => {
            const selected = pendingSetup("ind", 3);
            void selected.service.trigger();
            selected.fake.setSelection(1, 3);
            expect(selected.cancelled()).toEqual([true]);

            const multi = pendingSetup("ind", 3);
            void multi.service.trigger();
            multi.fake.setCursorCount(2);
            expect(multi.cancelled()).toEqual([true]);
        });

        it("typing a non-word character (space) cancels the request", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.type("ind ", 4);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("a cursor event without movement leaves the request alone", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.move(0, 3);
            expect(h.cancelled()).toEqual([false]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(true);
        });

        it("typing more of the word while awaiting the response: the list is narrowed to the typed text, accept replaces the whole word", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.fake.type("inden", 5); // word typing keeps the request alive
            expect(h.cancelled()).toEqual([false]);

            h.answers[0](completionResult([...ITEMS, { label: "index", insertText: "index" }]));
            await pending;

            // The filter uses the live prefix `inden`, not the request-time snapshot `ind`.
            expect(h.component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
            h.service.acceptSelected();
            const [edits] = h.fake.applyExternalEdits.mock.calls[0];
            // The snapshot would leave the tail `en` in the buffer.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 5 } });
        });

        // The gopls response shape via vscode-go: an incomplete list, all with the first item's `filterText`, an empty
        // `range` right after the dot — the server filters.
        const goMember = (label: string): ICoreCompletionItem => ({
            label,
            insertText: label,
            filterText: "Builder",
            range: { start: { line: 0, character: 8 }, end: { line: 0, character: 8 } },
        });

        it("an incomplete response for a stale prefix is re-requested for the typed text right away", async () => {
            const h = pendingSetup("strings", 7);
            (h.group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
            h.fake.type("strings.", 8);
            await flushTimers();
            expect(h.source).toHaveBeenCalledTimes(1);
            // While the server thinks over `strings.`, the user keeps typing `ToL`.
            h.fake.type("strings.T", 9);
            h.fake.type("strings.To", 10);
            h.fake.type("strings.ToL", 11);

            h.answers[0](completionResult(["Builder", "Clone", "Compare", "ToLower"].map(goMember), true));
            await flushTimers();
            // The whole package is not shown under `ToL` — a re-request went out from the current cursor.
            expect(h.service.isOpen()).toBe(false);
            expect(h.source).toHaveBeenCalledTimes(2);
            expect(h.source.mock.calls[1][0]).toMatchObject({
                character: 11,
                triggerKind: CompletionTriggerKind.Invoke,
            });

            h.answers[1](
                completionResult(
                    ["ToLower", "ToLowerSpecial"].map((label) => ({
                        ...goMember(label),
                        filterText: "ToLower",
                    })),
                    true,
                ),
            );
            await flushTimers();
            expect(h.component.view.items.map((i) => i.label)).toEqual(["ToLower", "ToLowerSpecial"]);
            // A response for the current prefix — no more re-requests.
            expect(h.source).toHaveBeenCalledTimes(2);
        });

        it("an incomplete response without further typing and a complete one with it are not re-requested", async () => {
            const unmoved = pendingSetup("ind", 3);
            const pending = unmoved.service.trigger();
            unmoved.answers[0](completionResult(ITEMS, true));
            await pending;
            await flushTimers();
            expect(unmoved.source).toHaveBeenCalledTimes(1);
            expect(unmoved.service.isOpen()).toBe(true);

            const complete = pendingSetup("ind", 3);
            const done = complete.service.trigger();
            complete.fake.type("inde", 4);
            complete.answers[0](completionResult(ITEMS));
            await done;
            await flushTimers();
            expect(complete.source).toHaveBeenCalledTimes(1);
            expect(complete.component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        });

        it("further typing with a provider range: the range end catches up with the cursor from the REQUEST position", async () => {
            const h = pendingSetup('{ "e', 4);
            const pending = h.service.trigger();
            h.fake.type('{ "edi', 6);

            h.answers[0](
                completionResult([
                    {
                        label: "editor.tabSize",
                        insertText: '"editor.tabSize"',
                        filterText: '"editor.tabSize"',
                        range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
                    },
                ]),
            );
            await pending;
            expect(h.service.isOpen()).toBe(true);

            h.service.acceptSelected();
            const [edits] = h.fake.applyExternalEdits.mock.calls[0];
            // The provider saw `"e` (range [2,4)); two characters typed since shift the end by 2.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 6 } });
        });

        it("losing editor focus cancels the request", async () => {
            const h = pendingSetup("ind", 3);
            const pending = h.service.trigger();
            h.focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
            expect(h.cancelled()).toEqual([false]);
            h.focusTracker.fire(null);
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });

        it("a trigger character cancels the previous word's request: its response does not bring up the old list", async () => {
            const h = pendingSetup("re", 2);
            (h.group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
            const pending = h.service.trigger();
            h.fake.type("re.", 3); // "." is a core word character, but for the server it's a new request
            expect(h.cancelled()).toEqual([true]);

            h.answers[0](completionResult(ITEMS));
            await pending;
            expect(h.service.isOpen()).toBe(false);
        });
    });

    it("accept inserts the item replacing the prefix and runs item.command via CommandRegistry", async () => {
        const { service, fake, execute } = setup(ITEMS);
        await service.trigger();
        service.acceptSelected(); // accepts the selected one (indent_style)

        expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
        const [edits, label] = fake.applyExternalEdits.mock.calls[0];
        expect(label).toBe("Accept Completion");
        expect(edits).toHaveLength(1);
        expect(edits[0].text).toBe("indent_style");
        expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } });

        await Promise.resolve();
        expect(execute).toHaveBeenCalledWith("ec._retrigger");
    });

    it("if the prefix filtered out everything, the full list is shown", async () => {
        const { service, component } = setup(ITEMS, "zzz", 3);
        await service.trigger();
        expect(component.view.items).toHaveLength(3);
    });

    // The provider range (diode-settings covers quotes with it) is a snapshot at trigger time, and the popup
    // doesn't re-request on typing: the range end must catch up with the cursor.
    describe("provider range", () => {
        /** An item with an explicit range over `"e` (quote + first letter) in the line `{ "e`. */
        const QUOTED: ICoreCompletionItem[] = [
            {
                label: "editor.tabSize",
                insertText: '"editor.tabSize"',
                kind: 9,
                range: { start: { line: 0, character: 2 }, end: { line: 0, character: 4 } },
            },
        ];

        it("respects the provider range when nothing was typed after the trigger", async () => {
            const { service, fake } = setup(QUOTED, '{ "e', 4);
            await service.trigger();
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].text).toBe('"editor.tabSize"');
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 4 } });
        });

        it("moves the range end to the cursor when characters were typed after the trigger", async () => {
            const { service, fake } = setup(QUOTED, '{ "e', 4);
            await service.trigger();
            expect(service.isOpen()).toBe(true);

            // Typed `di`: the popup only refilters, the provider range still points at `"e`.
            fake.type('{ "edi', 6);
            expect(service.isOpen()).toBe(true);

            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].text).toBe('"editor.tabSize"');
            // Without the shift only [2,4) would be replaced, leaving the tail `di` in the buffer.
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 6 } });
        });

        it("moves the range end back when a character after the trigger is deleted", async () => {
            const { service, fake } = setup(QUOTED, '{ "e', 4);
            await service.trigger();

            // Backspace → `{ "`. The cursor is at the prefix boundary, the popup stays open.
            fake.edit('{ "', 3);
            expect(service.isOpen()).toBe(true);

            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 0, character: 3 } });
        });

        it("a multi-line provider range is taken as is (per-character shift does not apply)", async () => {
            const multiline: ICoreCompletionItem[] = [
                {
                    label: "editor.tabSize",
                    insertText: '"editor.tabSize"',
                    range: { start: { line: 0, character: 2 }, end: { line: 1, character: 4 } },
                },
            ];
            const { service, fake } = setup(multiline, '{ "e', 4);
            await service.trigger();
            fake.type('{ "edi', 6);
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].range).toEqual({ start: { line: 0, character: 2 }, end: { line: 1, character: 4 } });
        });

        it("without a provider range replaces the live prefix", async () => {
            const { service, fake } = setup(ITEMS, "ind", 3);
            await service.trigger();
            fake.type("inde", 4);
            service.acceptSelected();

            const [edits] = fake.applyExternalEdits.mock.calls[0];
            expect(edits[0].range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 4 } });
        });
    });

    // While the popup is visible, Enter belongs to `acceptSelectedSuggestion`: a popup open "just in case"
    // steals the newline — with a provider prefix boundary too.
    describe("typing a non-word character closes the popup", () => {
        /** tsserver-shaped items: all share a range, i.e. the boundary is "from the provider". */
        const PROVIDER_ANCHORED: ICoreCompletionItem[] = [
            {
                label: "console",
                insertText: "console",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
            {
                label: "const",
                insertText: "const",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } },
            },
        ];

        it("`{` after a provider prefix closes the popup (Enter types again)", async () => {
            const { service, fake } = setup(PROVIDER_ANCHORED, "cons", 4, "cons");
            await service.trigger();
            expect(service.isOpen()).toBe(true);

            fake.type("cons{", 5);

            expect(service.isOpen()).toBe(false);
        });

        it("the same typing with letters leaves the popup alone", async () => {
            const { service, fake } = setup(PROVIDER_ANCHORED, "cons", 4, "cons");
            await service.trigger();

            fake.type("conso", 5);

            expect(service.isOpen()).toBe(true);
        });

        it("`(` and space close it the same way", async () => {
            for (const tail of ["(", " "]) {
                const { service, fake } = setup(PROVIDER_ANCHORED, "cons", 4, "cons");
                await service.trigger();
                expect(service.isOpen()).toBe(true);

                fake.type(`cons${tail}`, 5);

                expect(service.isOpen()).toBe(false);
            }
        });
    });

    it("word-based: without a source suggests words from the document", async () => {
        const fake = makeEditor("ind", 3, "indent_style indent_size root ab");
        const { service, component, body } = createService(makeGroup(fake.editor, undefined));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        expect(component.view.items[0].kind).toBe(0);
    });

    it("word-based: words are not mixed into items with a provider range", async () => {
        const items: ICoreCompletionItem[] = [
            {
                label: "indent_style",
                insertText: "indent_style",
                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
            },
        ];
        const { service, component } = setup(items, "ind", 3, "ind indigo");
        await service.trigger();
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style"]);
    });

    it("word-based: collects words from all open editors and dedupes against providers", async () => {
        const fake = makeEditor("", 0, "alpha beta");
        const other = makeEditor("", 0, "beta gamma indent_style");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component, body } = createService(makeGroup(fake.editor, source, [other.editor]));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();

        const labels = component.view.items.map((i) => i.label);
        expect(labels).toEqual(["indent_style", "indent_size", "root", "alpha", "beta", "gamma"]);
    });

    it("no active editor → no-op", async () => {
        const group = {
            getActiveEditor: () => null,
            onActiveEditorChanged: () => ({ dispose: () => {} }),
            completionTriggerCharacters: [],
        } as unknown as IEditorService;
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("hide() closes the popup", async () => {
        const { service, body } = setup(ITEMS);
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(true);
        service.hide();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
        expect(service.isOpen()).toBe(false);
    });

    it("cursor outside the viewport (anchor null) → the popup does not open", async () => {
        const fake = makeEditor("ind", 3, "ind");
        fake.setAnchorNull(true);
        const { service, component, body } = createService(
            makeGroup(
                fake.editor,
                vi.fn(() => Promise.resolve(completionResult(ITEMS))),
            ),
        );
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(body.overlayLayer.hasVisibleItems()).toBe(false);
    });

    it("an untitled buffer goes into the request as an untitled: resource, not an empty string", async () => {
        const fake = makeEditor("ind", 3, "ind");
        (fake.editor as unknown as { uri: Uri }).uri = Uri.parse("untitled:Untitled-1");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const { service, component, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(source).toHaveBeenCalledWith(expect.objectContaining({ uri: "untitled:Untitled-1" }), expect.anything());
    });

    it("accept without an active editor (after close) is a no-op", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        service.close(); // activeEditor = null, but the view keeps the list
        service.acceptSelected();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("accepting an item without a command does not call CommandRegistry", async () => {
        const { service, fake, execute } = setup(ITEMS, "", 0, "");
        await service.trigger();
        service.selectNext();
        service.selectNext(); // to "root" (no command)
        service.acceptSelected();
        expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
        await Promise.resolve();
        expect(execute).not.toHaveBeenCalled();
    });

    it("item.command without arguments runs with an empty argument list", async () => {
        const items: ICoreCompletionItem[] = [{ label: "only", insertText: "only", command: { command: "c.noargs" } }];
        const { service, execute } = setup(items, "", 0, "");
        await service.trigger();
        service.acceptSelected();
        await Promise.resolve();
        expect(execute).toHaveBeenCalledWith("c.noargs");
    });

    it("typing narrows the list and the popup follows the cursor", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        expect(component.view.items).toHaveLength(2);
        fake.type("indent_st", 9);
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style"]);
        expect(service.isOpen()).toBe(true);
    });

    it("typing with no matches keeps the last non-empty list (does not close)", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        fake.type("indq", 4);
        expect(component.view.items.map((i) => i.label)).toEqual(["indent_style", "indent_size"]);
        expect(service.isOpen()).toBe(true);
    });

    it("changing the line closes the popup", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.move(1, 0);
        expect(service.isOpen()).toBe(false);
    });

    it("a non-empty selection closes the popup", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.setSelection(1, 3);
        expect(service.isOpen()).toBe(false);
    });

    it("multiple cursors close the popup and prevent reopening it", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.setCursorCount(2);
        expect(service.isOpen()).toBe(false);

        await service.trigger();
        expect(service.isOpen()).toBe(false);
    });

    it("the cursor leaving the viewport while typing closes the popup", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.setAnchorNull(true);
        fake.type("indent", 6);
        expect(service.isOpen()).toBe(false);
    });

    it("typing a word character auto-opens the popup", async () => {
        const { service, fake, source } = setup(ITEMS); // start: "ind", cursor 3
        expect(service.isOpen()).toBe(false);
        fake.type("inde", 4); // one word character inserted
        await flushTimers();
        expect(source).toHaveBeenCalled();
        expect(service.isOpen()).toBe(true);
    });

    it("cursor movement with the popup closed does not cancel a scheduled auto request", async () => {
        const { service, fake, source } = setup(ITEMS);
        setSetting(service, "editor.quickSuggestionsDelay", 20);
        fake.type("inde", 4); // auto suggest scheduled
        fake.move(0, 4); // the cursor moved before the timer fired
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(source).toHaveBeenCalled();
    });

    it("pure cursor movement does NOT open the popup", async () => {
        const { service, fake, source } = setup(ITEMS);
        fake.move(0, 2); // no content change
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("accepting an item does not cause an auto reopen", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        service.acceptSelected(); // close() + applyExternalEdits (mock, no emit)
        // The accept edit is not typing: it has no `onDidType` event, auto suggest stays silent.
        fake.edit("indent_style2", 13);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
    });

    it("losing editor focus closes an open popup, focus in the editor does not", async () => {
        const { service, focusTracker } = setup(ITEMS);
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        focusTracker.fire(new EditorElement(new EditorViewState(new TextDocument(""))));
        expect(service.isOpen()).toBe(true);
        focusTracker.fire(null);
        expect(service.isOpen()).toBe(false);
    });

    it("suggestWidgetVisible reflects whether the popup is open", async () => {
        const { service } = setup(ITEMS);
        const keys = new ContextKeyService();
        service.updateContextKeys(keys);
        expect(keys.get("suggestWidgetVisible")).toBe(false);
        await service.trigger();
        service.updateContextKeys(keys);
        expect(keys.get("suggestWidgetVisible")).toBe(true);
    });

    it("a click on an item (view.onAccept) accepts via the service", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        // A click on the first row (localY=1) → view.onAccept → service.accept.
        component.view.dispatchEvent(
            new TUIMouseEvent("click", { button: "left", screenX: 0, screenY: 1, localX: 5, localY: 1 }),
        );
        expect(fake.applyExternalEdits).toHaveBeenCalledTimes(1);
    });

    it("selectPrevious / page navigation are delegated to the view", async () => {
        const items = Array.from({ length: 15 }, (_, i) => ({ label: `w${i}`, insertText: `w${i}` }));
        const { service, component } = setup(items, "", 0, "");
        await service.trigger();
        component.view.maxVisibleItems = 5;
        service.selectNextPage();
        expect(component.view.selectedIndex).toBe(5);
        service.selectPreviousPage();
        expect(component.view.selectedIndex).toBe(0);
        service.selectNext();
        service.selectPrevious();
        expect(component.view.selectedIndex).toBe(0);
    });

    it("changing the active editor closes an open popup", async () => {
        const fake = makeEditor("ind", 3, "ind");
        let activeCb: (e: TextEditorPane | null) => void = () => {};
        const group = {
            getActiveEditor: () => fake.editor,
            onActiveEditorChanged: (cb: (e: TextEditorPane | null) => void) => {
                activeCb = cb;
                return { dispose: () => {} };
            },
            completionSource: vi.fn(() => Promise.resolve(completionResult(ITEMS))),
            completionTriggerCharacters: [],
            getEditors: () => [fake.editor],
        } as unknown as IEditorService;
        const { service, component, body } = createService(group);
        TestApp.create(body, new Size(80, 24));
        await service.trigger();
        expect(service.isOpen()).toBe(true);
        activeCb(fake.editor); // onActiveEditorChanged → bindEditor closes the popup
        expect(service.isOpen()).toBe(false);
    });

    it("typing a non-letter character (word boundary) closes an open popup", async () => {
        const { service, fake } = setup(ITEMS);
        await service.trigger();
        fake.type("ind ", 4); // a space is non-word typing
        expect(service.isOpen()).toBe(false);
    });

    it("a shifted word start closes the popup even without further typing", async () => {
        // An edit LEFT of the cursor: nothing typed since the trigger, so the word-typing check passes, but the word
        // no longer starts where the prefix was set.
        const { service, fake } = setup(ITEMS, "a ind", 5, "a ind");
        await service.trigger();
        expect(service.isOpen()).toBe(true);

        fake.edit("aind", 4);

        expect(service.isOpen()).toBe(false);
    });

    it("auto suggest opens only on typing a word character with a single cursor", async () => {
        const attempts: ((fake: FakeEditor) => void)[] = [
            (fake) => {
                fake.edit("inde", 4); // paste/undo of one character is not typing
            },
            (fake) => {
                fake.type("ind ", 4); // a non-letter character
            },
            (fake) => {
                fake.setCursorCount(2);
                fake.type("inde", 4);
            },
            (fake) => {
                fake.setSelection(0, 3);
                fake.fireTyped("e"); // typing that left a selection (auto-surround)
            },
        ];
        for (const attempt of attempts) {
            const { service, fake, source } = setup(ITEMS);
            attempt(fake);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
            expect(service.isOpen()).toBe(false);
        }
    });

    it("acceptSelected without a selected item is a no-op", async () => {
        const { service, component, fake } = setup(ITEMS);
        await service.trigger();
        component.view.setFilter("zzzz"); // the list is empty → getSelectedItem null
        service.acceptSelected();
        expect(fake.applyExternalEdits).not.toHaveBeenCalled();
    });

    it("the constructor is safe with a non-empty initial selection", () => {
        const fake = makeEditor("ind", 3, "ind", 1); // anchor=1, active=3 (not collapsed)
        const { service } = createService(makeGroup(fake.editor, undefined));
        expect(service.isOpen()).toBe(false);
    });
});

function fakeInlineState(): IInlineSuggestionsState & {
    visible: boolean;
    loading: boolean;
    stopped: number;
    change: (patch: { visible?: boolean; loading?: boolean }) => void;
} {
    const emitter = new Emitter<void>();
    const state = {
        visible: false,
        loading: false,
        stopped: 0,
        isVisible: () => state.visible,
        isLoading: () => state.loading,
        stopAutomatic: () => {
            state.stopped++;
            state.loading = false;
        },
        onDidChange: emitter.event,
        change: (patch: { visible?: boolean; loading?: boolean }) => {
            Object.assign(state, patch);
            emitter.fire();
        },
    };
    return state;
}

/** An inline provider in the registry turns on `offWhenInlineCompletions` mode. */
function quickSetup(options: { line?: string; character?: number; settings?: TestSettings; inline?: boolean } = {}) {
    const line = options.line ?? "ind";
    const fake = makeEditor(line, options.character ?? line.length, line);
    const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
    const group = makeGroup(fake.editor, source);
    const languageFeatures = languageFeaturesOf(group);
    if (options.inline === true) {
        languageFeatures.inlineCompletionsProvider.register("*", {
            provideInlineCompletions: () => Promise.resolve([]),
        });
    }
    const { service, body } = createService(group, makeStateService(), options.settings, languageFeatures);
    TestApp.create(body, new Size(80, 24));
    const inline = fakeInlineState();
    const registration = service.setInlineSuggestionsState(inline);
    return { service, fake, source, inline, registration, group };
}

describe("CompletionService — quick suggest (upstream suggestModel)", () => {
    it("opens only when the cursor is at the end of a word that is not a number", async () => {
        const { service, fake, source } = quickSetup({ line: "x", character: 1 });
        for (const [line, character] of [
            ["x ", 2],
            ["x (", 3],
            ["x (4", 4],
            ["x (42", 5],
        ] as const) {
            fake.type(line, character);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        }
        // A letter after a number makes the word `42a`, not a number: the request goes out.
        fake.type("x (42a", 6);
        await flushTimers();
        expect(source).toHaveBeenCalled();
        void service;
    });

    it("a non-ASCII letter also requests: a word per the upstream definition, not \\w", async () => {
        const { service, fake, source } = quickSetup({ line: "", character: 0 });
        fake.type("\u043f", 1); // "p"
        await flushTimers();
        expect(source).toHaveBeenCalled();
        // The prefix is the typed letter, not an empty string: nothing in ITEMS matches it,
        // and the auto popup is not shown (otherwise it would open with the full list).
        expect(service.isOpen()).toBe(false);
    });

    it("typing Cyrillic narrows the open popup instead of closing and reopening it on every letter", async () => {
        // "privet primer proverka"
        const fake = makeEditor(
            "",
            0,
            "\u043f\u0440\u0438\u0432\u0435\u0442 \u043f\u0440\u0438\u043c\u0435\u0440 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430",
        );
        const { service, component, body } = createService(makeGroup(fake.editor, undefined), makeStateService(), {});
        TestApp.create(body, new Size(80, 24));
        fake.type("\u043f", 1); // "p"
        await flushTimers();
        expect(component.view.items.map((i) => i.label)).toEqual([
            "\u043f\u0440\u0438\u0432\u0435\u0442", // "privet"
            "\u043f\u0440\u0438\u043c\u0435\u0440", // "primer"
            "\u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430", // "proverka"
        ]);
        let closes = 0;
        service.onDidClose(() => closes++);
        fake.type("\u043f\u0440", 2); // "pr"
        fake.type("\u043f\u0440\u0438", 3); // "pri"
        await flushTimers();
        expect(closes).toBe(0);
        expect(service.isOpen()).toBe(true);
        expect(component.view.items.map((i) => i.label)).toEqual([
            "\u043f\u0440\u0438\u0432\u0435\u0442", // "privet"
            "\u043f\u0440\u0438\u043c\u0435\u0440", // "primer"
        ]);
    });

    it("typing inside a word — no, but a letter before a word — yes", async () => {
        const inside = quickSetup({ line: "indent", character: 3 });
        inside.fake.type("indeent", 4);
        await flushTimers();
        expect(inside.source).not.toHaveBeenCalled();

        const before = quickSetup({ line: "dent", character: 0 });
        before.fake.type("ident", 1);
        await flushTimers();
        expect(before.service.isOpen()).toBe(true);
    });

    it("editor.quickSuggestions: false — typing does not open, Ctrl+Space works", async () => {
        const { service, fake, source } = quickSetup({ settings: { "editor.quickSuggestions": false } });
        fake.type("inde", 4);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
        await service.trigger();
        expect(service.isOpen()).toBe(true);
    });

    it("the mode is taken for the token kind before the cursor: strings and comments are off by default", async () => {
        const { service, fake, source } = quickSetup({ line: '"ind', character: 4 });
        fake.setTokens([[0, STRING_TOKEN]]);
        fake.type('"inde', 5);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        fake.setTokens([[0, COMMENT_TOKEN]]);
        fake.type('"inden', 6);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        fake.setTokens([[0, CODE_TOKEN]]);
        fake.type('"indent', 7);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("the token kind is of the character LEFT of the cursor, not under it", async () => {
        // `"ind"`: the quotes are a string, `ind` is code; the cursor sits between `d` and the closing quote.
        const { service, fake } = quickSetup({ line: '"in"', character: 3 });
        fake.setTokens([
            [0, STRING_TOKEN],
            [1, CODE_TOKEN],
            [4, STRING_TOKEN],
        ]);
        fake.type('"ind"', 4);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("a language section enables strings (like `[json]` in json-language-features)", async () => {
        const { service, fake } = quickSetup({
            line: '"ind',
            settings: { "[editorconfig]": { "editor.quickSuggestions": { strings: true } } },
        });
        fake.setTokens([[0, STRING_TOKEN]]);
        fake.type('"inde', 5);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("inline mode does not open the popup (ghost text from suggest items is not supported)", async () => {
        const { fake, source } = quickSetup({ settings: { "editor.quickSuggestions": "inline" } });
        fake.type("inde", 4);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
    });

    it("editor.quickSuggestionsDelay: the popup waits for the delay", async () => {
        const { service, fake } = quickSetup({
            settings: { "[editorconfig]": { "editor.quickSuggestionsDelay": 40 } },
        });
        fake.type("inde", 4);
        await flushTimers();
        expect(service.isOpen()).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 60));
        expect(service.isOpen()).toBe(true);
    });

    it("the default delay is 10 ms, like upstream quickSuggestionsDelay", async () => {
        const { service, fake } = quickSetup();
        setSetting(service, "editor.quickSuggestionsDelay", undefined);
        fake.type("inde", 4);
        await new Promise((resolve) => setTimeout(resolve, 2));
        expect(service.isOpen()).toBe(false);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(service.isOpen()).toBe(true);
    });

    describe("offWhenInlineCompletions — yields to ghost text", () => {
        it("ghost text already on screen — the popup does not open", async () => {
            const { fake, source, inline } = quickSetup({ inline: true });
            inline.visible = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("waits for the ghost text response: ghost text arrived — no popup", async () => {
            const { fake, source, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();

            inline.change({ visible: true, loading: false });
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("waits for the ghost text response: no ghost text — the popup opens", async () => {
            const { service, fake, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(service.isOpen()).toBe(false);

            // An event with no outcome (still loading) doesn't end the wait.
            inline.change({});
            await flushTimers();
            expect(service.isOpen()).toBe(false);

            inline.change({ loading: false });
            await flushTimers();
            expect(service.isOpen()).toBe(true);
        });

        it("ghost text did not respond within 750 ms — the popup opens and the ghost text request is abandoned", async () => {
            vi.useFakeTimers();
            try {
                const { service, fake, inline } = quickSetup({ inline: true });
                inline.loading = true;
                fake.type("inde", 4);
                await vi.advanceTimersByTimeAsync(749);
                expect(service.isOpen()).toBe(false);
                expect(inline.stopped).toBe(0);
                await vi.advanceTimersByTimeAsync(1);
                expect(inline.stopped).toBe(1);
                expect(service.isOpen()).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it("the wait outcome is final: the timer after arrived ghost text does not open the popup", async () => {
            vi.useFakeTimers();
            try {
                const { service, fake, inline } = quickSetup({ inline: true });
                inline.loading = true;
                fake.type("inde", 4);
                await vi.advanceTimersByTimeAsync(5);
                inline.change({ visible: true, loading: false });
                // Ghost text was dismissed — an event fires again, but the wait is already over.
                inline.change({ visible: false });
                await vi.advanceTimersByTimeAsync(1000);
                expect(service.isOpen()).toBe(false);
                expect(inline.stopped).toBe(0);
            } finally {
                vi.useRealTimers();
            }
        });

        it("typing during the wait: the old wait does not open the popup", async () => {
            const { fake, source, inline } = quickSetup({
                inline: true,
                settings: { "editor.quickSuggestionsDelay": 30 },
            });
            inline.loading = true;
            fake.type("inde", 4);
            await new Promise((resolve) => setTimeout(resolve, 40)); // waiting for ghost text
            fake.type("inde ", 5); // next cycle: not a word — quick suggest won't open it
            inline.change({ loading: false });
            await new Promise((resolve) => setTimeout(resolve, 40));
            expect(source).not.toHaveBeenCalled();
        });

        it("an edit and cursor move during the wait — the popup does not open", async () => {
            const edited = quickSetup({ inline: true });
            edited.inline.loading = true;
            edited.fake.type("inde", 4);
            await flushTimers();
            edited.fake.edit("indent", 4); // a paste, not typing: a different version
            edited.inline.change({ loading: false });
            await flushTimers();
            expect(edited.source).not.toHaveBeenCalled();

            const moved = quickSetup({ inline: true });
            moved.inline.loading = true;
            moved.fake.type("inde", 4);
            await flushTimers();
            moved.fake.move(0, 2);
            moved.inline.change({ loading: false });
            await flushTimers();
            expect(moved.source).not.toHaveBeenCalled();

            const lined = quickSetup({ inline: true });
            lined.inline.loading = true;
            lined.fake.type("inde", 4);
            await flushTimers();
            lined.fake.move(1, 4);
            lined.inline.change({ loading: false });
            await flushTimers();
            expect(lined.source).not.toHaveBeenCalled();

            const multi = quickSetup({ inline: true });
            multi.inline.loading = true;
            multi.fake.type("inde", 4);
            await flushTimers();
            multi.fake.setCursorCount(2);
            multi.inline.change({ loading: false });
            await flushTimers();
            expect(multi.source).not.toHaveBeenCalled();

            const selected = quickSetup({ inline: true });
            selected.inline.loading = true;
            selected.fake.type("inde", 4);
            await flushTimers();
            selected.fake.setSelection(0, 4);
            selected.inline.change({ loading: false });
            await flushTimers();
            expect(selected.source).not.toHaveBeenCalled();
        });

        it("close (Esc) cancels the wait: the ghost text response does not bring the popup up", async () => {
            const { service, fake, source, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            service.close();
            inline.change({ loading: false });
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("no ghost text and no request in flight — the popup opens right away, without waiting", async () => {
            vi.useFakeTimers();
            try {
                const { service, fake } = quickSetup({ inline: true });
                fake.type("inde", 4);
                await vi.advanceTimersByTimeAsync(20);
                expect(service.isOpen()).toBe(true);
            } finally {
                vi.useRealTimers();
            }
        });

        it("after the wait the request stays automatic: nothing matched the typed text — no popup", async () => {
            const { service, fake, source, inline } = quickSetup({ inline: true, line: "inde " });
            inline.loading = true;
            fake.type("inde q", 6);
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
            inline.change({ loading: false });
            await flushTimers();
            expect(source).toHaveBeenCalledTimes(1);
            expect(service.isOpen()).toBe(false);
        });

        it("changing the active editor during the wait — the popup opens in neither", async () => {
            const { fake, source, inline, group } = quickSetup({ inline: true });
            const other = makeEditor("indent", 6);
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            Object.assign(group, { getActiveEditor: () => other.editor });
            inline.change({ loading: false });
            await flushTimers();
            expect(source).not.toHaveBeenCalled();
        });

        it("a popup opened during the wait is not opened again", async () => {
            const { service, fake, source, inline } = quickSetup({ inline: true });
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            // Ctrl+Space while the wait still hangs: trigger() drops it.
            await service.trigger();
            inline.change({ loading: false });
            await flushTimers();
            expect(source).toHaveBeenCalledTimes(1);
        });

        it("without an inline provider or with editor.inlineSuggest.enabled: false — does not wait", async () => {
            const noProvider = quickSetup();
            noProvider.inline.loading = true;
            noProvider.fake.type("inde", 4);
            await flushTimers();
            expect(noProvider.service.isOpen()).toBe(true);

            const disabled = quickSetup({
                inline: true,
                settings: { "[editorconfig]": { "editor.inlineSuggest.enabled": false } },
            });
            disabled.inline.loading = true;
            disabled.fake.type("inde", 4);
            await flushTimers();
            expect(disabled.service.isOpen()).toBe(true);
        });

        it("ghost text state not connected — opens right away, by the same auto request rules", async () => {
            const { service, fake, inline, registration } = quickSetup({ inline: true });
            // The removed state is "loading" forever: had it stayed connected,
            // the popup would wait for it.
            inline.loading = true;
            registration.dispose();
            fake.type("inde", 4);
            await flushTimers();
            expect(service.isOpen()).toBe(true);

            // Auto request: nothing matches the typed text — no popup.
            service.close();
            fake.type("inde q", 6);
            await flushTimers();
            expect(service.isOpen()).toBe(false);
        });

        it("disposing a stale registration does not remove the current one", async () => {
            const { service, fake, registration } = quickSetup({ inline: true });
            const current = fakeInlineState();
            current.visible = true;
            service.setInlineSuggestionsState(current);
            registration.dispose(); // the old registration is no longer current
            fake.type("inde", 4);
            await flushTimers();
            // The current state is in place: ghost text on screen — no popup.
            expect(service.isOpen()).toBe(false);
        });

        it("mode on does not wait for ghost text and opens over it", async () => {
            const { service, fake, inline } = quickSetup({
                inline: true,
                settings: { "editor.quickSuggestions": true },
            });
            inline.visible = true;
            inline.loading = true;
            fake.type("inde", 4);
            await flushTimers();
            expect(service.isOpen()).toBe(true);
        });
    });

    it("editor.inlineSuggest.suppressSuggestions: ghost text on screen suppresses auto open (both on typing and on a trigger character)", async () => {
        const settings = {
            "editor.quickSuggestions": true,
            "[editorconfig]": { "editor.inlineSuggest.suppressSuggestions": true },
        };
        const { service, fake, source, inline, group } = quickSetup({ inline: true, settings });
        inline.visible = true;
        fake.type("inde", 4);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        fake.type("inde.", 5);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();

        inline.visible = false;
        fake.type("inde..", 6);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
    });

    it("editor.suggestOnTriggerCharacters: false — a character does not open the popup", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["."];
        const { service, body } = createService(group, makeStateService(), {
            "[editorconfig]": { "editor.suggestOnTriggerCharacters": false },
        });
        TestApp.create(body, new Size(80, 24));
        fake.type("d.", 2);
        await flushTimers();
        expect(source).not.toHaveBeenCalled();
        expect(service.isOpen()).toBe(false);
    });

    it("a trigger character continuing a word goes the quick suggest path (Invoke, not TriggerCharacter)", async () => {
        const fake = makeEditor("d", 1, "d");
        const source = vi.fn(() => Promise.resolve(completionResult(ITEMS)));
        const group = makeGroup(fake.editor, source);
        (group as unknown as IFakeLanguageSeams).completionTriggerCharacters = ["a"];
        const { service, body } = createService(group);
        TestApp.create(body, new Size(80, 24));
        fake.type("da", 2);
        await flushTimers();
        void service;
        expect(source).toHaveBeenCalledWith(
            expect.objectContaining({ triggerKind: CompletionTriggerKind.Invoke }),
            expect.anything(),
        );
    });

    it("nothing matched the typed text — no auto popup, Ctrl+Space shows the whole list", async () => {
        const { service, fake, source } = quickSetup({ line: "", character: 0 });
        fake.type("q", 1);
        await flushTimers();
        expect(source).toHaveBeenCalledTimes(1);
        expect(service.isOpen()).toBe(false);

        await service.trigger();
        expect(service.isOpen()).toBe(true);
    });

    it("the auto popup closes when further typing filtered out everything; an explicit one keeps the list", async () => {
        const auto = quickSetup({ line: "in", character: 2 });
        auto.fake.type("ind", 3);
        await flushTimers();
        expect(auto.service.isOpen()).toBe(true);
        auto.fake.type("indq", 4);
        expect(auto.service.isOpen()).toBe(false);

        const explicit = quickSetup({ line: "ind", character: 3 });
        await explicit.service.trigger();
        explicit.fake.type("indq", 4);
        expect(explicit.service.isOpen()).toBe(true);
    });

    it("an incomplete auto list is re-requested with an auto request: an empty response closes the popup", async () => {
        const fake = makeEditor("in", 2, "in");
        const source = vi
            .fn<() => Promise<ICoreCompletionResult>>()
            .mockResolvedValueOnce(completionResult(ITEMS, true))
            .mockResolvedValue(completionResult([], false));
        const { service, body } = createService(makeGroup(fake.editor, source));
        TestApp.create(body, new Size(80, 24));
        fake.type("ind", 3);
        await flushTimers();
        expect(service.isOpen()).toBe(true);
        fake.type("indq", 4);
        expect(service.isOpen()).toBe(true);
        await flushTimers();
        expect(source).toHaveBeenCalledTimes(2);
        expect(service.isOpen()).toBe(false);
    });

    it("onDidShow fires once per opening of a closed popup", async () => {
        const { service } = quickSetup();
        const shown = vi.fn();
        service.onDidShow(shown);
        await service.trigger();
        await service.trigger(); // re-requesting an open popup is not an opening
        expect(shown).toHaveBeenCalledTimes(1);
        service.close();
        await service.trigger();
        expect(shown).toHaveBeenCalledTimes(2);
    });
});

describe("CompletionService — editor.wordBasedSuggestions", () => {
    function wordSetup(settings: TestSettings, options: { inline?: boolean; otherLanguage?: string } = {}) {
        const fake = makeEditor("", 0, "alpha beta");
        const sameLanguage = makeEditor("", 0, "gamma");
        const otherLanguage = makeEditor("", 0, "delta");
        Object.assign(otherLanguage.editor, { languageId: options.otherLanguage ?? "python" });
        const group = makeGroup(fake.editor, undefined, [sameLanguage.editor, otherLanguage.editor]);
        const languageFeatures = new LanguageFeaturesService();
        if (options.inline === true) {
            languageFeatures.inlineCompletionsProvider.register("*", {
                provideInlineCompletions: () => Promise.resolve([]),
            });
        }
        const { service, component, body } = createService(group, makeStateService(), settings, languageFeatures);
        TestApp.create(body, new Size(80, 24));
        const labels = async (): Promise<string[]> => {
            await service.trigger();
            return component.view.items.map((i) => i.label);
        };
        return { service, labels };
    }

    it("by default — open documents of the same language", async () => {
        expect(await wordSetup({}).labels()).toEqual(["alpha", "beta", "gamma"]);
        expect(await wordSetup({ "editor.wordBasedSuggestions": "matchingDocuments" }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
    });

    it("allDocuments — all open; currentDocument — only the active one; off — nothing", async () => {
        expect(await wordSetup({ "editor.wordBasedSuggestions": "allDocuments" }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
            "delta",
        ]);
        expect(await wordSetup({ "editor.wordBasedSuggestions": "currentDocument" }).labels()).toEqual([
            "alpha",
            "beta",
        ]);
        const off = wordSetup({ "editor.wordBasedSuggestions": "off" });
        expect(await off.labels()).toEqual([]);
        expect(off.service.isOpen()).toBe(false);
    });

    it("the mode is read for the document language; suppression only in offWithInlineSuggestions mode", async () => {
        expect(
            await wordSetup({ "[editorconfig]": { "editor.wordBasedSuggestions": "currentDocument" } }).labels(),
        ).toEqual(["alpha", "beta"]);
        // matchingDocuments with an inline provider and AI suggestions enabled doesn't drop words.
        expect(
            await wordSetup(
                { "editor.wordBasedSuggestions": "matchingDocuments", "github.copilot.enable": { "*": true } },
                { inline: true },
            ).labels(),
        ).toEqual(["alpha", "beta", "gamma"]);
    });

    it("offWithInlineSuggestions suppresses words only if there is an inline provider AND product AI suggestions are enabled", async () => {
        // An inline provider exists, but `github.copilot.enable` is unset — words stay (like upstream without Copilot).
        expect(await wordSetup({}, { inline: true }).labels()).toEqual(["alpha", "beta", "gamma"]);
        expect(await wordSetup({ "github.copilot.enable": { "*": true } }, { inline: true }).labels()).toEqual([]);
        // Without an inline provider the Copilot setting drops nothing.
        expect(await wordSetup({ "github.copilot.enable": { "*": true } }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
        expect(
            await wordSetup({ "github.copilot.enable": { "*": true, editorconfig: false } }, { inline: true }).labels(),
        ).toEqual(["alpha", "beta", "gamma"]);
        expect(
            await wordSetup({ "github.copilot.enable": { "*": false, editorconfig: true } }, { inline: true }).labels(),
        ).toEqual([]);
        expect(await wordSetup({ "github.copilot.enable": null }, { inline: true }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
        expect(await wordSetup({ "github.copilot.enable": true }, { inline: true }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
        expect(await wordSetup({ "github.copilot.enable": ["*"] }, { inline: true }).labels()).toEqual([
            "alpha",
            "beta",
            "gamma",
        ]);
    });
});
