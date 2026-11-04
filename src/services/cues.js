/** The subtitle showing at `time`. A positive delay shows subtitles later. */
export function cueTextAt(cues, time, delay) {
  const shifted = time - delay;
  for (let i = 0; i < cues.length; i += 1) {
    if (cues[i].start > shifted) return null;
    if (shifted < cues[i].end) return cues[i].text;
  }
  return null;
}
