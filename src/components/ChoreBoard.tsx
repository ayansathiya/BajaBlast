import { useEffect, useState } from 'react';
import { ChoreState, Person } from '../data/models';
import { Confetti } from './Confetti';

interface Props {
  state: ChoreState;
  people: Person[];
  onToggle: (choreId: string, personId: string) => Promise<{ completedAll: boolean } | null>;
  onClose: () => void;
  reducedMotion: boolean;
}

/**
 * The kids' board: pick your name, tick off today's list.
 *
 * Two screens rather than one long list of everyone's chores, because the
 * question a seven-year-old is actually asking is "what do *I* have left",
 * and a wall of other people's tasks is the wrong answer to it.
 *
 * It returns to the name picker on its own after a while — otherwise the
 * kitchen display sits on one kid's list until someone notices.
 */
export function ChoreBoard({ state, people, onToggle, onClose, reducedMotion }: Props) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [justDone, setJustDone] = useState<string | null>(null);

  const active = people.filter((p) => p.enabled);
  const person = active.find((p) => p.id === personId) || null;

  // Drop back to the name picker after a minute of nobody touching it.
  useEffect(() => {
    if (!personId) return;
    const t = setTimeout(() => setPersonId(null), 60_000);
    return () => clearTimeout(t);
  }, [personId, justDone]);

  async function tick(choreId: string) {
    if (!person) return;
    setJustDone(choreId);
    const result = await onToggle(choreId, person.id);
    if (result?.completedAll) setBurst((n) => n + 1);
  }

  const mine = person
    ? state.items.filter((c) => !c.personId || c.personId === person.id)
    : [];
  const doneIds = new Set(
    state.completions.filter((c) => !person || c.personId === person.id).map((c) => c.choreId)
  );
  const totals = person ? state.totals[person.id] : null;
  const goalPct = state.goal.targetPoints
    ? Math.min(100, (state.goalPoints / state.goal.targetPoints) * 100)
    : 0;

  return (
    <div className="chore-overlay" onClick={onClose}>
      <div className="chore-panel" onClick={(e) => e.stopPropagation()}>
        <Confetti trigger={burst} enabled={!reducedMotion} />

        <div className="chore-head">
          <div>
            <div className="uppercase-label" style={{ color: 'var(--text-muted)' }}>
              {person ? `${person.name}'s list` : 'Who are you?'}
            </div>
            <h2 className="chore-title">
              {person ? `${totals?.todayDone ?? 0} of ${mine.length} done` : 'Chores'}
            </h2>
          </div>
          <button className="btn-secondary" onClick={person ? () => setPersonId(null) : onClose}>
            {person ? 'Back' : 'Close'}
          </button>
        </div>

        {!person ? (
          <>
            <div className="chore-people">
              {active.map((p) => {
                const t = state.totals[p.id];
                const complete = t && t.todayTotal > 0 && t.todayDone === t.todayTotal;
                return (
                  <button
                    key={p.id}
                    className={`chore-person ${complete ? 'complete' : ''}`}
                    style={{ borderColor: p.color }}
                    onClick={() => setPersonId(p.id)}
                  >
                    <span className="chore-person-dot" style={{ background: p.color }} />
                    <span className="chore-person-name">{p.name}</span>
                    <span className="chore-person-meta">
                      {t ? `${t.todayDone}/${t.todayTotal} today` : '—'}
                    </span>
                    <span className="chore-person-points">{t?.totalPoints ?? 0} pts</span>
                    {t?.goalLabel && (
                      <span className="chore-person-goal">
                        <span className="chore-person-goal-track">
                          <span
                            className="chore-person-goal-fill"
                            style={{ width: `${t.goalPct}%`, background: p.color }}
                          />
                        </span>
                        <span className="chore-person-goal-label">
                          {t.goalReached ? `${t.goalLabel} — earned!` : `${t.goalLabel} · ${t.totalPoints}/${t.goalPoints}`}
                        </span>
                      </span>
                    )}
                    {complete && <span className="chore-person-badge">All done</span>}
                  </button>
                );
              })}
            </div>

            <div className="chore-leaderboard">
              <div className="uppercase-label" style={{ color: 'var(--text-muted)', marginBottom: 14 }}>
                Leaderboard · this week
              </div>
              {[...active]
                .sort((a, b) => (state.totals[b.id]?.weekPoints ?? 0) - (state.totals[a.id]?.weekPoints ?? 0))
                .map((p, i) => {
                  const t = state.totals[p.id];
                  const top = active.reduce((n, q) => Math.max(n, state.totals[q.id]?.weekPoints ?? 0), 0);
                  return (
                    <div className="lb-row" key={p.id}>
                      <span className="lb-rank">{i + 1}</span>
                      <span className="lb-name">{p.name}</span>
                      <span className="lb-bar">
                        <span
                          className="lb-fill"
                          style={{
                            width: `${top ? ((t?.weekPoints ?? 0) / top) * 100 : 0}%`,
                            background: p.color,
                          }}
                        />
                      </span>
                      <span className="lb-points tabular">{t?.weekPoints ?? 0}</span>
                    </div>
                  );
                })}
            </div>
          </>
        ) : (
          <div className="chore-list">
            {mine.length === 0 ? (
              <div className="chore-empty">Nothing on the list today.</div>
            ) : (
              mine.map((c) => {
                const done = doneIds.has(c.id);
                return (
                  <button
                    key={c.id}
                    className={`chore-item ${done ? 'done' : ''}`}
                    onClick={() => tick(c.id)}
                  >
                    <span className="chore-check" style={done ? { background: person.color, borderColor: person.color } : undefined} />
                    <span className="chore-label">{c.label}</span>
                    <span className="chore-points">{c.points} pts</span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {/* Two bars, deliberately: your own reward, and the one the whole
            house is saving for. Cashing in yours doesn't touch the family one. */}
        {person && totals?.goalLabel && (
          <div className="chore-goal">
            <div className="chore-goal-head">
              <span className="uppercase-label" style={{ color: 'var(--text-muted)' }}>
                {person.name} is saving for
              </span>
              <span className="chore-goal-label">{totals.goalLabel}</span>
            </div>
            <div className="chore-goal-track">
              <div
                className="chore-goal-fill"
                style={{ width: `${totals.goalPct}%`, background: person.color }}
              />
            </div>
            <div className="chore-goal-meta tabular">
              {totals.goalReached
                ? `Earned — ${totals.totalPoints} points`
                : `${totals.totalPoints} / ${totals.goalPoints} points`}
            </div>
          </div>
        )}

        <div className="chore-goal">
          <div className="chore-goal-head">
            <span className="uppercase-label" style={{ color: 'var(--text-muted)' }}>
              Everyone is working towards
            </span>
            <span className="chore-goal-label">{state.goal.label}</span>
          </div>
          <div className="chore-goal-track">
            <div className="chore-goal-fill" style={{ width: `${goalPct}%` }} />
          </div>
          <div className="chore-goal-meta tabular">
            {state.goalPoints} / {state.goal.targetPoints} points — everyone's together
            {state.everyoneReached && ' · everyone has earned their own reward too'}
          </div>
        </div>
      </div>
    </div>
  );
}
