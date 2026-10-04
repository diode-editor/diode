import * as fs from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createEditorPane } from "../../../../../TestUtils/TextEditorPaneFactory.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { ChokidarFileWatcher } from "../../../../platform/files/node/chokidarFileWatcher.ts";

/**
 * Атомарный save заменяет файл новым (временный сосед + rename, новый inode).
 * Настоящий наблюдатель обязан это пережить: собственную запись не принять за
 * чужую, а следующую внешнюю правку — увидеть.
 */
describe("TextFileModel — атомарный save и настоящий наблюдатель", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-atomic-save-" });
    });

    afterEach(() => {
        ws.dispose();
    });

    it("своя запись — не внешнее изменение; чужая после неё — перечитывается", async () => {
        const fp = ws.writeFile("a.txt", "one\n");
        const pane = createEditorPane();
        pane.model.fileWatcher = new ChokidarFileWatcher();
        pane.openFile(Uri.file(fp));
        pane.viewState.type("X");

        await expect(pane.save()).resolves.toBe("saved");
        // Даём наблюдателю отработать событие собственной записи (дебаунс 50 мс).
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(pane.model.hasDiskConflict).toBe(false);
        expect(pane.getText()).toBe("Xone\n");

        fs.writeFileSync(fp, "from outside\n");
        await vi.waitFor(
            () => {
                expect(pane.getText()).toBe("from outside\n");
            },
            { timeout: 5000 },
        );
        pane.dispose();
    });
});
