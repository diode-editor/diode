import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import {
    DEFAULT_LARGE_FILE_OPTIONS,
    type ILargeFileOptions,
    LARGE_FILE_LINE_COUNT_THRESHOLD,
    MiB,
} from "../../../../editor/common/model/largeFileOptions.ts";
import { NULL_FILE_WATCHER } from "../../../../platform/files/common/iFileWatcher.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel } from "./textFileModel.ts";
import { largeFileOptionsFromConfiguration, TextFileModelService } from "./textFileModelService.ts";

/** Two lines are "many" here: the mode is about the decision, not the megabytes. */
const TINY: ILargeFileOptions = { largeFileOptimizations: true, sizeThresholdMb: 1, lineCountThreshold: 2 };

describe("TextFileModel — the large-file mode", () => {
    let ws: ITempWorkspace;

    beforeEach(() => {
        ws = createTempWorkspace({ prefix: "diode-large-file-model-" });
    });
    afterEach(() => {
        ws.dispose();
    });

    function model(options?: ILargeFileOptions): TextFileModel {
        const result = new TextFileModel(NULL_LANGUAGE_SERVICE, new UndoRedoService(), diskFileService());
        if (options !== undefined) result.largeFileOptions = () => options;
        return result;
    }

    function open(name: string, content: string, options?: ILargeFileOptions): TextFileModel {
        const result = model(options);
        result.openFile(Uri.file(ws.writeFile(name, content)));
        return result;
    }

    it("upstream defaults: above 300K lines the file is too large, at 300K it is not", () => {
        const above = open("above.txt", "\n".repeat(LARGE_FILE_LINE_COUNT_THRESHOLD));
        expect(above.document.lineCount).toBe(LARGE_FILE_LINE_COUNT_THRESHOLD + 1);
        expect(above.isTooLargeForTokenization).toBe(true);

        const at = open("at.txt", "\n".repeat(LARGE_FILE_LINE_COUNT_THRESHOLD - 1));
        expect(at.document.lineCount).toBe(LARGE_FILE_LINE_COUNT_THRESHOLD);
        expect(at.isTooLargeForTokenization).toBe(false);
        expect(model().largeFileOptions("plaintext")).toBe(DEFAULT_LARGE_FILE_OPTIONS);
    });

    it("the size axis counts characters against `sizeThresholdMb`", () => {
        expect(open("big.txt", "x".repeat(MiB + 1), TINY).isTooLargeForTokenization).toBe(true);
        expect(open("fits.txt", "x".repeat(MiB), TINY).isTooLargeForTokenization).toBe(false);
    });

    it("with the optimizations off nothing is too large", () => {
        const off = { ...TINY, largeFileOptimizations: false };
        expect(open("a.txt", "1\n2\n3\n4", off).isTooLargeForTokenization).toBe(false);
    });

    it("decided once, on the first load: a reload keeps it either way", () => {
        const small = open("grows.txt", "1\n2", TINY);
        expect(small.isTooLargeForTokenization).toBe(false);
        ws.writeFile("grows.txt", "1\n2\n3\n4\n5");
        expect(small.revertToDisk()).toBe(true);
        expect(small.document.lineCount).toBe(5);
        expect(small.isTooLargeForTokenization).toBe(false);

        const large = open("shrinks.txt", "1\n2\n3\n4\n5", TINY);
        expect(large.isTooLargeForTokenization).toBe(true);
        ws.writeFile("shrinks.txt", "1");
        expect(large.revertToDisk()).toBe(true);
        expect(large.document.lineCount).toBe(1);
        expect(large.isTooLargeForTokenization).toBe(true);
    });

    it("forcefullyEnableFeatures: one event, then a no-op; never on an ordinary file", () => {
        const large = open("a.txt", "1\n2\n3", TINY);
        let fired = 0;
        large.onDidChangeTooLargeForTokenization(() => fired++);

        large.forcefullyEnableFeatures();
        expect(large.isTooLargeForTokenization).toBe(false);
        expect(fired).toBe(1);

        large.forcefullyEnableFeatures();
        expect(fired).toBe(1);

        const small = open("b.txt", "1", TINY);
        small.onDidChangeTooLargeForTokenization(() => fired++);
        small.forcefullyEnableFeatures();
        expect(fired).toBe(1);
    });

    it("a provider resource is decided the same way", () => {
        const provided = model(TINY);
        provided.openProvided(Uri.parse("memfs:/a.txt"), new TextEncoder().encode("1\n2\n3"));
        expect(provided.isTooLargeForTokenization).toBe(true);
    });

    describe("largeFileOptionsFromConfiguration", () => {
        it("without a configuration — the upstream constants", () => {
            expect(largeFileOptionsFromConfiguration(undefined)("plaintext")).toBe(DEFAULT_LARGE_FILE_OPTIONS);
        });

        it("reads the three keys per language", () => {
            const configuration = createTestConfigurationService({
                "editor.largeFileLineCountThreshold": 7,
                "editor.largeFileSizeThreshold": 3,
                "[log]": { "editor.largeFileOptimizations": false },
            });
            const options = largeFileOptionsFromConfiguration(configuration);
            expect(options("plaintext")).toEqual({
                largeFileOptimizations: true,
                sizeThresholdMb: 3,
                lineCountThreshold: 7,
            });
            expect(options("log").largeFileOptimizations).toBe(false);
        });

        it("TextFileModelService hands them to every model it creates", () => {
            const configuration = createTestConfigurationService({ "editor.largeFileLineCountThreshold": 1 });
            const service = new TextFileModelService(
                NULL_LANGUAGE_SERVICE,
                new UndoRedoService(),
                diskFileService(),
                NULL_FILE_WATCHER,
                configuration,
            );
            const path = ws.writeFile("c.txt", "1\n2\n3");
            const ref = service.acquire(Uri.file(path));
            expect(ref.model.isTooLargeForTokenization).toBe(true);
            ref.dispose();
            service.dispose();

            const plain = new TextFileModelService(
                NULL_LANGUAGE_SERVICE,
                new UndoRedoService(),
                diskFileService(),
                NULL_FILE_WATCHER,
            );
            const plainRef = plain.acquire(Uri.file(path));
            expect(plainRef.model.isTooLargeForTokenization).toBe(false);
            plainRef.dispose();
            plain.dispose();
        });
    });
});
