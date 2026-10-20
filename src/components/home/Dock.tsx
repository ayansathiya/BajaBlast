import { ChoreState, GroceryItem, KitchenTimer, MealDay, NowPlaying, Person } from '../../data/models';
import { BakeState, bakeWhen } from '../../engine/bake';
import { formatCountdown, isRinging, sortTimers, timerRemaining } from '../../engine/kitchen';
import { Icon } from '../Icon';
import { ReminderItem } from '../../hooks/useReminders';
import { showWhen } from '../../engine/when';

interface Props {
  now: Date;
  nowMs: number;
  people: Person[];
  tonight: MealDay | null;
  chores: ChoreState | null;
  grocery: GroceryItem[] | null;
  bake: BakeState | null;
  timers: KitchenTimer[];
  music: NowPlaying | null;
  reminders: ReminderItem[];
  /** null when there are no lights to show. */
  lights: { on: number; total: number } | null;
  onOpenChores: () => void;
  onOpenGrocery: () => void;
  onOpenRecipes: () => void;
  onOpenTimers: () => void;
  onMusic: (action: 'play' | 'pause') => void;
  onOpenReminders: () => void;
  onToggleLights: () => void;
  onOpenLights: () => void;
}

/**
 * The strip along the bottom: everything else the kitchen keeps an eye on.
 *
 * Dinner, chores, the shopping list, bake night — and a running timer or
 * what's playing, only while there is one. Each is one label, one line large
 * enough to read across the room, and one line of detail; tapping opens the
 * full thing. They sit in a row with nothing drawn around them.
 */
export function Dock({
  now,
  nowMs,
  people,
  tonight,
  chores,
  grocery,
  bake,
  timers,
  music,
  reminders,
  lights,
  onOpenChores,
  onOpenGrocery,
  onOpenRecipes,
  onOpenTimers,
  onMusic,
  onOpenReminders,
  onToggleLights,
  onOpenLights,
}: Props) {
  const tiles: JSX.Element[] = [];

  const running = sortTimers(timers, nowMs).filter((t) => !isRinging(t, nowMs));
  if (running.length > 0) {
    const t = running[0];
    tiles.push(
      <button className="dock-tile dock-timer" key="timer" onClick={onOpenTimers}>
        <span className="dock-label">
          <Icon name="timer" size={16} /> {running.length > 1 ? `${running.length} timers` : 'Timer'}
        </span>
        <span className="dock-value tabular">{formatCountdown(timerRemaining(t, nowMs))}</span>
        <span className="dock-sub">{t.remainingMs != null ? `${t.label} · paused` : t.label}</span>
      </button>
    );
  }

  // Reminders: what's due now leads; otherwise the next one coming.
  const open = reminders.filter((r) => !r.done);
  const dueNow = open.filter((r) => r.due && Date.parse(r.due) <= now.getTime());
  const nextUp = open.filter((r) => r.due && Date.parse(r.due) > now.getTime())[0];
  tiles.push(
    <button className={`dock-tile ${dueNow.length ? 'dock-due' : ''}`} key="reminders" onClick={onOpenReminders}>
      <span className="dock-label">
        <Icon name="bell" size={15} /> Reminders
      </span>
      <span className={`dock-value ${open.length ? '' : 'empty'}`}>
        {dueNow.length ? dueNow[0].text : nextUp ? nextUp.text : open.length ? `${open.length} to do` : 'None'}
      </span>
      <span className="dock-sub">
        {dueNow.length > 1 ? `and ${dueNow.length - 1} more now` : dueNow.length ? 'Now' : nextUp?.due ? showWhen(nextUp.due, now) : 'Tap to add one'}
      </span>
    </button>
  );

  const meal = tonight?.meal ?? null;
  tiles.push(
    <div className="dock-tile" key="dinner">
      <span className="dock-label">Dinner</span>
      <span className={`dock-value ${meal ? '' : 'empty'}`}>{meal ? meal.title : 'Not planned'}</span>
      <span className="dock-sub">{meal ? [meal.cook && `${meal.cook} cooking`, meal.note].filter(Boolean).join(' · ') || 'Tonight' : 'Pick one on a phone, under Meals'}</span>
    </div>
  );

  if (chores && chores.items.length > 0) {
    const rows = people.filter((p) => p.enabled && chores.totals[p.id]?.todayTotal);
    const done = rows.reduce((n, p) => n + chores.totals[p.id].todayDone, 0);
    const total = rows.reduce((n, p) => n + chores.totals[p.id].todayTotal, 0);
    tiles.push(
      <button className="dock-tile" key="chores" onClick={onOpenChores}>
        <span className="dock-label">Chores</span>
        <span className="dock-value tabular">{done === total ? 'All done' : `${total - done} left`}</span>
        <span className="dock-people">
          {rows.map((p) => {
            const t = chores.totals[p.id];
            const pct = t.todayTotal ? t.todayDone / t.todayTotal : 0;
            return (
              <span className="dock-person" key={p.id} title={`${p.name} ${t.todayDone}/${t.todayTotal}`}>
                <span className="dock-person-ring" style={{ ['--p' as string]: pct, ['--c' as string]: p.color }} />
                <span className="dock-person-name">{p.name}</span>
              </span>
            );
          })}
        </span>
      </button>
    );
  }

  if (grocery) {
    const pending = grocery.filter((g) => !g.done);
    tiles.push(
      <button className="dock-tile" key="grocery" onClick={onOpenGrocery}>
        <span className="dock-label">Groceries</span>
        <span className={`dock-value tabular ${pending.length ? '' : 'empty'}`}>
          {pending.length ? `${pending.length} to buy` : 'All set'}
        </span>
        <span className="dock-sub">{pending.slice(0, 3).map((g) => g.label).join(', ') || 'Nothing on the list'}</span>
      </button>
    );
  }

  if (bake?.enabled && bake.next) {
    const pick = bake.next.pick;
    tiles.push(
      <button className="dock-tile" key="bake" onClick={onOpenRecipes}>
        <span className="dock-label">{bake.label}</span>
        <span className={`dock-value ${pick ? '' : 'empty'}`}>{pick ? pick.title : 'Pick a recipe'}</span>
        <span className="dock-sub">{bakeWhen(bake.next.date, bake.dayName, now)}</span>
      </button>
    );
  }

  // The lights, one tap: all off if any are on, all on if none are.
  if (lights && lights.total > 0) {
    tiles.push(
      <div className="dock-tile dock-lights" key="lights">
        <span className="dock-label">
          <Icon name="bulb" size={15} /> Lights
        </span>
        <button className={`dock-switch ${lights.on ? 'on' : ''}`} onClick={onToggleLights}>
          <Icon name="power" size={18} />
          {lights.on ? `${lights.on === lights.total ? 'All' : lights.on} on` : 'Off'}
        </button>
        <button className="dock-link" onClick={onOpenLights}>
          Moods &amp; dimming
        </button>
      </div>
    );
  }

  if (music && music.title) {
    tiles.push(
      <button className="dock-tile" key="music" onClick={() => onMusic(music.playing ? 'pause' : 'play')}>
        <span className="dock-label">
          <Icon name={music.playing ? 'pause' : 'play'} size={14} /> {music.playing ? 'Playing' : 'Paused'}
        </span>
        <span className="dock-value">{music.title}</span>
        <span className="dock-sub">{music.artist || music.deviceName || ''}</span>
      </button>
    );
  }

  return <section className="dock">{tiles}</section>;
}
