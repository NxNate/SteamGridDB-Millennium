import {
  callable,
  afterPatch,
  definePlugin,
  DialogButton,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  EUIMode,
  IconsModule,
  MenuItem,
  Millennium,
  Navigation,
  routerHook,
  toaster,
  useParams,
} from '@steambrew/client';
import { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { GamepadView } from './views/GamepadView';

declare const SteamClient: {
  Apps: {
    ClearCustomArtworkForApp(appid: number, assetType: number): Promise<void>;
    SetCustomArtworkForApp(appid: number, data: string, extension: string, assetType: number): Promise<void>;
  };
  UI: {
    GetUIMode(): Promise<EUIMode>;
    RegisterForUIModeChanged(callback: (mode: EUIMode) => void): { unregister(): void };
  };
};

export type SGDBAssetType = 'grid_p' | 'grid_l' | 'hero' | 'logo' | 'icon';

export type SGDBAsset = {
  id: number;
  url: string;
  thumb: string;
  width: number;
  height: number;
  author?: {
    name?: string;
  };
  nsfw?: boolean;
  humor?: boolean;
  epilepsy?: boolean;
};

export type AssetState = Record<SGDBAssetType, SGDBAsset[]>;
export type PageState = Record<SGDBAssetType, number>;
export type LoadingState = Record<SGDBAssetType, boolean>;
export type EndState = Record<SGDBAssetType, boolean>;
export type FilterState = {
  static: boolean;
  animated: boolean;
  adult: boolean;
  humor: boolean;
  epilepsy: boolean;
};
export type ZoomState = Record<SGDBAssetType, number>;

type SGDBResponse<T> = {
  success: boolean;
  data: T;
  errors?: string[];
};

const sgdbRequest = callable<[{ path: string }], string | false>('sgdb_request');
const downloadAsBase64 = callable<[{ url: string }], string | false>('download_as_base64');
const setSteamIconFromUrl = callable<[{ appid: number; url: string }], string | false>('set_steam_icon_from_url');

const ASSET_TYPE: Record<SGDBAssetType, number> = {
  grid_p: 0,
  grid_l: 3,
  hero: 1,
  logo: 2,
  icon: 4,
};

export const ASSET_LABEL: Record<SGDBAssetType, string> = {
  grid_p: 'Capsule',
  grid_l: 'Wide Capsule',
  hero: 'Hero',
  logo: 'Logo',
  icon: 'Icon',
};

const ASSET_ENDPOINT: Record<SGDBAssetType, string> = {
  grid_p: 'grids',
  grid_l: 'grids',
  hero: 'heroes',
  logo: 'logos',
  icon: 'icons',
};

const DEFAULT_DIMENSIONS: Record<SGDBAssetType, string[]> = {
  grid_p: ['600x900', '342x482', '660x930'],
  grid_l: ['460x215', '920x430'],
  hero: ['1920x620', '3840x1240', '1600x650'],
  logo: [],
  icon: [1024, 768, 512, 310, 256, 194, 192, 180, 160, 152, 150, 144, 128, 120, 114, 100, 96, 90, 80, 76, 72, 64, 60, 57, 56, 54, 48, 40, 35, 32, 28, 24, 20, 16].map(String),
};

const emptyAssets = (): AssetState => ({
  grid_p: [],
  grid_l: [],
  hero: [],
  logo: [],
  icon: [],
});

const emptyPages = (): PageState => ({
  grid_p: 0,
  grid_l: 0,
  hero: 0,
  logo: 0,
  icon: 0,
});

const emptyLoading = (): LoadingState => ({
  grid_p: false,
  grid_l: false,
  hero: false,
  logo: false,
  icon: false,
});

const emptyEnd = (): EndState => ({
  grid_p: false,
  grid_l: false,
  hero: false,
  logo: false,
  icon: false,
});

const DEFAULT_STYLES: Record<SGDBAssetType, string[]> = {
  grid_p: ['alternate', 'white_logo', 'no_logo', 'blurred', 'material'],
  grid_l: ['alternate', 'white_logo', 'no_logo', 'blurred', 'material'],
  hero: ['alternate', 'blurred', 'material'],
  logo: ['official', 'white', 'black', 'custom'],
  icon: ['official', 'custom'],
};

const DEFAULT_MIMES: Record<SGDBAssetType, string[]> = {
  grid_p: ['image/png', 'image/jpeg', 'image/webp'],
  grid_l: ['image/png', 'image/jpeg', 'image/webp'],
  hero: ['image/png', 'image/jpeg', 'image/webp'],
  logo: ['image/png', 'image/webp'],
  icon: ['image/png', 'image/vnd.microsoft.icon'],
};

export const tabs = Object.keys(ASSET_TYPE) as SGDBAssetType[];

const defaultFilters: FilterState = {
  static: true,
  animated: true,
  adult: false,
  humor: true,
  epilepsy: true,
};

const defaultZoom: ZoomState = {
  grid_p: 180,
  grid_l: 395,
  hero: 3,
  logo: 4,
  icon: 140,
};

const gamepadDefaultZoom: ZoomState = {
  ...defaultZoom,
  grid_l: 315,
};

function parseResponse<T>(body: string | false): T {
  if (!body) {
    throw new Error('SteamGridDB returned an empty response.');
  }

  const parsed = JSON.parse(body) as SGDBResponse<T>;
  if (!parsed.success) {
    throw new Error(parsed.errors?.join(', ') || 'SteamGridDB API request failed.');
  }

  return parsed.data;
}

function buildAssetQuery(assetType: SGDBAssetType, page: number, filters: FilterState) {
  const params = new URLSearchParams({
    page: String(page),
    styles: DEFAULT_STYLES[assetType].join(','),
    mimes: DEFAULT_MIMES[assetType].join(','),
    nsfw: filters.adult ? 'any' : 'false',
    humor: filters.humor ? 'any' : 'false',
    epilepsy: filters.epilepsy ? 'any' : 'false',
    oneoftag: '',
    types: [filters.static && 'static', filters.animated && 'animated'].filter(Boolean).join(','),
  });

  if (DEFAULT_DIMENSIONS[assetType].length > 0) {
    params.set('dimensions', DEFAULT_DIMENSIONS[assetType].join(','));
  }

  return params.toString();
}

async function apiGet<T>(path: string): Promise<T> {
  return parseResponse<T>(await sgdbRequest({ path }));
}

const notice = (title: string, body: string) => {
  toaster.toast({
    title,
    body,
    icon: <IconsModule.Download />,
    duration: 2500,
  });
};

export const isAnimatedAsset = (src: string) => /\.(webm|mp4)(\?|$)/i.test(src);

export const assetGridStyle = (assetType: SGDBAssetType, zoom: number) => {
  if (assetType === 'hero' || assetType === 'logo') {
    const columns = Math.max(2, Math.min(6, zoom));
    return { gridTemplateColumns: `repeat(auto-fill, minmax(calc(${100 / columns}% - 10px), 1fr))` };
  }

  return { ['--asset-size' as string]: `${zoom}px` };
};

const SteamGridDBContent = ({ initialAppId, initialAssetType }: { initialAppId?: string; initialAssetType?: SGDBAssetType }) => {
  const [appIdText, setAppIdText] = useState(initialAppId ?? '');
  const [assetType, setAssetType] = useState<SGDBAssetType>('grid_p');
  const [assetsByType, setAssetsByType] = useState<AssetState>(() => emptyAssets());
  const [pagesByType, setPagesByType] = useState<PageState>(() => emptyPages());
  const [loadingByType, setLoadingByType] = useState<LoadingState>(() => emptyLoading());
  const [endReachedByType, setEndReachedByType] = useState<EndState>(() => emptyEnd());
  const [filters, setFilters] = useState<FilterState>(defaultFilters);
  const [zoomByType, setZoomByType] = useState<ZoomState>(defaultZoom);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [uiMode, setUiMode] = useState<EUIMode>(EUIMode.Desktop);
  const appId = useMemo(() => Number.parseInt(appIdText, 10), [appIdText]);
  const isGamepadUI = uiMode === EUIMode.GamePad;

  useEffect(() => {
    setZoomByType(isGamepadUI ? gamepadDefaultZoom : defaultZoom);
  }, [isGamepadUI]);

  useEffect(() => {
    if (initialAppId) {
      setAppIdText(initialAppId);
      setAssetsByType(emptyAssets());
      setPagesByType(emptyPages());
      setEndReachedByType(emptyEnd());
    }
  }, [initialAppId]);

  useEffect(() => {
    if (initialAssetType) {
      setAssetType(initialAssetType);
    }
  }, [initialAssetType]);

  useEffect(() => {
    let mounted = true;
    SteamClient.UI.GetUIMode()
      .then((mode) => {
        if (mounted) {
          setUiMode(mode);
        }
      })
      .catch(() => undefined);

    const registration = SteamClient.UI.RegisterForUIModeChanged((mode) => {
      setUiMode(mode);
    });

    return () => {
      mounted = false;
      registration?.unregister?.();
    };
  }, []);

  const loadAssets = useCallback(async (type: SGDBAssetType, nextPage = 0, append = false) => {
    if (!Number.isFinite(appId) || loadingByType[type] || endReachedByType[type]) return;
    setLoadingByType((current) => ({ ...current, [type]: true }));
    try {
      const endpoint = ASSET_ENDPOINT[type];
      const query = buildAssetQuery(type, nextPage, filters);
      const result = await apiGet<SGDBAsset[]>(`/${endpoint}/steam/${appId}?${query}`);
      setAssetsByType((current) => ({ ...current, [type]: append ? [...current[type], ...result] : result }));
      setPagesByType((current) => ({ ...current, [type]: nextPage }));
      setEndReachedByType((current) => ({ ...current, [type]: result.length === 0 }));
    } catch (err) {
      notice('SteamGridDB Assets Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingByType((current) => ({ ...current, [type]: false }));
    }
  }, [appId, endReachedByType, filters, loadingByType]);

  useEffect(() => {
    if (!Number.isFinite(appId)) return;
    if (assetsByType[assetType].length > 0 || loadingByType[assetType] || endReachedByType[assetType]) return;
    void loadAssets(assetType, 0, false);
  }, [appId, assetType, assetsByType, endReachedByType, loadAssets, loadingByType]);

  useEffect(() => {
    if (isGamepadUI || !Number.isFinite(appId)) return;
    if (pagesByType[assetType] !== 0 || assetsByType[assetType].length < 45 || loadingByType[assetType] || endReachedByType[assetType]) return;
    void loadAssets(assetType, 1, true);
  }, [appId, assetType, assetsByType, endReachedByType, isGamepadUI, loadAssets, loadingByType, pagesByType]);

  const resetCurrentTab = useCallback(() => {
    setAssetsByType((current) => ({ ...current, [assetType]: [] }));
    setPagesByType((current) => ({ ...current, [assetType]: 0 }));
    setEndReachedByType((current) => ({ ...current, [assetType]: false }));
  }, [assetType]);

  useEffect(() => {
    setAssetsByType(emptyAssets());
    setPagesByType(emptyPages());
    setEndReachedByType(emptyEnd());
  }, [filters]);

  const toggleFilter = (key: keyof FilterState) => {
    setFilters((current) => {
      const next = { ...current, [key]: !current[key] };
      if (!next.static && !next.animated) {
        next[key] = true;
      }
      return next;
    });
  };

  const applyAsset = useCallback(async (asset: SGDBAsset, type: SGDBAssetType) => {
    if (!Number.isFinite(appId)) {
      notice('Missing Steam App ID', 'Enter the Steam app id to apply artwork.');
      return;
    }

    setApplyingId(asset.id);
    try {
      if (type === 'icon') {
        const savedPath = await setSteamIconFromUrl({ appid: appId, url: asset.url });
        if (!savedPath) {
          throw new Error('The icon could not be written to Steam library cache.');
        }
        notice('Icon Saved', 'Restart Steam if the icon does not refresh immediately.');
        return;
      }

      const image = await downloadAsBase64({ url: asset.url });
      if (!image) {
        throw new Error('The selected image could not be downloaded.');
      }

      await SteamClient.Apps.ClearCustomArtworkForApp(appId, ASSET_TYPE[type]);
      await SteamClient.Apps.SetCustomArtworkForApp(appId, image, 'png', ASSET_TYPE[type]);
      notice('Artwork Applied', `${ASSET_LABEL[type]} was applied to ${appId}.`);
    } catch (err) {
      notice('Apply Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }, [appId]);

  const viewProps = {
    assetType,
    setAssetType,
    assetsByType,
    pagesByType,
    loadingByType,
    endReachedByType,
    filters,
    toggleFilter,
    zoomByType,
    setZoomByType,
    filtersOpen,
    setFiltersOpen,
    applyingId,
    applyAsset,
    loadAssets,
    resetCurrentTab,
    isGamepadUI,
  };

  return (
    <div className={`sgdbRoot sgdbGamepad ${isGamepadUI ? '' : 'sgdbDesktopToolbar'}`} id="sgdb-wrap">
      <style>{styles}</style>
      <GamepadView {...viewProps} />
    </div>
  );
};

const SteamGridDBRoute = () => {
  const { appid, assetType } = useParams<{ appid: string; assetType?: SGDBAssetType }>();
  return <SteamGridDBContent initialAppId={appid} initialAssetType={assetType} />;
};

function openSteamGridDB() {
  return {
    SteamButton: (): any => <IconsModule.Image height="20px" />,
  };
}

Millennium?.exposeObj?.({ openSteamGridDB });

const spliceArtworkItem = (children: any[], appid: number) => {
  if (!Array.isArray(children) || !appid) {
    return;
  }

  const existingIndex = children.findIndex((item) => item?.key === 'sgdb-change-artwork');
  if (existingIndex >= 0) {
    children.splice(existingIndex, 1);
  }

  const propertiesIndex = children.findIndex((item) =>
    findInReactTree(item, (node) => node?.onSelected && node.onSelected.toString().includes('AppProperties')),
  );
  const insertIndex = propertiesIndex >= 0 ? propertiesIndex : children.length;

  children.splice(insertIndex, 0, (
    <MenuItem
      key="sgdb-change-artwork"
      onSelected={() => {
        Navigation.Navigate(`/steamgriddb/${appid}`);
      }}
    >
      Change Artwork...
    </MenuItem>
  ));
};

const isOpeningAppContextMenu = (items: any[]) => {
  if (!items?.length) {
    return false;
  }

  return Boolean(findInReactTree(items, (node) => {
    const selected = node?.props?.onSelected?.toString?.() ?? node?.onSelected?.toString?.() ?? '';
    return selected.includes('launchSource') || selected.includes('AppProperties') || Boolean(node?.app?.appid);
  }));
};

const patchMenuItems = (menuItems: any[], fallbackAppId: number) => {
  let appid = fallbackAppId;

  const parentOverview = menuItems.find((item) => item?._owner?.pendingProps?.overview?.appid && item._owner.pendingProps.overview.appid !== fallbackAppId);
  if (parentOverview) {
    appid = parentOverview._owner.pendingProps.overview.appid;
  }

  const foundApp = findInTree(menuItems, (node) => node?.app?.appid, { walkable: ['props', 'children'] });
  if (foundApp?.app?.appid) {
    appid = foundApp.app.appid;
  }

  if (appid) {
    spliceArtworkItem(menuItems, appid);
  }
};

const findLibraryContextMenu = () => {
  const module = findModuleByExport((exp: any) => exp?.toString && exp.toString().includes('().LibraryContextMenu'));
  const component = Object.values(module ?? {}).find((sibling: any) => sibling?.toString?.().includes('navigator:')) as FC | undefined;
  if (!component) {
    return null;
  }

  return fakeRenderComponent(component)?.type;
};

const patchLibraryContextMenu = () => {
  const LibraryContextMenu = findLibraryContextMenu();
  if (!LibraryContextMenu?.prototype?.render) {
    console.warn('[SteamGridDB] Could not find LibraryContextMenu');
    return { unpatch: () => undefined };
  }

  const patches: { outer?: any; inner?: any; unpatch: () => void } = { unpatch: () => undefined };
  patches.outer = afterPatch(LibraryContextMenu.prototype, 'render', (_args: any[], component: any) => {
    const findCurrentAppId = (tree?: any) => {
      if (component?._owner?.pendingProps?.overview?.appid) {
        return component._owner.pendingProps.overview.appid;
      }

      const foundApp = findInTree(component?.props?.children, (node) => node?.app?.appid, { walkable: ['props', 'children'] });
      if (foundApp?.app?.appid) {
        return foundApp.app.appid;
      }

      const foundTreeApp = findInTree(tree, (node) => node?.app?.appid || node?.overview?.appid, { walkable: ['props', 'children', '_owner', 'pendingProps'] });
      return foundTreeApp?.app?.appid ?? foundTreeApp?.overview?.appid ?? 0;
    };

    if (!patches.inner) {
      patches.inner = afterPatch(component, 'type', (_typeArgs: any[], ret: any) => {
        if (ret?.type?.prototype?.render) {
          afterPatch(ret.type.prototype, 'render', (_renderArgs: any[], renderRet: any) => {
            const menuItems = renderRet?.props?.children?.[0];
            if (isOpeningAppContextMenu(menuItems)) {
              patchMenuItems(menuItems, findCurrentAppId(renderRet));
            }
            return renderRet;
          });

          afterPatch(ret.type.prototype, 'shouldComponentUpdate', ([nextProps]: any[], shouldUpdate: any) => {
            const menuItems = nextProps?.children;
            if (isOpeningAppContextMenu(menuItems)) {
              patchMenuItems(menuItems, findCurrentAppId(nextProps));
            }
            return shouldUpdate;
          });
        }

        return ret;
      });
    } else if (Array.isArray(component?.props?.children)) {
      patchMenuItems(component.props.children, findCurrentAppId(component));
    }

    return component;
  });

  patches.unpatch = () => {
    patches.outer?.unpatch?.();
    patches.inner?.unpatch?.();
  };
  return patches;
};

export default definePlugin(() => ({
  title: 'SteamGridDB',
  icon: <IconsModule.Image />,
  content: <SteamGridDBContent />,
  onDismount() {
    routerHook.removeRoute('/steamgriddb/:appid/:assetType?');
    window.__SGDB_CONTEXT_MENU_PATCH__?.unpatch?.();
    delete window.__SGDB_CONTEXT_MENU_PATCH__;
  },
}));

declare global {
  interface Window {
    __SGDB_CONTEXT_MENU_PATCH__?: { unpatch?: () => void };
  }
}

routerHook.removeRoute('/steamgriddb/:appid/:assetType?');
routerHook.addRoute('/steamgriddb/:appid/:assetType?', SteamGridDBRoute, { exact: true });
window.__SGDB_CONTEXT_MENU_PATCH__?.unpatch?.();
window.__SGDB_CONTEXT_MENU_PATCH__ = patchLibraryContextMenu();

const styles = `
.sgdbRoot {
  height: 100%;
  min-height: 0;
  margin-top: var(--basicui-header-height, 40px);
  padding: 0;
  background: var(--gpSystemDarkestGrey, #0e141b);
  overflow-x: hidden;
  box-sizing: border-box;
  overscroll-behavior: contain;
  --asset-size: 120px;
}

.sgdbRoot div[class*="gamepadtabbedpage_TabHeaderRowWrapper"][class*="gamepadtabbedpage_Floating"],
.sgdbRoot div[class*="gamepadtabbedpage_TabHeaderRowWrapper"] {
  background: #1b2838;
}

.sgdbDesktop {
  margin-top: 0;
}

.sgdbDesktopToolbar {
  position: relative;
  box-shadow: 0 calc(-1 * var(--basicui-header-height, 40px)) 0 #15222c;
}

.sgdbManualTabs {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 30px 16px;
  background: #101820;
  box-sizing: border-box;
}

.sgdbManualTabs button {
  width: auto;
  min-width: auto;
  padding: 12px 16px;
  font-weight: 700;
}

.sgdbManualTabs button.selected {
  color: #07111d;
  background: #1a9fff;
}

.sgdbTextPill {
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.9);
  background: transparent;
  outline: 0;
  box-shadow: none;
  font-weight: 900;
  line-height: 1;
  text-align: center;
  cursor: pointer;
  box-sizing: border-box;
}

.sgdbTextPill.selected {
  color: #07111d;
  background: #f8f8f4;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}

.sgdbTextPill.gpfocus,
.sgdbTextPill:focus-visible {
  outline: 0 !important;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.58);
}

.sgdbTextPill.selected.gpfocus,
.sgdbTextPill.selected:focus-visible {
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25), 0 0 0 2px rgba(255, 255, 255, 0.58);
}

.sgdbTextPill.gpfocus::before,
.sgdbTextPill.gpfocus::after,
.sgdbTextPill:focus-visible::before,
.sgdbTextPill:focus-visible::after,
.sgdbTextPill.gpfocus > *,
.sgdbTextPill:focus-visible > * {
  border-radius: inherit !important;
  outline: 0 !important;
}

.sgdbTextPill.gpfocus:not(.selected),
.sgdbTextPill:focus-visible:not(.selected) {
  background: transparent;
}

.sgdbTextPill.disabled,
.sgdbTextPill:disabled {
  opacity: 0.45;
  cursor: default;
}

.sgdbGamepad .sgdbGamepadTabs {
  justify-content: center;
  gap: 10px;
  min-height: 48px;
  padding: 0 36px;
  background: #15222c;
  border-bottom: 1px solid rgba(102, 192, 244, 0.08);
}

.sgdbGamepad .sgdbGamepadTab {
  min-width: 104px;
  width: 104px;
  height: 34px;
  padding: 0 4px;
  font-size: 13px;
  letter-spacing: 1.2px;
}

.sgdbGamepad .sgdbGamepadTab:nth-child(2) {
  width: 152px;
  min-width: 152px;
}

.sgdbGamepad .sgdbGamepadTab.selected {
  padding: 0 4px;
  color: #07111d;
  background: #f8f8f4;
}

.sgdbGamepad .sgdbManageTab {
  opacity: 0.9;
  cursor: default;
  pointer-events: none;
}

.tabcontents-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100%;
}

.spinnyboi {
  display: flex;
  align-items: center;
  justify-content: center;
  position: fixed;
  inset: 0;
  z-index: 10008;
  background: #0e141b;
  opacity: 1;
  transition: opacity 250ms ease-out, z-index 0s;
}

.spinnyboi img {
  transform: scale(0.75);
  transition: transform 300ms ease-out;
}

.spinnyboi.loaded {
  z-index: -1;
  opacity: 0;
  pointer-events: none;
  transition-delay: 0ms, 300ms;
}

.spinnyboi.loaded img {
  transform: scale(0.6);
}

.sgdb-asset-toolbar {
  display: flex;
  width: 100%;
  gap: var(--gpSpace-Gap, 0.6em);
  padding: 0 30px;
  box-sizing: border-box;
}

.sgdb-asset-toolbar .filter-buttons {
  display: flex;
  align-items: center;
  gap: 0.5em;
}

.sgdb-asset-toolbar .filter-buttons button {
  min-width: auto;
  white-space: nowrap;
}

.sgdb-asset-toolbar .size-slider {
  flex: 1;
  padding: 0.5em 1em;
  justify-content: center;
}

.sgdbGamepad .sgdb-asset-toolbar {
  display: grid;
  grid-template-columns: 144px 1fr;
  align-items: center;
  gap: 28px;
  min-height: 48px;
  padding: 0 36px;
  background: #060a10;
  border-bottom: 1px solid rgba(102, 192, 244, 0.08);
}

.sgdbGamepad .sgdb-asset-toolbar .filter-buttons {
  width: 144px;
}

.sgdbGamepad .sgdbFilterMainButton {
  width: 144px;
  height: 34px;
  min-width: 144px;
  padding: 0;
  font-size: 13px;
  letter-spacing: 1.2px;
}

.sgdbGamepad .sgdb-asset-toolbar .size-slider {
  padding: 0;
  min-height: 34px;
  display: flex;
  align-items: center;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}

.sgdbFilterTray {
  display: flex;
  gap: 8px;
  padding: 10px 30px 0;
  background: transparent;
  box-sizing: border-box;
}

.sgdbGamepad .sgdbGamepadFilterNotice {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 48px;
  padding: 7px 36px;
  background: #15222c;
  box-sizing: border-box;
}

.sgdbGamepad .sgdbFilterNoticeHeader {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.sgdbGamepad .sgdbFilterNoticeLine {
  height: 1px;
  background: rgba(255, 255, 255, 0.24);
}

.sgdbGamepad .sgdbFilterNoticeText {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.78);
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 1.5px;
}

.sgdbGamepad .sgdbFilterNoticeText button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  min-width: 24px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  color: #16202a;
  background: #f1f3f5;
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
}

.sgdbGamepad .sgdbGamepadFilterToggles {
  display: flex;
  gap: 8px;
  width: 100%;
}

.sgdbGamepad .sgdbFilterToggle {
  flex: 1;
  height: 34px;
  min-width: 0;
  padding: 0 12px;
  font-size: 13px;
  letter-spacing: 1.2px;
}

.sgdbGamepad .sgdbMoreButton {
  width: 128px;
  height: 48px;
  margin: 4px auto var(--gamepadui-current-footer-height, 24px);
  font-size: 16px;
  letter-spacing: 1.6px;
  text-transform: uppercase;
}

.sgdbResultsState {
  align-self: flex-start;
  margin: 12px 30px 0;
  padding: 0;
  border: 0;
  color: #8f98a8;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  text-align: left;
}

.sgdbGrid {
  display: grid;
  padding: 14px 34px var(--gamepadui-current-footer-height, 34px);
  row-gap: 1em;
  column-gap: 0.65em;
  width: 100%;
  justify-content: space-evenly;
  grid-auto-flow: dense;
  box-sizing: border-box;
}

.sgdbGrid.grid_p {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--asset-size, 150px), 100%), var(--asset-size, 150px)));
}

.sgdbGrid.grid_l {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--asset-size, 220px), 100%), var(--asset-size, 220px)));
}

.sgdbGrid.hero,
.sgdbGrid.logo {
  grid-template-columns: repeat(auto-fill, minmax(calc(33.33% - 10px), 1fr));
}

.sgdbGrid.icon {
  grid-template-columns: repeat(auto-fill, minmax(min(var(--asset-size, 120px), 100%), var(--asset-size, 120px)));
}

.asset-box-wrap {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  position: relative;
}

.image-wrap.sgdbAsset {
  position: relative;
  width: 100%;
  margin-top: auto;
  overflow: hidden;
  background: url('/images/defaultappimage.png') center center / cover, #05070a;
  cursor: pointer;
  outline: 2px solid transparent;
  transition: outline-color ease-in-out 160ms, transform ease-out 160ms;
}

.image-wrap.sgdbAsset.type-logo {
  padding-bottom: 0 !important;
  height: 185px;
}

.image-wrap.sgdbAsset.type-icon {
  aspect-ratio: 1 / 1;
}

.image-wrap.sgdbAsset:hover,
.image-wrap.sgdbAsset.gpfocus,
.image-wrap.sgdbAsset:focus-visible {
  z-index: 4;
  outline-color: rgba(255, 255, 255, 0.55);
  transform: scale(1.018);
}

.sgdbMedia {
  position: absolute;
  inset: 0;
  width: 100%;
  max-width: 100%;
  max-height: 100%;
  height: auto;
  object-fit: cover;
  display: block;
  z-index: 1;
  margin: 0 auto;
}

.sgdbMediaBlur {
  z-index: 0;
  filter: saturate(1.8) blur(18px);
  transform: scale(1.18);
  opacity: 0.32;
}

.sgdbMedia.logo,
.sgdbMedia.icon {
  object-fit: contain;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
}

.sgdbMediaBlur.logo,
.sgdbMediaBlur.icon {
  display: none;
}

.sgdbAssetMissing,
.sgdbEmpty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 96px;
  color: #8f98a8;
}

.author {
  display: flex;
  align-items: center;
  gap: 0.5em;
  width: 100%;
  padding-top: 0.15em;
  color: #dfe3ea;
  font-size: 0.65em;
  overflow: hidden;
  text-shadow: 0 1px 1px #000;
}

.author span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sgdbChips {
  position: absolute;
  right: -6px;
  top: 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  z-index: 3;
  pointer-events: none;
}

.sgdbChips span {
  padding: 3px 8px;
  min-height: 14px;
  border-radius: 4px 0 0 4px;
  color: white;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  transform: translateX(calc(100% - 8px));
  transition: transform 220ms cubic-bezier(0.33, 1, 0.68, 1);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.35);
}

.image-wrap.sgdbAsset:hover .sgdbChips span,
.image-wrap.sgdbAsset.gpfocus .sgdbChips span,
.image-wrap.sgdbAsset:focus-visible .sgdbChips span {
  transform: translateX(0);
}

.sgdbChips .animated {
  background: #e2a256;
}

.sgdbChips .nsfw {
  background: #e5344c;
}

.sgdbChips .humor {
  background: #eec314;
  color: #343434;
}

.sgdbChips .epilepsy {
  background: #735f9f;
}

.dload-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  opacity: 0;
  z-index: -3;
  background: rgba(0, 0, 0, 0.85);
  transition: opacity 100ms ease, z-index 0s 100ms;
}

.dload-overlay.downloading {
  opacity: 1;
  z-index: 5;
}

.sgdbDesktop .sgdbManualTabs {
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 52px;
  padding: 8px 24px;
  background: #0e141b;
  border-bottom: 1px solid rgba(102, 192, 244, 0.08);
  box-sizing: border-box;
}

.sgdbDesktop .sgdbDesktopTab {
  width: 104px;
  height: 36px;
  min-width: 104px;
  border: 0;
  appearance: none;
  -webkit-appearance: none;
  background-clip: padding-box;
  box-sizing: border-box;
  padding: 0 8px;
  font-size: 13px;
  letter-spacing: 1px;
  line-height: 1;
  pointer-events: auto;
  cursor: pointer;
  user-select: none;
}

.sgdbDesktop .sgdbDesktopTab.selected {
  color: #07111d;
  background: #f8f8f4;
}

.sgdbDesktop .sgdbDesktopTab:nth-child(2) {
  width: 148px;
  min-width: 148px;
}

.sgdbDesktop .sgdb-asset-toolbar {
  display: grid;
  grid-template-columns: max-content minmax(420px, 900px);
  align-items: center;
  gap: 16px;
  justify-content: center;
  min-height: 44px;
  padding: 4px 24px 4px;
  background: #0e141b;
}

.sgdbDesktop .sgdb-asset-toolbar .filter-buttons {
  width: auto;
  flex: 0 0 auto;
}

.sgdbDesktop .sgdb-asset-toolbar .size-slider {
  width: 100%;
  min-height: 34px;
  padding: 0;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
  display: flex;
  align-items: center;
}

.sgdbDesktop .sgdbDesktopSlider {
  width: 100%;
  height: 34px;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  outline: 0;
  cursor: pointer;
}

.sgdbDesktop .sgdbDesktopSlider::-webkit-slider-runnable-track {
  height: 8px;
  border-radius: 999px;
  border: 0;
  background: linear-gradient(
    90deg,
    #1a9fff 0%,
    #1a9fff var(--sgdb-slider-progress),
    rgba(255, 255, 255, 0.11) var(--sgdb-slider-progress),
    rgba(255, 255, 255, 0.11) 100%
  );
}

.sgdbDesktop .sgdbDesktopSlider::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -3px;
  border: 0;
  border-radius: 50%;
  background: #8fcfff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.28);
  appearance: none;
  -webkit-appearance: none;
}

.sgdbDesktop .sgdbDesktopSlider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}

.sgdbDesktop .sgdbFilterMainButton {
  width: auto;
  height: 29px;
  min-width: 0;
  padding: 0 19px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: none;
}

.sgdbDesktop .sgdbFilterTray {
  justify-content: center;
  gap: 10px;
  padding: 8px 24px 0;
}

.sgdbDesktop .sgdbFilterToggle {
  width: auto;
  height: 29px;
  min-width: 0;
  padding: 0 19px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: none;
}

.sgdbDesktop .sgdbMoreButton {
  width: auto;
  height: 34px;
  min-width: 0;
  margin: 14px auto 18px;
  padding: 0 28px;
  font-size: 13px;
  font-weight: 900;
  letter-spacing: 1.2px;
  text-transform: uppercase;
}

.sgdbDesktopToolbar .sgdb-asset-toolbar {
  display: grid;
  grid-template-columns: max-content minmax(420px, 900px);
  align-items: center;
  gap: 16px;
  justify-content: center;
  min-height: 44px;
  padding: 6px 24px;
  background: #0e141b;
}

.sgdbDesktopToolbar .sgdb-asset-toolbar .filter-buttons {
  display: flex;
  align-items: center;
  justify-content: center;
  width: auto;
  flex: 0 0 auto;
}

.sgdbDesktopToolbar .sgdbFilterMainButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: auto;
  height: 31px;
  min-width: 0;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  color: rgba(255, 255, 255, 0.9);
  background: transparent;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1;
  box-shadow: none;
}

.sgdbDesktopToolbar .sgdbFilterMainButton.selected {
  color: #07111d;
  background: #f8f8f4;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
}

.sgdbDesktopToolbar .sgdbGamepadFilterNotice {
  min-height: 31px;
  padding: 4px 24px 0;
  background: transparent;
}

.sgdbDesktopToolbar .sgdbGamepadFilterToggles {
  justify-content: center;
  gap: 8px;
}

.sgdbDesktopToolbar .sgdbFilterToggle {
  flex: 0 0 auto;
  width: auto;
  height: 27px;
  min-width: 0;
  padding: 0 17px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.9px;
}

.sgdbDesktopToolbar .sgdbDesktopSliderWrap {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  height: 29px;
  min-width: 0;
}

.sgdbDesktopToolbar .sgdbDesktopSliderWrap::before {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 6px;
  border-radius: 999px;
  transform: translateY(-50%);
  background: linear-gradient(
    90deg,
    #1a9fff 0%,
    #1a9fff var(--sgdb-slider-progress),
    rgba(255, 255, 255, 0.13) var(--sgdb-slider-progress),
    rgba(255, 255, 255, 0.13) 100%
  );
}

.sgdbDesktopToolbar .sgdbDesktopSlider {
  position: relative;
  z-index: 1;
  width: 100%;
  height: 29px;
  margin: 0;
  padding: 0;
  appearance: none;
  -webkit-appearance: none;
  background: transparent;
  outline: 0;
  cursor: pointer;
}

.sgdbDesktopToolbar .sgdbDesktopSlider::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 999px;
  border: 0;
  background: transparent;
}

.sgdbDesktopToolbar .sgdbDesktopSlider::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -4px;
  border: 0;
  border-radius: 50%;
  background: #8fcfff;
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.28);
  appearance: none;
  -webkit-appearance: none;
}

.sgdbDesktopToolbar .sgdbDesktopSlider:focus-visible::-webkit-slider-thumb {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.5);
}
`;
