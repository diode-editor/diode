import { Point } from "@tuidom/core/common/geometryPromitives";
import type { OverlaySessionHandle } from "@tuidom/core/dom/overlayLayer";
import type { BodyElement } from "@tuidom/elements/body/bodyElement";

import { Disposable } from "../../../../base/common/lifecycle.ts";
import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import { AboutDialog } from "../../../browser/parts/dialogs/aboutDialog.ts";
import { ConfirmDialog, type ConfirmDialogOptions } from "../../../browser/parts/dialogs/confirmDialog.ts";
import { ConfirmSaveDialog } from "../../../browser/parts/dialogs/confirmSaveDialog.ts";
import type { DialogComponent } from "../../../browser/parts/dialogs/dialogComponent.ts";

export const DialogServiceDIToken = token<DialogService>("DialogService");

export type ConfirmSaveChoice = "save" | "dontSave" | "cancel";

/**
 * Counterpart of vscode `IDialogService`. A host with an overlay layer attaches via {@link attachHost}
 * after building its view.
 */
export class DialogService extends Disposable {
    public static dependencies = [] as const;
    private host: BodyElement | null = null;

    private confirmSaveDialog: ConfirmSaveDialog | null = null;
    private confirmSaveSession: OverlaySessionHandle | null = null;

    private confirmDialog: ConfirmDialog | null = null;
    private confirmSession: OverlaySessionHandle | null = null;

    private aboutDialog: AboutDialog | null = null;
    private aboutSession: OverlaySessionHandle | null = null;

    public constructor() {
        super();
        this.register({
            dispose: () => {
                this.confirmSaveDialog?.dispose();
                this.confirmDialog?.dispose();
                this.aboutDialog?.dispose();
            },
        });
    }

    public attachHost(host: BodyElement): void {
        this.host = host;
    }

    /** One instance per app: showing it again updates the file name and callbacks. */
    public showConfirmSaveDialog(
        filename: string,
        callbacks: { onSave: () => void; onDontSave: () => void; onCancel: () => void },
    ): void {
        const host = this.requireHost();
        if (!this.confirmSaveDialog) {
            this.confirmSaveDialog = new ConfirmSaveDialog(filename);
            this.confirmSaveSession = host.overlayLayer.createSession(this.confirmSaveDialog.view, new Point(0, 0), {
                visible: false,
                restoreFocus: true,
                closeOnEscape: true,
                pointerPolicy: "modal",
            });
        } else {
            this.confirmSaveDialog.setFilename(filename);
        }
        const dialog = this.confirmSaveDialog;

        dialog.onSave = () => {
            this.confirmSaveSession?.close();
            callbacks.onSave();
        };
        dialog.onDontSave = () => {
            this.confirmSaveSession?.close();
            callbacks.onDontSave();
        };
        dialog.onCancel = () => {
            this.confirmSaveSession?.close();
            callbacks.onCancel();
        };

        this.openCentered(this.confirmSaveSession, dialog);
        dialog.focusDefault();
    }

    public confirmSave(filename: string): Promise<ConfirmSaveChoice> {
        return new Promise((resolve) => {
            this.showConfirmSaveDialog(filename, {
                onSave: () => {
                    resolve("save");
                },
                onDontSave: () => {
                    resolve("dontSave");
                },
                onCancel: () => {
                    resolve("cancel");
                },
            });
        });
    }

    public getOpenConfirmSaveDialog(): ConfirmSaveDialog | null {
        return (this.confirmSaveSession?.isOpen() ?? false) ? this.confirmSaveDialog : null;
    }

    /** A new component per question; closing (including Escape) disposes it. */
    public showConfirmDialog(
        options: ConfirmDialogOptions,
        callbacks: { onConfirm: () => void; onCancel?: () => void },
    ): void {
        const host = this.requireHost();
        this.hideConfirmDialog();

        const dialog = new ConfirmDialog(options);
        dialog.onConfirm = () => {
            this.hideConfirmDialog();
            callbacks.onConfirm();
        };
        dialog.onCancel = () => {
            this.hideConfirmDialog();
            callbacks.onCancel?.();
        };

        const session = host.overlayLayer.createSession(dialog.view, new Point(0, 0), {
            visible: false,
            restoreFocus: true,
            closeOnEscape: true,
            pointerPolicy: "modal",
            disposeOnClose: true,
            onClose: () => {
                // Every close path (callback, Escape, replacement by a new dialog)
                // goes through the session, so the component is disposed here.
                this.confirmDialog = null;
                this.confirmSession = null;
                dialog.dispose();
            },
        });
        this.confirmDialog = dialog;
        this.confirmSession = session;

        this.openCentered(session, dialog);
        dialog.focusDefault();
    }

    /** `false`: cancelled, including Escape. */
    public confirm(options: ConfirmDialogOptions): Promise<boolean> {
        return new Promise((resolve) => {
            this.showConfirmDialog(options, {
                onConfirm: () => {
                    resolve(true);
                },
                onCancel: () => {
                    resolve(false);
                },
            });
        });
    }

    public getOpenConfirmDialog(): ConfirmDialog | null {
        return (this.confirmSession?.isOpen() ?? false) ? this.confirmDialog : null;
    }

    public hideConfirmDialog(): void {
        this.confirmSession?.close();
        this.confirmSession = null;
        this.confirmDialog = null;
    }

    /** Single instance; showing it again reopens it. */
    public showAboutDialog(): void {
        const host = this.requireHost();
        if (!this.aboutDialog) {
            this.aboutDialog = new AboutDialog();
            this.aboutDialog.onClose = () => {
                this.aboutSession?.close();
            };
            this.aboutSession = host.overlayLayer.createSession(this.aboutDialog.view, new Point(0, 0), {
                visible: false,
                restoreFocus: true,
                closeOnEscape: true,
                pointerPolicy: "modal",
            });
        }

        this.openCentered(this.aboutSession, this.aboutDialog);
        this.aboutDialog.focusDefault();
    }

    public getOpenAboutDialog(): AboutDialog | null {
        return (this.aboutSession?.isOpen() ?? false) ? this.aboutDialog : null;
    }

    private openCentered(session: OverlaySessionHandle | null, dialog: DialogComponent): void {
        const host = this.requireHost();
        const screenW = host.layoutSize.width;
        const screenH = host.layoutSize.height;
        const dialogW = dialog.view.getMaxIntrinsicWidth(0);
        const dialogH = dialog.view.getMaxIntrinsicHeight(dialogW);
        const px = Math.max(0, Math.floor((screenW - dialogW) / 2));
        const py = Math.max(0, Math.floor((screenH - dialogH) / 2));
        session?.setPosition(new Point(px, py));
        session?.open();
    }

    private requireHost(): BodyElement {
        if (this.host === null) {
            throw new Error("DialogService: host is not attached (attachHost must be called before showing dialogs)");
        }
        return this.host;
    }
}
