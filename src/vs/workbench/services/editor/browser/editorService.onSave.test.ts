import { NULL_LOG_SERVICE } from "../../../../platform/log/common/nullLogService.ts";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createTestEditorContextMenuController } from "../../../../../TestUtils/testEditorContextMenu.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { createCursorSelection } from "../../../../editor/common/core/iSelection.ts";
import { createTextEdit } from "../../../../editor/common/core/iTextEdit.ts";
import type { ICodeActionRequest } from "../../../../editor/common/languages/iCodeActionSource.ts";
import type { IFormattingRequest } from "../../../../editor/common/languages/iFormattingSource.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { NULL_TOKEN_STYLE_RESOLVER } from "../../../../editor/common/languages/iTokenStyleResolver.ts";
import { TokenizationRegistry } from "../../../../editor/common/languages/tokenizationRegistry.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { WorkbenchTheme } from "../../../../platform/theme/common/workbenchTheme.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { darkPlusTheme } from "../../themes/common/themes/darkPlus.ts";
import { ThemeService } from "../../themes/common/themeService.ts";

import { EditorService } from "./editorService.ts";

// Герметичный контракт пайплайна сохранения (#196, хвост): настройки
// `editor.codeActionsOnSave` / `editor.formatOnSave` включают участников поверх
// фейковых источников (стоковый стек закрыт отдельным сетевым сьютом
// extensionHost.ruffLsp.onSave.test.ts). Порядок VS Code: code actions →
// формат → will-save расширений; на диск уходит уже поправленный текст.

function stubConfigurationService(values: Record<string, unknown>): IConfigurationService {
    return {
        ...NULL_CONFIGURATION_SERVICE,
        get<T>(key: string, defaultValue?: T): T | undefined {
            return key in values ? (values[key] as T) : defaultValue;
        },
    };
}

function createEditorService(configuration: Record<string, unknown> = {}): EditorService {
    return new EditorService(
        new ThemeService(WorkbenchTheme.fromThemeFile(darkPlusTheme)),
        new TokenizationRegistry(),
        NULL_TOKEN_STYLE_RESOLVER,
        NULL_LANGUAGE_SERVICE,
        stubConfigurationService(configuration),
        new UndoRedoService(),
        NULL_FILE_WATCHER,
        createTestEditorContextMenuController(),
        NULL_LOG_SERVICE,
    );
}

describe("EditorService — сохранение по настройкам onSave", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-onsave-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    function writeFile(name: string, content: string): string {
        const fp = path.join(ws.dir, name);
        fs.writeFileSync(fp, content, "utf-8");
        return fp;
    }

    describe("editor.codeActionsOnSave", () => {
        it("прогоняет включённый вид: provide с only и полным диапазоном, apply всех действий по порядку", async () => {
            const ctrl = createEditorService({ "editor.codeActionsOnSave": { "source.fixAll": true } });
            const fp = writeFile("a.txt", "import sys\nimport os\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;

            const provided: ICodeActionRequest[] = [];
            const applied: string[] = [];
            ctrl.codeActionSource = {
                provide: (req) => {
                    provided.push(req);
                    return Promise.resolve([
                        { id: "fix.1", title: "Fix all", kind: "source.fixAll.fake" },
                        { id: "fix.2", title: "Fix more", kind: "source.fixAll.fake" },
                    ]);
                },
                apply: (id) => {
                    applied.push(id);
                    // Субпроцесс применяет правки сам (workspace.applyEdit) — имитируем.
                    if (id === "fix.1") {
                        pane.applyExternalEdits([createTextEdit(createRange(0, 0, 1, 0), "")], "fix");
                    }
                    return Promise.resolve(true);
                },
            };

            await pane.save();

            expect(provided).toHaveLength(1);
            expect(provided[0].only).toBe("source.fixAll");
            expect(provided[0].languageId).toBe("plaintext");
            // Полный диапазон документа: 3 «строки» сплита, последняя пустая.
            expect(provided[0].range).toEqual(createRange(0, 0, 2, 0));
            expect(provided[0].text).toBe("import sys\nimport os\n");
            expect(applied).toEqual(["fix.1", "fix.2"]);
            // Правка применена ДО записи: на диске уже поправленный текст.
            expect(fs.readFileSync(fp, "utf-8")).toBe("import os\n");
            ctrl.dispose();
        });

        it("иерархический ключ вида уходит в only как есть", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.organizeImports.ruff": "explicit" },
            });
            ctrl.openFile(writeFile("b.txt", "x"));

            const onlySeen: (string | undefined)[] = [];
            ctrl.codeActionSource = {
                provide: (req) => {
                    onlySeen.push(req.only);
                    return Promise.resolve([]);
                },
                apply: () => Promise.resolve(true),
            };

            await ctrl.getActiveEditor()!.save();

            expect(onlySeen).toEqual(["source.organizeImports.ruff"]);
            ctrl.dispose();
        });

        it("несколько включённых видов идут по порядку ключей, выключенные значения не идут", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": {
                    "source.fixAll": true,
                    "source.unknown": false,
                    "source.never": "never",
                    "source.organizeImports": "always",
                },
            });
            ctrl.openFile(writeFile("c.txt", "x"));

            const onlySeen: (string | undefined)[] = [];
            ctrl.codeActionSource = {
                provide: (req) => {
                    onlySeen.push(req.only);
                    return Promise.resolve(null);
                },
                apply: () => Promise.resolve(true),
            };

            await ctrl.getActiveEditor()!.save();

            expect(onlySeen).toEqual(["source.fixAll", "source.organizeImports"]);
            ctrl.dispose();
        });

        it("массивная форма настройки включает перечисленные виды", async () => {
            const ctrl = createEditorService({ "editor.codeActionsOnSave": ["source.fixAll"] });
            ctrl.openFile(writeFile("d.txt", "x"));

            const onlySeen: (string | undefined)[] = [];
            ctrl.codeActionSource = {
                provide: (req) => {
                    onlySeen.push(req.only);
                    return Promise.resolve([]);
                },
                apply: () => Promise.resolve(true),
            };

            await ctrl.getActiveEditor()!.save();

            expect(onlySeen).toEqual(["source.fixAll"]);
            ctrl.dispose();
        });
    });

    describe("editor.formatOnSave", () => {
        it("правки форматтера ложатся в буфер и на диск, каретка схлопывается на прежнее место", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            const fp = writeFile("f.txt", "a  =  1\nb=2\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;
            pane.viewState.selections = [createCursorSelection(1, 1), createCursorSelection(0, 2)];

            const requests: IFormattingRequest[] = [];
            ctrl.formattingSource = (req) => {
                requests.push(req);
                return Promise.resolve([createTextEdit(createRange(0, 0, 0, 7), "a = 1")]);
            };

            await pane.save();

            expect(requests).toHaveLength(1);
            expect(requests[0].text).toBe("a  =  1\nb=2\n");
            expect(requests[0].range).toBeUndefined();
            expect(fs.readFileSync(fp, "utf-8")).toBe("a = 1\nb=2\n");
            // Одна каретка на прежнем месте первичного выделения (сеттер
            // viewState сортирует мультикурсоры по позиции — первичное (0,2)).
            expect(pane.viewState.selections).toHaveLength(1);
            expect(pane.viewState.selections[0].active).toEqual({ line: 0, character: 2 });
            ctrl.dispose();
        });

        it("устаревший ответ форматтера (текст изменился за время RPC) отбрасывается", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            const fp = writeFile("stale.txt", "old\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;

            ctrl.formattingSource = () => {
                // Пока «форматтер думает», буфер меняется (гонка с пользователем).
                pane.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "typed:")], "user");
                return Promise.resolve([createTextEdit(createRange(0, 0, 0, 3), "NEW")]);
            };

            await pane.save();

            // Правка форматтера НЕ применена; на диск ушёл текст с правкой пользователя.
            expect(fs.readFileSync(fp, "utf-8")).toBe("typed:old\n");
            ctrl.dispose();
        });

        it("нет форматтера — сохранение молча работает", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            const fp = writeFile("nofmt.txt", "x");
            ctrl.openFile(fp);

            const outcome = await ctrl.getActiveEditor()!.save();

            expect(outcome).toBe("saved");
            ctrl.dispose();
        });
    });

    describe("композиция", () => {
        it("порядок VS Code: code actions → формат → will-save расширений, каждый по свежему тексту", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            const fp = writeFile("pipe.txt", "base\n");
            ctrl.openFile(fp);
            const pane = ctrl.getActiveEditor()!;

            const order: string[] = [];
            ctrl.codeActionSource = {
                provide: () => {
                    order.push("actions");
                    return Promise.resolve([{ id: "a", title: "fix" }]);
                },
                apply: () => {
                    pane.applyExternalEdits([createTextEdit(createRange(0, 0, 0, 0), "fixed:")], "fix");
                    return Promise.resolve(true);
                },
            };
            ctrl.formattingSource = (req) => {
                order.push("format");
                // Формат обязан видеть текст ПОСЛЕ code action.
                expect(req.text).toBe("fixed:base\n");
                return Promise.resolve([createTextEdit(createRange(0, 0, 0, 0), "fmt:")]);
            };
            ctrl.saveParticipant = (snapshot) => {
                order.push("willSave");
                // Will-save расширений видит текст после формата.
                expect(snapshot.text).toBe("fmt:fixed:base\n");
                return Promise.resolve([]);
            };

            await pane.save();

            expect(order).toEqual(["actions", "format", "willSave"]);
            expect(fs.readFileSync(fp, "utf-8")).toBe("fmt:fixed:base\n");
            ctrl.dispose();
        });

        it("с дефолтами источники не дёргаются и save остаётся синхронным", async () => {
            const ctrl = createEditorService();
            const fp = writeFile("off.txt", "as is\n");
            ctrl.openFile(fp);

            let touched = 0;
            ctrl.codeActionSource = {
                provide: () => {
                    touched++;
                    return Promise.resolve([]);
                },
                apply: () => {
                    touched++;
                    return Promise.resolve(true);
                },
            };
            ctrl.formattingSource = () => {
                touched++;
                return Promise.resolve([]);
            };

            fs.rmSync(fp);
            const pending = ctrl.getActiveEditor()!.save();

            // Пайплайн пуст (обе настройки выключены, host не подключён) —
            // запись случилась ДО первого await, в этом же тике.
            expect(fs.readFileSync(fp, "utf-8")).toBe("as is\n");
            await pending;
            expect(touched).toBe(0);
            ctrl.dispose();
        });

        it("настройка включена, но её источник не подключён — участник не в списке, save синхронный", async () => {
            // Гейты collectSaveParticipants попарные: codeActions без источника
            // и формат с выключенной настройкой обязаны выпасть из пайплайна.
            const ctrl = createEditorService({ "editor.codeActionsOnSave": { "source.fixAll": true } });
            const fp = writeFile("halfoff.txt", "x\n");
            ctrl.openFile(fp);
            ctrl.formattingSource = () => Promise.resolve([]);

            fs.rmSync(fp);
            const pending = ctrl.getActiveEditor()!.save();

            expect(fs.readFileSync(fp, "utf-8")).toBe("x\n");
            await pending;
            ctrl.dispose();
        });

        it("saveAs модели без вью (сторона диффа): панель не найдена, участники no-op, запись работает", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            // Модель БЕЗ панели — как редактируемая сторона Compare Untitled.
            const model = ctrl.createUntitledModel();
            ctrl.codeActionSource = {
                provide: () => Promise.resolve([]),
                apply: () => Promise.resolve(true),
            };
            let formatCalled = 0;
            ctrl.formattingSource = () => {
                formatCalled++;
                return Promise.resolve([]);
            };

            const dst = path.join(ws.dir, "untitled-dst.txt");
            await model.saveAs(dst);

            expect(fs.existsSync(dst)).toBe(true);
            // Формат без панели — no-op ещё до запроса к источнику.
            expect(formatCalled).toBe(0);
            ctrl.dispose();
        });

        it("настройки включены, но источников нет (host не подключён) — save работает и остаётся синхронным", async () => {
            const ctrl = createEditorService({
                "editor.codeActionsOnSave": { "source.fixAll": true },
                "editor.formatOnSave": true,
            });
            const fp = writeFile("nosrc.txt", "x");
            ctrl.openFile(fp);

            fs.rmSync(fp);
            const pending = ctrl.getActiveEditor()!.save();

            expect(fs.readFileSync(fp, "utf-8")).toBe("x");
            await expect(pending).resolves.toBe("saved");
            ctrl.dispose();
        });

        it("формат идёт по панели СОХРАНЯЕМОГО файла, а не первой попавшейся", async () => {
            const ctrl = createEditorService({ "editor.formatOnSave": true });
            writeFile("first.txt", "first\n");
            const fp = writeFile("second.txt", "second\n");
            ctrl.openFile(path.join(ws.dir, "first.txt"));
            ctrl.openFile(fp);

            const texts: string[] = [];
            ctrl.formattingSource = (req) => {
                texts.push(req.text);
                return Promise.resolve([]);
            };

            await ctrl.getActiveEditor()!.save();

            // Панель ищется по uri снапшота: запрос обязан нести текст second.txt.
            expect(texts).toEqual(["second\n"]);
            ctrl.dispose();
        });
    });
});
