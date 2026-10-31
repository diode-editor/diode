import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { diskFileService } from "../../../../../TestUtils/diskFileService.ts";
import { createTempWorkspace, type ITempWorkspace } from "../../../../../TestUtils/TempWorkspace.ts";
import { Uri } from "../../../../base/common/uri.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import { NULL_CONFIGURATION_SERVICE } from "../../../../platform/configuration/common/nullConfigurationService.ts";
import { TrashService } from "../../../../platform/files/node/trashService.ts";
import { UndoRedoService, WORKSPACE_UNDO_CONTEXT } from "../../../../platform/undoRedo/common/undoRedoService.ts";
import { type IBulkEditBuffers, NULL_BULK_EDIT_BUFFERS } from "../common/iBulkEditBuffers.ts";
import type {
    FileOperationKind,
    IFileOperationPair,
    IFileOperationParticipant,
} from "../common/iFileOperationParticipant.ts";
import type { BulkEdit } from "../common/workspaceEdit.ts";

import { WorkspaceEditService } from "./workspaceEditService.ts";

let ws: ITempWorkspace;
let dir: string;

beforeEach(() => {
    ws = createTempWorkspace({ prefix: "diode-wes-fileops-" });
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

type Log = string[];

function uriOf(p: string): string {
    return Uri.file(p).toString();
}

function pairText(files: readonly IFileOperationPair[]): string {
    const name = (uri: string): string => path.basename(Uri.parse(uri).fsPath);
    return files.map((f) => `${f.source === undefined ? "" : `${name(f.source)}>`}${name(f.target)}`).join(",");
}

/** Records the order and, at "will" time, what the disk holds: that is what "before the operation" means. */
function recordingParticipant(
    log: Log,
    edit?: (operation: FileOperationKind, files: readonly IFileOperationPair[]) => BulkEdit | null,
): IFileOperationParticipant {
    return {
        willRun: (operation, files) => {
            log.push(`will ${operation} ${pairText(files)}`);
            return Promise.resolve(edit?.(operation, files) ?? null);
        },
        didRun: (operation, files) => {
            log.push(`did ${operation} ${pairText(files)}`);
        },
    };
}

function makeService(participant: IFileOperationParticipant): { service: WorkspaceEditService; undo: UndoRedoService } {
    const undo = new UndoRedoService();
    const service = new WorkspaceEditService(
        undo,
        new TrashService(),
        NO_TRASH,
        NULL_BULK_EDIT_BUFFERS,
        diskFileService(),
    );
    service.fileOperationParticipant = participant;
    return { service, undo };
}

function write(name: string, text = ""): string {
    const p = path.join(dir, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, text);
    return p;
}

describe("WorkspaceEditService — file operation participants [api:workspace.onWillCreateFiles] [api:workspace.onDidCreateFiles]", () => {
    it("runs will, then the operation, then did, with the file not there yet at will time", async () => {
        const log: Log = [];
        const target = path.join(dir, "new.txt");
        let existedAtWill: boolean | undefined;
        const { service } = makeService({
            ...recordingParticipant(log),
            willRun: (operation, files) => {
                existedAtWill = fs.existsSync(target);
                log.push(`will ${operation} ${pairText(files)}`);
                return Promise.resolve(null);
            },
        });

        await expect(service.applyWorkspaceEdit([{ kind: "create", to: target }], "t")).resolves.toBe(true);

        expect(log).toEqual(["will create new.txt", "did create new.txt"]);
        expect(existedAtWill).toBe(false);
        expect(fs.existsSync(target)).toBe(true);
    });

    it("reports a run of one kind as one event and splits it at another kind or a text edit", async () => {
        const log: Log = [];
        const a = write("a.txt", "A");
        const b = write("b.txt", "B");
        const c = write("c.txt", "C");
        const { service } = makeService(recordingParticipant(log));

        await service.applyWorkspaceEdit(
            [
                { kind: "rename", from: a, to: path.join(dir, "a2.txt") },
                { kind: "rename", from: b, to: path.join(dir, "b2.txt") },
                { kind: "delete", from: c },
                { kind: "create", to: path.join(dir, "d.txt") },
                { resource: uriOf(path.join(dir, "d.txt")), edits: [] },
                { kind: "create", to: path.join(dir, "e.txt") },
            ],
            "t",
        );

        expect(log).toEqual([
            "will move a.txt>a2.txt,b.txt>b2.txt",
            "did move a.txt>a2.txt,b.txt>b2.txt",
            "will delete c.txt",
            "did delete c.txt",
            "will create d.txt,e.txt",
            "did create d.txt,e.txt",
        ]);
    });

    it("sends nothing for an edit that is refused or a skipped operation", async () => {
        const log: Log = [];
        const existing = write("existing.txt", "x");
        const { service } = makeService(recordingParticipant(log));

        await expect(service.applyWorkspaceEdit([{ kind: "create", to: existing }], "t")).resolves.toBe(false);
        await expect(
            service.applyWorkspaceEdit([{ kind: "create", to: existing, ignoreIfExists: true }], "t"),
        ).resolves.toBe(true);
        await expect(
            service.applyWorkspaceEdit(
                [{ kind: "delete", from: path.join(dir, "nope"), ignoreIfNotExists: true }],
                "t",
            ),
        ).resolves.toBe(true);

        expect(log).toEqual([]);
    });

    it("rolls back a failed group without reporting it as done", async () => {
        const log: Log = [];
        const a = write("a.txt", "A");
        const missing = path.join(dir, "gone.txt");
        const b = write("gone.txt", "B");
        const { service } = makeService(
            recordingParticipant(log, () => {
                // The file disappears after validation: the operation fails past the plan.
                fs.rmSync(b);
                return null;
            }),
        );

        await expect(
            service.applyWorkspaceEdit(
                [
                    { kind: "rename", from: a, to: path.join(dir, "a2.txt") },
                    { kind: "rename", from: missing, to: path.join(dir, "b2.txt") },
                ],
                "t",
            ),
        ).resolves.toBe(false);

        expect(log).toEqual(["will move a.txt>a2.txt,gone.txt>b2.txt"]);
        expect(fs.existsSync(a)).toBe(true);
        expect(fs.existsSync(path.join(dir, "a2.txt"))).toBe(false);
    });

    it("applies the participant's edit before the operation, in the same undo step", async () => {
        const log: Log = [];
        const other = write("other.txt", "BAR");
        const a = write("a.txt", "A");
        let otherAtRename: string | undefined;
        const { service, undo } = makeService({
            ...recordingParticipant(log),
            willRun: () =>
                Promise.resolve([
                    {
                        resource: uriOf(other),
                        edits: [
                            {
                                range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } },
                                text: "FOO",
                            },
                        ],
                    },
                ]),
            didRun: () => {
                otherAtRename = fs.readFileSync(other, "utf8");
            },
        });

        await service.applyWorkspaceEdit([{ kind: "rename", from: a, to: path.join(dir, "b.txt") }], "t");
        expect(otherAtRename).toBe("FOO");

        await undo.undo(WORKSPACE_UNDO_CONTEXT);
        expect(fs.readFileSync(other, "utf8")).toBe("BAR");
        expect(fs.existsSync(a)).toBe(true);
        expect(undo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });

    it("goes on when the participant's edit is refused", async () => {
        const log: Log = [];
        const target = path.join(dir, "new.txt");
        const { service } = makeService(
            recordingParticipant(log, () => [
                // Note 2 of the API: the file doesn't exist yet, so this edit cannot apply.
                {
                    resource: uriOf(target),
                    edits: [
                        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, text: "nope" },
                    ],
                },
            ]),
        );

        await expect(service.applyWorkspaceEdit([{ kind: "create", to: target }], "t")).resolves.toBe(true);

        expect(fs.readFileSync(target, "utf8")).toBe("");
        expect(log).toEqual(["will create new.txt", "did create new.txt"]);
    });

    it("fires the events of a file operation inside the participant's edit too", async () => {
        const log: Log = [];
        const a = write("a.txt");
        const b = write("b.txt");
        const { service } = makeService(
            recordingParticipant(log, (_operation, files) =>
                files[0].target === uriOf(a) ? [{ kind: "delete", from: b }] : null,
            ),
        );

        await expect(service.applyWorkspaceEdit([{ kind: "delete", from: a }], "t")).resolves.toBe(true);

        expect(log).toEqual(["will delete a.txt", "will delete b.txt", "did delete b.txt", "did delete a.txt"]);
        expect(fs.existsSync(b)).toBe(false);
    });

    it("on undo and redo reports the reverse operation and asks no participant", async () => {
        const log: Log = [];
        const a = write("a.txt", "A");
        const { service, undo } = makeService(recordingParticipant(log));
        await service.applyWorkspaceEdit([{ kind: "rename", from: a, to: path.join(dir, "b.txt") }], "t");
        log.length = 0;

        await undo.undo(WORKSPACE_UNDO_CONTEXT);
        expect(log).toEqual(["did move b.txt>a.txt"]);
        log.length = 0;

        await undo.redo(WORKSPACE_UNDO_CONTEXT);
        expect(log).toEqual(["did move a.txt>b.txt"]);
    });

    it("undoing a create reports a delete, redoing it a create", async () => {
        const log: Log = [];
        const { service, undo } = makeService(recordingParticipant(log));
        await service.applyWorkspaceEdit([{ kind: "create", to: path.join(dir, "n.txt") }], "t");
        log.length = 0;

        await undo.undo(WORKSPACE_UNDO_CONTEXT);
        await undo.redo(WORKSPACE_UNDO_CONTEXT);

        expect(log).toEqual(["did delete n.txt", "did create n.txt"]);
    });

    it("a permanent delete reports did and leaves no undo step", async () => {
        const log: Log = [];
        const a = write("a.txt");
        const { service, undo } = makeService(recordingParticipant(log));

        await service.applyWorkspaceEdit([{ kind: "delete", from: a }], "t");

        expect(log).toEqual(["will delete a.txt", "did delete a.txt"]);
        expect(undo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(false);
    });
});

describe("WorkspaceEditService — explorer operations [api:workspace.onWillRenameFiles] [api:workspace.onDidRenameFiles]", () => {
    it("reports file and folder create, rename and delete", async () => {
        const log: Log = [];
        const { service } = makeService(recordingParticipant(log));
        const folder = path.join(dir, "folder");

        await service.applyFileEdits([{ kind: "create", to: folder, directory: true }], "t");
        await service.applyFileEdits([{ kind: "rename", from: folder, to: path.join(dir, "renamed") }], "t");
        await service.applyFileEdits([{ kind: "delete", from: path.join(dir, "renamed") }], "t");

        expect(log).toEqual([
            "will create folder",
            "did create folder",
            "will move folder>renamed",
            "did move folder>renamed",
            "will delete renamed",
            "did delete renamed",
        ]);
    });

    it("reports a paste as one event with the targets it picked", async () => {
        const log: Log = [];
        const a = write("src/a.txt");
        const b = write("src/b.txt");
        write("dest/a.txt");
        const { service } = makeService(recordingParticipant(log));

        await service.applyFileEdits(
            [
                { kind: "copy", from: a, to: path.join(dir, "dest") },
                { kind: "copy", from: b, to: path.join(dir, "dest") },
            ],
            "Paste",
        );

        expect(log).toEqual(["will copy a.txt>a copy.txt,b.txt>b.txt", "did copy a.txt>a copy.txt,b.txt>b.txt"]);
    });

    it("a cut pasted into its own directory is no operation at all", async () => {
        const log: Log = [];
        const a = write("a.txt");
        const { service } = makeService(recordingParticipant(log));

        await service.applyFileEdits([{ kind: "move", from: a, to: dir }], "Move");

        expect(log).toEqual([]);
    });

    it("reports only the entries that made it, without stopping at a failed one", async () => {
        const log: Log = [];
        const a = write("a.txt");
        const { service } = makeService(recordingParticipant(log));

        await service.applyFileEdits(
            [
                { kind: "rename", from: path.join(dir, "missing.txt"), to: path.join(dir, "x.txt") },
                { kind: "rename", from: a, to: path.join(dir, "b.txt") },
            ],
            "t",
        );

        expect(log).toEqual(["will move missing.txt>x.txt,a.txt>b.txt", "did move a.txt>b.txt"]);
        expect(fs.existsSync(path.join(dir, "b.txt"))).toBe(true);
    });

    it("keeps the participant's edit in the explorer's undo step", async () => {
        const other = write("other.txt", "BAR");
        const a = write("a.txt");
        const { service, undo } = makeService(
            recordingParticipant([], () => [
                {
                    resource: uriOf(other),
                    edits: [
                        { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, text: "FOO" },
                    ],
                },
            ]),
        );

        await service.applyFileEdits([{ kind: "rename", from: a, to: path.join(dir, "b.txt") }], "Rename");
        expect(fs.readFileSync(other, "utf8")).toBe("FOO");

        await undo.undo(WORKSPACE_UNDO_CONTEXT);

        expect(fs.readFileSync(other, "utf8")).toBe("BAR");
        expect(fs.existsSync(a)).toBe(true);
    });
});

const INVOKING_TAB = "invoking-tab";

function tabOf(resource: string): string {
    return `tab:${resource}`;
}

/** `open` are the resources with a tab; with nothing touched the step belongs to the tab it was invoked from. */
function fakeBuffers(open: readonly string[], willDelete: string[] = []): IBulkEditBuffers {
    return {
        ...NULL_BULK_EDIT_BUFFERS,
        get: (resource) =>
            open.includes(resource)
                ? {
                      text: () => "BAR",
                      applyEdits: (_edits, label) => ({
                          label,
                          resources: [],
                          undo: () => undefined,
                          redo: () => undefined,
                      }),
                      setEol: () => null,
                      save: () => Promise.resolve(),
                  }
                : null,
        willDelete: (resource) => {
            willDelete.push(resource);
        },
        undoParticipants: (touched) =>
            touched.length === 0
                ? [{ context: INVOKING_TAB, label: "tab", owner: false }]
                : touched.map((resource) => ({ context: tabOf(resource), label: resource, owner: true })),
    };
}

function serviceOver(
    buffers: IBulkEditBuffers,
    participant: IFileOperationParticipant,
): { service: WorkspaceEditService; undo: UndoRedoService } {
    const undo = new UndoRedoService();
    const service = new WorkspaceEditService(undo, new TrashService(), NO_TRASH, buffers, diskFileService());
    service.fileOperationParticipant = participant;
    return { service, undo };
}

function textEdit(resource: string): BulkEdit {
    return [
        {
            resource,
            edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, text: "FOO" }],
        },
    ];
}

describe("WorkspaceEditService — the undo step of a participant's edit", () => {
    it("an explorer step with a participant's edit is in the tab's bucket and the explorer's, which don't own it", async () => {
        const other = write("other.txt", "BAR");
        const a = write("a.txt");
        const tab = tabOf(uriOf(other));
        const { service, undo } = serviceOver(
            fakeBuffers([uriOf(other)]),
            recordingParticipant([], () => textEdit(uriOf(other))),
        );

        await service.applyFileEdits([{ kind: "rename", from: a, to: path.join(dir, "b.txt") }], "Rename");

        expect(undo.canUndo(tab)).toBe(true);
        expect(undo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);

        // The explorer's bucket holds no edit of its own: losing it doesn't break the step.
        undo.clear(WORKSPACE_UNDO_CONTEXT);
        await expect(undo.undo(tab)).resolves.toBe(true);
        expect(fs.existsSync(a)).toBe(true);
    });

    it("an explorer step without such an edit stays out of the invoking tab", async () => {
        const a = write("a.txt");
        const { service, undo } = serviceOver(fakeBuffers([]), recordingParticipant([]));

        await service.applyFileEdits([{ kind: "rename", from: a, to: path.join(dir, "b.txt") }], "Rename");

        expect(undo.canUndo(INVOKING_TAB)).toBe(false);
        expect(undo.canUndo(WORKSPACE_UNDO_CONTEXT)).toBe(true);
    });

    it("a file a participant deletes loses its unsaved edits and is in the step's resources", async () => {
        const a = write("a.txt");
        const b = write("b.txt");
        const dropped: string[] = [];
        const { service, undo } = serviceOver(
            fakeBuffers([], dropped),
            recordingParticipant([], (_operation, files) =>
                files[0].target === uriOf(path.join(dir, "a2.txt")) ? [{ kind: "delete", from: b }] : null,
            ),
        );

        await service.applyWorkspaceEdit([{ kind: "rename", from: a, to: path.join(dir, "a2.txt") }], "t");

        expect(dropped).toEqual([uriOf(b)]);
        expect(undo.peekUndo(INVOKING_TAB)?.resources).toContain(b);
    });

    it("the edit of a participant of a participant's operation joins the step too", async () => {
        const other = write("other.txt", "BAR");
        const a = write("a.txt");
        const b = write("b.txt");
        const { service, undo } = serviceOver(
            fakeBuffers([uriOf(other)]),
            recordingParticipant([], (_operation, files) => {
                if (files[0].target === uriOf(a)) return [{ kind: "delete", from: b }];
                return files[0].target === uriOf(b) ? textEdit(uriOf(other)) : null;
            }),
        );

        await service.applyWorkspaceEdit([{ kind: "delete", from: a }], "t");

        expect(undo.canUndo(tabOf(uriOf(other)))).toBe(true);
    });
});

describe("WorkspaceEditService — operations that report themselves", () => {
    it("a move to another directory reports the target it picked, and undo reports it back", async () => {
        const log: Log = [];
        const a = write("src/a.txt");
        write("dest/a.txt");
        const { service, undo } = makeService(recordingParticipant(log));

        await service.applyFileEdits([{ kind: "move", from: a, to: path.join(dir, "dest") }], "Move");
        expect(log).toEqual(["will move a.txt>a copy.txt", "did move a.txt>a copy.txt"]);
        log.length = 0;

        await undo.undo(WORKSPACE_UNDO_CONTEXT);
        expect(log).toEqual(["did move a copy.txt>a.txt"]);
    });

    it("undoing a copy asks first and reports a delete", async () => {
        const log: Log = [];
        const a = write("src/a.txt");
        const { service, undo } = makeService(recordingParticipant(log));

        const element = await service.applyFileEdits([{ kind: "copy", from: a, to: path.join(dir, "dest") }], "Paste");
        expect(element?.confirmBeforeUndo).toBe("Are you sure you want to delete 'a.txt'?");
        log.length = 0;

        await undo.undo(WORKSPACE_UNDO_CONTEXT);
        expect(log).toEqual(["did delete a.txt"]);
    });

    it("undoing a delete from the trash reports a create", async () => {
        const saved = process.env.XDG_DATA_HOME;
        process.env.XDG_DATA_HOME = path.join(dir, ".data");
        try {
            const log: Log = [];
            const a = write("a.txt");
            const undo = new UndoRedoService();
            const service = new WorkspaceEditService(
                undo,
                new TrashService(),
                {
                    ...NULL_CONFIGURATION_SERVICE,
                    get<T>(key: string, def?: T): T | undefined {
                        return key === "files.enableTrash" ? (true as unknown as T) : def;
                    },
                },
                NULL_BULK_EDIT_BUFFERS,
                diskFileService(),
            );
            service.fileOperationParticipant = recordingParticipant(log);

            await service.applyFileEdits([{ kind: "delete", from: a }], "Delete");
            log.length = 0;

            await undo.undo(WORKSPACE_UNDO_CONTEXT);
            await undo.redo(WORKSPACE_UNDO_CONTEXT);
            expect(log).toEqual(["did create a.txt", "did delete a.txt"]);
        } finally {
            if (saved === undefined) delete process.env.XDG_DATA_HOME;
            else process.env.XDG_DATA_HOME = saved;
        }
    });
});
