import type { StatusBarService } from "./statusBarService.ts";

export const TRANSIENT_NOTICE_MS = 4000;

export function showTransientNotice(statusBar: StatusBarService, id: string, text: string): void {
    const handle = statusBar.addEntry({ id, text, alignment: "left", priority: 100 });
    setTimeout(() => {
        handle.dispose();
    }, TRANSIENT_NOTICE_MS);
}
