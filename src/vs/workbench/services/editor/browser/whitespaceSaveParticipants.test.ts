import { describe, expect, it } from "vitest";

import { createTestConfigurationService } from "../../../../../TestUtils/testConfigurationService.ts";
import { EndOfLine } from "../../../../editor/common/core/endOfLine.ts";
import { createRange } from "../../../../editor/common/core/iRange.ts";
import { LanguageFeaturesService } from "../../../../editor/common/services/languageFeaturesService.ts";
import type { ISaveSnapshot } from "../../textfile/common/iSaveParticipant.ts";

import type { IOnSaveParticipantHost } from "./onSaveParticipants.ts";
import {
    createInsertFinalNewlineOnSaveParticipant,
    createTrimFinalNewlinesOnSaveParticipant,
    createTrimWhitespaceOnSaveParticipant,
} from "./whitespaceSaveParticipants.ts";

// The participants' own edits; the full pipeline (disk, undo, order) is editorService.whitespaceOnSave.test.ts.

function snapshot(text: string, languageId = "plaintext"): ISaveSnapshot {
    return {
        uri: "file:///a.txt",
        languageId,
        versionId: 1,
        isDirty: true,
        text,
        eol: EndOfLine.LF,
        encoding: "utf8",
    };
}

/** No pane: a save without a tab (or a diff side), so there are no tokens. */
function host(settings: Record<string, unknown>): IOnSaveParticipantHost {
    return {
        configuration: createTestConfigurationService(settings),
        languageFeatures: new LanguageFeaturesService(),
        paneForUri: () => null,
    };
}

describe("createTrimWhitespaceOnSaveParticipant", () => {
    it("without a pane trims every line by default", async () => {
        const edits = await createTrimWhitespaceOnSaveParticipant(host({}))(snapshot("a  \nb"));
        expect(edits).toEqual([{ kind: "text", range: createRange(0, 1, 0, 3), text: "" }]);
    });

    it("InRegexAndStrings is read with the language override: off for this language, no tokens → nothing", async () => {
        const settings = { "[typescript]": { "files.trimTrailingWhitespaceInRegexAndStrings": false } };
        const participant = createTrimWhitespaceOnSaveParticipant(host(settings));
        expect(await participant(snapshot("a  ", "typescript"))).toEqual([]);
        expect(await participant(snapshot("a  ", "plaintext"))).toHaveLength(1);
    });
});

describe("createInsertFinalNewlineOnSaveParticipant", () => {
    it("inserts at the end of a non-blank last line", async () => {
        expect(await createInsertFinalNewlineOnSaveParticipant()(snapshot("a\nbc"))).toEqual([
            { kind: "text", range: createRange(1, 2, 1, 2), text: "\n" },
        ]);
    });

    it.each(["", "a\n", "a\n \t"])("%j: no edits", async (text) => {
        expect(await createInsertFinalNewlineOnSaveParticipant()(snapshot(text))).toEqual([]);
    });
});

describe("createTrimFinalNewlinesOnSaveParticipant", () => {
    it("deletes from the line after the last non-empty one to the end", async () => {
        expect(await createTrimFinalNewlinesOnSaveParticipant()(snapshot("a\n\n\n"))).toEqual([
            { kind: "text", range: createRange(1, 0, 3, 0), text: "" },
        ]);
    });

    it("all-newline file: everything goes", async () => {
        expect(await createTrimFinalNewlinesOnSaveParticipant()(snapshot("\n\n"))).toEqual([
            { kind: "text", range: createRange(0, 0, 2, 0), text: "" },
        ]);
    });

    it.each(["", "a", "a\n", "a\n  "])("%j: no edits", async (text) => {
        expect(await createTrimFinalNewlinesOnSaveParticipant()(snapshot(text))).toEqual([]);
    });
});
