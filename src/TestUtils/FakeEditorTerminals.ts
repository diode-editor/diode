import type {
    ITerminalEditorLocation,
    TerminalEditorService,
} from "../vs/workbench/contrib/terminal/browser/terminalEditorService.ts";
import type {
    ITerminalCreateOptions,
    ITerminalInstance,
    TerminalService,
} from "../vs/workbench/contrib/terminal/browser/terminalService.ts";

type EditorTerminals = Pick<TerminalEditorService, "createTerminal" | "splitInstance" | "reveal">;

/** Сквозной путь до вкладки — в `workbench.extensionTerminal.test.ts` на настоящем сервисе. */
export class FakeEditorTerminals implements EditorTerminals {
    public readonly created: { id: number; location: ITerminalEditorLocation | { split: number } }[] = [];
    public readonly revealed: { id: number; preserveFocus: boolean }[] = [];

    public constructor(private readonly terminals: TerminalService) {}

    public createTerminal(
        options: Omit<ITerminalCreateOptions, "target"> = {},
        location: ITerminalEditorLocation = {},
    ): ITerminalInstance {
        const instance = this.terminals.createInstance({ ...options, target: "editor" });
        this.created.push({ id: instance.id, location });
        return instance;
    }

    public splitInstance(parentId: number, options: Omit<ITerminalCreateOptions, "target"> = {}): ITerminalInstance {
        const instance = this.terminals.createInstance({ ...options, target: "editor" });
        this.created.push({ id: instance.id, location: { split: parentId } });
        return instance;
    }

    public reveal(id: number, preserveFocus: boolean): void {
        this.revealed.push({ id, preserveFocus });
    }
}
