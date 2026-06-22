import { DialogButton, Spinner } from '@steambrew/client';
import { Dispatch, SetStateAction, useMemo, useState } from 'react';
import type { AssetState, EndState, FilterState, LoadingState, PageState, SGDBAsset, SGDBAssetType, ZoomState } from '../index';

type ViewProps = {
  assetType: SGDBAssetType;
  setAssetType: Dispatch<SetStateAction<SGDBAssetType>>;
  assetsByType: AssetState;
  pagesByType: PageState;
  loadingByType: LoadingState;
  endReachedByType: EndState;
  filters: FilterState;
  toggleFilter: (key: keyof FilterState) => void;
  zoomByType: ZoomState;
  setZoomByType: Dispatch<SetStateAction<ZoomState>>;
  filtersOpen: boolean;
  setFiltersOpen: Dispatch<SetStateAction<boolean>>;
  applyingId: number | null;
  applyAsset: (asset: SGDBAsset, type: SGDBAssetType) => Promise<void>;
  showCreatorNames?: boolean;
  loadAssets: (type: SGDBAssetType, nextPage?: number, append?: boolean) => Promise<void>;
  resetCurrentTab: () => void;
};

const ASSET_LABEL: Record<SGDBAssetType, string> = {
  grid_p: 'GRID',
  grid_l: 'WIDE GRID',
  hero: 'HERO',
  logo: 'LOGO',
  icon: 'ICON',
};

const tabs = Object.keys(ASSET_LABEL) as SGDBAssetType[];
const isAnimatedAsset = (src: string) => /\.(webm|mp4)(\?|$)/i.test(src);

const sliderLimits = (assetType: SGDBAssetType) => ({
  min: assetType === 'hero' ? 3.45 : assetType === 'logo' ? 2 : assetType === 'grid_l' ? 160 : 100,
  max: assetType === 'hero' ? 6.45 : assetType === 'logo' ? 6 : assetType === 'grid_l' ? 280 : 200,
  step: assetType === 'hero' ? 0.25 : assetType === 'logo' ? 1 : 5,
});

const assetGridStyle = (assetType: SGDBAssetType, zoom: number) => {
  if (assetType === 'hero' || assetType === 'logo') {
    const minColumns = assetType === 'hero' ? 3.45 : 2;
    const maxColumns = assetType === 'hero' ? 6.45 : 6;
    const columns = Math.max(minColumns, Math.min(maxColumns, zoom));
    return { gridTemplateColumns: `repeat(auto-fill, minmax(calc(${100 / columns}% - 10px), 1fr))` };
  }

  return { ['--asset-size' as string]: `${Math.round(zoom * 1.15)}px` };
};

const AssetPreview = ({ asset, assetType }: { asset: SGDBAsset; assetType: SGDBAssetType }) => {
  const [sourceIndex, setSourceIndex] = useState(0);
  const sources = useMemo(() => Array.from(new Set([asset.thumb, asset.url].filter(Boolean))), [asset.thumb, asset.url]);
  const src = sources[sourceIndex] ?? '';

  if (!src) {
    return <div className="sgdbAssetMissing">No preview</div>;
  }

  if (isAnimatedAsset(src)) {
    return (
      <>
        <video className={`sgdbMedia sgdbMediaBlur ${assetType}`} src={src} muted loop autoPlay playsInline />
        <video className={`sgdbMedia ${assetType}`} src={src} muted loop autoPlay playsInline onError={() => setSourceIndex((current) => Math.min(current + 1, sources.length))} />
      </>
    );
  }

  return (
    <>
      <img className={`sgdbMedia sgdbMediaBlur ${assetType}`} src={src} alt="" loading="lazy" />
      <img className={`sgdbMedia ${assetType}`} src={src} alt="" loading="lazy" onError={() => setSourceIndex((current) => Math.min(current + 1, sources.length))} />
    </>
  );
};

export const DesktopView = ({
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
  showCreatorNames = true,
  loadAssets,
  resetCurrentTab,
}: ViewProps) => {
  const tabAssets = assetsByType[assetType];
  const tabLoading = loadingByType[assetType];
  const tabEndReached = endReachedByType[assetType];
  const tabGridStyle = assetGridStyle(assetType, zoomByType[assetType]);
  const slider = sliderLimits(assetType);
  const sliderProgress = ((zoomByType[assetType] - slider.min) / (slider.max - slider.min)) * 100;

  return (
    <>
      <div
        className="sgdbManualTabs sgdbDesktopTabs"
        onPointerDownCapture={(event) => {
          const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-sgdb-tab]')?.dataset.sgdbTab as SGDBAssetType | undefined;
          if (tab) {
            setAssetType(tab);
          }
        }}
        onClickCapture={(event) => {
          const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-sgdb-tab]')?.dataset.sgdbTab as SGDBAssetType | undefined;
          if (tab) {
            setAssetType(tab);
          }
        }}
      >
        {tabs.map((tab) => (
          <button
            key={tab}
            data-sgdb-tab={tab}
            className={`sgdbDesktopTab sgdbTextPill ${tab === assetType ? 'selected' : ''}`}
            type="button"
            onPointerDown={() => setAssetType(tab)}
            onClick={() => setAssetType(tab)}
          >
            {ASSET_LABEL[tab]}
          </button>
        ))}
      </div>

      <div className="tabcontents-wrap">
        <div className="sgdb-asset-toolbar">
          <div className="filter-buttons">
            <button className={`sgdbFilterMainButton sgdbTextPill ${filtersOpen ? 'selected' : ''}`} type="button" onClick={() => setFiltersOpen((open) => !open)}>
              Filter
            </button>
          </div>
          <input
            className="sgdbDesktopSlider"
            type="range"
            value={zoomByType[assetType]}
            min={slider.min}
            max={slider.max}
            step={slider.step}
            style={{ ['--sgdb-slider-progress' as string]: `${sliderProgress}%` }}
            onChange={(event) => {
              const nextZoom = Number(event.currentTarget.value);
              setZoomByType((current) => ({ ...current, [assetType]: nextZoom }));
            }}
          />
        </div>

        {filtersOpen ? (
          <div className="sgdbFilterTray">
            {([
              ['static', 'Static'],
              ['animated', 'Animated'],
              ['adult', 'Adult'],
              ['humor', 'Humor'],
              ['epilepsy', 'Epilepsy'],
            ] as [keyof FilterState, string][]).map(([key, label]) => (
              <button key={key} className={`sgdbFilterToggle sgdbTextPill ${filters[key] ? 'selected' : ''}`} type="button" onClick={() => toggleFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <button className="sgdbResultsState" type="button" onClick={() => setFiltersOpen((open) => !open)}>
          {tabLoading ? 'Loading' : `${tabAssets.length} ${ASSET_LABEL[assetType].toLowerCase()} results`}
        </button>

        <div id="images-container" className={`sgdbGrid ${assetType}`} style={tabGridStyle}>
          {!tabLoading && tabAssets.map((asset) => (
            <div className="asset-box-wrap" key={asset.id}>
              <button
                className={`image-wrap sgdbAsset type-${assetType}`}
                style={{ paddingBottom: `${asset.width === asset.height ? 100 : (asset.height / asset.width) * 100}%` }}
                type="button"
                onClick={() => applyAsset(asset, assetType)}
              >
                <AssetPreview asset={asset} assetType={assetType} />
                <div className="sgdbChips">
                  {isAnimatedAsset(asset.url) || isAnimatedAsset(asset.thumb) ? <span className="animated">Animated</span> : null}
                  {asset.nsfw ? <span className="nsfw">Adult</span> : null}
                  {asset.humor ? <span className="humor">Humor</span> : null}
                  {asset.epilepsy ? <span className="epilepsy">Epilepsy</span> : null}
                </div>
                {applyingId === asset.id ? <div className="dload-overlay downloading"><Spinner /></div> : null}
              </button>
              {showCreatorNames && asset.author?.name ? <div className="author"><span>{asset.author.name}</span></div> : null}
            </div>
          ))}
          {tabAssets.length === 0 && !tabLoading ? (
            <div className="sgdbEmpty">
              No {ASSET_LABEL[assetType].toLowerCase()} artwork found for this Steam app.
              <DialogButton onClick={resetCurrentTab}>Retry</DialogButton>
            </div>
          ) : null}
        </div>

        {tabAssets.length > 0 && !tabEndReached ? (
          <button
            className={`sgdbMoreButton sgdbTextPill ${tabLoading ? 'disabled' : ''}`}
            type="button"
            onClick={() => {
              if (!tabLoading) {
                void loadAssets(assetType, pagesByType[assetType] + 1, true);
              }
            }}
          >
            More
          </button>
        ) : null}
      </div>
    </>
  );
};
