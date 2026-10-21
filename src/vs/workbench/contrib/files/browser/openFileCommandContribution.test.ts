import { describe, expect, it } from "vitest";

import { CommandRegistry } from "../../../../platform/commands/common/commandRegistry.ts";
import type { WorkbenchContextKeys } from "../../../browser/workbenchContextKeys.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";

import { OpenFileCommandContribution } from "./openFileCommandContribution.ts";

class FakeEditorService {
    public opened: string[] = [];
    public options: unknown[] = [];
    public openFile(path: string, options: unknown): void {
        this.opened.push(path);
        this.options.push(options);
    }
}

class FakeContextKeys {
    public updates = 0;
    public update(): void {
        this.updates++;
    }
}

describe("OpenFileCommandContribution", () => {
    it("registers workbench.openFile: opens the file and updates context keys", () => {
        const commands = new CommandRegistry();
        const editorService = new FakeEditorService();
        const contextKeys = new FakeContextKeys();
        new OpenFileCommandContribution(
            commands,
            editorService as unknown as IEditorService,
            contextKeys as unknown as WorkbenchContextKeys,
        );

        commands.execute("workbench.openFile", "/ws/alpha.txt");

        expect(editorService.opened).toEqual(["/ws/alpha.txt"]);
        expect(contextKeys.updates).toBe(1);
    });

    it("the second argument is open options: the tree asks for preview", () => {
        const commands = new CommandRegistry();
        const editorService = new FakeEditorService();
        new OpenFileCommandContribution(
            commands,
            editorService as unknown as IEditorService,
            new FakeContextKeys() as unknown as WorkbenchContextKeys,
        );

        commands.execute("workbench.openFile", "/ws/alpha.txt", { preview: true });

        expect(editorService.options).toEqual([{ preview: true }]);
    });

    it("without the second argument (CLI, Quick Open) there are no options — a pinned tab", () => {
        const commands = new CommandRegistry();
        const editorService = new FakeEditorService();
        new OpenFileCommandContribution(
            commands,
            editorService as unknown as IEditorService,
            new FakeContextKeys() as unknown as WorkbenchContextKeys,
        );

        commands.execute("workbench.openFile", "/ws/alpha.txt");

        // An empty object, not `undefined`: `preview` stays off.
        expect(editorService.options).toEqual([{}]);
    });

    it("a command without title does not appear in the command palette", () => {
        const commands = new CommandRegistry();
        new OpenFileCommandContribution(
            commands,
            new FakeEditorService() as unknown as IEditorService,
            new FakeContextKeys() as unknown as WorkbenchContextKeys,
        );

        expect(commands.listCommands().some((c) => c.id === "workbench.openFile")).toBe(false);
    });
});
