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
  showModal,
  toaster,
  useParams,
} from '@steambrew/client';
import { Dispatch, FC, SetStateAction, useCallback, useEffect, useMemo, useState } from 'react';
import { GamepadView } from './views/GamepadView';

declare const SteamClient: {
  Apps: {
    ClearCustomArtworkForApp(appid: number, assetType: number): Promise<void>;
    SetCustomArtworkForApp(appid: number, data: string, extension: string, assetType: number): Promise<void>;
    SetCustomLogoPositionForApp?(appid: number, position: { pinnedPosition: string; nWidthPct: number; nHeightPct: number }): Promise<void>;
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
type FilterStateByType = Record<SGDBAssetType, FilterState>;
export type CurrentArtworkItem = {
  path: string;
  dataUrl?: string;
  modified?: string;
  length?: number;
};
export type CurrentArtworkState = Partial<Record<SGDBAssetType, CurrentArtworkItem>>;
type PluginSettings = {
  filterDefaults: FilterState;
  showExternalLinks: boolean;
  showCreatorNames: boolean;
  preloadPages: number;
};

type SGDBResponse<T> = {
  success: boolean;
  data: T;
  errors?: string[];
};

type SGDBGame = {
  id: number;
  name: string;
};

const sgdbRequest = callable<[{ path: string }], string | false>('sgdb_request');
const downloadAsBase64 = callable<[{ url: string }], string | false>('download_as_base64');
const setSteamIconFromUrl = callable<[{ appid: number; url: string; extension: string }], string | false>('set_steam_icon_from_url');
const setAnimatedArtworkFromUrl = callable<[{ appid: number; asset_type: SGDBAssetType; url: string; extension: string }], string | false>('set_animated_artwork_from_url');
const getCurrentArtwork = callable<[{ appid: number }], string | false>('get_current_artwork');
const openExternalUrl = callable<[{ url: string }], boolean>('open_external_url');

const ASSET_TYPE: Record<SGDBAssetType, number> = {
  grid_p: 0,
  grid_l: 3,
  hero: 1,
  logo: 2,
  icon: 4,
};

export const ASSET_LABEL: Record<SGDBAssetType, string> = {
  grid_p: 'Grid',
  grid_l: 'Wide Grid',
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

const ASSET_PAGE_PATH: Record<SGDBAssetType, string> = {
  grid_p: 'grid',
  grid_l: 'grid',
  hero: 'hero',
  logo: 'logo',
  icon: 'icon',
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

const defaultSettings: PluginSettings = {
  filterDefaults: defaultFilters,
  showExternalLinks: true,
  showCreatorNames: true,
  preloadPages: 0,
};

const defaultZoom: ZoomState = {
  grid_p: 180,
  grid_l: 395,
  hero: 3.45,
  logo: 4,
  icon: 140,
};

const gamepadDefaultZoom: ZoomState = {
  ...defaultZoom,
  grid_l: 315,
};

type ZoomModeState = {
  desktop: ZoomState;
  gamepad: ZoomState;
};

const ZOOM_STORAGE_KEY = 'steamgriddb:zoomByMode:v1';
const SETTINGS_STORAGE_KEY = 'steamgriddb:settings:v1';
const FILTER_STORAGE_KEY = 'steamgriddb:filtersByType:v1';

const isZoomState = (value: unknown): value is ZoomState => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return tabs.every((tab) => typeof (value as Partial<ZoomState>)[tab] === 'number');
};

const loadZoomByMode = (): ZoomModeState => {
  const fallback = {
    desktop: defaultZoom,
    gamepad: gamepadDefaultZoom,
  };

  try {
    const raw = window.localStorage.getItem(ZOOM_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const saved = JSON.parse(raw) as Partial<ZoomModeState>;
    return {
      desktop: isZoomState(saved.desktop) ? { ...defaultZoom, ...saved.desktop } : fallback.desktop,
      gamepad: isZoomState(saved.gamepad) ? { ...gamepadDefaultZoom, ...saved.gamepad } : fallback.gamepad,
    };
  } catch {
    return fallback;
  }
};

const isFilterState = (value: unknown): value is FilterState => {
  if (!value || typeof value !== 'object') {
    return false;
  }

  return (['static', 'animated', 'adult', 'humor', 'epilepsy'] as (keyof FilterState)[]).every((key) => typeof (value as Partial<FilterState>)[key] === 'boolean');
};

const filterStateByType = (fallback: FilterState): FilterStateByType => ({
  grid_p: { ...fallback },
  grid_l: { ...fallback },
  hero: { ...fallback },
  logo: { ...fallback },
  icon: { ...fallback },
});

const loadFiltersByType = (fallback: FilterState): FilterStateByType => {
  const defaults = filterStateByType(fallback);

  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }

    const saved = JSON.parse(raw) as Partial<Record<SGDBAssetType, unknown>>;
    return tabs.reduce((current, tab) => ({
      ...current,
      [tab]: isFilterState(saved[tab]) ? { ...fallback, ...saved[tab] } : defaults[tab],
    }), defaults);
  } catch {
    return defaults;
  }
};

const normalizeSettings = (settings: Partial<PluginSettings>): PluginSettings => ({
  filterDefaults: isFilterState(settings.filterDefaults) ? { ...defaultFilters, ...settings.filterDefaults } : defaultSettings.filterDefaults,
  showExternalLinks: typeof settings.showExternalLinks === 'boolean' ? settings.showExternalLinks : defaultSettings.showExternalLinks,
  showCreatorNames: typeof settings.showCreatorNames === 'boolean' ? settings.showCreatorNames : defaultSettings.showCreatorNames,
  preloadPages: Math.max(0, Math.min(5, Number.isFinite(settings.preloadPages) ? Math.trunc(settings.preloadPages as number) : defaultSettings.preloadPages)),
});

const loadPluginSettings = (): PluginSettings => {
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? normalizeSettings(JSON.parse(raw) as Partial<PluginSettings>) : defaultSettings;
  } catch {
    return defaultSettings;
  }
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

const filterReturnedAssets = (assets: SGDBAsset[], filters: FilterState) =>
  assets.filter((asset) => {
    if (!filters.adult && asset.nsfw) return false;
    if (!filters.humor && asset.humor) return false;
    if (!filters.epilepsy && asset.epilepsy) return false;
    if (!filters.static && !isAnimatedAsset(asset.url) && !isAnimatedAsset(asset.thumb)) return false;
    if (!filters.animated && (isAnimatedAsset(asset.url) || isAnimatedAsset(asset.thumb))) return false;
    return true;
  });

async function apiGet<T>(path: string): Promise<T> {
  return parseResponse<T>(await sgdbRequest({ path }));
}

const getSteamAppName = (appId: number) => {
  try {
    const overview = window.appStore?.GetAppOverviewByAppID(appId) as { display_name?: string; displayName?: string; name?: string } | null | undefined;
    return overview?.display_name || overview?.displayName || overview?.name || '';
  } catch {
    return '';
  }
};

const setDefaultLogoPosition = (appId: number) => {
  const position = { pinnedPosition: 'BottomLeft', nWidthPct: 50, nHeightPct: 50 } as const;
  try {
    const overview = window.appStore?.GetAppOverviewByAppID(appId);
    if (overview && window.appDetailsStore?.SaveCustomLogoPosition) {
      void Promise.resolve(window.appDetailsStore.SaveCustomLogoPosition(overview as Parameters<typeof window.appDetailsStore.SaveCustomLogoPosition>[0], position)).catch(() => {});
    }
  } catch {
    // Logo positioning should never make a successful artwork apply fail.
  }
};

async function resolveSteamGridDBGameId(appId: number): Promise<number | null> {
  const appName = getSteamAppName(appId).trim();
  if (!appName) {
    return null;
  }

  const games = await apiGet<SGDBGame[]>(`/search/autocomplete/${encodeURIComponent(encodeURIComponent(appName))}`);
  return games[0]?.id ?? null;
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

type DownloadedAsset = {
  data: string;
  byteLength?: number;
};

const getAssetExtension = (asset: SGDBAsset) => {
  const source = asset.url || asset.thumb || '';
  const match = source.match(/\.([a-z0-9]+)(?:\?|$)/i);
  const extension = match?.[1]?.toLowerCase();
  if (extension === 'webm' || extension === 'mp4' || extension === 'webp' || extension === 'jpg' || extension === 'jpeg') {
    return extension;
  }
  return 'png';
};

const isDirectAnimatedExtension = (extension: string) => extension === 'webm' || extension === 'mp4';

const arrayBufferToBase64 = (buffer: ArrayBuffer) => {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return window.btoa(binary);
};

const downloadAssetInBrowser = async (url: string): Promise<DownloadedAsset> => {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Download failed with HTTP ${response.status}.`);
  }
  const buffer = await response.arrayBuffer();
  return {
    data: arrayBufferToBase64(buffer),
    byteLength: buffer.byteLength,
  };
};

export const assetGridStyle = (assetType: SGDBAssetType, zoom: number) => {
  if (assetType === 'hero' || assetType === 'logo') {
    const minColumns = assetType === 'hero' ? 3.45 : 2;
    const maxColumns = assetType === 'hero' ? 6.45 : 6;
    const columns = Math.max(minColumns, Math.min(maxColumns, zoom));
    return { gridTemplateColumns: `repeat(auto-fill, minmax(calc(${100 / columns}% - 10px), 1fr))` };
  }

  return { ['--asset-size' as string]: `${zoom}px` };
};

const SettingsView = ({
  settings,
  setSettings,
}: {
  settings: PluginSettings;
  setSettings: Dispatch<SetStateAction<PluginSettings>>;
}) => {
  const updateFilterDefault = (key: keyof FilterState) => {
    setSettings((current) => {
      const nextFilters = {
        ...current.filterDefaults,
        [key]: !current.filterDefaults[key],
      };
      if (!nextFilters.static && !nextFilters.animated) {
        nextFilters[key] = true;
      }
      return {
        ...current,
        filterDefaults: nextFilters,
      };
    });
  };

  return (
    <div className="sgdbSettingsPage">
      <section className="sgdbSettingsSection">
        <h2>Filter Defaults</h2>
        <div className="sgdbSettingsToggleGrid">
          {([
            ['static', 'Static'],
            ['animated', 'Animated'],
            ['adult', 'Adult'],
            ['humor', 'Humor'],
            ['epilepsy', 'Epilepsy'],
          ] as [keyof FilterState, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`sgdbSettingsPill sgdbTextPill ${settings.filterDefaults[key] ? 'selected' : ''}`}
              type="button"
              onClick={() => updateFilterDefault(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="sgdbSettingsSection">
        <h2>Artwork Browser</h2>
        <label className="sgdbSettingsRow">
          <span>SteamGridDB link button</span>
          <input
            type="checkbox"
            checked={settings.showExternalLinks}
            onChange={(event) => {
              const showExternalLinks = event.currentTarget.checked;
              setSettings((current) => ({ ...current, showExternalLinks }));
            }}
          />
        </label>
        <label className="sgdbSettingsRow">
          <span>Asset creator names</span>
          <input
            type="checkbox"
            checked={settings.showCreatorNames}
            onChange={(event) => {
              const showCreatorNames = event.currentTarget.checked;
              setSettings((current) => ({ ...current, showCreatorNames }));
            }}
          />
        </label>
        <label className="sgdbSettingsRow">
          <span>Additional pages to preload</span>
          <input
            type="number"
            min={0}
            max={5}
            step={1}
            value={settings.preloadPages}
            onChange={(event) => {
              const preloadPages = Math.max(0, Math.min(5, Number.parseInt(event.currentTarget.value || '0', 10)));
              setSettings((current) => ({ ...current, preloadPages }));
            }}
          />
        </label>
      </section>
    </div>
  );
};

const SteamGridDBContent = ({ initialAppId, initialAssetType, popout = false }: { initialAppId?: string; initialAssetType?: SGDBAssetType; popout?: boolean }) => {
  const [settings, setSettings] = useState<PluginSettings>(() => loadPluginSettings());
  const [appIdText, setAppIdText] = useState(initialAppId ?? '');
  const [assetType, setAssetType] = useState<SGDBAssetType>('grid_p');
  const [assetsByType, setAssetsByType] = useState<AssetState>(() => emptyAssets());
  const [pagesByType, setPagesByType] = useState<PageState>(() => emptyPages());
  const [loadingByType, setLoadingByType] = useState<LoadingState>(() => emptyLoading());
  const [endReachedByType, setEndReachedByType] = useState<EndState>(() => emptyEnd());
  const [filtersByType, setFiltersByType] = useState<FilterStateByType>(() => loadFiltersByType(settings.filterDefaults));
  const [zoomByMode, setZoomByMode] = useState<ZoomModeState>(() => loadZoomByMode());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [applyingId, setApplyingId] = useState<number | null>(null);
  const [uiMode, setUiMode] = useState<EUIMode>(EUIMode.Desktop);
  const [sgdbGameId, setSgdbGameId] = useState<number | null>(null);
  const [currentArtwork, setCurrentArtwork] = useState<CurrentArtworkState>({});
  const appId = useMemo(() => Number.parseInt(appIdText, 10), [appIdText]);
  const isGamepadUI = uiMode === EUIMode.GamePad;
  const zoomModeKey = isGamepadUI ? 'gamepad' : 'desktop';
  const zoomByType = zoomByMode[zoomModeKey];
  const filters = filtersByType[assetType] ?? settings.filterDefaults;

  useEffect(() => {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, JSON.stringify(zoomByMode));
  }, [zoomByMode]);

  useEffect(() => {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filtersByType));
  }, [filtersByType]);

  const setZoomByType = useCallback<Dispatch<SetStateAction<ZoomState>>>((action) => {
    setZoomByMode((current) => {
      const currentZoom = current[zoomModeKey];
      const nextZoom = typeof action === 'function' ? action(currentZoom) : action;
      return {
        ...current,
        [zoomModeKey]: nextZoom,
      };
    });
  }, [zoomModeKey]);

  const setFilters = useCallback<Dispatch<SetStateAction<FilterState>>>((action) => {
    setFiltersByType((current) => {
      const currentFilters = current[assetType] ?? settings.filterDefaults;
      const nextFilters = typeof action === 'function' ? action(currentFilters) : action;
      return {
        ...current,
        [assetType]: nextFilters,
      };
    });
  }, [assetType, settings.filterDefaults]);

  const refreshCurrentArtwork = useCallback(async () => {
    if (!Number.isFinite(appId)) {
      setCurrentArtwork({});
      return;
    }

    const raw = await getCurrentArtwork({ appid: appId }).catch(() => false);
    if (typeof raw !== 'string' || raw.length === 0) {
      setCurrentArtwork({});
      return;
    }

    try {
      setCurrentArtwork(JSON.parse(raw) as CurrentArtworkState);
    } catch {
      setCurrentArtwork({});
    }
  }, [appId]);

  useEffect(() => {
    if (initialAppId) {
      setAppIdText(initialAppId);
      setAssetsByType(emptyAssets());
      setPagesByType(emptyPages());
      setEndReachedByType(emptyEnd());
      setSgdbGameId(null);
    }
  }, [initialAppId]);

  useEffect(() => {
    if (initialAssetType) {
      setAssetType(initialAssetType);
    }
  }, [initialAssetType]);

  useEffect(() => {
    void refreshCurrentArtwork();
  }, [refreshCurrentArtwork]);

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
      const lastPageToLoad = nextPage === 0 && !append ? nextPage + settings.preloadPages : nextPage;
      let loadedAssets: SGDBAsset[] = [];
      let lastLoadedPage = nextPage;
      let reachedEnd = false;
      let resolvedGameId = sgdbGameId;

      for (let page = nextPage; page <= lastPageToLoad; page += 1) {
        const query = buildAssetQuery(type, page, filters);
        let result: SGDBAsset[];
        try {
          result = await apiGet<SGDBAsset[]>(`/${endpoint}/${resolvedGameId ? 'game' : 'steam'}/${resolvedGameId ?? appId}?${query}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (resolvedGameId || !/game not found/i.test(message)) {
            throw err;
          }

          resolvedGameId = await resolveSteamGridDBGameId(appId);
          if (!resolvedGameId) {
            throw err;
          }

          setSgdbGameId(resolvedGameId);
          result = await apiGet<SGDBAsset[]>(`/${endpoint}/game/${resolvedGameId}?${query}`);
        }

        loadedAssets = [...loadedAssets, ...filterReturnedAssets(result, filters)];
        lastLoadedPage = page;
        if (result.length === 0) {
          reachedEnd = true;
          break;
        }
      }

      setAssetsByType((current) => ({ ...current, [type]: append ? [...current[type], ...loadedAssets] : loadedAssets }));
      setPagesByType((current) => ({ ...current, [type]: lastLoadedPage }));
      setEndReachedByType((current) => ({ ...current, [type]: reachedEnd }));
    } catch (err) {
      setEndReachedByType((current) => ({ ...current, [type]: true }));
      notice('SteamGridDB Assets Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingByType((current) => ({ ...current, [type]: false }));
    }
  }, [appId, endReachedByType, filters, loadingByType, settings.preloadPages, sgdbGameId]);

  useEffect(() => {
    if (!Number.isFinite(appId)) return;
    if (assetsByType[assetType].length > 0 || loadingByType[assetType] || endReachedByType[assetType]) return;
    void loadAssets(assetType, 0, false);
  }, [appId, assetType, assetsByType, endReachedByType, loadAssets, loadingByType]);

  useEffect(() => {
    if (isGamepadUI || !Number.isFinite(appId)) return;
    if (settings.preloadPages > 0) return;
    if (pagesByType[assetType] !== 0 || assetsByType[assetType].length < 45 || loadingByType[assetType] || endReachedByType[assetType]) return;
    void loadAssets(assetType, 1, true);
  }, [appId, assetType, assetsByType, endReachedByType, isGamepadUI, loadAssets, loadingByType, pagesByType, settings.preloadPages]);

  const resetCurrentTab = useCallback(() => {
    setAssetsByType((current) => ({ ...current, [assetType]: [] }));
    setPagesByType((current) => ({ ...current, [assetType]: 0 }));
    setEndReachedByType((current) => ({ ...current, [assetType]: false }));
  }, [assetType]);

  const toggleFilter = (key: keyof FilterState) => {
    setFilters((current) => {
      const next = { ...current, [key]: !current[key] };
      if (!next.static && !next.animated) {
        next[key] = true;
      }
      return next;
    });
    resetCurrentTab();
  };

  const applyAsset = useCallback(async (asset: SGDBAsset, type: SGDBAssetType) => {
    if (!Number.isFinite(appId)) {
      notice('Missing Steam App ID', 'Enter the Steam app id to apply artwork.');
      return;
    }

    setApplyingId(asset.id);
    try {
      const extension = getAssetExtension(asset);
      if (type === 'icon') {
        const savedPath = await setSteamIconFromUrl({ appid: appId, url: asset.url, extension });
        if (!savedPath) {
          throw new Error('The icon could not be written to Steam grid cache.');
        }
        notice('Icon Saved', 'Restart Steam if the icon does not refresh immediately.');
        void refreshCurrentArtwork();
        return;
      }

      const shouldDirectWriteAnimated = isAnimatedAsset(asset.thumb) || isDirectAnimatedExtension(extension);
      if (shouldDirectWriteAnimated) {
        const savedPath = await setAnimatedArtworkFromUrl({
          appid: appId,
          asset_type: type,
          url: asset.url,
          extension,
        });
        if (!savedPath) {
          throw new Error('The animated asset could not be written directly to Steam grid cache.');
        }
        if (type === 'logo') {
          setDefaultLogoPosition(appId);
        }
        notice('Animated Artwork Saved', `${ASSET_LABEL[type]} was saved directly. Restart Steam if it does not refresh immediately.`);
        void refreshCurrentArtwork();
        return;
      }

      const downloaded: DownloadedAsset | false = await downloadAssetInBrowser(asset.url).catch(async () => {
        const data = await downloadAsBase64({ url: asset.url });
        return data ? ({ data } as DownloadedAsset) : false;
      });
      if (!downloaded) {
        throw new Error('The selected image could not be downloaded.');
      }

      await SteamClient.Apps.SetCustomArtworkForApp(appId, downloaded.data, extension, ASSET_TYPE[type]);
      if (type === 'logo') {
        setDefaultLogoPosition(appId);
      }
      notice('Artwork Applied', `${ASSET_LABEL[type]} was applied to ${appId}.`);
      void refreshCurrentArtwork();
    } catch (err) {
      notice('Apply Failed', err instanceof Error ? err.message : String(err));
    } finally {
      setApplyingId(null);
    }
  }, [appId, refreshCurrentArtwork]);

  const resetArtwork = useCallback(async (type: SGDBAssetType) => {
    if (!Number.isFinite(appId)) {
      notice('Missing Steam App ID', 'Enter the Steam app id to reset artwork.');
      return;
    }

    if (type === 'icon') {
      notice('Icon Reset Not Available', 'Steam icon reset needs a separate cache restore path.');
      return;
    }

    try {
      await SteamClient.Apps.ClearCustomArtworkForApp(appId, ASSET_TYPE[type]);
      notice('Artwork Reset', `${ASSET_LABEL[type]} was reset to default.`);
      void refreshCurrentArtwork();
    } catch (err) {
      notice('Reset Failed', err instanceof Error ? err.message : String(err));
    }
  }, [appId, refreshCurrentArtwork]);

  const openAssetPage = useCallback(async (asset: SGDBAsset, type: SGDBAssetType) => {
    const url = `https://www.steamgriddb.com/${ASSET_PAGE_PATH[type]}/${asset.id}`;
    try {
      const opened = await openExternalUrl({ url });
      if (!opened) {
        throw new Error('The browser could not be opened.');
      }
    } catch (err) {
      notice('Open Failed', err instanceof Error ? err.message : String(err));
    }
  }, []);

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
    zoomDefaults: isGamepadUI ? gamepadDefaultZoom : defaultZoom,
    setZoomByType,
    filtersOpen,
    setFiltersOpen,
    applyingId,
    applyAsset,
    openAssetPage,
    showExternalLinks: settings.showExternalLinks,
    showCreatorNames: settings.showCreatorNames,
    loadAssets,
    resetCurrentTab,
    resetArtwork,
    currentArtwork,
    refreshCurrentArtwork,
    isGamepadUI,
  };

  return (
    <div className={`sgdbRoot sgdbGamepad ${isGamepadUI ? '' : 'sgdbDesktopToolbar'} ${popout ? 'sgdbPopoutContent' : ''}`} id="sgdb-wrap">
      <style>{styles}</style>
      {initialAppId ? <GamepadView {...viewProps} /> : <SettingsView settings={settings} setSettings={setSettings} />}
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

const openSteamGridDBForApp = async (appid: number) => {
  const mode = await SteamClient.UI.GetUIMode().catch(() => EUIMode.Desktop);
  if (mode === EUIMode.GamePad) {
    Navigation.Navigate(`/steamgriddb/${appid}`);
    return;
  }

  showModal(<SteamGridDBContent initialAppId={String(appid)} popout />, window, {
    strTitle: 'SteamGridDB',
    bHideMainWindowForPopouts: false,
    bForcePopOut: true,
    popupHeight: 760,
    popupWidth: 1500,
  });
};

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
        void openSteamGridDBForApp(appid);
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
  background:
    radial-gradient(1180px 760px at 52% 16%, rgba(17, 29, 38, 0.36), rgba(7, 12, 17, 0.18) 54%, transparent 84%),
    linear-gradient(180deg, #05080b 0, #060a0e 96px, #070d12 210px, #091017 100%);
  overflow-x: hidden;
  box-sizing: border-box;
  overscroll-behavior: contain;
  box-shadow: 0 calc(-1 * var(--basicui-header-height, 40px)) 0 #0a1218;
  --asset-size: 120px;
}

.sgdbRoot div[class*="gamepadtabbedpage_TabHeaderRowWrapper"][class*="gamepadtabbedpage_Floating"],
.sgdbRoot div[class*="gamepadtabbedpage_TabHeaderRowWrapper"] {
  background: transparent;
}

.sgdbDesktop {
  margin-top: 0;
}

.sgdbDesktopToolbar {
  position: relative;
  box-shadow: 0 calc(-1 * var(--basicui-header-height, 40px)) 0 #0a1218;
}

.sgdbPopoutContent {
  height: 100vh;
  margin-top: 0;
  padding-right: 8px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  box-shadow: none;
}

.sgdbPopoutContent::-webkit-scrollbar {
  width: 10px;
}

.sgdbPopoutContent::-webkit-scrollbar-track {
  background: transparent;
}

.sgdbPopoutContent::-webkit-scrollbar-thumb {
  min-height: 48px;
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(139, 153, 170, 0.28);
  background-clip: padding-box;
}

.sgdbPopoutContent:hover::-webkit-scrollbar-thumb {
  background: rgba(139, 153, 170, 0.62);
  background-clip: padding-box;
}

.sgdbPopoutContent::-webkit-scrollbar-thumb:hover {
  background: rgba(191, 202, 215, 0.78);
  background-clip: padding-box;
}

body:has(#sgdb-wrap) button[aria-label="Close"],
body:has(#sgdb-wrap) button[title="Close"],
body:has(#sgdb-wrap) [class*="CloseButton"],
body:has(#sgdb-wrap) [class*="closeButton"] {
  color: #8b98a5 !important;
  background: transparent !important;
  box-shadow: none !important;
}

body:has(#sgdb-wrap) button[aria-label="Close"]:hover,
body:has(#sgdb-wrap) button[title="Close"]:hover,
body:has(#sgdb-wrap) [class*="CloseButton"]:hover,
body:has(#sgdb-wrap) [class*="closeButton"]:hover {
  color: #dfe3ea !important;
  background: rgba(255, 255, 255, 0.06) !important;
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
  position: relative;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 0;
  border-radius: 999px;
  clip-path: inset(0 round 999px);
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
  color: #f7f9fb;
  background: #2e333a;
  box-shadow: none;
}

.sgdbTextPill.gpfocus,
.sgdbTextPill:focus-visible {
  outline: 0 !important;
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.58);
  border-radius: 999px !important;
  clip-path: inset(0 round 999px) !important;
}

.sgdbTextPill.selected.gpfocus,
.sgdbTextPill.selected:focus-visible {
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.58);
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
  gap: 32px;
  min-height: 54px;
  padding: 3px 56px 0;
  background: transparent;
  border-bottom: 0;
}

.sgdbGamepad .sgdbGamepadTab {
  width: auto;
  min-width: 0;
  height: 32px;
  margin-top: 4px;
  padding: 0 16px;
  --gpFocusBorderRadius: 999px;
  --focus-ring-border-radius: 999px;
  color: rgba(226, 231, 237, 0.82);
  background: transparent;
  font-size: 12.75px;
  font-weight: 700;
  letter-spacing: 0.42px;
  text-transform: uppercase;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  transition: background 90ms ease, color 90ms ease;
}

.sgdbGamepad .sgdbGamepadTab:nth-child(2) {
  width: auto;
  min-width: 0;
}

.sgdbGamepad .sgdbGamepadTab.selected {
  color: #f3f5f7;
  background: #30363d;
  box-shadow: none;
}

.sgdbGamepad .sgdbGamepadTab.selected.contentFocus {
  color: #f3f5f7;
  background: #30363d;
}

.sgdbGamepad .sgdbGamepadTab:not(.selected):hover,
.sgdbGamepad .sgdbGamepadTab:not(.selected):focus-visible,
.sgdbGamepad .sgdbGamepadTab:not(.selected).gpfocus {
  color: rgba(242, 246, 250, 0.86);
  background: transparent !important;
  box-shadow: none !important;
}

.sgdbGamepad .sgdbGamepadTab.gpfocus,
.sgdbGamepad .sgdbGamepadTab:focus-visible,
.sgdbGamepad .sgdbGamepadTab.gpfocus.selected,
.sgdbGamepad .sgdbGamepadTab:focus-visible.selected {
  outline: 0 !important;
  border-radius: 999px !important;
  box-shadow: none !important;
}

.sgdbGamepad .sgdbGamepadTab *,
.sgdbGamepad .sgdbGamepadTab *::before,
.sgdbGamepad .sgdbGamepadTab *::after {
  border-radius: 999px !important;
}

.sgdbGamepad .sgdbGamepadTab.gpfocus::before,
.sgdbGamepad .sgdbGamepadTab.gpfocus::after,
.sgdbGamepad .sgdbGamepadTab:focus-visible::before,
.sgdbGamepad .sgdbGamepadTab:focus-visible::after,
.sgdbGamepad .sgdbGamepadTab:not(.selected).gpfocus::before,
.sgdbGamepad .sgdbGamepadTab:not(.selected).gpfocus::after,
.sgdbGamepad .sgdbGamepadTab.gpfocus > *,
.sgdbGamepad .sgdbGamepadTab:focus-visible > * {
  border: 0 !important;
  border-radius: 999px !important;
  outline: 0 !important;
  box-shadow: none !important;
}

.sgdbGamepad .sgdbGamepadTab [class*="Focus"],
.sgdbGamepad .sgdbGamepadTab [class*="focus"],
.sgdbGamepad .sgdbGamepadTab [class*="Highlight"],
.sgdbGamepad .sgdbGamepadTab [class*="highlight"],
.sgdbGamepad .sgdbGamepadTab div {
  border-radius: 999px !important;
  clip-path: inset(0 round 999px) !important;
}

.sgdbGamepad .sgdbGamepadTab.selected.tabFocus:hover,
.sgdbGamepad .sgdbGamepadTab.selected.tabFocus.gpfocus,
.sgdbGamepad .sgdbGamepadTab.selected.tabFocus:focus-visible {
  color: #f3f5f7;
  background: #30363d;
  box-shadow: none;
}

.sgdbGamepad .sgdbGamepadTab.selected.contentFocus:hover,
.sgdbGamepad .sgdbGamepadTab.selected.contentFocus.gpfocus,
.sgdbGamepad .sgdbGamepadTab.selected.contentFocus:focus-visible {
  color: #f3f5f7;
  background: #30363d;
  box-shadow: none;
}

.sgdbSettingsPage {
  width: min(680px, calc(100% - 48px));
  margin: 24px auto;
  color: #dfe3ea;
}

.sgdbSettingsSection {
  padding: 18px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.sgdbSettingsSection h2 {
  margin: 0 0 14px;
  color: #f1f5f9;
  font-size: 18px;
  font-weight: 900;
  letter-spacing: 0.8px;
}

.sgdbSettingsToggleGrid {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.sgdbSettingsPill {
  width: auto;
  min-width: 108px;
  height: 34px;
  padding: 0 18px;
  font-size: 13px;
  letter-spacing: 0.9px;
}

.sgdbSettingsRow {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 20px;
  min-height: 42px;
  color: #dfe3ea;
  font-size: 15px;
  font-weight: 700;
}

.sgdbSettingsRow input[type="checkbox"] {
  width: 22px;
  height: 22px;
}

.sgdbSettingsRow input[type="number"] {
  width: 72px;
  height: 32px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 4px;
  color: #f1f5f9;
  background: rgba(255, 255, 255, 0.08);
  font-size: 15px;
  font-weight: 700;
}

.tabcontents-wrap {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-height: 100%;
  background: transparent;
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
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 32px;
  min-height: 50px;
  padding: 0 46px;
  background: transparent;
  border: 0;
}

.sgdbGamepad .sgdb-asset-toolbar .filter-buttons {
  width: auto;
}

.sgdbGamepad .sgdbFilterMainButton,
.sgdbGamepad .sgdbResetButton {
  width: auto;
  height: 32px;
  min-width: 0;
  padding: 0 16px;
  border-radius: 999px;
  color: rgba(226, 231, 237, 0.82);
  background: transparent;
  font-size: 12.75px;
  font-weight: 700;
  letter-spacing: 0.42px;
  text-transform: none;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  box-shadow: none;
}

.sgdbGamepad .sgdbFilterMainButton.selected,
.sgdbGamepad .sgdbFilterMainButton:hover,
.sgdbGamepad .sgdbFilterMainButton.gpfocus,
.sgdbGamepad .sgdbFilterMainButton:focus-visible,
.sgdbGamepad .sgdbResetButton:hover,
.sgdbGamepad .sgdbResetButton.gpfocus,
.sgdbGamepad .sgdbResetButton:focus-visible {
  color: #f3f5f7;
  background: #30363d !important;
  box-shadow: none !important;
}

.sgdbSliderWithMarks {
  position: relative;
  min-width: 0;
}

.sgdbGamepad .sgdb-asset-toolbar .size-slider {
  padding: 0;
  min-height: 30px;
  display: flex;
  align-items: center;
  background: transparent !important;
  box-shadow: none !important;
  outline: none !important;
}

.sgdbResetButton {
  display: grid;
  place-items: center;
  height: 32px;
  min-width: 0;
  padding: 0 16px;
  border: 0;
  border-radius: 999px;
  color: rgba(226, 231, 237, 0.82);
  background: transparent;
  font-size: 12.75px;
  font-weight: 700;
  letter-spacing: 0.42px;
  text-transform: uppercase;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  cursor: pointer;
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
  min-height: 30px;
  padding: 0 42px;
  background: transparent;
  border: 0;
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
  gap: 30px;
  width: 100%;
  justify-content: center;
}

.sgdbGamepad .sgdbFilterToggle {
  flex: 0 0 auto;
  height: 32px;
  min-width: 0;
  padding: 0 16px;
  color: rgba(226, 231, 237, 0.82);
  background: transparent;
  font-size: 12.75px;
  font-weight: 700;
  letter-spacing: 0.42px;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  box-shadow: none;
}

.sgdbGamepad .sgdbFilterToggle.selected,
.sgdbGamepad .sgdbFilterToggle:hover,
.sgdbGamepad .sgdbFilterToggle.gpfocus,
.sgdbGamepad .sgdbFilterToggle:focus-visible {
  color: #f3f5f7;
  background: #30363d !important;
  box-shadow: none !important;
}

.sgdbGamepad .sgdbMoreButton {
  width: auto;
  min-width: 92px;
  height: 32px;
  padding: 0 16px;
  margin: 4px auto var(--gamepadui-current-footer-height, 24px);
  color: rgba(226, 231, 237, 0.82);
  background: transparent;
  font-size: 12.75px;
  font-weight: 700;
  letter-spacing: 0.42px;
  text-transform: uppercase;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
  box-shadow: none;
}

.sgdbGamepad .sgdbMoreButton:hover,
.sgdbGamepad .sgdbMoreButton.gpfocus,
.sgdbGamepad .sgdbMoreButton:focus-visible {
  color: #f3f5f7;
  background: #30363d !important;
  box-shadow: none !important;
}

.sgdbManageGrid {
  display: grid;
  grid-template-columns: minmax(220px, 0.72fr) minmax(420px, 1.78fr);
  grid-template-areas:
    "grid wide"
    "grid logo"
    "icon logo"
    "hero hero";
  gap: 18px 26px;
  width: 100%;
  padding: 16px 42px 44px;
  box-sizing: border-box;
}

.sgdbManagePanel {
  min-width: 0;
}

.sgdbManagePanel h2 {
  margin: 0 0 8px;
  color: rgba(242, 246, 250, 0.9);
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 2.4px;
  line-height: 1.1;
  text-transform: uppercase;
  -webkit-font-smoothing: antialiased;
  text-rendering: geometricPrecision;
}

.sgdbManagePanelCapsule {
  grid-area: grid;
}

.sgdbManagePanelWide {
  grid-area: wide;
}

.sgdbManagePanelLogo {
  grid-area: logo;
}

.sgdbManagePanelHero {
  grid-area: hero;
}

.sgdbManagePanelIcon {
  grid-area: icon;
}

.sgdbManagePreview,
.sgdbManageMissing {
  display: grid;
  position: relative;
  place-items: center;
  overflow: hidden;
  width: 100%;
  border: 1px solid rgba(156, 171, 186, 0.72);
  color: #8f98a8;
  background: rgba(5, 10, 15, 0.5);
  box-sizing: border-box;
}

.sgdbManagePreview.type-grid_p {
  aspect-ratio: 2 / 3;
  max-height: 460px;
}

.sgdbManagePreview.type-grid_l {
  aspect-ratio: 92 / 43;
}

.sgdbManagePreview.type-logo {
  min-height: 108px;
  aspect-ratio: 5 / 1;
}

.sgdbManagePreview.type-hero {
  aspect-ratio: 16 / 5;
}

.sgdbManagePreview.type-icon {
  width: 132px;
  max-width: 100%;
  aspect-ratio: 1 / 1;
}

.sgdbManageImage {
  display: block;
  width: 100%;
  height: 100%;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.sgdbManageImage.type-grid_p,
.sgdbManageImage.type-grid_l,
.sgdbManageImage.type-hero {
  object-fit: cover;
}

.sgdbManageImage.type-logo,
.sgdbManageImage.type-icon {
  padding: 12px;
  box-sizing: border-box;
}

.sgdbManageMissing {
  min-height: 96px;
  font-size: 15px;
  font-weight: 700;
}

.sgdbManagePanelCapsule .sgdbManageMissing {
  aspect-ratio: 2 / 3;
  min-height: 260px;
}

.sgdbManagePanelWide .sgdbManageMissing {
  aspect-ratio: 92 / 43;
}

.sgdbManagePanelLogo .sgdbManageMissing {
  min-height: 108px;
  aspect-ratio: 5 / 1;
}

.sgdbManagePanelHero .sgdbManageMissing {
  aspect-ratio: 16 / 5;
}

.sgdbManagePanelIcon .sgdbManageMissing {
  width: 132px;
  aspect-ratio: 1 / 1;
}

.sgdbResultsState {
  align-self: flex-start;
  margin: -10px 30px 2px;
  padding: 0;
  border: 0;
  color: #8f98a8;
  background: transparent;
  cursor: pointer;
  font-size: 16px;
  text-align: left;
}

.sgdbGamepad .sgdbGamepadFilterNotice + .sgdbResultsState {
  margin-top: -14px;
}

.sgdbGrid {
  display: grid;
  padding: 10px 42px var(--gamepadui-current-footer-height, 34px);
  row-gap: 1.22em;
  column-gap: 0.95em;
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
  perspective: 900px;
}

.image-wrap.sgdbAsset {
  position: relative;
  width: 100%;
  margin-top: auto;
  overflow: hidden;
  container-type: size;
  background: url('/images/defaultappimage.png') center center / cover, #05070a;
  cursor: pointer;
  outline: 2px solid transparent;
  border-radius: 3px;
  box-shadow: 0 7px 18px rgba(0, 0, 0, 0.22);
  transition: outline-color ease-in-out 160ms, transform ease-out 160ms, box-shadow ease-out 160ms;
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
  outline-color: rgba(226, 231, 237, 0.66);
  transform: translate3d(0, -3px, 18px) scale(1.018);
  box-shadow: 0 18px 34px rgba(0, 0, 0, 0.44), 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.sgdbExternalLinkButton {
  position: absolute;
  left: 0;
  bottom: 0;
  z-index: 4;
  display: grid;
  place-items: center;
  width: clamp(23px, 13cqw, 38px);
  height: clamp(23px, 13cqw, 38px);
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.58);
  border-left-width: 0;
  border-bottom-width: 0;
  border-radius: 0 clamp(3px, 2.4cqw, 5px) 0 0;
  color: rgba(255, 255, 255, 0.94);
  background: rgba(7, 10, 15, 0.86);
  box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.24);
  cursor: pointer;
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 120ms ease, transform 120ms ease, background 120ms ease;
}

.image-wrap.sgdbAsset.type-grid_l .sgdbExternalLinkButton,
.image-wrap.sgdbAsset.type-hero .sgdbExternalLinkButton,
.image-wrap.sgdbAsset.type-logo .sgdbExternalLinkButton {
  width: clamp(20px, min(7.5cqw, 24cqh), 33px);
  height: clamp(20px, min(7.5cqw, 24cqh), 33px);
  border-radius: 0 clamp(3px, min(2cqw, 4cqh), 5px) 0 0;
}

.image-wrap.sgdbAsset:hover .sgdbExternalLinkButton,
.image-wrap.sgdbAsset.gpfocus .sgdbExternalLinkButton,
.image-wrap.sgdbAsset:focus-within .sgdbExternalLinkButton {
  opacity: 1;
  transform: translateY(0);
}

.sgdbExternalLinkButton:hover,
.sgdbExternalLinkButton:focus-visible {
  background: rgba(12, 18, 26, 0.96);
  outline: 0;
}

.sgdbExternalIcon {
  width: clamp(19px, 10.6cqw, 26px);
  height: clamp(19px, 10.6cqw, 26px);
  display: block;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 2.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.image-wrap.sgdbAsset.type-grid_l .sgdbExternalIcon,
.image-wrap.sgdbAsset.type-hero .sgdbExternalIcon,
.image-wrap.sgdbAsset.type-logo .sgdbExternalIcon {
  width: clamp(16px, min(6.25cqw, 18.75cqh), 23px);
  height: clamp(16px, min(6.25cqw, 18.75cqh), 23px);
  stroke-width: 2.45;
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
  right: calc(-1 * clamp(5px, min(3.25cqw, 6.25cqh), 10px));
  top: clamp(5px, min(3.25cqw, 6.25cqh), 10px);
  display: flex;
  flex-direction: column;
  gap: clamp(3px, min(1.75cqw, 3.75cqh), 5px);
  z-index: 3;
  pointer-events: none;
}

.sgdbChips span {
  padding: clamp(3px, min(1.75cqw, 3.75cqh), 6px) clamp(6px, min(5cqw, 10cqh), 15px);
  min-height: clamp(14px, min(8.75cqw, 16.25cqh), 28px);
  border-radius: clamp(4px, min(2.75cqw, 6.25cqh), 8px) 0 0 clamp(4px, min(2.75cqw, 6.25cqh), 8px);
  color: white;
  font-size: clamp(8px, min(4.75cqw, 9.25cqh), 15px);
  font-weight: 700;
  text-transform: uppercase;
  transform: translateX(calc(100% - clamp(8px, min(5cqw, 10cqh), 15px)));
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
  background: rgba(0, 0, 0, 0.42);
  transition: opacity 100ms ease, z-index 0s 100ms;
}

.dload-overlay.downloading {
  opacity: 1;
  z-index: 5;
}

.sgdbApplyStatus {
  display: grid;
  place-items: center;
  width: clamp(34px, min(18cqw, 28cqh), 52px);
  height: clamp(34px, min(18cqw, 28cqh), 52px);
  border-radius: 999px;
  background: rgba(6, 10, 16, 0.82);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.sgdbApplyStatus svg,
.sgdbApplyStatus img,
.sgdbApplyStatus div {
  max-width: 26px;
  max-height: 26px;
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
  grid-template-columns: max-content minmax(420px, 900px) max-content;
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

.sgdbDesktop .sgdbFilterMainButton,
.sgdbDesktop .sgdbResetButton {
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
  grid-template-columns: max-content minmax(420px, 900px) max-content;
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

.sgdbDesktopToolbar .sgdbFilterMainButton,
.sgdbDesktopToolbar .sgdbResetButton {
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

.sgdbDesktopToolbar .sgdbFilterMainButton.selected,
.sgdbDesktopToolbar .sgdbResetButton:hover,
.sgdbDesktopToolbar .sgdbResetButton:focus-visible {
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

.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l .sgdbExternalLinkButton,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero .sgdbExternalLinkButton {
  width: clamp(30px, min(11.25cqw, 36cqh), 50px);
  height: clamp(30px, min(11.25cqw, 36cqh), 50px);
}

.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l .sgdbExternalIcon,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero .sgdbExternalIcon {
  width: clamp(24px, min(9.375cqw, 28.125cqh), 35px);
  height: clamp(24px, min(9.375cqw, 28.125cqh), 35px);
}

.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l .sgdbChips,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero .sgdbChips {
  right: calc(-1 * clamp(7.5px, min(4.875cqw, 9.375cqh), 15px));
  top: clamp(7.5px, min(4.875cqw, 9.375cqh), 15px);
  gap: clamp(4.5px, min(2.625cqw, 5.625cqh), 7.5px);
}

.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l .sgdbChips span,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero .sgdbChips span {
  padding: clamp(4.5px, min(2.625cqw, 5.625cqh), 9px) clamp(9px, min(7.5cqw, 15cqh), 22.5px);
  min-height: clamp(21px, min(13.125cqw, 24.375cqh), 42px);
  border-radius: clamp(6px, min(4.125cqw, 9.375cqh), 12px) 0 0 clamp(6px, min(4.125cqw, 9.375cqh), 12px);
  font-size: clamp(12px, min(7.125cqw, 13.875cqh), 22.5px);
  transform: translateX(calc(100% - clamp(12px, min(7.5cqw, 15cqh), 22.5px)));
}

.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l:hover .sgdbChips span,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l.gpfocus .sgdbChips span,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-grid_l:focus-visible .sgdbChips span,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero:hover .sgdbChips span,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero.gpfocus .sgdbChips span,
.sgdbDesktopToolbar .image-wrap.sgdbAsset.type-hero:focus-visible .sgdbChips span {
  transform: translateX(0);
}
`;
