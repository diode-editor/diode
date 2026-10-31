import { describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { Uri } from "../../../../base/common/uri.ts";
import { NULL_LANGUAGE_SERVICE } from "../../../../editor/common/languages/iLanguageService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";

import { TextFileModel, untitledUriOf } from "./textFileModel.ts";

function make(languageOf: (filePath: string) => string | undefined = () => undefined): TextFileModel {
    const languages = { ...NULL_LANGUAGE_SERVICE, getLanguageIdForResource: languageOf };
    return new TextFileModel(languages, new UndoRedoService(), diskFileService());
}

describe("TextFileModel — untitled under a named resource", () => {
    it("an associated resource is dirty with no edits and takes its language from the path", () => {
        const model = make((filePath) => (filePath.endsWith(".md") ? "markdown" : undefined));
        model.setUntitledResource(Uri.parse("untitled:/some/page.md"), { associated: true });

        expect(model.isModified).toBe(true);
        expect(model.languageId).toBe("markdown");
        expect(model.uri.toString()).toBe("untitled:/some/page.md");
        model.dispose();
    });

    it("an associated resource with an unknown language keeps the buffer's language", () => {
        const model = make();
        const before = model.languageId;
        model.setUntitledResource(Uri.parse("untitled:/some/file.unknown"), { associated: true });

        expect(model.languageId).toBe(before);
        model.dispose();
    });

    it("a resource that is only a name stays clean and keeps its language", () => {
        const model = make(() => "markdown");
        const before = model.languageId;
        model.setUntitledResource(Uri.parse("untitled:Untitled-7.md"), { associated: false });

        expect(model.isModified).toBe(false);
        expect(model.languageId).toBe(before);
        model.dispose();
    });

    it.each([
        ["relative", "untitled:new.txt"],
        ["with a host", "untitled://localhost/c%24/new.txt"],
    ])("%s has no path to write to: save reports no file", async (_name, uri) => {
        const model = make();
        model.setUntitledResource(Uri.parse(uri), { associated: true });

        expect(await model.save()).toBe("no-file");
        expect(model.isModified).toBe(true);
        model.dispose();
    });

    it("the number of an automatic name is the path of its uri", () => {
        expect(untitledUriOf(3).toString()).toBe("untitled:Untitled-3");
    });
});
