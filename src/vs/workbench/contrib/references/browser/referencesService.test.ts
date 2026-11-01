import { describe, expect, it } from "vitest";

import { settle } from "../../../../../TestUtils/timing.ts";
import type { ICancellationToken } from "../../../../base/common/cancellation.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type {
    ICoreReference,
    IReferenceRequest,
    ReferenceProvider,
} from "../../../../editor/common/languages/iReferenceSource.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import { type IFileService } from "../../../../platform/files/common/files.ts";
import type { IWorkspaceContextService } from "../../../../platform/workspace/common/iWorkspaceContextService.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";
import type { TextFileModelService } from "../../../services/textfile/common/textFileModelService.ts";

import type { IReferenceGroup } from "./referencePreview.ts";
import { REFERENCES_VIEWLET_ID, type ReferencesComponent } from "./referencesComponent.ts";
import { ReferencesService } from "./referencesService.ts";

const ROOT = "/work/project";
const MAIN = `${ROOT}/src/main.ts`;
const MAIN_TEXT = 'import { greet } from "./defs";\n\nconst hello = greet("world");\n';

function fakeComponent(): { component: ReferencesComponent; shown: IReferenceGroup[][]; cleared: number } {
    const shown: IReferenceGroup[][] = [];
    const state = { cleared: 0 };
    const component = {
        setResults: (groups: readonly IReferenceGroup[]) => shown.push([...groups]),
        revealResults: () => undefined,
        clear: () => {
            state.cleared++;
        },
    } as unknown as ReferencesComponent;
    return {
        component,
        shown,
        get cleared(): number {
            return state.cleared;
        },
    };
}

interface IFakeEditorOptions {
    /** 0-based. */
    readonly caret?: [number, number];
    readonly text?: string;
    readonly source?: ReferenceProvider["provideReferences"];
    readonly noEditor?: boolean;
    readonly openModels?: Record<string, string>;
    /** Text of `/Lib.java` by scheme; other resources of the scheme give `null`. */
    readonly virtual?: Record<string, string>;
}

function fakeGroup(opts: IFakeEditorOptions = {}): IEditorService {
    const [line, character] = opts.caret ?? [2, 15];
    const editor = {
        uri: Uri.file(MAIN),
        languageId: "typescript",
        getText: () => opts.text ?? MAIN_TEXT,
        // The request carries the model version instead of the document text.
        model: { document: { versionId: 3 } },
        viewState: { selections: [{ active: { line, character } }] },
    };
    const group = {
        getActiveEditor: () => (opts.noEditor === true ? null : editor),
        virtualDocumentSource: {
            canProvide: (scheme: string) => opts.virtual?.[scheme] !== undefined,
            provide: (uri: Uri) =>
                Promise.resolve(uri.path === "/Lib.java" ? (opts.virtual?.[uri.scheme] ?? null) : null),
        },
        // Plays the TextFileModelService role: the resource's open model.
        get: (uri: Uri) => {
            const text = opts.openModels?.[uri.fsPath];
            return text === undefined ? null : { getText: () => text };
        },
    } as unknown as IEditorService;
    sources.set(group, opts.source);
    return group;
}

const sources = new WeakMap<IEditorService, IFakeEditorOptions["source"]>();

/** A provider from `fakeGroup({ source })` is registered under `*`, like an extension provider proxy in production. */
function createService(
    component: ReferencesComponent,
    group: IEditorService,
    workspace: IWorkspaceContextService,
    providers: IFileService,
    sidebar: SidebarService,
): ReferencesService {
    const languageFeatures = new LanguageFeaturesService();
    const source = sources.get(group);
    if (source !== undefined) languageFeatures.referenceProvider.register("*", { provideReferences: source });
    const models = group as unknown as TextFileModelService;
    return new ReferencesService(component, group, models, workspace, providers, sidebar, languageFeatures);
}

function fakeWorkspace(root: string | null = ROOT): IWorkspaceContextService {
    const folders = root === null ? [] : [{ uri: { fsPath: root }, name: "", index: 0 }];
    return { getWorkspace: () => ({ id: root, folders }) } as unknown as IWorkspaceContextService;
}

function fakeProviders(disk: Partial<Record<string, string>>): IFileService {
    return {
        readFile: (uri: Uri) => {
            const text = disk[uri.fsPath];
            if (text === undefined) return Promise.reject(new Error(`ENOENT ${uri.fsPath}`));
            return Promise.resolve({ value: new TextEncoder().encode(text) });
        },
    } as unknown as IFileService;
}

function fakeSidebar(): { service: SidebarService; shown: string[] } {
    const shown: string[] = [];
    return {
        shown,
        service: { showViewlet: (id: string) => shown.push(id) } as unknown as SidebarService,
    };
}

function reference(absolutePath: string, line: number, from: number, to: number): ICoreReference {
    return { uri: Uri.file(absolutePath).toString(), range: createRange(line, from, line, to) };
}

describe("ReferencesService — findReferences", () => {
    it("queries providers at the cursor, fetches line text and shows the viewlet", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        const requests: IReferenceRequest[] = [];
        const service = createService(
            panel.component,
            fakeGroup({
                source: (req) => {
                    requests.push(req);
                    return Promise.resolve([reference(`${ROOT}/src/defs.ts`, 0, 16, 21), reference(MAIN, 2, 14, 19)]);
                },
            }),
            fakeWorkspace(),
            fakeProviders({
                [`${ROOT}/src/defs.ts`]: "export function greet(name: string) {}\n",
                [MAIN]: MAIN_TEXT,
            }),
            sidebar.service,
        );

        await service.findReferences();

        expect(requests).toEqual([
            {
                uri: Uri.file(MAIN).toString(),
                languageId: "typescript",
                versionId: 3,
                line: 2,
                character: 15,
                // VS Code shows the declaration as the first list row.
                includeDeclaration: true,
            },
        ]);
        expect(panel.shown).toHaveLength(1);
        expect(panel.shown[0].map((g) => g.relPath)).toEqual(["src/defs.ts", "src/main.ts"]);
        expect(panel.shown[0][0].matches[0].preview).toEqual({
            before: "export function ",
            inside: "greet",
            after: "(name: string) {}",
        });
        expect(sidebar.shown).toEqual([REFERENCES_VIEWLET_ID]);
    });

    it("an unsaved edit is visible: text comes from the open model, not from disk", async () => {
        const panel = fakeComponent();
        const service = createService(
            panel.component,
            fakeGroup({
                source: () => Promise.resolve([reference(MAIN, 0, 0, 5)]),
                openModels: { [MAIN]: "hello world (in buffer)\n" },
            }),
            fakeWorkspace(),
            fakeProviders({ [MAIN]: "different on disk\n" }),
            fakeSidebar().service,
        );

        await service.findReferences();

        expect(panel.shown[0][0].matches[0].preview.inside).toBe("hello");
    });

    it("an empty result still shows the panel: 'No results' explains itself", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        const service = createService(
            panel.component,
            fakeGroup({ source: () => Promise.resolve([]) }),
            fakeWorkspace(),
            fakeProviders({}),
            sidebar.service,
        );

        await service.findReferences();

        expect(panel.shown).toEqual([[]]);
        expect(sidebar.shown).toEqual([REFERENCES_VIEWLET_ID]);
    });

    it("a stale response is dropped before reading files", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        let release: ((refs: readonly ICoreReference[]) => void) | null = null;
        let reads = 0;
        const providers = {
            readFile: () => {
                reads++;
                return Promise.resolve({ value: new TextEncoder().encode(MAIN_TEXT) });
            },
        } as unknown as IFileService;
        const service = createService(
            panel.component,
            fakeGroup({
                source: () =>
                    release === null
                        ? new Promise<readonly ICoreReference[]>((resolve) => {
                              release = resolve;
                          })
                        : Promise.resolve([reference(MAIN, 0, 9, 14)]),
            }),
            fakeWorkspace(),
            providers,
            sidebar.service,
        );

        const stale = service.findReferences();
        await service.findReferences();
        release!([reference(MAIN, 2, 14, 19)]);
        await stale;

        expect(panel.shown).toHaveLength(1);
        expect(panel.shown[0][0].matches[0].lineNumber).toBe(1);
        // And the stale response is dropped BEFORE fetching lines: no extra file read.
        expect(reads).toBe(1);
    });

    it("a request that goes stale while fetching lines does not fill the panel", async () => {
        const panel = fakeComponent();
        // Reading the file for A hangs: while A fetches previews, B arrives.
        let releaseRead: (() => void) | null = null;
        let hang = true;
        const providers = {
            readFile: () => {
                if (!hang) return Promise.resolve({ value: new TextEncoder().encode(MAIN_TEXT) });
                return new Promise<{ value: Uint8Array }>((resolve) => {
                    releaseRead = () => {
                        resolve({ value: new TextEncoder().encode(MAIN_TEXT) });
                    };
                });
            },
        } as unknown as IFileService;
        const service = createService(
            panel.component,
            fakeGroup({ source: () => Promise.resolve([reference(MAIN, 2, 14, 19)]) }),
            fakeWorkspace(),
            providers,
            fakeSidebar().service,
        );

        const stale = service.findReferences();
        // Let A reach the file read, and only then let B through.
        await settle(0);
        hang = false;
        await service.findReferences();
        releaseRead!();
        await stale;

        expect(panel.shown).toHaveLength(1);
    });

    it("clear invalidates the request so the next one does not 'adopt' it", async () => {
        const panel = fakeComponent();
        let release: ((refs: readonly ICoreReference[]) => void) | null = null;
        let calls = 0;
        const service = createService(
            panel.component,
            fakeGroup({
                source: () =>
                    calls++ === 0
                        ? new Promise<readonly ICoreReference[]>((resolve) => {
                              release = resolve;
                          })
                        : Promise.resolve([reference(MAIN, 0, 9, 14)]),
            }),
            fakeWorkspace(),
            fakeProviders({ [MAIN]: MAIN_TEXT }),
            fakeSidebar().service,
        );

        // A hangs → Clear → B completes → A finally answers. The request
        // counter must tell A and B apart, otherwise A's response would paint over B's result.
        const first = service.findReferences();
        service.clear();
        await service.findReferences();
        release!([reference(MAIN, 2, 14, 19)]);
        await first;

        expect(panel.shown).toHaveLength(1);
        expect(panel.shown[0][0].matches[0].lineNumber).toBe(1);
    });

    it("Clear also cancels the request at the provider", () => {
        const tokens: ICancellationToken[] = [];
        const service = createService(
            fakeComponent().component,
            fakeGroup({
                source: (_request, token) => {
                    tokens.push(token);
                    return new Promise<readonly ICoreReference[]>(() => undefined);
                },
            }),
            fakeWorkspace(),
            fakeProviders({ [MAIN]: MAIN_TEXT }),
            fakeSidebar().service,
        );

        void service.findReferences();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([false]);

        service.clear();
        expect(tokens.map((token) => token.isCancellationRequested)).toEqual([true]);
    });

    it("no active editor, no source, cursor not on a word: nothing happens", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        const providers = fakeProviders({});

        const noEditor = createService(
            panel.component,
            fakeGroup({ noEditor: true, source: () => Promise.resolve([reference(MAIN, 0, 0, 1)]) }),
            fakeWorkspace(),
            providers,
            sidebar.service,
        );
        await noEditor.findReferences();

        const noSource = createService(panel.component, fakeGroup({}), fakeWorkspace(), providers, sidebar.service);
        await noSource.findReferences();

        // Cursor on whitespace — nothing to look up.
        const notOnWord = createService(
            panel.component,
            fakeGroup({ caret: [1, 0], source: () => Promise.resolve([reference(MAIN, 0, 0, 1)]) }),
            fakeWorkspace(),
            providers,
            sidebar.service,
        );
        await notOnWord.findReferences();

        // Cursor past the end of the text — same.
        const pastEnd = createService(
            panel.component,
            fakeGroup({ caret: [99, 0], source: () => Promise.resolve([reference(MAIN, 0, 0, 1)]) }),
            fakeWorkspace(),
            providers,
            sidebar.service,
        );
        await pastEnd.findReferences();

        expect(panel.shown).toEqual([]);
        expect(sidebar.shown).toEqual([]);
    });

    it("without an open folder paths are shown as is", async () => {
        const panel = fakeComponent();
        const service = createService(
            panel.component,
            fakeGroup({ source: () => Promise.resolve([reference(MAIN, 2, 14, 19)]) }),
            fakeWorkspace(null),
            fakeProviders({ [MAIN]: MAIN_TEXT }),
            fakeSidebar().service,
        );

        await service.findReferences();

        expect(panel.shown[0][0].relPath).toBe(MAIN);
    });
});

describe("ReferencesService — showLocations", () => {
    const DEFS = `${ROOT}/src/defs.ts`;
    const DISK = { [MAIN]: MAIN_TEXT, [DEFS]: "export function greet(name: string) {}\n" };
    const LOCATIONS = [reference(DEFS, 0, 16, 21), reference(MAIN, 2, 14, 19)];

    function setup(opts: IFakeEditorOptions = {}) {
        const calls: unknown[] = [];
        const panel = fakeComponent();
        const { component } = panel;
        const original = component.setResults.bind(component);
        component.setResults = (groups, options) => {
            calls.push(options);
            original(groups, options);
        };
        const sidebar = fakeSidebar();
        const service = createService(
            component,
            fakeGroup(opts),
            fakeWorkspace(),
            fakeProviders(DISK),
            sidebar.service,
        );
        return { calls, panel, service, sidebar };
    }

    it("groups the locations, passes the title and shows the panel", async () => {
        const { calls, panel, service, sidebar } = setup();

        await service.showLocations("Definitions", LOCATIONS);

        expect(panel.shown[0].map((g) => g.relPath)).toEqual(["src/defs.ts", "src/main.ts"]);
        expect(calls).toEqual([{ title: "Definitions", active: undefined }]);
        expect(sidebar.shown).toEqual([REFERENCES_VIEWLET_ID]);
    });

    it("reveal: false fills the panel without showing it", async () => {
        const { panel, service, sidebar } = setup();

        await service.showLocations("Definitions", LOCATIONS, undefined, { reveal: false });

        expect(panel.shown).toHaveLength(1);
        expect(sidebar.shown).toEqual([]);
    });

    it("an empty list does nothing and keeps a running search alive", async () => {
        const { panel, service, sidebar } = setup();

        await service.showLocations("Definitions", []);

        expect(panel.shown).toEqual([]);
        expect(sidebar.shown).toEqual([]);
    });

    it("active as a reference picks the location by uri and position inside its range", async () => {
        const { calls, service } = setup();

        await service.showLocations("Definitions", LOCATIONS, reference(MAIN, 2, 15, 15));

        expect(calls).toEqual([{ title: "Definitions", active: LOCATIONS[1] }]);
    });

    it("active as a position looks in the active editor's file", async () => {
        const { calls, service } = setup();

        await service.showLocations("Definitions", LOCATIONS, { line: 2, character: 19 });

        expect(calls).toEqual([{ title: "Definitions", active: LOCATIONS[1] }]);
    });

    it("active that matches nothing leaves the choice to the panel: same position, other file", async () => {
        const { calls, service } = setup();

        await service.showLocations("Definitions", LOCATIONS, reference(`${ROOT}/other.ts`, 2, 15, 15));
        await service.showLocations("Definitions", LOCATIONS, { line: 0, character: 16 });

        expect(calls).toEqual([
            { title: "Definitions", active: undefined },
            { title: "Definitions", active: undefined },
        ]);
    });

    it("active as a position without an active editor matches nothing", async () => {
        const { calls, service } = setup({ noEditor: true });

        await service.showLocations("Definitions", LOCATIONS, { line: 2, character: 15 });

        expect(calls).toEqual([{ title: "Definitions", active: undefined }]);
    });

    it("a later search wins over a list still reading its files", async () => {
        const { panel, service } = setup({ source: () => Promise.resolve([reference(MAIN, 0, 9, 14)]) });

        const stale = service.showLocations("Definitions", LOCATIONS);
        await service.findReferences();
        await stale;

        expect(panel.shown).toHaveLength(1);
        expect(panel.shown[0][0].matches[0].lineNumber).toBe(1);
    });

    it("a non-disk target takes its text from the scheme provider", async () => {
        const { panel, service } = setup({
            virtual: { jdt: "class Lib {}\n" },
        });

        await service.showLocations("Definitions", [
            { uri: "jdt://contents/Lib.java", range: createRange(0, 6, 0, 9) },
            { uri: "jdt://contents/Empty.java", range: createRange(0, 0, 0, 1) },
        ]);

        // The provider returned nothing for the second one: dropped, like an unreadable file.
        expect(panel.shown[0].map((g) => g.uri)).toEqual(["jdt://contents/Lib.java"]);
        expect(panel.shown[0][0].matches[0].preview.inside).toBe("Lib");
    });
});

describe("ReferencesService — clear", () => {
    it("clears the panel and invalidates the response of an already sent request", async () => {
        const panel = fakeComponent();
        let release: ((refs: readonly ICoreReference[]) => void) | null = null;
        const service = createService(
            panel.component,
            fakeGroup({
                source: () =>
                    new Promise<readonly ICoreReference[]>((resolve) => {
                        release = resolve;
                    }),
            }),
            fakeWorkspace(),
            fakeProviders({ [MAIN]: MAIN_TEXT }),
            fakeSidebar().service,
        );

        const pending = service.findReferences();
        service.clear();
        release!([reference(MAIN, 2, 14, 19)]);
        await pending;

        expect(panel.cleared).toBe(1);
        expect(panel.shown).toEqual([]);
    });
});
