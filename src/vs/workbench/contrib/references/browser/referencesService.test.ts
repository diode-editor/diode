import { describe, expect, it } from "vitest";

import { settle } from "../../../../../TestUtils/timing.ts";

import { Uri } from "../../../../base/common/uri.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import type { ICoreReference, IReferenceRequest } from "../../../../editor/common/languages/iReferenceSource.ts";
import type { IFileSystemProviderRegistry } from "../../../../platform/files/common/iFileSystemProviderRegistry.ts";
import type { SidebarService } from "../../../browser/parts/sidebar/sidebarService.ts";
import type { EditorService } from "../../../services/editor/browser/editorService.ts";
import type { ExplorerService } from "../../files/browser/explorerService.ts";

import type { IReferenceGroup } from "./referencePreview.ts";
import { REFERENCES_VIEWLET_ID, type ReferencesComponent } from "./referencesComponent.ts";
import { ReferencesService } from "./referencesService.ts";

const ROOT = "/work/project";
const MAIN = `${ROOT}/src/main.ts`;
const MAIN_TEXT = 'import { greet } from "./defs";\n\nconst hello = greet("world");\n';

/** Панель-заглушка: запоминает, какие группы ей показали. */
function fakeComponent(): { component: ReferencesComponent; shown: IReferenceGroup[][]; cleared: number } {
    const shown: IReferenceGroup[][] = [];
    const state = { cleared: 0 };
    const component = {
        setResults: (groups: readonly IReferenceGroup[]) => shown.push([...groups]),
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
    /** Позиция каретки: строка и колонка (0-based). */
    readonly caret?: [number, number];
    readonly text?: string;
    readonly source?: (req: IReferenceRequest) => Promise<readonly ICoreReference[]>;
    /** Активного редактора нет вовсе. */
    readonly noEditor?: boolean;
    /** Открытые модели: путь → текст (несохранённые правки). */
    readonly openModels?: Record<string, string>;
}

function fakeGroup(opts: IFakeEditorOptions = {}): EditorService {
    const [line, character] = opts.caret ?? [2, 15];
    const editor = {
        uri: Uri.file(MAIN),
        languageId: "typescript",
        getText: () => opts.text ?? MAIN_TEXT,
        viewState: { selections: [{ active: { line, character } }] },
    };
    return {
        getActiveEditor: () => (opts.noEditor === true ? null : editor),
        referenceSource: opts.source,
        openFileModel: (uri: Uri) => {
            const text = opts.openModels?.[uri.fsPath];
            return text === undefined ? null : { getText: () => text };
        },
    } as unknown as EditorService;
}

function fakeExplorer(root: string | null = ROOT): ExplorerService {
    return { getRootPath: () => root } as unknown as ExplorerService;
}

function fakeProviders(disk: Record<string, string>): IFileSystemProviderRegistry {
    return {
        readFile: (uri: Uri) => {
            const text = disk[uri.fsPath];
            if (text === undefined) return Promise.reject(new Error(`ENOENT ${uri.fsPath}`));
            return Promise.resolve(new TextEncoder().encode(text));
        },
    } as unknown as IFileSystemProviderRegistry;
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
    it("спрашивает провайдеров по каретке, добирает текст строк и показывает вьюлет", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        const requests: IReferenceRequest[] = [];
        const service = new ReferencesService(
            panel.component,
            fakeGroup({
                source: (req) => {
                    requests.push(req);
                    return Promise.resolve([
                        reference(`${ROOT}/src/defs.ts`, 0, 16, 21),
                        reference(MAIN, 2, 14, 19),
                    ]);
                },
            }),
            fakeExplorer(),
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
                text: MAIN_TEXT,
                line: 2,
                character: 15,
                // VS Code показывает объявление первой строкой списка.
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

    it("несохранённая правка видна: текст берётся из открытой модели, а не с диска", async () => {
        const panel = fakeComponent();
        const service = new ReferencesService(
            panel.component,
            fakeGroup({
                source: () => Promise.resolve([reference(MAIN, 0, 0, 5)]),
                openModels: { [MAIN]: "hello world (в буфере)\n" },
            }),
            fakeExplorer(),
            fakeProviders({ [MAIN]: "на диске другое\n" }),
            fakeSidebar().service,
        );

        await service.findReferences();

        expect(panel.shown[0][0].matches[0].preview.inside).toBe("hello");
    });

    it("пустой результат всё равно показывает панель — «No results» объясняет себя сам", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        const service = new ReferencesService(
            panel.component,
            fakeGroup({ source: () => Promise.resolve([]) }),
            fakeExplorer(),
            fakeProviders({}),
            sidebar.service,
        );

        await service.findReferences();

        expect(panel.shown).toEqual([[]]);
        expect(sidebar.shown).toEqual([REFERENCES_VIEWLET_ID]);
    });

    it("устаревший ответ отбрасывается до чтения файлов", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        let release: ((refs: readonly ICoreReference[]) => void) | null = null;
        let reads = 0;
        const providers = {
            readFile: () => {
                reads++;
                return Promise.resolve(new TextEncoder().encode(MAIN_TEXT));
            },
        } as unknown as IFileSystemProviderRegistry;
        const service = new ReferencesService(
            panel.component,
            fakeGroup({
                source: () =>
                    release === null
                        ? new Promise<readonly ICoreReference[]>((resolve) => {
                              release = resolve;
                          })
                        : Promise.resolve([reference(MAIN, 0, 9, 14)]),
            }),
            fakeExplorer(),
            providers,
            sidebar.service,
        );

        const stale = service.findReferences();
        await service.findReferences();
        release!([reference(MAIN, 2, 14, 19)]);
        await stale;

        // Показан ровно один результат — второго (свежего) запроса.
        expect(panel.shown).toHaveLength(1);
        expect(panel.shown[0][0].matches[0].lineNumber).toBe(1);
        // И устаревший ответ отброшен ДО добора строк: лишнего чтения файла нет.
        expect(reads).toBe(1);
    });

    it("запрос, устаревший уже во время добора строк, панель не наполняет", async () => {
        const panel = fakeComponent();
        // Чтение файла для A зависает: пока A добирает превью, приезжает B.
        let releaseRead: (() => void) | null = null;
        let hang = true;
        const providers = {
            readFile: () => {
                if (!hang) return Promise.resolve(new TextEncoder().encode(MAIN_TEXT));
                return new Promise<Uint8Array>((resolve) => {
                    releaseRead = () => resolve(new TextEncoder().encode(MAIN_TEXT));
                });
            },
        } as unknown as IFileSystemProviderRegistry;
        const service = new ReferencesService(
            panel.component,
            fakeGroup({ source: () => Promise.resolve([reference(MAIN, 2, 14, 19)]) }),
            fakeExplorer(),
            providers,
            fakeSidebar().service,
        );

        const stale = service.findReferences();
        // Дать A дойти до чтения файла, и только потом пускать B.
        await settle(0);
        hang = false;
        await service.findReferences();
        releaseRead!();
        await stale;

        // Панель наполнил только второй запрос.
        expect(panel.shown).toHaveLength(1);
    });

    it("clear обесценивает запрос так, что следующий его не «усыновит»", async () => {
        const panel = fakeComponent();
        let release: ((refs: readonly ICoreReference[]) => void) | null = null;
        let calls = 0;
        const service = new ReferencesService(
            panel.component,
            fakeGroup({
                source: () =>
                    calls++ === 0
                        ? new Promise<readonly ICoreReference[]>((resolve) => {
                              release = resolve;
                          })
                        : Promise.resolve([reference(MAIN, 0, 9, 14)]),
            }),
            fakeExplorer(),
            fakeProviders({ [MAIN]: MAIN_TEXT }),
            fakeSidebar().service,
        );

        // A подвис → Clear → B прошёл целиком → A наконец ответил. Счётчик
        // запросов обязан развести A и B, иначе ответ A закрасит результат B.
        const first = service.findReferences();
        service.clear();
        await service.findReferences();
        release!([reference(MAIN, 2, 14, 19)]);
        await first;

        expect(panel.shown).toHaveLength(1);
        expect(panel.shown[0][0].matches[0].lineNumber).toBe(1);
    });

    it("нет активного редактора, нет источника, каретка не на слове — ничего не происходит", async () => {
        const panel = fakeComponent();
        const sidebar = fakeSidebar();
        const providers = fakeProviders({});

        const noEditor = new ReferencesService(
            panel.component,
            fakeGroup({ noEditor: true, source: () => Promise.resolve([reference(MAIN, 0, 0, 1)]) }),
            fakeExplorer(),
            providers,
            sidebar.service,
        );
        await noEditor.findReferences();

        const noSource = new ReferencesService(
            panel.component,
            fakeGroup({}),
            fakeExplorer(),
            providers,
            sidebar.service,
        );
        await noSource.findReferences();

        // Каретка на пробеле — искать нечего.
        const notOnWord = new ReferencesService(
            panel.component,
            fakeGroup({ caret: [1, 0], source: () => Promise.resolve([reference(MAIN, 0, 0, 1)]) }),
            fakeExplorer(),
            providers,
            sidebar.service,
        );
        await notOnWord.findReferences();

        // Каретка за пределами текста — тоже.
        const pastEnd = new ReferencesService(
            panel.component,
            fakeGroup({ caret: [99, 0], source: () => Promise.resolve([reference(MAIN, 0, 0, 1)]) }),
            fakeExplorer(),
            providers,
            sidebar.service,
        );
        await pastEnd.findReferences();

        expect(panel.shown).toEqual([]);
        expect(sidebar.shown).toEqual([]);
    });

    it("без открытой папки пути показываются как есть", async () => {
        const panel = fakeComponent();
        const service = new ReferencesService(
            panel.component,
            fakeGroup({ source: () => Promise.resolve([reference(MAIN, 2, 14, 19)]) }),
            fakeExplorer(null),
            fakeProviders({ [MAIN]: MAIN_TEXT }),
            fakeSidebar().service,
        );

        await service.findReferences();

        expect(panel.shown[0][0].relPath).toBe(MAIN);
    });
});

describe("ReferencesService — clear", () => {
    it("чистит панель и обесценивает ответ уже отправленного запроса", async () => {
        const panel = fakeComponent();
        let release: ((refs: readonly ICoreReference[]) => void) | null = null;
        const service = new ReferencesService(
            panel.component,
            fakeGroup({
                source: () =>
                    new Promise<readonly ICoreReference[]>((resolve) => {
                        release = resolve;
                    }),
            }),
            fakeExplorer(),
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
