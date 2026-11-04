import { APP_CONFIG } from '../../config/app.config';
import { PanelItem } from './PanelItem';

const { UP_NEXT_LEAD_OPTIONS } = APP_CONFIG;
const focusOnHover = (event) => event.currentTarget.focus();

/** Moving through the series, and how it moves by itself. */
export function EpisodesPanel({ episodes, onClose }) {
  const { current, nextEpisode, previousEpisode, seasons, prefs, updatePrefs, jump } = episodes;
  const leadIndex = UP_NEXT_LEAD_OPTIONS.indexOf(prefs.lead);
  const setLead = (step) => {
    const index = Math.min(UP_NEXT_LEAD_OPTIONS.length - 1, Math.max(0, leadIndex + step));
    updatePrefs({ lead: UP_NEXT_LEAD_OPTIONS[index] });
  };
  const list = episodes.episodes.slice().sort((a, b) => a - b);

  return (
    <aside className="subs" aria-label="Episodes">
      <h2 className="subs__title">Episodes</h2>
      {current && <p className="subs__status">Now playing: {current.label}</p>}
      <div className="subs__scroll">
        {nextEpisode && <PanelItem label="Next episode" detail={nextEpisode.label} onClick={() => episodes.next()} />}
        {previousEpisode && <PanelItem label="Previous episode" detail={previousEpisode.label} onClick={() => episodes.previous()} />}

        {seasons.length > 1 && <h3 className="subs__heading">Seasons</h3>}
        {seasons.length > 1 && seasons.map((season) => (
          <PanelItem key={season} label={`Season ${season}`} selected={current && current.season === season} onClick={() => jump(season, null)} />
        ))}

        {list.length > 1 && <h3 className="subs__heading">{current && current.season ? `Season ${current.season}` : 'All episodes'}</h3>}
        {list.length > 1 && list.map((number) => (
          <PanelItem key={number} label={`Episode ${number}`} selected={current && current.episode === number} onClick={() => jump(current ? current.season : null, number)} />
        ))}

        <h3 className="subs__heading">Autoplay</h3>
        <PanelItem label="Play next episode automatically" selected={prefs.autoplay} onClick={() => updatePrefs({ autoplay: !prefs.autoplay })} />
        <div className="subs__stepper">
          <span className="subs__stepper-name">Show before end</span>
          <button type="button" data-nav="step" className="subs__step" aria-label="Show earlier or later: less" onClick={() => setLead(-1)} onMouseEnter={focusOnHover}>−</button>
          <span className="subs__value">{prefs.lead}s</span>
          <button type="button" data-nav="step" className="subs__step" aria-label="Show earlier or later: more" onClick={() => setLead(1)} onMouseEnter={focusOnHover}>+</button>
        </div>
        <PanelItem label="Done" onClick={onClose} />
      </div>
    </aside>
  );
}
