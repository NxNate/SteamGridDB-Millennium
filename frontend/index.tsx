import {
  callable,
  afterPatch,
  definePlugin,
  DialogButton,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  IconsModule,
  MenuItem,
  Millennium,
  Navigation,
  PanelSection,
  PanelSectionRow,
  Spinner,
  TextField,
  routerHook,
  toaster,
  useParams,
} from '@steambrew/client';
import { FC, useCallback, useEffect, useMemo, useState } from 'react';

declare const SteamClient: {
  Apps: {
    ClearCustomArtworkForApp(appid: number, assetType: number): Promise<void>;
    SetCustomArtworkForApp(appid: number, data: string, extension: string, assetType: number): Promise<void>;
  };
};

type SGDBAssetType = 'grid_p' | 'grid_l' | 'hero' | 'logo' | 'icon';

type SGDBGame = {
  id: number;
  name: string;
  types?: string[];
  verified?: boolean;
};

type SGDBAsset = {
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

const ASSET_LABEL: Record<SGDBAssetType, string> = {
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

const tabs = Object.keys(ASSET_TYPE) as SGDBAssetType[];

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

function buildAssetQuery(assetType: SGDBAssetType, page: number) {
  const params = new URLSearchParams({
    page: String(page),
    styles: DEFAULT_STYLES[assetType].join(','),
    dimensions: DEFAULT_DIMENSIONS[assetType].join(','),
    mimes: DEFAULT_MIMES[assetType].join(','),
    nsfw: 'false',
    humor: 'any',
    epilepsy: 'any',
    oneoftag: '',
    types: 'static,animated',
  });

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

const inputValue = (eventOrValue: unknown) => {
  if (typeof eventOrValue === 'string') {
    return eventOrValue;
  }

  const maybeEvent = eventOrValue as { target?: { value?: string }; currentTarget?: { value?: string } };
  return maybeEvent?.target?.value ?? maybeEvent?.currentTarget?.value ?? '';
};

const SteamGridDBContent = ({ initialAppId, initialAssetType }: { initialAppId?: string; initialAssetType?: SGDBAssetType }) => {
  const [appIdText, setAppIdText] = useState('');
  const [searchText, setSearchText] = useState('');
  const [games, setGames] = useState<SGDBGame[]>([]);
  const [selectedGame, setSelectedGame] = useState<SGDBGame | null>(null);
  const [assetType, setAssetType] = useState<SGDBAssetType>('grid_p');
  const [assets, setAssets] = useState<SGDBAsset[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const appId = useMemo(() => Number.parseInt(appIdText, 10), [appIdText]);

  useEffect(() => {
    if (initialAppId) {
      setAppIdText(initialAppId);
    }
  }, [initialAppId]);

  useEffect(() => {
    if (initialAssetType) {
      setAssetType(initialAssetType);
    }
  }, [initialAssetType]);

  const searchGames = useCallback(async () => {
    if (!searchText.trim()) return;
    setLoading(true);
    try {
      const encoded = encodeURIComponent(encodeURIComponent(searchText.trim()));
      const result = await apiGet<SGDBGame[]>(`/search/autocomplete/${encoded}`);
      setGames(result);
    } catch (err) {
      notice('SteamGridDB Search Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [searchText]);

  const loadAssets = useCallback(async (nextPage = 0, append = false) => {
    if (!selectedGame) return;
    setLoading(true);
    try {
      const endpoint = ASSET_ENDPOINT[assetType];
      const query = buildAssetQuery(assetType, nextPage);
      const result = await apiGet<SGDBAsset[]>(`/${endpoint}/game/${selectedGame.id}?${query}`);
      setAssets((current) => append ? [...current, ...result] : result);
      setPage(nextPage);
    } catch (err) {
      notice('SteamGridDB Assets Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [assetType, selectedGame]);

  const applyAsset = useCallback(async (asset: SGDBAsset) => {
    if (!Number.isFinite(appId)) {
      notice('Missing Steam App ID', 'Enter the Steam app id to apply artwork.');
      return;
    }

    setApplyingId(asset.id);
    try {
      if (assetType === 'icon') {
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

      await SteamClient.Apps.ClearCustomArtworkForApp(appId, ASSET_TYPE[assetType]);
      await SteamClient.Apps.SetCustomArtworkForApp(appId, image, 'png', ASSET_TYPE[assetType]);
      notice('Artwork Applied', `${ASSET_LABEL[assetType]} was applied to ${appId}.`);
    } catch (err) {
      notice('Apply Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }, [appId, assetType]);

  const selectGame = (game: SGDBGame) => {
    setSelectedGame(game);
    setAssets([]);
    setPage(0);
  };

  return (
    <div className="sgdbRoot">
      <style>{styles}</style>

      <PanelSection title="Target">
        <PanelSectionRow>
          <TextField
            label="Steam App ID"
            description="Artwork will be applied to this Steam app."
            value={appIdText}
            mustBeNumeric
            bShowClearAction
            onChange={(event) => setAppIdText(inputValue(event))}
          />
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="SteamGridDB Game">
        <PanelSectionRow>
          <div className="sgdbSearch">
            <TextField
              value={searchText}
              bShowClearAction
              onChange={(event) => setSearchText(inputValue(event))}
            />
            <DialogButton onClick={searchGames} disabled={loading}>Search</DialogButton>
          </div>
        </PanelSectionRow>
        {games.length > 0 && (
          <PanelSectionRow>
            <div className="sgdbGameList">
              {games.slice(0, 8).map((game) => (
                <button
                  key={game.id}
                  className={game.id === selectedGame?.id ? 'selected' : ''}
                  onClick={() => selectGame(game)}
                  type="button"
                >
                  {game.name}
                </button>
              ))}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="Artwork">
        <PanelSectionRow>
          <div className="sgdbTabs">
            {tabs.map((tab) => (
              <button
                key={tab}
                className={tab === assetType ? 'selected' : ''}
                onClick={() => {
                  setAssetType(tab);
                  setAssets([]);
                }}
                type="button"
              >
                {ASSET_LABEL[tab]}
              </button>
            ))}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div className="sgdbActions">
            <DialogButton onClick={() => loadAssets(0)} disabled={!selectedGame || loading}>Load Artwork</DialogButton>
            <DialogButton onClick={() => loadAssets(page + 1, true)} disabled={!selectedGame || loading || assets.length === 0}>More</DialogButton>
            {loading && <Spinner />}
          </div>
        </PanelSectionRow>
        {assets.length > 0 && (
          <PanelSectionRow>
            <div className="sgdbGrid">
              {assets.map((asset) => (
                <button
                  key={asset.id}
                  className="sgdbAsset"
                  onClick={() => applyAsset(asset)}
                  type="button"
                >
                  <img src={asset.thumb} alt="" loading="lazy" />
                  <span>{applyingId === asset.id ? 'Applying...' : 'Apply'}</span>
                </button>
              ))}
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
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
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sgdbSearch,
.sgdbActions {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.sgdbSearch > :first-child {
  flex: 1;
}

.sgdbGameList,
.sgdbTabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.sgdbGameList button,
.sgdbTabs button {
  border: 0;
  border-radius: 4px;
  padding: 7px 9px;
  color: #dfe3ea;
  background: rgba(255, 255, 255, 0.08);
  cursor: pointer;
}

.sgdbGameList button.selected,
.sgdbTabs button.selected {
  background: #1a9fff;
  color: #07111d;
}

.sgdbGrid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 8px;
  width: 100%;
}

.sgdbAsset {
  position: relative;
  min-height: 148px;
  border: 0;
  border-radius: 6px;
  padding: 0;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.24);
  cursor: pointer;
}

.sgdbAsset img {
  width: 100%;
  height: 100%;
  min-height: 148px;
  object-fit: cover;
  display: block;
}

.sgdbAsset span {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 6px;
  color: white;
  background: rgba(0, 0, 0, 0.72);
  font-size: 12px;
}
`;
