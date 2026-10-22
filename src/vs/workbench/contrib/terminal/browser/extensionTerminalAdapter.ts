import { DisposableStore, type IDisposable } from "../../../../base/common/lifecycle.ts";
import type { IConfigurationService } from "../../../../platform/configuration/common/iConfigurationService.ts";
import type { IExtensionTerminalEvents, IExtensionTerminalSink } from "../../../api/common/iExtensionWindowSinks.ts";
import type {
    IWireTerminalCreate,
    IWireTerminalLaunch,
    IWireTerminalLocation,
    IWireTerminalOpened,
    IWireTerminalRef,
} from "../../../api/common/wireTypes.ts";
import type { ViewsService } from "../../../browser/parts/views/viewsService.ts";
import type { IExtensionPtyTerminalOptions, IExtensionPtyTerminals } from "../common/extensionPtyTerminals.ts";
import type { ExtensionPtySessionFactory, IExtensionPtySession } from "../common/terminalSessionFactory.ts";

import type { ITerminalEditorLocation, TerminalEditorService } from "./terminalEditorService.ts";
import {
    INITIAL_COLS,
    INITIAL_ROWS,
    type ITerminalCreateOptions,
    type ITerminalInstance,
    TERMINAL_VIEW_ID,
    type TerminalService,
} from "./terminalService.ts";

export type IExtensionEditorTerminals = Pick<TerminalEditorService, "createTerminal" | "splitInstance" | "reveal">;

type TerminalPlace =
    | { readonly kind: "panel" }
    | { readonly kind: "editor"; readonly location: ITerminalEditorLocation }
    | { readonly kind: "split"; readonly parentId: number };

/**
 * The lifecycle of ALL instances (including the user's shells) goes to the subscriber, so
 * `window.terminals` sees every terminal, as in upstream. The subprocess addresses its own
 * terminal by `extHostId` until it learns the host id from `opened`.
 */
export class ExtensionTerminalAdapter implements IExtensionTerminalSink, IExtensionPtyTerminals {
    /** Only a handful of terminals — reverse lookup is a linear scan. */
    private readonly byExtHostId = new Map<number, number>();
    /** `onDidCreateInstance` fires inside `createInstance`, before it returns the instance. */
    private creating: number | undefined;
    private events: IExtensionTerminalEvents | null = null;
    /** The key allows `undefined` (unresolved address) — a lookup by it is simply empty. */
    private readonly ptySessions = new Map<number | undefined, IExtensionPtySession>();
    /** The extension sees `exitStatus.code` as `undefined`, as in upstream. */
    private readonly ptyExitedWithoutCode = new Set<number | undefined>();

    public constructor(
        private readonly terminals: TerminalService,
        private readonly views: ViewsService,
        private readonly createPtySession: ExtensionPtySessionFactory,
        private readonly editorTerminals: IExtensionEditorTerminals,
        private readonly configuration: IConfigurationService,
    ) {}

    public snapshot(): { readonly terminals: readonly IWireTerminalOpened[]; readonly activeId: number | null } {
        const all = [
            ...this.terminals.getInstances(),
            ...this.terminals.getBackgroundInstances(),
            ...this.terminals.getEditorInstances(),
        ].sort((a, b) => a.id - b.id);
        return {
            terminals: all.map((instance) => this.toOpened(instance)),
            activeId: this.terminals.getActiveInstanceAcrossHosts()?.id ?? null,
        };
    }

    public subscribe(events: IExtensionTerminalEvents): IDisposable {
        const store = new DisposableStore();
        this.events = events;
        store.add({
            dispose: () => {
                if (this.events === events) this.events = null;
            },
        });
        store.add(
            this.terminals.onDidCreateInstance((instance) => {
                events.opened(this.toOpened(instance));
            }),
        );
        store.add(
            this.terminals.onDidDisposeInstance((instance) => {
                const withoutCode = this.ptyExitedWithoutCode.delete(instance.id);
                this.ptySessions.delete(instance.id);
                events.closed({
                    id: instance.id,
                    ...(instance.exitCode !== undefined && !withoutCode ? { code: instance.exitCode } : {}),
                    reason: instance.exitReason,
                });
                // A closed terminal's label no longer addresses anything (a foreign one has none).
                for (const [extHostId, id] of this.byExtHostId) {
                    if (id === instance.id) this.byExtHostId.delete(extHostId);
                }
            }),
        );
        store.add(
            this.terminals.onDidChangeActiveInstanceAcrossHosts((instance) => {
                events.activeChanged(instance === null ? null : instance.id);
            }),
        );
        return store;
    }

    public create(request: IWireTerminalCreate): void {
        // A repeated label is not our case (the subprocess mints them monotonically); a second
        // instance under the same label would make the first one unaddressable.
        if (this.byExtHostId.has(request.extHostId)) return;
        // Resolve the parent before creating: the new label means nothing yet.
        const place = this.resolvePlace(request.location);
        this.creating = request.extHostId;
        try {
            if (request.pty === true) {
                this.createPty(request.extHostId, request.name ?? "", place);
                return;
            }
            // Wire parsing already filtered the fields; the extra label and location don't bother the service.
            const instance = this.createIn(place, request);
            this.byExtHostId.set(request.extHostId, instance.id);
        } finally {
            this.creating = undefined;
        }
    }

    public show(terminal: IWireTerminalRef, preserveFocus: boolean): void {
        const id = this.resolve(terminal);
        if (id === undefined) return;
        this.terminals.showInstance(id);
        if (this.terminals.getInstance(id)?.target === "editor") {
            // Upstream `setActiveInstance`: the tab is the active terminal even when revealed in an inactive group.
            this.terminals.setActiveEditorInstance(id);
            this.editorTerminals.reveal(id, preserveFocus);
            return;
        }
        this.views.openView(TERMINAL_VIEW_ID, false, false);
        if (!preserveFocus) this.terminals.focusActive();
    }

    /** Hides only if this terminal is the one shown. */
    public hide(terminal: IWireTerminalRef): void {
        const active = this.terminals.getActiveInstance();
        if (active === null || active.id !== this.resolve(terminal)) return;
        this.views.closeView(TERMINAL_VIEW_ID);
    }

    /** The service silently skips an unresolved address. */
    public sendText(terminal: IWireTerminalRef, text: string, shouldExecute: boolean): void {
        this.terminals.sendText(this.resolve(terminal), text, shouldExecute);
    }

    public dispose(terminal: IWireTerminalRef): void {
        this.terminals.closeInstance(this.resolve(terminal), "extension");
    }

    public ptyData(terminal: IWireTerminalRef, data: string): void {
        this.ptySessions.get(this.resolve(terminal))?.feed(data);
    }

    public ptyExit(terminal: IWireTerminalRef, code: number | undefined): void {
        const id = this.resolve(terminal);
        const session = this.ptySessions.get(id);
        if (session === undefined) return;
        // A task terminal survives pty exit and restarts — the
        // "no code" flag refers to the last exit.
        if (code === undefined) this.ptyExitedWithoutCode.add(id);
        else this.ptyExitedWithoutCode.delete(id);
        session.exit(code);
    }

    /**
     * The subprocess attaches the pty by instance id once it learns the task started;
     * `ptyStart` is sent right away — the subprocess remembers it.
     */
    public createPtyInstance(options: IExtensionPtyTerminalOptions): number {
        return this.createPtySessionInstance(options.name, options);
    }

    /** Pty terminals close — their process died with the subprocess; shells stay alive. */
    public reset(): void {
        this.byExtHostId.clear();
        for (const id of [...this.ptySessions.keys()]) this.terminals.closeInstance(id, "process");
    }

    private labelOf(instanceId: number): number | undefined {
        for (const [extHostId, id] of this.byExtHostId) if (id === instanceId) return extHostId;
        return undefined;
    }

    /** `ptyStart` goes out at once, like upstream `$startExtensionTerminal`; the real size comes via `ptyResize`. */
    private createPty(extHostId: number, name: string, place: TerminalPlace): void {
        this.byExtHostId.set(extHostId, this.createPtySessionInstance(name, {}, place));
    }

    private createPtySessionInstance(
        name: string,
        extra: Pick<ITerminalCreateOptions, "message" | "waitOnExit">,
        place: TerminalPlace = { kind: "panel" },
    ): number {
        // The instance id is known only after createInstance; widget input and resize can't happen earlier.
        // Stryker disable next-line UnaryOperator: placeholder until createInstance — session callbacks never see it
        let instanceId = -1;
        const session = this.createPtySession({
            cols: INITIAL_COLS,
            rows: INITIAL_ROWS,
            name,
            onInput: (data) => {
                this.events?.ptyInput(instanceId, data);
            },
            onResize: (cols, rows) => {
                this.events?.ptyResize(instanceId, cols, rows);
            },
        });
        // The service already treats an empty name as "not set".
        const instance = this.createIn(place, { ...extra, name, session });
        instanceId = instance.id;
        this.ptySessions.set(instance.id, session);
        this.events?.ptyStart(instance.id, INITIAL_COLS, INITIAL_ROWS);
        return instance.id;
    }

    /** A parent that no longer exists is treated as no `location` (same in upstream). */
    private resolvePlace(location: IWireTerminalLocation | undefined): TerminalPlace {
        if (location === 1) return { kind: "panel" };
        if (location === 2) return { kind: "editor", location: {} };
        if (location !== undefined && "viewColumn" in location) {
            return {
                kind: "editor",
                location: { viewColumn: location.viewColumn, preserveFocus: location.preserveFocus === true },
            };
        }
        const parent =
            location === undefined ? null : this.terminals.getInstance(this.resolve(location.parentTerminal));
        if (parent !== null)
            return parent.target === "editor" ? { kind: "split", parentId: parent.id } : { kind: "panel" };
        return this.configuration.get("terminal.integrated.defaultLocation") === "editor"
            ? { kind: "editor", location: {} }
            : { kind: "panel" };
    }

    private createIn(place: TerminalPlace, options: ITerminalCreateOptions): ITerminalInstance {
        switch (place.kind) {
            case "panel":
                return this.terminals.createInstance(options);
            case "split":
                return this.editorTerminals.splitInstance(place.parentId, options);
            case "editor":
                return this.editorTerminals.createTerminal(options, place.location);
        }
    }

    private resolve(terminal: IWireTerminalRef): number | undefined {
        return "id" in terminal ? terminal.id : this.byExtHostId.get(terminal.extHostId);
    }

    private toOpened(instance: ITerminalInstance): IWireTerminalOpened {
        const extHostId = this.creating ?? this.labelOf(instance.id);
        return {
            id: instance.id,
            ...(extHostId !== undefined ? { extHostId } : {}),
            name: instance.title,
            ...(instance.processId !== undefined ? { pid: instance.processId } : {}),
            launch: toWireLaunch(instance),
        };
    }
}

function toWireLaunch(instance: ITerminalInstance): IWireTerminalLaunch {
    const { launch } = instance;
    return {
        name: instance.title,
        shellPath: launch.shellPath,
        ...(launch.shellArgs !== undefined ? { shellArgs: launch.shellArgs } : {}),
        cwd: launch.cwd,
        ...(launch.env !== undefined ? { env: launch.env } : {}),
        ...(launch.hideFromUser ? { hideFromUser: true } : {}),
    };
}
