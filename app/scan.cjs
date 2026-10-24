/**
 * Reading a photo: a school newsletter, a party invitation, a handwritten
 * shopping list, a sticky note — and turning it into calendar events,
 * grocery items and reminders.
 *
 * Nothing here adds anything. It returns what it found; the phone shows
 * that as a list to tick, and only what's ticked is added. A model misreading
 * "the 13th" as "the 18th" should cost one untick, not a wrong event on the
 * wall.
 *
 * Claude reads it when there's an Anthropic key (Settings → Baja); otherwise
 * Groq's free vision model, with the Groq key Baja already uses. Plain fetch,
 * no SDK: the app ships without node_modules (see packaging/build-deb.sh).
 */

const ANTHROPIC_MODEL = 'claude-opus-5-5';
// Groq's vision models, best first; whichever the key can use.
const GROQ_VISION = ['meta-llama/llama-4-maverick-17b-128e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'];
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['events', 'grocery', 'reminders'],
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'date', 'start', 'end', 'location'],
        properties: {
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          start: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'HH:MM, 24-hour; null for all day' },
          end: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'HH:MM, 24-hour; null if not given' },
          location: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
      },
    },
    grocery: { type: 'array', items: { type: 'string' } },
    reminders: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'date', 'time'],
        properties: {
          text: { type: 'string' },
          date: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'YYYY-MM-DD, or null' },
          time: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'HH:MM, 24-hour, or null' },
        },
      },
    },
  },
};

function instructions(now) {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return [
    `Today is ${weekday} ${today}. This photo was taken by a family to add things to their kitchen calendar.`,
    'Find everything in it worth adding, in three kinds:',
    '- events: things that happen at a date (and usually a time): appointments, school events, parties, games, deadlines with a time. Use a short title as it would appear on a calendar ("Science fair", "Emma — dentist"). Resolve relative dates ("next Friday", "the 13th") against today; a date with no year is the next one on or after today. Times in 24-hour HH:MM; start null for all-day.',
    '- grocery: things to buy, one per item, short ("milk", "2 lemons").',
    '- reminders: things to do or remember that are not an event ("Send permission slip", "Bring $5 for the bake sale"), with a date and time if the photo gives one.',
    'Only what the photo actually says — no guesses, no duplicates between the lists. If there is nothing of a kind, return an empty list for it.',
  ].join('\n');
}

function parseDataUrl(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const data = m[2].replace(/\s+/g, '');
  if (Math.floor((data.length * 3) / 4) > MAX_IMAGE_BYTES) return null;
  return { mediaType: m[1], data };
}

const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00`));
const isTime = (s) => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const text = (s, max) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Whatever the model returned, made safe and well-formed — or dropped. */
function clean(raw) {
  const out = { events: [], grocery: [], reminders: [] };
  if (!raw || typeof raw !== 'object') return out;
  for (const e of Array.isArray(raw.events) ? raw.events.slice(0, 40) : []) {
    const title = text(e && e.title, 80);
    if (!title || !isDate(e.date)) continue;
    const start = isTime(e.start) ? e.start : null;
    let end = isTime(e.end) ? e.end : null;
    if (start && end && end <= start) end = null;
    out.events.push({ title, date: e.date, start, end, location: text(e.location, 80) || null });
  }
  const seen = new Set();
  for (const g of Array.isArray(raw.grocery) ? raw.grocery.slice(0, 80) : []) {
    const label = text(g, 60);
    if (!label || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    out.grocery.push(label);
  }
  for (const r of Array.isArray(raw.reminders) ? raw.reminders.slice(0, 40) : []) {
    const t = text(r && r.text, 140);
    if (!t) continue;
    out.reminders.push({ text: t, date: isDate(r.date) ? r.date : null, time: isDate(r.date) && isTime(r.time) ? r.time : null });
  }
  return out;
}

async function withAnthropic(key, image, now) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(90_000),
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      // If the photo trips a safety classifier, let Anthropic's recommended
      // model try it rather than coming back empty.
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      fallbacks: 'default',
      // Reading a page is not hard thinking; low effort keeps it to seconds.
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } },
            { type: 'text', text: instructions(now) },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401) return { error: 'The Anthropic key was turned down. Check it in Settings → Baja.' };
  if (!res.ok || !data) return { error: `Claude couldn't read it (${res.status}).` };
  if (data.stop_reason === 'refusal') return { error: "Claude wouldn't read this photo." };
  const body = (data.content || []).find((b) => b.type === 'text');
  try {
    return { result: clean(JSON.parse(body ? body.text : '')), by: 'claude' };
  } catch {
    return { error: "Claude's answer couldn't be read. Try again." };
  }
}

async function withGroq(key, models, image, now) {
  // Groq retires models often, and a name that's gone means every scan
  // fails. So: the known-good names this key still has, then anything else
  // on the key that looks able to see (llama-4, "vision", "-vl"), and only
  // then the defaults as a last try.
  const usable = GROQ_VISION.filter((m) => models.includes(m));
  const seeing = models.filter((m) => !GROQ_VISION.includes(m) && /llama-4|vision|-vl\b|\bvl-|scout|maverick|llava|gemma-3/i.test(m));
  const list = [...usable, ...seeing, ...GROQ_VISION.filter((m) => !usable.includes(m))];
  let lastError = null;
  for (const model of list) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      signal: AbortSignal.timeout(60_000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `${instructions(now)}\nAnswer with only a JSON object with exactly the keys "events" (objects with title, date, start, end, location), "grocery" (strings) and "reminders" (objects with text, date, time).`,
              },
              { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
            ],
          },
        ],
      }),
    }).catch((err) => ({ ok: false, status: 0, json: async () => ({ error: { message: err.message } }) }));
    const data = await res.json().catch(() => null);
    if (res.status === 401) return { error: 'The Groq key was turned down. Check it in Settings → Baja.' };
    if (res.ok && data) {
      try {
        return { result: clean(JSON.parse(data.choices[0].message.content)), by: 'groq' };
      } catch {
        lastError = "Groq's answer couldn't be read.";
        continue;
      }
    }
    lastError = (data && data.error && data.error.message) || `Groq couldn't read it (${res.status}).`;
  }
  return { error: lastError || "Groq couldn't read it." };
}

/**
 * Read one photo. `settings` is the household's; `groqModels` lists what the
 * Groq key can use (or [] to try the defaults).
 */
async function read(dataUrl, settings, groqModels = [], now = new Date()) {
  const image = parseDataUrl(dataUrl);
  if (!image) return { error: "That isn't a photo this can read (JPEG, PNG or WebP, under 6MB)." };
  const anthropicKey = String((settings && settings.bajaApiKey) || '').trim();
  const groqKey = String((settings && settings.bajaGroqKey) || '').trim();
  if (anthropicKey) return withAnthropic(anthropicKey, image, now);
  if (groqKey) return withGroq(groqKey, groqModels, image, now);
  return { error: 'Reading photos needs a free Groq key (or an Anthropic key) in Settings → Baja.' };
}

module.exports = { read, clean, parseDataUrl, instructions, SCHEMA, ANTHROPIC_MODEL };
