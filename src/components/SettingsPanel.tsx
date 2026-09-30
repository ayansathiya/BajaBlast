import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { CalendarEvent, FamilyPhoto, GroceryItem, HouseholdSettings, Person, eventPeople } from '../data/models';
import { EventEditor } from './EventEditor';
import { calendarProvider as calendarProviderRef } from '../providers';
import { formatClock } from '../engine/intelligence';
import { useMusic } from '../hooks/useMusic';
import { qrToSvg } from '../engine/qr';
import { collapseSeries, describeRecurrence } from '../engine/recurrence';

/** Shape of one entry from Spotify's /me/player/devices. */
interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface Props {
  settings: HouseholdSettings;
  onChange: (next: HouseholdSettings) => void;
  onClose: () => void;
  visibleEvents: CalendarEvent[];
  /** Re-reads the calendar after the editor changes something. */
  onEventsChanged: () => Promise<void>;
  grocery: GroceryItem[];
  onAddGrocery: (label: string) => Promise<void>;
  onRemoveGrocery: (id: string) => Promise<void>;
}

// Deliberately identical to the tab list on the phone (app/mobile.html).
// If one grows a section, so does the other — they're the same panel.
const SECTIONS = ['Calendar', 'People', 'Grocery', 'Chores', 'Recipes', 'Photos', 'Music', 'Display', 'Ambient', 'Intelligence', 'Baja', "What's new", 'System'] as const;
type Section = (typeof SECTIONS)[number];

const PERSON_COLORS = ['#00F5D4', '#FF5C72', '#8FA3AD', '#A88F7D', '#B58FA0', '#8FA88F', '#E8C468'];

/**
 * Today's date in the LOCAL timezone, as YYYY-MM-DD for a date input.
 *
 * `toISOString()` would be wrong here: it converts to UTC first, so anywhere
 * west of Greenwich every evening rolls over early — in New York, from 8pm
 * onward it returns tomorrow, and the Add Event form silently defaults to the
 * wrong day.
 */
function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const inputStyle: CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text)',
  border: '1px solid var(--hairline)',
  borderRadius: 4,
  padding: '9px 12px',
  fontSize: 14,
  width: '100%',
  fontWeight: 500,
};

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} aria-pressed={on}>
      <span className="toggle-knob" />
    </button>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-label">{label}</div>
        {desc && <div className="settings-row-desc">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/**
 * Calendar: the event list, the editor, and the household's own categories.
 *
 * The list shows one row per series, not one per date. A weekly class is a
 * single row saying when it next runs and how many more are coming, rather
 * than forty rows of the same thing. Grids are the opposite — week and month
 * views show every occurrence, because that's what a calendar is.
 */
function CalendarManager({
  settings,
  onChange,
  events,
  onSaved,
}: {
  settings: HouseholdSettings;
  onChange: (next: HouseholdSettings) => void;
  events: CalendarEvent[];
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(undefined);
  const [categoryLabel, setCategoryLabel] = useState('');
  const provider = calendarProviderRef;

  // One row per series, not one per occurrence.
  //
  // A weekly class expanded across the view window is thirty or forty rows of
  // the same thing, and the list stops being usable for its actual purpose —
  // finding an event to change. Each repeating event now shows its next date
  // and says how many more there are.
  const sorted = collapseSeries(
    [...events].filter((e) => new Date(e.end).getTime() > Date.now() - 12 * 3600 * 1000),
  ).slice(0, 40);

  async function save(draft: Partial<CalendarEvent>, scope: 'one' | 'all') {
    const target = editing;
    if (!target) {
      await provider.createEvent(draft as Omit<CalendarEvent, 'id'>);
    } else if (target.recurrenceParentId && scope === 'one') {
      // Just this date: the master skips it, an override takes its place.
      await provider.updateOccurrence(target.recurrenceParentId, target.occurrenceDate!, draft);
    } else {
      // The whole series (or a one-off): patch the underlying record.
      await provider.updateEvent(target.recurrenceParentId ?? target.id, draft);
    }
    setEditing(undefined);
    await onSaved();
  }

  async function remove(scope: 'one' | 'all') {
    const target = editing;
    if (!target) return;
    if (target.recurrenceParentId && scope === 'one') {
      await provider.updateOccurrence(target.recurrenceParentId, target.occurrenceDate!, null);
    } else {
      await provider.deleteEvent(target.recurrenceParentId ?? target.id);
    }
    setEditing(undefined);
    await onSaved();
  }

  if (editing !== undefined) {
    return (
      <>
        <h2>{editing ? 'Edit Event' : 'Add Event'}</h2>
        <EventEditor
          event={editing}
          settings={settings}
          inputStyle={inputStyle}
          onSave={save}
          onDelete={remove}
          onCancel={() => setEditing(undefined)}
        />
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h2>Events</h2>
        <button className="btn-primary" onClick={() => setEditing(null)}>
          Add event
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="settings-row-desc" style={{ padding: '12px 0' }}>No upcoming events.</div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {sorted.map(({ event: e, moreCount }) => {
            const owners = eventPeople(e)
              .map((id) => settings.people.find((p) => p.id === id))
              .filter(Boolean) as Person[];
            // The rule lives on the master, which for an occurrence is the
            // record it was expanded from.
            const master = e.recurrenceParentId ? events.find((x) => x.id === e.recurrenceParentId) : e;
            const repeats = describeRecurrence(master?.recurrence ?? e.recurrence);
            return (
              <button className="event-list-row event-row-button" key={e.id} onClick={() => setEditing(e)}>
                <div style={{ minWidth: 0, textAlign: 'left' }}>
                  <div className="event-list-title">
                    {owners.map((p) => (
                      <span key={p.id} className="person-dot" style={{ background: p.color }} />
                    ))}
                    {e.title}
                    {e.recurrenceParentId && <span className="repeat-mark" title="Repeats">↻</span>}
                  </div>
                  <div className="settings-row-desc">
                    {moreCount > 0 ? 'Next: ' : ''}
                    {new Date(e.start).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    {' · '}
                    {formatClock(new Date(e.start))}
                    {e.location ? ` · ${e.location.label}` : ''}
                  </div>
                  {moreCount > 0 && (
                    <div className="settings-row-desc" style={{ color: 'var(--accent)' }}>
                      {repeats ?? 'Repeats'} · {moreCount} more coming up
                    </div>
                  )}
                </div>
                <span className="settings-row-desc">Edit</span>
              </button>
            );
          })}
        </div>
      )}

      <h2 style={{ marginTop: 36, fontSize: 18 }}>Your own categories</h2>
      <div className="settings-row-desc" style={{ marginBottom: 12 }}>
        Alongside the built-in ones (school, work, sports…). Useful when the built-ins don't match how your household
        actually thinks about things.
      </div>
      {settings.customCategories.map((c) => (
        <Row key={c.id} label={c.label}>
          <button
            className="btn-delete"
            onClick={() =>
              onChange({
                ...settings,
                customCategories: settings.customCategories.filter((x) => x.id !== c.id),
              })
            }
          >
            Delete
          </button>
        </Row>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <input
          style={inputStyle}
          value={categoryLabel}
          onChange={(e) => setCategoryLabel(e.target.value)}
          placeholder="Add a category…"
        />
        <button
          className="btn-secondary"
          onClick={() => {
            if (!categoryLabel.trim()) return;
            onChange({
              ...settings,
              customCategories: [
                ...settings.customCategories,
                { id: `cat-${Date.now()}`, label: categoryLabel.trim() },
              ],
            });
            setCategoryLabel('');
          }}
        >
          Add
        </button>
      </div>
    </>
  );
}

function PeopleManager({ settings, onChange }: { settings: HouseholdSettings; onChange: (next: HouseholdSettings) => void }) {
  const [name, setName] = useState('');
  const [newColor, setNewColor] = useState(PERSON_COLORS[0]);

  function patchPeople(people: Person[]) {
    onChange({ ...settings, people });
  }

  function addPerson() {
    if (!name.trim()) return;
    const initials = name.trim().slice(0, 1).toUpperCase();
    patchPeople([
      ...settings.people,
      { id: `person-${Date.now()}`, name: name.trim(), color: newColor, initials, enabled: true },
    ]);
    setName('');
    setNewColor(PERSON_COLORS[(settings.people.length + 1) % PERSON_COLORS.length]);
  }

  function deletePerson(id: string) {
    patchPeople(settings.people.filter((p) => p.id !== id));
  }

  function setPersonColor(id: string, color: string) {
    patchPeople(settings.people.map((x) => (x.id === id ? { ...x, color } : x)));
  }

  return (
    <>
      <h2>People</h2>
      {settings.people.map((p) => (
        <div className="event-list-row" key={p.id}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ position: 'relative', display: 'inline-block', width: 18, height: 18, borderRadius: '50%', cursor: 'pointer' }}>
              <span
                className="person-dot"
                style={{ width: 18, height: 18, background: p.color, display: 'block' }}
              />
              <input
                type="color"
                value={p.color}
                onChange={(e) => setPersonColor(p.id, e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                title="Click to change this person's color"
              />
            </label>
            <span className="settings-row-label">{p.name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Toggle
              on={p.enabled}
              onClick={() => patchPeople(settings.people.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x)))}
            />
            <button className="btn-delete" onClick={() => deletePerson(p.id)}>Delete</button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, marginTop: 20, alignItems: 'center' }}>
        <label style={{ position: 'relative', display: 'inline-block', width: 36, height: 36, borderRadius: 6, flexShrink: 0, border: '1px solid var(--hairline)', overflow: 'hidden' }}>
          <span style={{ position: 'absolute', inset: 0, background: newColor }} />
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            title="Pick a color for this person"
          />
        </label>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a person…"
          onKeyDown={(e) => e.key === 'Enter' && addPerson()}
        />
        <button className="btn-accent" onClick={addPerson} style={{ flexShrink: 0 }}>
          Add
        </button>
      </div>
    </>
  );
}

function GroceryManager({
  grocery,
  onAdd,
  onRemove,
}: {
  grocery: GroceryItem[];
  onAdd: Props['onAddGrocery'];
  onRemove: Props['onRemoveGrocery'];
}) {
  const [label, setLabel] = useState('');

  async function handleAdd() {
    if (!label.trim()) return;
    await onAdd(label.trim());
    setLabel('');
  }

  return (
    <>
      <h2>Shared Grocery List</h2>
      <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
        <input
          style={inputStyle}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Add an item…"
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="btn-accent" onClick={handleAdd} style={{ flexShrink: 0 }}>
          Add
        </button>
      </div>
      {grocery.length === 0 ? (
        <div className="settings-row-desc">Nothing on the list yet.</div>
      ) : (
        grocery.map((g) => (
          <div className="event-list-row" key={g.id}>
            <div className="settings-row-label" style={{ textDecoration: g.done ? 'line-through' : 'none', opacity: g.done ? 0.5 : 1 }}>
              {g.label}
            </div>
            <button className="btn-delete" onClick={() => onRemove(g.id)}>Remove</button>
          </div>
        ))
      )}
    </>
  );
}

/**
 * Which build is actually running, and out of which folder.
 *
 * Unzipping a new release next to an existing copy quietly produces a second
 * folder, and then it's easy to run every command correctly in the wrong
 * place. This makes that visible without going near a terminal.
 */
function VersionRow() {
  const [info, setInfo] = useState<{ build: string; root: string; rev?: number; source?: string } | null>(null);

  useEffect(() => {
    fetch('/api/version', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  // APP_BUILD is baked in at compile time; info.build comes from the running
  // server. Equal means the screen and the server came from the same unzip.
  const appBuild = __APP_BUILD__;
  const stale = info && info.build !== appBuild;

  const where =
    info?.source === 'installed'
      ? 'Updated over the air'
      : info?.source === 'bundled'
        ? 'As shipped in the app'
        : info?.root;

  return (
    <>
      <Row label="Version" desc={info ? where : 'Local server not reachable'}>
        <span className="settings-row-desc">
          {appBuild}
          {info?.rev ? ` · rev ${info.rev}` : ''}
        </span>
      </Row>
      {stale && (
        <Row
          label="Stale build"
          desc={`This screen was built from ${appBuild} but the server is running ${info!.build}. Quit and run npm run build.`}
        >
          <span className="settings-row-desc" style={{ color: 'var(--accent-2)' }}>Mismatch</span>
        </Row>
      )}
    </>
  );
}

/**
 * The phone address, with a QR code.
 *
 * This exists because the stick moves. Plug it into a different Mac and the
 * address changes, and the alternative to a QR is someone reading
 * "192.168.1.147:8787" off a screen across the kitchen and typing it into a
 * phone with wet hands.
 */
function PhoneAddressRow() {
  const [info, setInfo] = useState<{ phoneUrl: string; localUrl: string; remoteUrl: string | null } | null>(null);

  useEffect(() => {
    const load = () =>
      fetch('/api/version', { cache: 'no-store' })
        .then((r) => r.json())
        .then((v) => setInfo({ phoneUrl: v.phoneUrl, localUrl: v.localUrl, remoteUrl: v.remoteUrl ?? null }))
        .catch(() => setInfo(null));
    load();
    // The address can change under us — a new DHCP lease, the stick moved to
    // another Mac, or someone running the remote setup script in the next
    // room — between one glance at this panel and the next.
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const svg = useMemo(() => {
    if (!info?.phoneUrl) return null;
    try {
      return qrToSvg(info.phoneUrl, { size: 132 });
    } catch {
      return null;
    }
  }, [info?.phoneUrl]);

  if (!info) return null;

  const away = !!info.remoteUrl;

  return (
    <div className="settings-row" style={{ display: 'block' }}>
      <div className="settings-row-label">Phone app</div>
      <div className="settings-row-desc" style={{ marginBottom: 12 }}>
        {away ? (
          <>
            Point a camera at this, then add it to your home screen — iPhone: Share → Add to Home
            Screen. It works from anywhere, not just the house, and the address never changes.
          </>
        ) : (
          <>
            Point a camera at this. Works on this Wi-Fi only, and the address changes when the
            router hands out a new one. Run <code>setup/remote-setup.sh</code> once to get a
            permanent address that works away from home — and that a phone can install as a real
            app.
          </>
        )}
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        {svg && (
          <div
            style={{ lineHeight: 0, borderRadius: 8, overflow: 'hidden', flex: '0 0 auto' }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        <div style={{ minWidth: 0 }}>
          <code style={{ fontSize: 15, letterSpacing: '0.01em', wordBreak: 'break-all' }}>{info.phoneUrl}</code>
          {away && (
            <div className="settings-row-desc" style={{ marginTop: 8 }}>
              On the house Wi-Fi this also works: <code>{info.localUrl}</code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * When the screen sleeps.
 *
 * The wording matters here more than the control does, because the intuition
 * is backwards: people assume the computer is what costs money to leave on. It
 * isn't — the panel is five or six times the draw, and unlike the computer it
 * can be woken by touching it. So this sleeps the screen and leaves the machine
 * running, which is also the only version that works: a Raspberry Pi that has
 * powered itself off has no way to turn itself back on in the morning.
 */
function ScreenScheduleRows({
  settings,
  patch,
}: {
  settings: HouseholdSettings;
  patch: (key: 'display', value: HouseholdSettings['display']) => void;
}) {
  const schedule = settings.display.schedule ?? { enabled: true, on: '06:00', off: '23:00', wakeOnTouch: true };
  const set = (next: Partial<typeof schedule>) =>
    patch('display', { ...settings.display, schedule: { ...schedule, ...next } });

  // Rounded to the nearest dollar because pretending to three decimal places
  // about someone's electricity bill would be false precision.
  const hoursOff = (() => {
    const [onH, onM] = schedule.on.split(':').map(Number);
    const [offH, offM] = schedule.off.split(':').map(Number);
    const on = onH * 60 + onM;
    const off = offH * 60 + offM;
    const awake = off > on ? off - on : 1440 - on + off;
    return (1440 - awake) / 60;
  })();
  const saving = Math.round(((30 /* watts, a typical 24" panel */ * hoursOff * 365) / 1000) * 0.29);

  return (
    <>
      <Row
        label="Sleep the screen overnight"
        desc={
          schedule.enabled
            ? `Off between ${schedule.off} and ${schedule.on} — around $${saving} a year at New Hampshire prices. The computer behind it keeps running, so your phone still works and updates still arrive.`
            : 'The screen stays on all night. The panel is most of what this costs to run.'
        }
      >
        <Toggle on={schedule.enabled} onClick={() => set({ enabled: !schedule.enabled })} />
      </Row>

      {schedule.enabled && (
        <>
          <Row label="Wakes at" desc="The schedule should be up before anyone comes downstairs">
            <input
              type="time"
              value={schedule.on}
              onChange={(e) => set({ on: e.target.value })}
              style={{ ...inputStyle, width: 140 }}
            />
          </Row>
          <Row label="Sleeps at">
            <input
              type="time"
              value={schedule.off}
              onChange={(e) => set({ off: e.target.value })}
              style={{ ...inputStyle, width: 140 }}
            />
          </Row>
          <Row
            label="Touch wakes it early"
            desc="Tapping the screen at 2am brings it back for an hour and a half. Turn this off if the display is somewhere a cat can reach."
          >
            <Toggle on={schedule.wakeOnTouch !== false} onClick={() => set({ wakeOnTouch: schedule.wakeOnTouch === false })} />
          </Row>
          <Row
            label="Turn the TV off too"
            desc="For a box plugged into a television: sends it to standby over HDMI at night and switches it back on in the morning. Most TVs otherwise sit lit up saying “No signal”. Leave off if the TV is shared."
          >
            <Toggle on={schedule.hdmiCec === true} onClick={() => set({ hdmiCec: schedule.hdmiCec !== true })} />
          </Row>
        </>
      )}
    </>
  );
}

interface UpdateStatus {
  current: { build: string; rev: number; source: string };
  latest: { build: string; rev: number; notes?: string; bytes?: number } | null;
  status: string;
  lastChecked: string | null;
  lastError: string | null;
  lastInstalled: { build: string; rev: number; at: string } | null;
  repo: { owner: string; repo: string } | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
}

/**
 * Updates, as seen from the kitchen.
 *
 * The distinction this row has to keep straight: it updates the app's *code*,
 * which changes week to week, and not the installed package, which changes
 * about once a year and needs a new .deb. Saying "up to date" without that
 * caveat would eventually be false.
 */
function UpdateRow() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState<'check' | 'install' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/update/status', { cache: 'no-store' });
      setStatus(await res.json());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000);
    return () => clearInterval(t);
  }, [load]);

  async function run(what: 'check' | 'install') {
    setBusy(what);
    try {
      const res = await fetch(`/api/update/${what}`, { method: 'POST' });
      const body = await res.json();
      if (body.status) setStatus((s) => ({ ...(s as UpdateStatus), ...body.status }));
      else await load();
    } catch {
      /* the row will fall back to showing the server as unreachable */
    } finally {
      setBusy(null);
    }
  }

  if (!status) return null;

  if (!status.repo) {
    return (
      <Row
        label="Automatic updates"
        desc="Not set up yet. Run setup/github-setup.sh once to put the code on GitHub — after that, every push updates this screen on its own."
      >
        <span className="settings-row-desc">Off</span>
      </Row>
    );
  }

  const checked = status.lastChecked
    ? new Date(status.lastChecked).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'never';

  let desc = `${status.repo.owner}/${status.repo.repo} · checked ${checked}`;
  if (status.lastError) desc = `Couldn't check: ${status.lastError}`;
  else if (status.updateAvailable) desc = `${status.latest?.build} is ready. It installs and restarts once nobody is mid-edit.`;
  else if (status.lastInstalled) desc = `${status.repo.owner}/${status.repo.repo} · last updated to ${status.lastInstalled.build}`;

  return (
    <Row label="Automatic updates" desc={desc}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {status.updateAvailable ? (
          <button className="btn-accent" onClick={() => run('install')} disabled={busy !== null}>
            {busy === 'install' ? 'Updating…' : 'Update now'}
          </button>
        ) : (
          <span className="settings-row-desc">{status.lastError ? 'Error' : 'Up to date'}</span>
        )}
        <button className="btn-secondary" onClick={() => run('check')} disabled={busy !== null}>
          {busy === 'check' ? 'Checking…' : 'Check'}
        </button>
      </div>
    </Row>
  );
}

/**
 * One passcode for the whole household, not one per person.
 *
 * Only settable from the kiosk (the server refuses this route from anywhere
 * but its own loopback address), so knowing the current passcode on a phone
 * isn't enough to change it.
 */
function PasscodeRow() {
  const [required, setRequired] = useState(false);
  const [draft, setDraft] = useState('');
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status', { cache: 'no-store' });
      setRequired((await res.json()).required);
    } catch {
      setRequired(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(passcode: string) {
    await fetch('/api/auth/passcode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passcode }),
    });
    setDraft('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
    load();
  }

  return (
    <div className="settings-row" style={{ display: 'block' }}>
      <div className="settings-row-label">
        Household sign-in {required && <span style={{ color: 'var(--accent)' }}>· On</span>}
      </div>
      <div className="settings-row-desc" style={{ marginBottom: 10 }}>
        One passcode for the whole family — everyone uses the same one, there's no account per
        person. It locks the phone page only; this kiosk never asks. Leave it empty for no
        passcode.
        <br />
        <br />
        It's a lock, not encryption: traffic on your home network is plain HTTP, so this keeps a
        guest from rewriting the calendar but doesn't make the kiosk safe to expose to the internet.
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={inputStyle}
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={required ? 'Enter a new passcode' : 'Set a passcode'}
        />
        <button className="btn-secondary" onClick={() => save(draft)} disabled={!draft}>
          {saved ? 'Saved' : 'Set'}
        </button>
        {required && (
          <button className="btn-delete" onClick={() => save('')}>
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Backup and restore.
 *
 * Everything already survives the app quitting — it's written to disk on
 * every change, atomically, with hourly rolling backups. This is the other
 * half: a copy the household actually holds, so a wiped Mac isn't the end of
 * the calendar.
 */
function BackupRow() {
  const [status, setStatus] = useState<string | null>(null);

  async function importFile(file: File) {
    try {
      const text = await file.text();
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      });
      const data = await res.json();
      setStatus(data.error ? `Import failed: ${data.error}` : `Restored ${data.events} events, ${data.grocery} grocery items.`);
    } catch {
      setStatus('That file could not be read.');
    }
  }

  return (
    <div className="settings-row" style={{ display: 'block' }}>
      <div className="settings-row-label">Backup</div>
      <div className="settings-row-desc" style={{ marginBottom: 10 }}>
        Events, grocery list, people and settings are written to disk the moment they change and
        kept through hourly rolling backups, so quitting or crashing loses nothing. This exports a
        copy you keep yourself. The passcode and Spotify login are left out of the file on purpose.
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn-secondary"
          onClick={() => window.open('/api/export', '_blank')}
        >
          Export backup
        </button>
        <label className="btn-secondary" style={{ cursor: 'pointer' }}>
          Restore from file
          <input
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])}
          />
        </label>
        {status && <span className="settings-row-desc">{status}</span>}
      </div>
    </div>
  );
}

/** Home location — drives both the weather lookup and travel estimates. */
function LocationRow({ settings, onChange }: { settings: HouseholdSettings; onChange: (s: HouseholdSettings) => void }) {
  const [loc, setLoc] = useState(settings.homeLocation);
  const commit = () => onChange({ ...settings, homeLocation: loc });

  return (
    <div className="settings-row" style={{ display: 'block' }}>
      <div className="settings-row-label">Home location</div>
      <div className="settings-row-desc" style={{ marginBottom: 10 }}>
        Used for weather and travel estimates. Weather comes from Open-Meteo for these coordinates.
      </div>
      <input
        style={{ ...inputStyle, marginBottom: 8 }}
        value={loc.label}
        onChange={(e) => setLoc({ ...loc, label: e.target.value })}
        onBlur={commit}
        placeholder="Nashua, NH"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={inputStyle}
          type="number"
          step="0.0001"
          value={loc.lat}
          onChange={(e) => setLoc({ ...loc, lat: Number(e.target.value) })}
          onBlur={commit}
        />
        <input
          style={inputStyle}
          type="number"
          step="0.0001"
          value={loc.lon}
          onChange={(e) => setLoc({ ...loc, lon: Number(e.target.value) })}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

/**
 * Trending tickers. Keeps its own draft string so typing a comma isn't eaten
 * mid-keystroke by normalization; it commits on blur.
 */
function TickerRow({ settings, onChange }: { settings: HouseholdSettings; onChange: (s: HouseholdSettings) => void }) {
  const [draft, setDraft] = useState(settings.feeds.tickers.join(', '));

  function commit() {
    const list = draft
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 8);
    onChange({ ...settings, feeds: { ...settings.feeds, tickers: list } });
    setDraft(list.join(', '));
  }

  return (
    <div className="settings-row" style={{ display: 'block' }}>
      <div className="settings-row-label">Trending tickers</div>
      <div className="settings-row-desc" style={{ marginBottom: 10 }}>
        Comma-separated, up to eight. Yahoo Finance, with Stooq as a backup. Headlines come from BBC World, NPR, CNBC
        Markets and Ars Technica — all public RSS, no account, no key, no cost.
      </div>
      <input
        style={inputStyle}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder="AAPL, NVDA, MSFT, TSLA, SPY"
      />
    </div>
  );
}

/**
 * The daily chore list and the reward everyone's working towards.
 *
 * Points are per chore rather than per completion streak on purpose: a
 * seven-year-old can see why emptying the dishwasher is worth more than
 * making a bed, and nobody has to explain a multiplier.
 */
function ChoresManager({ settings, onChange }: { settings: HouseholdSettings; onChange: (s: HouseholdSettings) => void }) {
  const [label, setLabel] = useState('');
  const [points, setPoints] = useState(10);
  const [personId, setPersonId] = useState('');
  const [goal, setGoal] = useState(settings.chores.goal);
  const [rewardLabel, setRewardLabel] = useState('');
  const [rewardPoints, setRewardPoints] = useState(100);

  function patchChores(next: Partial<HouseholdSettings['chores']>) {
    onChange({ ...settings, chores: { ...settings.chores, ...next } });
  }

  function addReward() {
    if (!rewardLabel.trim()) return;
    patchChores({
      rewards: [
        ...settings.chores.rewards,
        { id: `reward-${Date.now()}`, label: rewardLabel.trim(), points: rewardPoints || 100 },
      ],
    });
    setRewardLabel('');
  }

  function add() {
    if (!label.trim()) return;
    patchChores({
      items: [
        ...settings.chores.items,
        { id: `chore-${Date.now()}`, label: label.trim(), personId, points, active: true },
      ],
    });
    setLabel('');
  }

  return (
    <>
      <h2>Chores</h2>
      <Row label="Show chores on the kiosk" desc="Adds the progress strip in the rail and the tap-to-open board">
        <Toggle on={settings.chores.enabled} onClick={() => patchChores({ enabled: !settings.chores.enabled })} />
      </Row>

      <h2 style={{ marginTop: 30, fontSize: 18 }}>Today's list</h2>
      {settings.chores.items.length === 0 ? (
        <div className="settings-row-desc">No chores yet.</div>
      ) : (
        settings.chores.items.map((c) => {
          const who = c.personId ? settings.people.find((p) => p.id === c.personId)?.name : 'Anyone';
          return (
            <Row key={c.id} label={c.label} desc={`${who ?? 'Anyone'} · ${c.points} pts`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Toggle
                  on={c.active}
                  onClick={() =>
                    patchChores({
                      items: settings.chores.items.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x)),
                    })
                  }
                />
                <button
                  className="btn-delete"
                  onClick={() => patchChores({ items: settings.chores.items.filter((x) => x.id !== c.id) })}
                >
                  Delete
                </button>
              </div>
            </Row>
          );
        })
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
        <input
          style={inputStyle}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="Add a daily job…"
        />
        <select
          value={personId}
          onChange={(e) => setPersonId(e.target.value)}
          style={{ ...inputStyle, width: 150 }}
        >
          <option value="">Anyone</option>
          {settings.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input
          style={{ ...inputStyle, width: 90 }}
          type="number"
          min={0}
          max={500}
          value={points}
          onChange={(e) => setPoints(Number(e.target.value))}
        />
        <button className="btn-secondary" onClick={add}>
          Add
        </button>
      </div>

      <h2 style={{ marginTop: 34, fontSize: 18 }}>Rewards</h2>
      <div className="settings-row-desc" style={{ marginBottom: 14 }}>
        The list everyone picks from. Add as many as you like, at whatever price feels right — a hundred points for ice
        cream, six hundred for a day out.
      </div>
      {settings.chores.rewards.map((r) => (
        <Row key={r.id} label={r.label} desc={`${r.points} points`}>
          <button
            className="btn-delete"
            onClick={() =>
              patchChores({
                rewards: settings.chores.rewards.filter((x) => x.id !== r.id),
                // Don't leave anyone pointed at a reward that no longer exists.
                personGoals: Object.fromEntries(
                  Object.entries(settings.chores.personGoals).filter(([, id]) => id !== r.id)
                ),
              })
            }
          >
            Delete
          </button>
        </Row>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <input
          style={inputStyle}
          value={rewardLabel}
          onChange={(e) => setRewardLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addReward()}
          placeholder="Add a reward…"
        />
        <input
          style={{ ...inputStyle, width: 110 }}
          type="number"
          min={1}
          value={rewardPoints}
          onChange={(e) => setRewardPoints(Number(e.target.value))}
        />
        <button className="btn-secondary" onClick={addReward}>
          Add
        </button>
      </div>

      <h2 style={{ marginTop: 34, fontSize: 18 }}>Who's saving for what</h2>
      <div className="settings-row-desc" style={{ marginBottom: 14 }}>
        Each person works towards their own reward, measured against their own running total — so one person cashing in
        doesn't reset anybody else.
      </div>
      {settings.people.map((p) => (
        <Row key={p.id} label={p.name}>
          <select
            value={settings.chores.personGoals[p.id] ?? ''}
            onChange={(e) =>
              patchChores({
                personGoals: { ...settings.chores.personGoals, [p.id]: e.target.value },
              })
            }
            style={{ ...inputStyle, width: 260 }}
          >
            <option value="">No goal yet</option>
            {settings.chores.rewards.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label} — {r.points} pts
              </option>
            ))}
          </select>
        </Row>
      ))}

      <h2 style={{ marginTop: 34, fontSize: 18 }}>The household goal</h2>
      <div className="settings-row" style={{ display: 'block' }}>
        <div className="settings-row-desc" style={{ marginBottom: 10 }}>
          One extra bar that everyone's points push together, on top of the individual ones. Not a race — the
          leaderboard already covers who's been pulling their weight. Lists reset at midnight; a year of history is kept.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={inputStyle}
            value={goal.label}
            onChange={(e) => setGoal({ ...goal, label: e.target.value })}
            onBlur={() => patchChores({ goal })}
            placeholder="Movie night"
          />
          <input
            style={{ ...inputStyle, width: 130 }}
            type="number"
            min={1}
            value={goal.targetPoints}
            onChange={(e) => setGoal({ ...goal, targetPoints: Number(e.target.value) })}
            onBlur={() => patchChores({ goal })}
          />
        </div>
      </div>
    </>
  );
}

/**
 * Photos on the kiosk: review and delete only.
 *
 * Adding happens from the phone — the kitchen display has no camera and no
 * file picker worth using with a mouse across the room.
 */
function PhotosManager() {
  const [photos, setPhotos] = useState<FamilyPhoto[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/photos', { cache: 'no-store' });
      if (res.ok) setPhotos(await res.json());
    } catch {
      // Server not up — leave the list empty rather than throwing in render.
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    await fetch(`/api/photos/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <h2>Family Photos</h2>
      <div className="settings-row-desc" style={{ marginBottom: 18 }}>
        Add photos from your phone — open the same settings page there and use the Photos tab. They're stored on this
        kiosk and never uploaded anywhere.
      </div>
      {photos.length === 0 ? (
        <div className="settings-row-desc">No photos yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {photos.map((p) => (
            <div key={p.id} style={{ position: 'relative', aspectRatio: '1', overflow: 'hidden', borderRadius: 4 }}>
              <img
                src={`${p.url}`}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <button
                className="btn-delete"
                style={{ position: 'absolute', top: 4, right: 4, background: 'rgba(0,0,0,0.75)', borderRadius: 4 }}
                onClick={() => remove(p.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Music: Sonos on the network, Spotify Connect, and an embedded player.
 *
 * The long note at the bottom is load-bearing, not decoration — "send it to
 * the Sonos over Bluetooth" is the thing everyone reaches for first and the
 * one thing no app can do, so the panel says why and points at the two
 * routes that actually work.
 */
function MusicManager({ settings, onChange }: { settings: HouseholdSettings; onChange: (s: HouseholdSettings) => void }) {
  const { state, command, setVolume, discover, transfer } = useMusic(6, true);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [clientId, setClientId] = useState(settings.music.spotifyClientId);
  const [embedUri, setEmbedUri] = useState(settings.music.embedUri);
  const [scanning, setScanning] = useState(false);
  const [diagnosis, setDiagnosis] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  async function checkConnection() {
    setChecking(true);
    setDiagnosis(null);
    try {
      const res = await fetch('/api/spotify/diagnose', { cache: 'no-store' });
      setDiagnosis((await res.json()).verdict);
    } catch {
      setDiagnosis('Could not reach the local server.');
    } finally {
      setChecking(false);
    }
  }

  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch('/api/spotify/devices', { cache: 'no-store' });
      const data = await res.json();
      setDevices(data.devices || []);
    } catch {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    if (state?.spotify.connected) loadDevices();
  }, [state?.spotify.connected, loadDevices]);

  const np = state?.nowPlaying;
  const embedPath = embedUri.replace('spotify:', '').split(':');

  return (
    <>
      <h2>Music</h2>

      {np?.title ? (
        <div className="settings-row" style={{ borderTop: 'none', alignItems: 'center', gap: 14 }}>
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', minWidth: 0 }}>
            {np.artwork && (
              <img src={np.artwork} alt="" style={{ width: 56, height: 56, borderRadius: 3, objectFit: 'cover' }} />
            )}
            <div style={{ minWidth: 0 }}>
              <div className="settings-row-label">{np.title}</div>
              <div className="settings-row-desc">
                {np.artist} · {np.playing ? 'Playing' : 'Paused'}
                {np.deviceName ? ` · ${np.deviceName}` : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-secondary" onClick={() => command('previous')}>◀◀</button>
            <button className="btn-secondary" onClick={() => command(np.playing ? 'pause' : 'play')}>
              {np.playing ? '❚❚' : '▶'}
            </button>
            <button className="btn-secondary" onClick={() => command('next')}>▶▶</button>
          </div>
        </div>
      ) : (
        <div className="settings-row-desc" style={{ marginBottom: 18 }}>Nothing playing right now.</div>
      )}

      {np?.volume != null && (
        <Row label="Volume" desc={`${np.volume}%`}>
          <input
            type="range"
            min={0}
            max={100}
            defaultValue={np.volume}
            onMouseUp={(e) => setVolume(Number((e.target as HTMLInputElement).value))}
            onTouchEnd={(e) => setVolume(Number((e.target as HTMLInputElement).value))}
          />
        </Row>
      )}

      <h2 style={{ marginTop: 34, fontSize: 18 }}>Sonos speakers on this network</h2>
      {(state?.speakers.length ?? 0) === 0 ? (
        <div className="settings-row-desc">
          None found yet. Sonos speakers announce themselves over Wi-Fi — make sure this Mac mini is on the same network
          as them, then rescan.
        </div>
      ) : (
        state!.speakers.map((s) => (
          <Row key={s.ip} label={s.room} desc={`${s.model} · ${s.ip}`}>
            <button
              className="btn-secondary"
              onClick={() => onChange({ ...settings, music: { ...settings.music, speakerIp: s.ip, speakerRoom: s.room } })}
            >
              {settings.music.speakerIp === s.ip ? 'Selected' : 'Use'}
            </button>
          </Row>
        ))
      )}
      <button
        className="btn-secondary"
        style={{ marginTop: 14 }}
        onClick={async () => {
          setScanning(true);
          await discover();
          setScanning(false);
        }}
      >
        {scanning ? 'Scanning…' : 'Rescan network'}
      </button>

      <h2 style={{ marginTop: 34, fontSize: 18 }}>Spotify Connect</h2>
      {!state?.spotify.clientIdSet ? (
        <div className="settings-row-desc">Add a client ID below to enable Spotify Connect.</div>
      ) : !state?.spotify.connected ? (
        <Row label="Not connected" desc="Opens in this Mac's own browser, so you can see the real Spotify page.">
          <button
            className="btn-secondary"
            onClick={() => fetch('/api/spotify/open-login', { method: 'POST' })}
          >
            Connect Spotify
          </button>
        </Row>
      ) : (
        <>
          <Row label="Connected" desc="Pick where the music should come out.">
            <button
              className="btn-delete"
              onClick={async () => {
                await fetch('/api/spotify/disconnect', { method: 'POST' });
                loadDevices();
              }}
            >
              Disconnect
            </button>
          </Row>
          {devices.length === 0 ? (
            <div className="settings-row-desc">
              No Spotify Connect devices are awake. Open Spotify on the speaker or a phone once and it'll appear here.
            </div>
          ) : (
            devices.map((d) => (
              <Row key={d.id} label={d.name} desc={`${d.type}${d.is_active ? ' · active' : ''}`}>
                <button className="btn-secondary" onClick={() => transfer(d.id)}>Play here</button>
              </Row>
            ))
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button className="btn-secondary" onClick={loadDevices}>
              Refresh devices
            </button>
            <button className="btn-secondary" onClick={checkConnection} disabled={checking}>
              {checking ? 'Checking…' : 'Check connection'}
            </button>
          </div>
          {diagnosis && (
            <div className="settings-row-desc" style={{ marginTop: 12, borderLeft: '2px solid var(--accent)', paddingLeft: 12 }}>
              {diagnosis}
            </div>
          )}
        </>
      )}

      <div className="settings-row" style={{ display: 'block' }}>
        <div className="settings-row-label">Spotify client ID</div>
        <div className="settings-row-desc" style={{ marginBottom: 10 }}>
          Create a free app at developer.spotify.com/dashboard, add{' '}
          <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>
            http://127.0.0.1:8787/api/spotify/callback
          </code>{' '}
          as a Redirect URI, and paste the Client ID here. There's no client secret — this uses PKCE, so nothing secret
          is stored. Handing playback to a speaker needs Spotify Premium; that's Spotify's rule, not this app's.
        </div>
        <input
          style={inputStyle}
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          onBlur={() => onChange({ ...settings, music: { ...settings.music, spotifyClientId: clientId.trim() } })}
          placeholder="from developer.spotify.com"
        />
      </div>

      <h2 style={{ marginTop: 34, fontSize: 18 }}>Play on this screen</h2>
      <div className="settings-row" style={{ display: 'block', borderTop: 'none' }}>
        <div className="settings-row-desc" style={{ marginBottom: 10 }}>
          This player makes sound on <strong>the Mac mini's own audio output</strong>. Pair a Bluetooth speaker to the
          Mac in System Settings → Bluetooth and this comes out of it. Free Spotify accounts get 30-second previews
          here; Premium plays in full.
        </div>
        <input
          style={inputStyle}
          value={embedUri}
          onChange={(e) => setEmbedUri(e.target.value)}
          onBlur={() => onChange({ ...settings, music: { ...settings.music, embedUri: embedUri.trim() } })}
          placeholder="spotify:playlist:…"
        />
      </div>
      {embedPath.length >= 2 && (
        <iframe
          title="Spotify"
          src={`https://open.spotify.com/embed/${encodeURIComponent(embedPath[0])}/${encodeURIComponent(embedPath[1])}`}
          style={{ width: '100%', height: 352, border: '1px solid var(--hairline)', borderRadius: 8, marginTop: 12 }}
          allow="autoplay; clipboard-write; encrypted-media; picture-in-picture"
          loading="lazy"
        />
      )}

      <h2 style={{ marginTop: 34, fontSize: 18, color: 'var(--coral, #ff5c72)' }}>About Bluetooth and Sonos</h2>
      <div className="settings-row-desc" style={{ borderLeft: '2px solid var(--coral, #ff5c72)', paddingLeft: 14 }}>
        No app — this one or any other — can push audio to a speaker over Bluetooth from a web page. Bluetooth audio
        (A2DP) lives in the operating system; the only Bluetooth a browser can speak carries small data packets, not
        sound. And most Sonos speakers have no Bluetooth audio input at all — they're Wi-Fi devices.
        <br />
        <br />
        So there are two real routes, and both beat what Bluetooth would have given you:
        <ul style={{ margin: '10px 0 0 18px', padding: 0, lineHeight: 1.7 }}>
          <li>
            <strong>Sonos:</strong> use Spotify Connect above. Audio goes Spotify → speaker over Wi-Fi, never through
            this Mac. No pairing, no range limit, no re-encoding.
          </li>
          <li>
            <strong>Any Bluetooth speaker:</strong> pair it to the Mac mini once in System Settings → Bluetooth and set
            it as the output device. Everything the Mac plays, the player above included, goes there.
          </li>
        </ul>
      </div>
    </>
  );
}


const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Recipes, Bake Night and the in-app browser.
 *
 * Two of these settings are really about who is standing in front of the
 * screen. Cocktails are hidden with one switch for a household where the
 * kiosk is at child height, and the browser is switched off entirely for one
 * where a touchscreen that can reach the open web isn't wanted in the
 * kitchen. Both leave everything else working.
 */
function RecipesManager({
  settings,
  onChange,
}: {
  settings: HouseholdSettings;
  onChange: (next: HouseholdSettings) => void;
}) {
  const recipes = settings.recipes;

  function patchRecipes(next: Partial<HouseholdSettings['recipes']>) {
    onChange({ ...settings, recipes: { ...recipes, ...next } });
  }

  function patchBake(next: Partial<HouseholdSettings['recipes']['bakeNight']>) {
    patchRecipes({ bakeNight: { ...recipes.bakeNight, ...next } });
  }

  return (
    <>
      <h2>Recipes</h2>

      <Row label="Recipes screen" desc="The chef button in the corner of the calendar">
        <Toggle on={recipes.enabled} onClick={() => patchRecipes({ enabled: !recipes.enabled })} />
      </Row>

      <Row
        label="On-screen keyboard, always"
        desc="It comes up by itself on a touch screen whenever you tap a text box. On shows it even with a mouse."
      >
        <Toggle
          on={recipes.onScreenKeyboard}
          onClick={() => patchRecipes({ onScreenKeyboard: !recipes.onScreenKeyboard })}
        />
      </Row>

      <Row label="Show cocktails" desc="Mocktails stay either way">
        <Toggle on={recipes.showCocktails} onClick={() => patchRecipes({ showCocktails: !recipes.showCocktails })} />
      </Row>

      <h2 style={{ marginTop: 28 }}>Bake Night</h2>

      <Row label="Bake Night" desc="One day a week on the calendar for something the family bakes">
        <Toggle on={recipes.bakeNight.enabled} onClick={() => patchBake({ enabled: !recipes.bakeNight.enabled })} />
      </Row>

      <Row label="Day" desc="Change it and every week moves, including the ones already picked">
        <select
          value={recipes.bakeNight.weekday}
          onChange={(e) => patchBake({ weekday: Number(e.target.value) })}
          style={{ ...inputStyle, width: 150 }}
        >
          {WEEKDAYS.map((day, i) => (
            <option key={day} value={i}>
              {day}
            </option>
          ))}
        </select>
      </Row>

      <Row label="Time" desc="Where it sits on the day view">
        <input
          type="time"
          value={recipes.bakeNight.time}
          onChange={(e) => patchBake({ time: e.target.value })}
          style={{ ...inputStyle, width: 130 }}
        />
      </Row>

      <Row label="What to call it" desc="Shown on the calendar and in the rail">
        <input
          value={recipes.bakeNight.label}
          onChange={(e) => patchBake({ label: e.target.value })}
          style={{ ...inputStyle, width: 180 }}
        />
      </Row>

      <h2 style={{ marginTop: 28 }}>Browser</h2>

      <Row label="Browse the web" desc="A browser inside the app, with a back button that always returns here">
        <Toggle on={recipes.browserEnabled} onClick={() => patchRecipes({ browserEnabled: !recipes.browserEnabled })} />
      </Row>

      <Row label="Home page" desc="Where it opens, and where the home button goes">
        <input
          value={recipes.browserHome}
          onChange={(e) => patchRecipes({ browserHome: e.target.value })}
          style={{ ...inputStyle, width: 280 }}
        />
      </Row>

      <p className="settings-note">
        In the Mac app the browser is a real one — any site loads. On the Pi it can only show sites that allow
        being embedded in another page; the rest say so and offer a QR code to finish on a phone.
      </p>
    </>
  );
}


interface ChangelogEntry {
  date: string | null;
  title: string;
  changes: string[];
}

/**
 * What's new — the update log, read from CHANGELOG.md on the server.
 *
 * Worth having on the wall rather than only on GitHub: this app updates
 * itself overnight, so the screen in the kitchen can change without anyone
 * having asked it to. Somebody should be able to walk up the next morning and
 * find out what happened.
 *
 * The build currently running is marked, so "is this the new one yet?" has an
 * answer that doesn't involve a terminal.
 */
function WhatsNew() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([]);
  const [build, setBuild] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/changelog')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setEntries(data.entries || []);
        setBuild(data.build || '');
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));
    return () => {
      cancelled = true;
    };
  }, []);

  // The build stamp starts with the date it was built, which is how an entry
  // is matched to the version actually on screen.
  const runningDate = build.slice(0, 10);

  return (
    <>
      <h2>What&rsquo;s new</h2>
      <p className="settings-note" style={{ marginTop: 0 }}>
        This display updates itself. Build <strong>{build || '—'}</strong> is running now.
      </p>

      {state === 'loading' && <div className="settings-note">Loading…</div>}
      {state === 'error' && <div className="settings-note">Could not read the update log.</div>}

      {entries.map((entry, i) => (
        <div className="changelog-entry" key={`${entry.date ?? entry.title}-${i}`}>
          <div className="changelog-head">
            <span className="uppercase-label">{entry.date ?? 'Earlier'}</span>
            {entry.date === runningDate && <span className="changelog-current">Running now</span>}
          </div>
          <div className="changelog-title">{entry.title}</div>
          <ul className="changelog-list">
            {entry.changes.map((line, j) => (
              <li key={j}>{line}</li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export function SettingsPanel({
  settings,
  onChange,
  onClose,
  visibleEvents,
  onEventsChanged,
  grocery,
  onAddGrocery,
  onRemoveGrocery,
}: Props) {
  const [section, setSection] = useState<Section>('Calendar');

  function patch<K extends keyof HouseholdSettings>(key: K, value: HouseholdSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-nav">
          {SECTIONS.map((s) => (
            <button key={s} className={`settings-nav-item ${s === section ? 'active' : ''}`} onClick={() => setSection(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="settings-content">
          {section === 'Calendar' && (
            <CalendarManager
              settings={settings}
              onChange={onChange}
              events={visibleEvents}
              onSaved={onEventsChanged}
            />
          )}

          {section === 'People' && <PeopleManager settings={settings} onChange={onChange} />}

          {section === 'Grocery' && <GroceryManager grocery={grocery} onAdd={onAddGrocery} onRemove={onRemoveGrocery} />}

          {section === 'Chores' && <ChoresManager settings={settings} onChange={onChange} />}

          {section === 'Recipes' && <RecipesManager settings={settings} onChange={onChange} />}

          {section === "What's new" && <WhatsNew />}

          {section === 'Photos' && <PhotosManager />}

          {section === 'Music' && <MusicManager settings={settings} onChange={onChange} />}

          {section === 'Display' && (
            <>
              <h2>Display</h2>
              <ScreenScheduleRows settings={settings} patch={patch} />
              <Row label="Theme" desc="Auto adapts to time of day">
                <select
                  value={settings.display.theme}
                  onChange={(e) => patch('display', { ...settings.display, theme: e.target.value as any })}
                  style={{ ...inputStyle, width: 140 }}
                >
                  <option value="auto">Auto</option>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </Row>
              <Row label="Clock seconds" desc="Show a ticking seconds readout">
                <Toggle
                  on={settings.display.clockStyle === 'digital-seconds'}
                  onClick={() => patch('display', { ...settings.display, clockStyle: settings.display.clockStyle === 'digital-seconds' ? 'digital' : 'digital-seconds' })}
                />
              </Row>
              {/*
        One switch for a machine that can't afford the pretty version.

        On a 1GB box with a software-rendered browser, the crossfades, the idle
        reel and the rotating photo frame are most of the work the CPU does —
        and a calendar that stutters is worse than one that doesn't animate.
        Three settings in three different panels is too much to ask of someone
        standing in front of a slow screen, so this flips all of them.
      */}
      <Row label="Low power mode" desc="For a small box: no animation, no idle reel, no photo frame">
        <Toggle
          on={settings.display.reducedMotion && !settings.ambient.enabled && settings.feeds.showPhotoFrame === false}
          onClick={() => {
            const goingOn = !(settings.display.reducedMotion && !settings.ambient.enabled && settings.feeds.showPhotoFrame === false);
            onChange({
              ...settings,
              display: { ...settings.display, reducedMotion: goingOn },
              ambient: { ...settings.ambient, enabled: !goingOn },
              feeds: { ...settings.feeds, showPhotoFrame: !goingOn },
            });
          }}
        />
      </Row>

      <Row label="Reduced motion" desc="Minimize animation across the interface">
                <Toggle on={settings.display.reducedMotion} onClick={() => patch('display', { ...settings.display, reducedMotion: !settings.display.reducedMotion })} />
              </Row>
              <Row label="Large text" desc="Increase text size for readability">
                <Toggle on={settings.display.largeText} onClick={() => patch('display', { ...settings.display, largeText: !settings.display.largeText })} />
              </Row>
              <Row label="High contrast" desc="Increase contrast for low light or vision needs">
                <Toggle on={settings.display.highContrast} onClick={() => patch('display', { ...settings.display, highContrast: !settings.display.highContrast })} />
              </Row>
            </>
          )}

          {section === 'Ambient' && (
            <>
              <h2>Ambient / Idle</h2>
              <Row label="Idle mode" desc="Enter the cinematic Today Reel when inactive">
                <Toggle on={settings.ambient.enabled} onClick={() => patch('ambient', { ...settings.ambient, enabled: !settings.ambient.enabled })} />
              </Row>
              <Row label="Idle timeout" desc={`${settings.ambient.idleTimeoutSeconds} seconds of inactivity`}>
                <input
                  type="range"
                  min={30}
                  max={600}
                  step={15}
                  value={settings.ambient.idleTimeoutSeconds}
                  onChange={(e) => patch('ambient', { ...settings.ambient, idleTimeoutSeconds: Number(e.target.value) })}
                />
              </Row>
              <Row label="Show weather in reel">
                <Toggle on={settings.ambient.showWeather} onClick={() => patch('ambient', { ...settings.ambient, showWeather: !settings.ambient.showWeather })} />
              </Row>
              <Row label="Show birthdays in reel">
                <Toggle on={settings.ambient.showBirthdays} onClick={() => patch('ambient', { ...settings.ambient, showBirthdays: !settings.ambient.showBirthdays })} />
              </Row>
              <Row label="Show news in reel">
                <Toggle on={settings.ambient.showNews} onClick={() => patch('ambient', { ...settings.ambient, showNews: !settings.ambient.showNews })} />
              </Row>
              <Row label="Show grocery list in reel">
                <Toggle on={settings.ambient.showGrocery} onClick={() => patch('ambient', { ...settings.ambient, showGrocery: !settings.ambient.showGrocery })} />
              </Row>
              <Row label="Show family photos in reel" desc="Cycles through photos uploaded via the phone">
                <Toggle on={settings.ambient.showPhotos} onClick={() => patch('ambient', { ...settings.ambient, showPhotos: !settings.ambient.showPhotos })} />
              </Row>
              <Row label="Photo frame on main screen" desc="An always-on photo tile at the bottom of the rail">
                <Toggle on={settings.feeds.showPhotoFrame} onClick={() => patch('feeds', { ...settings.feeds, showPhotoFrame: !settings.feeds.showPhotoFrame })} />
              </Row>
              <Row label="Video source" desc="Where idle backgrounds come from">
                <select
                  value={settings.ambient.videoSource}
                  onChange={(e) => patch('ambient', { ...settings.ambient, videoSource: e.target.value as any })}
                  style={{ ...inputStyle, width: 200 }}
                >
                  <option value="generated">Generated gradients</option>
                  <option value="local">Local videos (/IdleVideos)</option>
                  <option value="off">Off</option>
                </select>
              </Row>
            </>
          )}

          {section === 'Intelligence' && (
            <>
              <h2>Intelligence</h2>
              <Row label="Event prioritization" desc="Surface what matters most, hide routine noise">
                <Toggle on={settings.intelligence.prioritizationEnabled} onClick={() => patch('intelligence', { ...settings.intelligence, prioritizationEnabled: !settings.intelligence.prioritizationEnabled })} />
              </Row>
              <Row label="Weather awareness" desc="Flag outdoor events at risk of rain">
                <Toggle on={settings.intelligence.weatherAwareness} onClick={() => patch('intelligence', { ...settings.intelligence, weatherAwareness: !settings.intelligence.weatherAwareness })} />
              </Row>
              <Row label="Travel time / Leave Now" desc="Estimate when to leave for events with a location">
                <Toggle on={settings.intelligence.travelTimeEnabled} onClick={() => patch('intelligence', { ...settings.intelligence, travelTimeEnabled: !settings.intelligence.travelTimeEnabled })} />
              </Row>
              <Row label="Preparation reminders" desc="Show what to bring for recognized event types">
                <Toggle on={settings.intelligence.preparationReminders} onClick={() => patch('intelligence', { ...settings.intelligence, preparationReminders: !settings.intelligence.preparationReminders })} />
              </Row>
              <Row label="Conflict detection" desc="Flag overlapping household events">
                <Toggle on={settings.intelligence.conflictDetection} onClick={() => patch('intelligence', { ...settings.intelligence, conflictDetection: !settings.intelligence.conflictDetection })} />
              </Row>
            </>
          )}

          {section === 'Baja' && (
            <>
              <h2>Baja</h2>
              <Row label="Enable Baja" desc='Listens continuously for "Baja" — not Siri, see note below'>
                <Toggle on={settings.voiceEnabled} onClick={() => patch('voiceEnabled', !settings.voiceEnabled)} />
              </Row>
              <div style={{ marginTop: 18 }}>
                <div className="field-label">Anthropic API key (paid, best quality)</div>
                <input
                  style={inputStyle}
                  type="password"
                  value={settings.bajaApiKey || ''}
                  onChange={(e) => patch('bajaApiKey', e.target.value)}
                  placeholder="sk-ant-… (optional)"
                />
                <div className="settings-row-desc" style={{ marginTop: 8 }}>
                  Stored only on this local server, never sent anywhere except
                  directly to Anthropic when Baja needs to answer a question.
                  Usage-based — roughly a fraction of a cent per question.
                </div>
              </div>
              <div style={{ marginTop: 20 }}>
                <div className="field-label">Or: free local model name (via Ollama)</div>
                <input
                  style={inputStyle}
                  value={settings.bajaLocalModel || ''}
                  onChange={(e) => patch('bajaLocalModel', e.target.value)}
                  placeholder="llama3.2"
                />
                <div className="settings-row-desc" style={{ marginTop: 8 }}>
                  If no Anthropic key is set above, Baja automatically tries
                  this model through <a href="https://ollama.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>Ollama</a>{' '}
                  running locally on this Mac mini — completely free, no
                  internet needed for the answer itself, nothing sent
                  anywhere. Install Ollama, then run{' '}
                  <code style={{ background: 'var(--bg)', padding: '1px 5px', borderRadius: 3 }}>ollama pull llama3.2</code>{' '}
                  once in Terminal. Small models (1B–3B) run fine on any
                  Mac mini from the last few years.
                </div>
              </div>
              <div className="voice-note" style={{ marginTop: 20 }}>
                Baja is <strong>not</strong> Apple's Siri — there's no public
                API that lets a third-party app plug into Siri's brain. Baja
                is a real, working alternative built on your browser/Electron's
                own continuous speech recognition, which typically runs
                through the OS/browser's speech service rather than fully
                on-device, so listening itself still needs an internet
                connection even when the answering part is free and local.
                <br /><br />
                Say <strong>"Baja"</strong> anywhere near the kiosk, either
                with your question in the same breath ("Baja, what's next?")
                or just the name — it'll say "Yes?" and listen for a moment.
                A few things it always handles instantly, no model needed:
                <ul style={{ margin: '10px 0 10px 18px', padding: 0, lineHeight: 1.7 }}>
                  <li>"Add [item] to the grocery list"</li>
                  <li>"What's next?"</li>
                  <li>"What's the weather?"</li>
                </ul>
                Anything else is answered by whichever of the two options
                above is configured, with today's schedule and grocery list
                included as context. Neither configured → Baja says so out
                loud instead of failing silently.
              </div>
            </>
          )}

          {section === 'System' && (
            <>
              <h2>System</h2>
              <Row label="Household name">
                <input
                  value={settings.householdName}
                  onChange={(e) => patch('householdName', e.target.value)}
                  style={{ ...inputStyle, width: 220 }}
                />
              </Row>
              <LocationRow settings={settings} onChange={onChange} />
              <TickerRow settings={settings} onChange={onChange} />
              <PasscodeRow />
              <BackupRow />
              <Row label="Kiosk mode" desc="Runs full-screen with no OS chrome via Electron">
                <span className="settings-row-desc">Configured in the launcher</span>
              </Row>
              <PhoneAddressRow />
              <UpdateRow />
              <VersionRow />
            </>
          )}
        </div>
        <div className="settings-close-hint">Press Esc or ⌘, to close</div>
      </div>
    </div>
  );
}
