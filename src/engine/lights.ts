/**
 * What Baja should do with the lights, from what it heard.
 *
 *   "set the tv mood"                 → mood TV
 *   "dinner mode", "the night scene"  → mood Dinner / Night
 *   "turn off the lights"             → every light off
 *   "turn on the lamp lights"         → the lights named like "lamp", on
 *   "dim the lights", "… to 30 percent"
 *   "make the lights warm / red"
 *
 * Returns null when the sentence isn't about the lights, so the assistant
 * falls through to its other commands. The speech recogniser writes "TV" as
 * "t v", and numbers as words, both of which are handled here.
 */

export interface LightChange {
  on?: boolean;
  dimming?: number;
  temp?: number;
  color?: [number, number, number];
}

export type LightCommand =
  | { kind: 'scene'; name: string }
  | { kind: 'set'; target: 'all' | string[]; change: LightChange; names: string[] };

const NUMBERS: Record<string, number> = {
  ten: 10, fifteen: 15, twenty: 20, 'twenty five': 25, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, 'seventy five': 75, eighty: 80, ninety: 90, hundred: 100, 'a hundred': 100, 'one hundred': 100,
};

const COLORS: Record<string, [number, number, number]> = {
  red: [255, 0, 0],
  orange: [255, 110, 0],
  yellow: [255, 200, 0],
  green: [0, 255, 0],
  blue: [0, 60, 255],
  purple: [140, 0, 255],
  pink: [255, 50, 150],
};

function normalise(text: string): string {
  return ` ${text.toLowerCase()} `
    .replace(/[.,!?]/g, ' ')
    .replace(/\bt\s+v\b/g, 'tv')
    .replace(/\bteevee\b/g, 'tv')
    // How the Pi's recogniser tends to hear these (checked against it).
    .replace(/\blamb(s?)\b/g, 'lamp$1')
    .replace(/\b(lives|likes|lice)\b/g, 'lights')
    .replace(/\b(please|hey|could you|can you)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function percentIn(q: string): number | null {
  const digits = q.match(/\b(\d{1,3})\s*(?:percent|%)/);
  if (digits) return Number(digits[1]);
  for (const [word, n] of Object.entries(NUMBERS).sort((a, b) => b[0].length - a[0].length)) {
    if (new RegExp(`\\b${word}\\s+percent\\b`).test(q)) return n;
  }
  return null;
}

export function parseLightCommand(text: string, sceneNames: string[], bulbNames: string[]): LightCommand | null {
  const q = normalise(text);

  // A mood, by name: "set the tv mood", "tv mode", "the dinner scene".
  const moodish = q.match(/^(?:.*?\b(?:set|turn on|switch to|start|put on|activate|go to|use)\s+)?(?:the\s+|a\s+)?(.+?)\s+(?:mood|scene|mode|lighting)\b/);
  if (moodish) {
    const said = squash(moodish[1]);
    const scene =
      sceneNames.find((n) => squash(n) === said) ??
      sceneNames.find((n) => said.endsWith(squash(n)) || squash(n).startsWith(said));
    if (scene) return { kind: 'scene', name: scene };
  }

  if (!/\b(lights?|lamps?|bulbs?)\b/.test(q)) return null;

  // Which lights: whatever names the sentence mentions, or all of them.
  const names = bulbNames.filter((n) => {
    const s = n.toLowerCase();
    return q.includes(s) || s.split(/\s+/).filter((w) => w.length > 3 && !/^light/.test(w)).some((w) => q.includes(w));
  });
  const target: 'all' | string[] = names.length && !/\ball\b/.test(q) ? names : 'all';

  const change: LightChange = {};
  if (/\boff\b/.test(q)) {
    change.on = false;
  } else {
    const pct = percentIn(q);
    if (/\bdim(mer)?\b/.test(q)) change.dimming = pct ?? 30;
    else if (/\b(brighten|brighter|full|max|maximum)\b/.test(q)) change.dimming = pct ?? 100;
    else if (pct != null) change.dimming = pct;

    if (/\bwarm(er)?\b/.test(q)) change.temp = 2700;
    else if (/\b(cool|cooler|daylight)\b/.test(q)) change.temp = 5000;
    const color = Object.keys(COLORS).find((c) => new RegExp(`\\b${c}\\b`).test(q));
    if (color) change.color = COLORS[color];

    if (/\bon\b/.test(q) || Object.keys(change).length) change.on = true;
  }

  if (change.on === undefined) return null;
  return { kind: 'set', target, change, names };
}
