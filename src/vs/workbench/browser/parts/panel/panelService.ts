import { token } from "../../../../platform/instantiation/common/diContainer.ts";
import type { IPaneCompositeView, IPaneCompositeViewDescriptor } from "../paneCompositePartService.ts";
import { PaneCompositePartService } from "../paneCompositePartService.ts";

export const PanelServiceDIToken = token<PanelService>("PanelService");

/** Описание вкладки нижней панели при регистрации (см. {@link PanelService.addView}). */
export type IPanelViewDescriptor = IPaneCompositeViewDescriptor;

/** Зарегистрированная вкладка нижней панели (снимок для компонента). */
export type IPanelView = IPaneCompositeView;

/**
 * Таб-строка нижней **Panel** (VS Code `ViewContainerLocation.Panel`) + её
 * видимость: вкладки — контейнеры с `location: "panel"`. Механика общая со
 * вторичной боковой панелью — {@link PaneCompositePartService}; свой класс
 * ради своего DI-токена, как у эталона `PanelPart` рядом с `AuxiliaryBarPart`.
 */
export class PanelService extends PaneCompositePartService {}
