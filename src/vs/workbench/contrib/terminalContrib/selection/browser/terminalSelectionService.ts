import type { IClipboard } from "../../../../../platform/clipboard/common/iClipboard.ts";
import { ClipboardDIToken } from "../../../../../platform/clipboard/common/iClipboard.ts";
import type { IConfigurationService } from "../../../../../platform/configuration/common/iConfigurationService.ts";
import { IConfigurationServiceDIToken } from "../../../../../platform/configuration/common/iConfigurationServiceDIToken.ts";
import type { IContextKeyContributor } from "../../../../../platform/contextkey/common/contextKeyContributor.ts";
import {
    type ContextKeyService,
    ContextKeyServiceDIToken,
} from "../../../../../platform/contextkey/common/contextKeyService.ts";
import { token } from "../../../../../platform/instantiation/common/diContainer.ts";
import {
    type ITerminalInstance,
    type TerminalService,
    TerminalServiceDIToken,
} from "../../../terminal/browser/terminalService.ts";
import type {
    ITerminalDecoratedSurface,
    ITerminalSurfaceDecoration,
    ITerminalSurfaceDecorator,
} from "../../../terminal/browser/terminalWidgetFactory.ts";

import { TerminalSelectionSurface } from "./terminalSelectionSurface.ts";

export const TerminalSelectionServiceDIToken = token<TerminalSelectionService>("TerminalSelectionService");

/**
 * The text selection of every terminal widget (upstream xterm.js `SelectionService` behind `TerminalInstance`):
 * the selection lives in the widget's surface, so each terminal keeps its own; a terminal moved to another host
 * starts without one.
 */
export class TerminalSelectionService implements ITerminalSurfaceDecorator, IContextKeyContributor {
    public static dependencies = [
        TerminalServiceDIToken,
        ClipboardDIToken,
        ContextKeyServiceDIToken,
        IConfigurationServiceDIToken,
    ] as const;

    /** The surface of the instance's current widget. */
    private readonly surfaces = new WeakMap<ITerminalInstance, TerminalSelectionSurface>();
    /** The surface of the focused terminal widget. */
    private focused: TerminalSelectionSurface | undefined;

    public constructor(
        private readonly terminals: TerminalService,
        private readonly clipboard: IClipboard,
        private readonly contextKeys: ContextKeyService,
        private readonly configuration: IConfigurationService,
    ) {}

    public decorate(instance: ITerminalInstance, inner: ITerminalDecoratedSurface): ITerminalSurfaceDecoration {
        const surface = new TerminalSelectionSurface(inner, () =>
            this.configuration.get("terminal.integrated.wordSeparators"),
        );
        this.surfaces.set(instance, surface);
        // Upstream sets the keys on `onSelectionChange`: a command run right after a drag sees them.
        surface.onDidChangeSelection(() => {
            this.updateContextKeys(this.contextKeys);
        });
        // Upstream `TerminalClipboardContribution`: the finished selection goes to the clipboard.
        surface.onDidFinishSelection(() => {
            if (this.configuration.get("terminal.integrated.copyOnSelection")) void this.copy(surface);
        });
        return {
            surface,
            attach: (widget) => {
                surface.attach(widget);
                // The selection color follows the focus.
                widget.addEventListener("focus", () => {
                    this.focused = surface;
                    surface.setFocused(true);
                });
                // The old widget's blur comes before the new one's focus.
                widget.addEventListener("blur", () => {
                    this.focused = undefined;
                    surface.setFocused(false);
                });
            },
        };
    }

    /**
     * Upstream `terminalTextSelected` — the active terminal, in the panel or an editor tab, has a selection;
     * `terminalTextSelectedInFocused` — the focused one has.
     */
    public updateContextKeys(contextKeys: ContextKeyService): void {
        contextKeys.set("terminalTextSelected", this.activeSurface()?.hasSelection === true);
        contextKeys.set("terminalTextSelectedInFocused", this.focused?.hasSelection === true);
    }

    /** Upstream `copySelection`: the selection to the clipboard; it stays selected. */
    public copySelection(): Promise<void> {
        return this.copy(this.activeSurface());
    }

    public clearSelection(): void {
        this.activeSurface()?.clearSelection();
    }

    public selectAll(): void {
        this.activeSurface()?.selectAll();
    }

    private async copy(surface: TerminalSelectionSurface | undefined): Promise<void> {
        const text = surface?.selectionText;
        if (text !== undefined) await this.clipboard.writeText(text);
    }

    private activeSurface(): TerminalSelectionSurface | undefined {
        const instance = this.terminals.getActiveInstanceAcrossHosts();
        return instance === null ? undefined : this.surfaces.get(instance);
    }
}
