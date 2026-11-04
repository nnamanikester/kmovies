import { AUTO_QUALITY } from '../../hooks/usePlayer';
import { PanelItem } from './PanelItem';

/** The stream's qualities, and any other versions of the video the page offered. */
export function QualityPanel({ player, versions, currentVersion, onSwitchVersion, onClose }) {
  const { qualities, selectedQuality, playingQuality, selectQuality } = player;
  const playing = qualities.find((quality) => quality.id === playingQuality);
  const otherVersions = versions.length > 1 ? versions : [];
  const hasChoice = qualities.length > 1 || otherVersions.length > 0;

  return (
    <aside className="subs" aria-label="Video quality">
      <h2 className="subs__title">Video quality</h2>
      <div className="subs__scroll">
        {qualities.length > 1 && (
          <div>
            <PanelItem
              label="Auto"
              detail={selectedQuality === AUTO_QUALITY && playing ? playing.label : null}
              selected={selectedQuality === AUTO_QUALITY}
              onClick={() => selectQuality(AUTO_QUALITY)}
            />
            {qualities.map((quality) => (
              <PanelItem key={quality.id} label={quality.label} selected={selectedQuality === quality.id} onClick={() => selectQuality(quality.id)} />
            ))}
          </div>
        )}

        {otherVersions.length > 0 && (
          <div>
            <h3 className="subs__heading">Versions on this page</h3>
            {otherVersions.map((version) => (
              <PanelItem key={version.id} label={version.label} selected={version.id === currentVersion} onClick={() => onSwitchVersion(version.id)} />
            ))}
          </div>
        )}

        {!hasChoice && <p className="subs__empty">This website only offers one quality for this video.</p>}
        <PanelItem label="Done" onClick={onClose} />
      </div>
    </aside>
  );
}
