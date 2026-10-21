import { describe, expect, it } from "vitest";

import type { IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IEditorService } from "../../../services/editor/common/editorService.ts";

import { AutoRevealContribution } from "./autoRevealContribution.ts";
import type { ExplorerService } from "./explorerService.ts";

class FakeEditorService {
    public activePath: string | null = null;
    private listeners: (() => void)[] = [];

    public onActiveEditorChanged(cb: () => void): IDisposable {
        this.listeners.push(cb);
        return {
            dispose: () => {
                this.listeners = this.listeners.filter((l) => l !== cb);
            },
        };
    }

    public getActiveTabEditor(): { absoluteFilePath: string | null } | null {
        return this.activePath === null ? null : { absoluteFilePath: this.activePath };
    }

    public emit(): void {
        for (const l of this.listeners) l();
    }
}

class FakeExplorerService {
    public revealed: (string | null)[] = [];
    public autoRevealActiveFile(filePath: string | null): void {
        this.revealed.push(filePath);
    }
}

function setup(): { editor: FakeEditorService; explorer: FakeExplorerService; contribution: AutoRevealContribution } {
    const editor = new FakeEditorService();
    const explorer = new FakeExplorerService();
    const contribution = new AutoRevealContribution(
        editor as unknown as IEditorService,
        explorer as unknown as ExplorerService,
    );
    return { editor, explorer, contribution };
}

describe("AutoRevealContribution", () => {
    it("on active editor change calls autoRevealActiveFile with the active file's path", () => {
        const { editor, explorer } = setup();
        editor.activePath = "/ws/alpha.txt";

        editor.emit();

        expect(explorer.revealed).toEqual(["/ws/alpha.txt"]);
    });

    it("passes null when there is no active editor", () => {
        const { editor, explorer } = setup();
        editor.activePath = null;

        editor.emit();

        expect(explorer.revealed).toEqual([null]);
    });

    it("dispose removes the subscription", () => {
        const { editor, explorer, contribution } = setup();
        contribution.dispose();

        editor.emit();

        expect(explorer.revealed).toEqual([]);
    });
});
