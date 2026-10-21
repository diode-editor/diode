import { Uri } from "../../../../base/common/uri.ts";
import type { CommandAction } from "../../../../platform/actions/common/commandAction.ts";
import { type IStateDescriptor, StateServiceDIToken } from "../../../../platform/state/common/iStateService.ts";
import { URLServiceDIToken } from "../../../../platform/url/common/url.ts";
import { QuickInputServiceDIToken } from "../../../browser/parts/quickinput/quickInputService.ts";

/** Last entered URL — upstream's key and scope (`OpenUrlAction.STORAGE_KEY`). */
export const OPEN_URL_LAST_INPUT_STATE: IStateDescriptor<string> = {
    key: "workbench.action.url.openUrl.lastInput",
    scope: "workspace",
    default: "",
};

/** `diode://<extension id>/…` goes to the extension's URI handler, as if the OS had opened the URL. */
export const openUrlAction: CommandAction = {
    id: "workbench.action.url.openUrl",
    title: "Developer: Open URL",
    shortTitle: "Open URL",
    async run(accessor) {
        const state = accessor.get(StateServiceDIToken);
        const input = await accessor.get(QuickInputServiceDIToken).input({
            prompt: "URL to open",
            value: state.get(OPEN_URL_LAST_INPUT_STATE),
        });
        if (input === undefined || input === "") return;
        state.store(OPEN_URL_LAST_INPUT_STATE, input);
        await accessor.get(URLServiceDIToken).open(Uri.parse(input), { originalUrl: input });
    },
};

export const URL_ACTIONS: readonly CommandAction[] = [openUrlAction];
