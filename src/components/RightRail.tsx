import { Fragment, useEffect, useRef, useState } from 'react';
import {
  CalendarEvent,
  ChoreState,
  FamilyPhoto,
  GroceryItem,
  NowPlaying as NowPlayingModel,
  Person,
} from '../data/models';
import { formatClock, isSameDay, computeDayLoad } from '../engine/intelligence';
import { BakeState, bakeWhen } from '../engine/bake';
import { NowPlaying } from './NowPlaying';

interface Props {
  upcoming: CalendarEvent[];
  people: Person[];
  todayEvents: CalendarEvent[];
  now: Date;
  showGrocery: boolean;
  grocery: GroceryItem[];
  onToggleGrocery: (id: string) => void;
  photos: FamilyPhoto[];
  showPhotoFrame: boolean;
  nowPlaying: NowPlayingModel | null;
  showNowPlaying: boolean;
  onMusicCommand: (action: 'play' | 'pause' | 'next' | 'previous') => void;
  chores: ChoreState | null;
  showChores: boolean;
  onOpenChores: () => void;
  bake: BakeState | null;
  onOpenRecipes: () => void;
}

function describeWhen(e: CalendarEvent, now: Date): string {
  const start = new Date(e.start);
  if (isSameDay(start, now)) return `Today · ${formatClock(start)}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (isSameDay(start, tomorrow)) return `Tomorrow · ${formatClock(start)}`;
  return `${start.toLocaleDateString(undefined, { weekday: 'long' })} · ${formatClock(start)}`;
}

/**
 * A slow, always-on photo frame pinned to the bottom of the rail.
 *
 * Family photos used to appear only in the idle reel, which meant that
 * unless you stood in the kitchen doing nothing for two and a half minutes
 * you never saw them at all. All the photos are stacked and crossfaded by
 * opacity so there's no flash of empty space between them.
 */
function PhotoFrame({ photos }: { photos: FamilyPhoto[] }) {
  const [index, setIndex] = useState(0);
  const [shape, setShape] = useState<'portrait' | 'square' | 'landscape'>('landscape');
  const mediaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (photos.length <= 1) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % photos.length), 14000);
    return () => clearInterval(t);
  }, [photos.length]);

  // The tile grows taller for a portrait photo and stays short for a
  // landscape one. Without this, a phone photo shown whole inside a wide,
  // short tile is correct but tiny — technically uncropped, practically
  // useless from across a kitchen.
  //
  // Measured on every change rather than on the image's load event, because
  // an image that's already cached doesn't fire load again when it comes back
  // around in the rotation.
  useEffect(() => {
    const node = mediaRef.current;
    if (!node) return;

    function measure() {
      const img = node!.querySelector<HTMLImageElement>('img.showing:not(.blur)');
      if (!img?.naturalWidth || !img.naturalHeight) return;
      const ratio = img.naturalWidth / img.naturalHeight;
      setShape(ratio < 0.9 ? 'portrait' : ratio < 1.25 ? 'square' : 'landscape');
    }

    measure();
    // A not-yet-decoded image reports 0×0; catch it when it finishes.
    node.querySelectorAll('img').forEach((img) => img.addEventListener('load', measure));
    return () => node.querySelectorAll('img').forEach((img) => img.removeEventListener('load', measure));
  }, [index, photos]);

  if (photos.length === 0) return null;
  const current = photos[index % photos.length];

  return (
    <div className="photo-frame">
      <div className="uppercase-label rail-label">Family</div>
      <div className={`photo-frame-media is-${shape}`} ref={mediaRef}>
        {photos.map((p, i) => {
          const showing = i === index % photos.length;
          const src = `${p.url}`;
          return (
            // Two copies of each photo: a blurred one filling the tile, and
            // the real one contained on top of it, so nothing is cropped.
            <Fragment key={p.id}>
              <img src={src} alt="" aria-hidden className={`blur ${showing ? 'showing' : ''}`} />
              {/* Sizing is handled by the effect above, which re-measures on
                  every rotation — an onLoad here would miss cached images. */}
              <img src={src} alt="" className={showing ? 'showing' : ''} />
            </Fragment>
          );
        })}
      </div>
      {current.caption && <div className="photo-frame-caption">{current.caption}</div>}
    </div>
  );
}

export function RightRail({
  upcoming,
  people,
  todayEvents,
  now,
  showGrocery,
  grocery,
  onToggleGrocery,
  photos,
  showPhotoFrame,
  nowPlaying,
  showNowPlaying,
  onMusicCommand,
  chores,
  showChores,
  onOpenChores,
  bake,
  onOpenRecipes,
}: Props) {
  const load = computeDayLoad(todayEvents);
  const pendingGrocery = grocery.filter((g) => !g.done);
  const musicVisible = showNowPlaying && !!nowPlaying?.title;
  const choreStripVisible = showChores && !!chores && chores.items.length > 0;
  const bakeVisible = !!bake?.enabled && !!bake.next;

  return (
    <div className="rail">
      <div className="rail-scroll">
        {showNowPlaying && <NowPlaying nowPlaying={nowPlaying} onCommand={onMusicCommand} />}

        {upcoming.length > 0 && (
          <div className="rail-section">
            <div className="uppercase-label rail-label">
              Next<span className="rail-count">{load.label}</span>
            </div>
            {/* One upcoming event when music is on screen, two otherwise —
                the rail can't hold both at full length on a 1080p display. */}
            {upcoming.slice(0, musicVisible ? 1 : 2).map((e) => {
              const person = people.find((p) => p.id === e.personId);
              return (
                <div
                  className="upcoming-item"
                  key={e.id}
                  style={{
                    borderLeft: `3px solid ${person ? person.color : 'transparent'}`,
                    paddingLeft: 10,
                    marginLeft: -13,
                  }}
                >
                  <div className="upcoming-when">{describeWhen(e, now)}</div>
                  <div className="upcoming-title">{e.title}</div>
                </div>
              );
            })}
          </div>
        )}

        {choreStripVisible && chores && (
          <button className="rail-section chore-rail" onClick={onOpenChores}>
            <div className="uppercase-label rail-label">
              Chores
              <span className="rail-count">Tap to open</span>
            </div>
            {/* Pills rather than a row each: five people with progress bars
                cost about 170px, which is most of what the grocery list
                needs. This says the same thing in two wrapped lines. */}
            <div className="chore-pills">
              {people
                .filter((p) => p.enabled && chores.totals[p.id]?.todayTotal)
                .map((p) => {
                  const t = chores.totals[p.id];
                  const complete = t.todayDone === t.todayTotal;
                  return (
                    <span className={`chore-pill ${complete ? 'complete' : ''}`} key={p.id}>
                      <span className="chore-pill-dot" style={{ background: p.color }} />
                      {p.name}
                      <span className="chore-pill-count tabular">
                        {t.todayDone}/{t.todayTotal}
                      </span>
                    </span>
                  );
                })}
            </div>
          </button>
        )}

        {/*
          What we're baking this week.

          Photo-led, because this is the one rail entry whose whole appeal is
          the picture, and because the empty state has to look like an
          invitation rather than a missing image — "nobody's picked yet" is the
          prompt that gets someone to tap it.
        */}
        {bakeVisible && bake && (
          <button className="rail-section bake-rail" onClick={onOpenRecipes}>
            <div className="uppercase-label rail-label">
              {bake.label}
              <span className="rail-count">{bakeWhen(bake.next.date, bake.dayName, now)}</span>
            </div>
            {bake.next.pick ? (
              <div className="bake-rail-row">
                {bake.next.pick.image && <img className="bake-rail-img" src={bake.next.pick.image} alt="" />}
                <span className="bake-rail-title">{bake.next.pick.title}</span>
              </div>
            ) : (
              <div className="bake-rail-empty">Nothing picked yet — tap to choose</div>
            )}
          </button>
        )}

        {showGrocery && (
          <div className="rail-section">
            <div className="uppercase-label rail-label">
              Grocery List
              {pendingGrocery.length > 0 && <span className="rail-count">{pendingGrocery.length}</span>}
            </div>
            {pendingGrocery.length === 0 ? (
              <div className="grocery-empty">Nothing on the list.</div>
            ) : (
              // One fewer line for each strip above it, so a 1080p rail still
              // ends on a whole row rather than a faded one.
              pendingGrocery.slice(0, 5 - (choreStripVisible ? 1 : 0) - (bakeVisible ? 1 : 0)).map((g) => (
                <button className="grocery-row" key={g.id} onClick={() => onToggleGrocery(g.id)}>
                  <span className="grocery-check" />
                  <span className="grocery-label">{g.label}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {showPhotoFrame && <PhotoFrame photos={photos} />}
    </div>
  );
}
