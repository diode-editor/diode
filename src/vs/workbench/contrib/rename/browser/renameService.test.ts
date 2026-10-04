import { Size } from "@tuidom/core/common/geometryPromitives";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAppTestHarness, type IAppHarness } from "../../../../../TestUtils/AppTestHarness.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type {
    ICoreRenameLocation,
    ICoreRenameResult,
    IRenameRequest,
    RenameProvider,
} from "../../../../editor/common/languages/iRenameSource.ts";
import type { ILanguageFeaturesService } from "../../../../editor/common/services/languageFeatures.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { InputBoxOptions, QuickInputService } from "../../../browser/parts/quickinput/quickInputService.ts";
import { EditorServiceDIToken } from "../../../services/editor/browser/editorService.ts";
import type { StatusBarService } from "../../../services/statusbar/common/statusBarService.ts";

import { RenameService } from "./renameService.ts";

// Редактор и его состояние настоящие (AppTestHarness), подменены только поле
// ввода нового имени и статус-бар — иначе нечем ни «набрать» имя, ни прочитать
// показанную ошибку. Провайдеры — в настоящем реестре ядра, как их туда кладёт
// LanguageFeaturesAdapter.

describe("RenameService — Rename Symbol", () => {
    let ws: ITempWorkspace;
    let h: IAppHarness;
    let features: ILanguageFeaturesService;
    /** Что отдаёт поле ввода на очередной показ (undefined = Escape). */
    let typed: (string | undefined)[];
    let opened: InputBoxOptions[];
    let notices: string[];

    beforeEach(() => {
        ws = createTempWorkspace({
            prefix: "diode-rename-",
            files: { "main.ts": "const value = 1;\nconsole.log(value);\n" },
        });
        h = createAppTestHarness({ workspaceFolder: ws.dir, size: new Size(80, 24) });
        h.workbench.openFile(ws.path("main.ts"));
        h.workbench.focusEditor();
        features = new LanguageFeaturesService();
        typed = [];
        opened = [];
        notices = [];
    });

    afterEach(() => {
        h.dispose();
        ws.dispose();
    });

    const group = (): ReturnType<typeof h.container.get<typeof EditorServiceDIToken>> =>
        h.container.get(EditorServiceDIToken);

    /**
     * Кладёт провайдера в реестр — как это делает адаптер. Селектор `"*"`, а
     * не `typescript`: язык документу назначает LanguageService, которого в
     * харнессе нет (любой файл — `plaintext`), и привязка к имени языка
     * проверяла бы не провайдера, а харнесс.
     */
    function provider(impl: Partial<RenameProvider>): RenameProvider {
        const full: RenameProvider = {
            prepareRename: impl.prepareRename ?? ((): Promise<null> => Promise.resolve(null)),
            provideRenameEdits: impl.provideRenameEdits ?? ((): Promise<ICoreRenameResult> => Promise.resolve({ applied: false })),
        };
        features.renameProvider.register("*", full);
        return full;
    }

    const name = (value: string): Promise<ICoreRenameLocation> => Promise.resolve({ kind: "name", name: value });

    function service(): RenameService {
        const quickInput = {
            input: (opts: InputBoxOptions = {}) => {
                opened.push(opts);
                return Promise.resolve(typed.shift());
            },
        } as unknown as QuickInputService;
        const statusBar = {
            addEntry: (entry: { text: string }) => {
                notices.push(entry.text);
                return { dispose: () => undefined };
            },
        } as unknown as StatusBarService;
        return new RenameService(group(), quickInput, statusBar, features);
    }

    /** Ставит каретку внутрь слова `value` в объявлении (строка 0, колонка 8). */
    function caretOnValue(): void {
        group().getActiveEditor()?.goToPosition(0, 8);
    }

    it("имя от prepare подставляется в поле, новое имя уезжает провайдеру", async () => {
        const seen: { request?: IRenameRequest; newName?: string } = {};
        provider({
            prepareRename: () => name("value"),
            provideRenameEdits: (request, newName) => {
                seen.request = request;
                seen.newName = newName;
                return Promise.resolve({ applied: true });
            },
        });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened).toHaveLength(1);
        expect(opened[0]).toMatchObject({ title: "Rename Symbol", value: "value" });
        expect(seen.newName).toBe("renamed");
        expect(seen.request).toMatchObject({
            uri: Uri.file(ws.path("main.ts")).toString(),
            line: 0,
            character: 8,
        });
        expect(seen.request?.text).toContain("const value = 1;");
        expect(notices).toEqual([]);
    });

    it("prepare вернул null — поле заполняется словом под кареткой (фолбэк эталона)", async () => {
        provider({ provideRenameEdits: () => Promise.resolve({ applied: true }) });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened[0]).toMatchObject({ value: "value" });
    });

    it("prepare отказал — причина человеку, поля ввода нет", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({
            prepareRename: () => Promise.resolve({ kind: "reject", reason: "You cannot rename this element." }),
            provideRenameEdits,
        });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
        expect(notices).toEqual(["Rename failed: You cannot rename this element."]);
    });

    it("prepare вернул null И каретка не на слове — поля ввода нет вовсе", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ provideRenameEdits });
        // Колонка 13 — пробел после `=`: ни на символе под кареткой, ни на
        // символе перед ней слова нет (каретка сразу ПОСЛЕ слова словом ещё
        // считается, поэтому колонка 5 не годится).
        group().getActiveEditor()?.goToPosition(0, 13);

        await service().rename();

        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("каретка за последней строкой — молчаливый no-op, а не падение", async () => {
        // Группа целиком поддельная: настоящий редактор позицию клампует, а
        // фолбэк обязан выдержать и «протухшую» на кадр строку (образец —
        // `referencesService.test.ts`, случай «каретка за пределами текста»).
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ provideRenameEdits });
        const fakeGroup = {
            getActiveEditor: () => ({
                uri: Uri.file(ws.path("main.ts")),
                languageId: "typescript",
                getText: () => "const value = 1;\n",
                viewState: { selections: [{ active: { line: 99, character: 0 } }] },
            }),
        } as unknown as ReturnType<typeof group>;

        await new RenameService(
            fakeGroup,
            { input: () => Promise.resolve("renamed") } as unknown as QuickInputService,
            { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService,
            features,
        ).rename();

        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("Escape (undefined) и то же самое имя — провайдера не зовём", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ prepareRename: () => name("value"), provideRenameEdits });
        caretOnValue();
        typed = [undefined, "value"];

        await service().rename();
        await service().rename();

        expect(opened).toHaveLength(2);
        expect(provideRenameEdits).not.toHaveBeenCalled();
        expect(notices).toEqual([]);
    });

    it("пустое имя — сообщение, провайдера не зовём", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ prepareRename: () => name("value"), provideRenameEdits });
        caretOnValue();
        typed = [""];

        await service().rename();

        expect(provideRenameEdits).not.toHaveBeenCalled();
        expect(notices).toEqual(["Rename failed: the new name is empty"]);
    });

    it("отказ провайдера с сообщением показывается человеку", async () => {
        provider({
            prepareRename: () => name("value"),
            provideRenameEdits: () => Promise.resolve({ applied: false, error: "'class' is not a valid identifier" }),
        });
        caretOnValue();
        typed = ["class"];

        await service().rename();

        expect(notices).toEqual(["Rename failed: 'class' is not a valid identifier"]);
    });

    it("отказ БЕЗ сообщения тихий: переименовывать было нечего", async () => {
        provider({ prepareRename: () => name("value"), provideRenameEdits: () => Promise.resolve({ applied: false }) });
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(notices).toEqual([]);
    });

    it("текст пересобирается на момент применения: провайдер видит живой документ", async () => {
        const seen: { text?: string } = {};
        provider({
            prepareRename: () => name("value"),
            provideRenameEdits: (request) => {
                seen.text = request.text;
                return Promise.resolve({ applied: true });
            },
        });
        caretOnValue();
        const editor = group().getActiveEditor();
        const quickInput = {
            input: () => {
                // Пока «набирается» имя, документ уезжает — как от авто-импорта.
                editor?.pushUndo(editor.viewState.insertText("// touched\n"));
                return Promise.resolve("renamed");
            },
        } as unknown as QuickInputService;
        const statusBar = { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService;

        await new RenameService(group(), quickInput, statusBar, features).rename();

        expect(seen.text).toContain("// touched");
    });

    it("без провайдеров под документ и без активного редактора — no-op", async () => {
        caretOnValue();
        typed = ["renamed"];
        await service().rename();
        expect(opened).toEqual([]);

        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        provider({ prepareRename: () => name("value"), provideRenameEdits });
        const emptyGroup = { getActiveEditor: () => null } as unknown as ReturnType<typeof group>;
        await new RenameService(
            emptyGroup,
            { input: () => Promise.resolve("renamed") } as unknown as QuickInputService,
            { addEntry: () => ({ dispose: () => undefined }) } as unknown as StatusBarService,
            features,
        ).rename();
        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });

    it("провайдер чужого языка документ не трогает", async () => {
        const provideRenameEdits = vi.fn((): Promise<ICoreRenameResult> => Promise.resolve({ applied: true }));
        features.renameProvider.register(
            { language: "python" },
            { prepareRename: () => name("value"), provideRenameEdits },
        );
        caretOnValue();
        typed = ["renamed"];

        await service().rename();

        expect(opened).toEqual([]);
        expect(provideRenameEdits).not.toHaveBeenCalled();
    });
});
