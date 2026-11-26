import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import { UndoRedoService } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { NULL_BULK_EDIT_BUFFERS } from "../common/iBulkEditBuffers.ts";
import type { IFileOperationParticipant } from "../common/iFileOperationParticipant.ts";

import { WorkspaceEditService } from "./workspaceEditService.ts";

let ws: ITempWorkspace;
let dir: string;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wes-conflicts-" });
    dir = ws.dir;
});

afterEach(() => {
    ws.dispose();
});

const NO_TRASH: IConfigurationService = {
    ...NULL_CONFIGURATION_SERVICE,
    get<T>(key: string, def?: T): T | undefined {
        return key === "files.enableTrash" ? (false as unknown as T) : def;
    },
};

function makeService(participant: IFileOperationParticipant): WorkspaceEditService {
    const service = new WorkspaceEditService(
        new UndoRedoService(),
        new TrashService(),
        NO_TRASH,
        NULL_BULK_EDIT_BUFFERS,
        diskFileService(),
    );
    service.fileOperationParticipant = participant;
    return service;
}

function write(name: string, text: string): string {
    const p = path.join(dir, name);
    fs.writeFileSync(p, text);
    return p;
}

describe("WorkspaceEditService — a target that appears while participants run [api:workspace.onWillRenameFiles]", () => {
    it("does not overwrite a file written to the rename target during the participant wait", async () => {
        const source = write("source.txt", "SOURCE");
        const target = path.join(dir, "target.txt");
        const did: string[] = [];
        const service = makeService({
            willRun: () => {
                fs.writeFileSync(target, "USER DATA");
                return Promise.resolve(null);
            },
            didRun: (operation) => {
                did.push(operation);
            },
        });

        const applied = await service.applyWorkspaceEdit([{ kind: "rename", from: source, to: target }], "t");

        expect(fs.readFileSync(target, "utf8")).toBe("USER DATA");
        expect(fs.readFileSync(source, "utf8")).toBe("SOURCE");
        expect(applied).toBe(false);
        expect(did).toEqual([]);
    });

    it("does not let two concurrent renames to one target destroy a file", async () => {
        const first = write("first.txt", "FIRST");
        const second = write("second.txt", "SECOND");
        const target = path.join(dir, "target.txt");
        // Both edits pass validation before either moves: the participant holds them until both have been asked.
        let release: () => void = () => {};
        let asked = 0;
        const bothAsked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const service = makeService({
            willRun: async () => {
                asked++;
                if (asked === 2) release();
                await bothAsked;
                return null;
            },
            didRun: () => {},
        });

        const results = await Promise.all([
            service.applyWorkspaceEdit([{ kind: "rename", from: first, to: target }], "t"),
            service.applyWorkspaceEdit([{ kind: "rename", from: second, to: target }], "t"),
        ]);

        const contents = [first, second, target].filter((p) => fs.existsSync(p)).map((p) => fs.readFileSync(p, "utf8"));
        expect(contents.sort()).toEqual(["FIRST", "SECOND"]);
        expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("still replaces the target when the edit asks to overwrite", async () => {
        const source = write("source.txt", "SOURCE");
        const target = path.join(dir, "target.txt");
        const service = makeService({
            willRun: () => {
                fs.writeFileSync(target, "OLD");
                return Promise.resolve(null);
            },
            didRun: () => {},
        });

        const applied = await service.applyWorkspaceEdit(
            [{ kind: "rename", from: source, to: target, overwrite: true }],
            "t",
        );

        expect(applied).toBe(true);
        expect(fs.readFileSync(target, "utf8")).toBe("SOURCE");
    });
});
