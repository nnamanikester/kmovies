import { useCallback, useRef, useState } from 'react';
import { useCastConnection } from './hooks/useCastConnection';
import { usePlayer } from './hooks/usePlayer';
import { useEpisodes } from './hooks/useEpisodes';
import { useSubtitles } from './hooks/useSubtitles';
import { PlayerScreen, WaitingScreen } from './screens';

/** The TV plays what it's sent, and everything about playback is controlled from here. */
export default function App() {
  const onMessageRef = useRef(() => {});
  const onMessage = useCallback((message) => onMessageRef.current(message), []);
  const { connected, server, media, send, sendStatus, clearMedia } = useCastConnection(onMessage);
  const player = usePlayer(media, sendStatus);
  const subtitles = useSubtitles(media, player.videoRef, send);
  const episodes = useEpisodes(media, send);
  const [speed, setSpeed] = useState(1);
  const peekRef = useRef(() => {});
  const [versionList, setVersionList] = useState({ castId: null, versions: [] });

  onMessageRef.current = (message) => {
    if (message.type === 'control') {
      player.control(message);
      peekRef.current();
    } else if (message.type === 'versions') {
      setVersionList(message);
    } else if (message.type === 'episodes' || message.type === 'advancing' || message.type === 'advanceFailed') {
      episodes.onMessage(message);
    } else {
      subtitles.onMessage(message);
    }
  };

  const stop = () => {
    sendStatus({ status: 'stopped' });
    clearMedia();
  };

  const versions = media && versionList.castId === media.castId ? versionList.versions : [];
  const switchVersion = (id) => send({ type: 'version', id, position: player.videoRef.current ? player.videoRef.current.currentTime : 0 });

  if (!media) return <WaitingScreen connected={connected} server={server} />;
  return <PlayerScreen key={media.castId} media={media} player={player} subtitles={subtitles} episodes={episodes} speed={speed} onSpeedChange={setSpeed} versions={versions} onSwitchVersion={switchVersion} onStop={stop} peekRef={peekRef} />;
}
