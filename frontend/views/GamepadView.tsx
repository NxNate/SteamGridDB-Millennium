import { DialogButton, Focusable, GamepadButton, SliderField, Spinner } from '@steambrew/client';
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
  loadAssets: (type: SGDBAssetType, nextPage?: number, append?: boolean) => Promise<void>;
  resetCurrentTab: () => void;
  isGamepadUI?: boolean;
};

const ASSET_LABEL: Record<SGDBAssetType, string> = {
  grid_p: 'CAPSULE',
  grid_l: 'WIDE CAPSULE',
  hero: 'HERO',
  logo: 'LOGO',
  icon: 'ICON',
};

const tabs = Object.keys(ASSET_LABEL) as SGDBAssetType[];
const isAnimatedAsset = (src: string) => /\.(webm|mp4)(\?|$)/i.test(src);

const assetGridStyle = (assetType: SGDBAssetType, zoom: number) => {
  if (assetType === 'hero' || assetType === 'logo') {
    const columns = Math.max(2, Math.min(6, zoom));
    return { gridTemplateColumns: `repeat(auto-fill, minmax(calc(${100 / columns}% - 10px), 1fr))` };
  }

  return { ['--asset-size' as string]: `${zoom}px` };
};

const sliderLimits = (assetType: SGDBAssetType) => ({
  min: assetType === 'hero' ? 2 : assetType === 'logo' ? 2 : assetType === 'grid_l' ? 160 : 100,
  max: assetType === 'hero' ? 4 : assetType === 'logo' ? 6 : assetType === 'grid_l' ? 640 : assetType === 'grid_p' ? 300 : 200,
  step: assetType === 'hero' || assetType === 'logo' ? 1 : 5,
});

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

export const GamepadView = ({
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
  isGamepadUI = true,
}: ViewProps) => {
  const tabAssets = assetsByType[assetType];
  const tabLoading = loadingByType[assetType];
  const tabEndReached = endReachedByType[assetType];
  const tabGridStyle = assetGridStyle(assetType, zoomByType[assetType]);
  const slider = sliderLimits(assetType);
  const sliderProgress = ((zoomByType[assetType] - slider.min) / (slider.max - slider.min)) * 100;

  return (
    <>
      <Focusable className="sgdbManualTabs sgdbGamepadTabs" flow-children="row">
        {tabs.map((tab) => (
          <Focusable
            key={tab}
            className={`sgdbGamepadTab sgdbTextPill ${tab === assetType ? 'selected' : ''}`}
            onActivate={() => setAssetType(tab)}
            onClick={() => setAssetType(tab)}
            onOKActionDescription={ASSET_LABEL[tab]}
            role="button"
          >
            {ASSET_LABEL[tab]}
          </Focusable>
        ))}
        <div className="sgdbGamepadTab sgdbTextPill sgdbManageTab" role="button" aria-disabled="true">
          MANAGE
        </div>
      </Focusable>

      <div className="tabcontents-wrap">
        <div className={`spinnyboi ${!tabLoading ? 'loaded' : ''}`}>
          <img alt="Loading..." src="/images/steam_spinner.png" />
        </div>

        {isGamepadUI ? (
          <Focusable className="sgdb-asset-toolbar" flow-children="row">
            <Focusable className="filter-buttons" flow-children="row">
              <Focusable
                className={`sgdbFilterMainButton sgdbTextPill ${filtersOpen ? 'selected' : ''}`}
                onActivate={() => setFiltersOpen((open) => !open)}
                onClick={() => setFiltersOpen((open) => !open)}
                onOKActionDescription="Filter"
                role="button"
              >
                Filter
              </Focusable>
            </Focusable>
            <SliderField
              className="size-slider"
              value={zoomByType[assetType]}
              min={slider.min}
              max={slider.max}
              step={slider.step}
              showValue={false}
              bottomSeparator="none"
              onChange={(value) => setZoomByType((current) => ({ ...current, [assetType]: value }))}
            />
          </Focusable>
        ) : (
          <div className="sgdb-asset-toolbar">
            <div className="filter-buttons">
              <button className={`sgdbFilterMainButton sgdbTextPill ${filtersOpen ? 'selected' : ''}`} type="button" onClick={() => setFiltersOpen((open) => !open)}>
                Filter
              </button>
            </div>
            <div className="sgdbDesktopSliderWrap" style={{ ['--sgdb-slider-progress' as string]: `${sliderProgress}%` }}>
              <input
                className="sgdbDesktopSlider"
                type="range"
                value={zoomByType[assetType]}
                min={slider.min}
                max={slider.max}
                step={slider.step}
                onChange={(event) => {
                  const nextZoom = Number(event.currentTarget.value);
                  setZoomByType((current) => ({ ...current, [assetType]: nextZoom }));
                }}
              />
            </div>
          </div>
        )}

        {filtersOpen ? (
          <Focusable className="sgdbFilterTray sgdbGamepadFilterNotice" flow-children="row">
            <div className="sgdbGamepadFilterToggles">
            {([
              ['static', 'Static'],
              ['animated', 'Animated'],
              ['adult', 'Adult'],
              ['humor', 'Humor'],
              ['epilepsy', 'Epilepsy'],
            ] as [keyof FilterState, string][]).map(([key, label]) => (
              <Focusable
                key={key}
                className={`sgdbFilterToggle sgdbTextPill ${filters[key] ? 'selected' : ''}`}
                onActivate={() => toggleFilter(key)}
                onClick={() => toggleFilter(key)}
                onOKActionDescription={label}
                role="button"
              >
                {label}
              </Focusable>
            ))}
            </div>
          </Focusable>
        ) : null}

        <button className="sgdbResultsState" type="button" onClick={() => setFiltersOpen((open) => !open)}>
          {tabLoading ? 'Loading' : `${tabAssets.length} ${ASSET_LABEL[assetType].toLowerCase()} results`}
        </button>

        <Focusable id="images-container" className={`sgdbGrid ${assetType}`} style={tabGridStyle} flow-children="right">
          {!tabLoading && tabAssets.map((asset) => (
            <div className="asset-box-wrap" key={asset.id}>
              <Focusable
                className={`image-wrap sgdbAsset type-${assetType}`}
                style={{ paddingBottom: `${asset.width === asset.height ? 100 : (asset.height / asset.width) * 100}%` }}
                onActivate={() => applyAsset(asset, assetType)}
                onClick={() => applyAsset(asset, assetType)}
                onOKActionDescription={`Apply ${ASSET_LABEL[assetType]}`}
                onSecondaryActionDescription="Filter"
                onSecondaryButton={() => setFiltersOpen((open) => !open)}
                actionDescriptionMap={{
                  [GamepadButton.BUMPER_LEFT]: 'Previous Tab',
                  [GamepadButton.BUMPER_RIGHT]: 'Next Tab',
                }}
                role="button"
              >
                <AssetPreview asset={asset} assetType={assetType} />
                <div className="sgdbChips">
                  {isAnimatedAsset(asset.url) || isAnimatedAsset(asset.thumb) ? <span className="animated">Animated</span> : null}
                  {asset.nsfw ? <span className="nsfw">Adult</span> : null}
                  {asset.humor ? <span className="humor">Humor</span> : null}
                  {asset.epilepsy ? <span className="epilepsy">Epilepsy</span> : null}
                </div>
                {applyingId === asset.id ? <div className="dload-overlay downloading"><Spinner /></div> : null}
              </Focusable>
              {asset.author?.name ? <div className="author"><span>{asset.author.name}</span></div> : null}
            </div>
          ))}
          {tabAssets.length === 0 && !tabLoading ? (
            <div className="sgdbEmpty">
              No {ASSET_LABEL[assetType].toLowerCase()} artwork found for this Steam app.
              <DialogButton onClick={resetCurrentTab}>Retry</DialogButton>
            </div>
          ) : null}
        </Focusable>

        {tabAssets.length > 0 && !tabEndReached ? (
          <Focusable
            className={`sgdbMoreButton sgdbTextPill ${tabLoading ? 'disabled' : ''}`}
            onActivate={() => {
              if (!tabLoading) {
                void loadAssets(assetType, pagesByType[assetType] + 1, true);
              }
            }}
            onClick={() => {
              if (!tabLoading) {
                void loadAssets(assetType, pagesByType[assetType] + 1, true);
              }
            }}
            onOKActionDescription="More"
            role="button"
          >
            More
          </Focusable>
        ) : null}
      </div>
    </>
  );
};
