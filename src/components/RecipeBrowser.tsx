import { useCallback, useEffect, useRef, useState } from 'react';
import { BakePick, Recipe, RecipeCard, RecipeCategory, RecipeSection, RecipeSettings } from '../data/models';
import { BakeState, bakeWhen, bakeWhenPhrase } from '../engine/bake';
import { fetchRecipe, fetchSection, fetchSections, searchRecipes } from '../providers/recipesApi';
import { googleRecipeSearch } from '../engine/websearch';
import { TouchKeyboard } from './TouchKeyboard';

interface Props {
  settings: RecipeSettings;
  bake: BakeState | null;
  onPickBake: (recipe: Partial<BakePick> & { title: string }, date?: string) => Promise<boolean>;
  onAddGrocery: (label: string) => void;
  /** Opens the in-app browser, at a URL if one is given. */
  onOpenBrowser: (url?: string) => void;
  onClose: () => void;
  now: Date;
}

/**
 * The recipe screen: what's for dinner, what we're baking, what to drink.
 *
 * Built photo-first. A kitchen display is read from across the room, usually
 * by someone with their hands full, and a list of recipe titles at 14px is
 * useless at that distance — a grid of pictures is legible from the doorway.
 *
 * Three sections come from the household (Baking, Mocktails, Cocktails) and
 * the rest are the food categories the API publishes, so "Chicken" and
 * "Vegetarian" show up without this file knowing they exist.
 */
export function RecipeBrowser({ settings, bake, onPickBake, onAddGrocery, onOpenBrowser, onClose, now }: Props) {
  const [sections, setSections] = useState<RecipeSection[]>([]);
  const [categories, setCategories] = useState<RecipeCategory[]>([]);
  const [active, setActive] = useState('baking');
  const [cards, setCards] = useState<RecipeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [keyboard, setKeyboard] = useState(false);
  const [searching, setSearching] = useState(false);
  const searchInput = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState<Recipe | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [weekPicker, setWeekPicker] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchSections()
      .then((data) => {
        if (cancelled) return;
        setSections(data.sections);
        setCategories(data.categories);
        // Not fatal — the three built-in sections still work without the
        // food-category list, so this is a note rather than an error screen.
        if (data.error) setError(data.error);
      })
      .catch((err) => !cancelled && setError(String(err.message || err)));
    return () => {
      cancelled = true;
    };
  }, []);

  /*
    The cursor starts in the search box.

    On a machine with a keyboard — which is most of them, and all of the ones
    this is developed on — opening Recipes and typing should just work. No
    click into the field first, no on-screen keyboard in the way.
  */
  useEffect(() => {
    searchInput.current?.focus();
  }, []);

  /*
    Escape closes an open recipe — and only that.

    Closing the Recipes screen itself, the browser, and the rest is App's job,
    in one place, so the precedence is written down once. This listener is on
    the capture phase so it gets first refusal, and it stops the event dead
    when it acts; otherwise both would fire and Escape would close two things
    at once, which is exactly the bug this replaced.
  */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && open) {
        e.stopImmediatePropagation();
        setOpen(null);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const loadSection = useCallback((key: string) => {
    setActive(key);
    setSearching(false);
    setLoading(true);
    setError(null);
    fetchSection(key)
      .then((list) => {
        setCards(list);
        setLoading(false);
      })
      .catch((err) => {
        setError(String(err.message || err));
        setCards([]);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadSection('baking');
  }, [loadSection]);

  function runSearch() {
    const q = query.trim();
    if (q.length < 2) return;
    setKeyboard(false);
    setSearching(true);
    setLoading(true);
    setError(null);
    searchRecipes(q)
      .then((list) => {
        setCards(list);
        setLoading(false);
        if (list.length === 0) setError(`Nothing found for “${q}”.`);
      })
      .catch((err) => {
        setError(String(err.message || err));
        setLoading(false);
      });
  }

  function openRecipe(card: RecipeCard) {
    setOpenError(null);
    setWeekPicker(false);
    // Show the card's photo and title immediately and fill the rest in when it
    // lands. A tap that does nothing for a second reads as a broken button,
    // and people press it again.
    setOpen({ ...card, ingredients: [], steps: [] });
    fetchRecipe(card.id)
      .then(setOpen)
      .catch((err) => setOpenError(String(err.message || err)));
  }

  /**
   * Open a pick that's already been made.
   *
   * No fetch: the ingredients and steps were copied into the pick when it was
   * chosen, so the bake still works on a Saturday morning when the recipe site
   * is down or the household is off the internet. A pick that came from the
   * web has a URL instead, and the detail panel offers to open it.
   */
  function openPick(pick: BakePick) {
    setOpenError(null);
    setWeekPicker(false);
    setOpen({
      id: pick.id,
      kind: pick.kind,
      title: pick.title,
      image: pick.image,
      category: null,
      ingredients: pick.ingredients,
      steps: pick.steps,
      source: pick.url,
    });
  }

  async function chooseForBake(date?: string) {
    if (!open) return;
    // Mapped by hand rather than spread: the store keeps `url`, the API calls
    // it `source`, and the pick carries its own copy of the ingredients so
    // bake day doesn't depend on the recipe site still being up.
    const ok = await onPickBake(
      {
        id: open.id,
        title: open.title,
        image: open.image,
        kind: open.kind,
        url: open.source || undefined,
        ingredients: open.ingredients,
        steps: open.steps,
      },
      date
    );
    setWeekPicker(false);
    const when = date ?? bake?.next?.date;
    setToast(
      ok
        ? `${open.title} — ${when ? bakeWhen(when, bake?.dayName ?? '', now) : 'this week'}`
        : 'Could not save that pick.'
    );
    setTimeout(() => setToast(null), 3500);
  }

  function addAllToGrocery() {
    if (!open) return;
    open.ingredients.forEach((line) => onAddGrocery(line));
    setToast(`${open.ingredients.length} ingredients added to the grocery list`);
    setTimeout(() => setToast(null), 3500);
  }

  const tabs: RecipeSection[] = [
    ...sections,
    ...categories.map((c) => ({ key: c.id, title: c.title, subtitle: c.description })),
  ];

  return (
    <div className="recipe-overlay">
      <div className="recipe-shell">
        <div className="recipe-head">
          <div>
            <div className="uppercase-label" style={{ color: 'var(--text-muted)' }}>
              Kitchen
            </div>
            <h2 className="recipe-title">Recipes</h2>
          </div>
          <div className="recipe-head-actions">
            {settings.browserEnabled && (
              <button className="btn-secondary" onClick={() => onOpenBrowser()}>
                Browse the web
              </button>
            )}
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {/* The bake slot, right at the top: this screen's main job is to fill it. */}
        {bake?.enabled && bake.next && (
          <button
            className={`recipe-bake-strip ${bake.next.pick ? 'filled' : 'empty'}`}
            onClick={() => bake.next.pick && openPick(bake.next.pick)}
          >
            <span className="uppercase-label">
              {bake.label} · {bakeWhen(bake.next.date, bake.dayName, now)}
            </span>
            <span className="recipe-bake-title">
              {bake.next.pick ? bake.next.pick.title : 'Nothing picked yet — choose something below'}
            </span>
          </button>
        )}

        <div className="recipe-searchbar">
          {/* A real input. Type, press Enter. */}
          <input
            ref={searchInput}
            className="recipe-search-field"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') runSearch();
            }}
            placeholder="Search recipes, or the whole web…"
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn-primary" onClick={runSearch} disabled={query.trim().length < 2}>
            Search
          </button>
          {/*
            The other half of "search everything".

            The built-in list is a few hundred recipes with photos and tidy
            ingredients; Google is every recipe there has ever been. This hands
            the same words to Google and opens the result in the in-app
            browser, where "Bake this on Saturday" still works — so a recipe
            from a stranger's blog ends up on the calendar exactly like one
            from the list.
          */}
          {settings.browserEnabled && (
            <button
              className="btn-secondary"
              onClick={() => onOpenBrowser(googleRecipeSearch(query))}
              disabled={query.trim().length < 2}
            >
              Search Google
            </button>
          )}
          {/* Only on a wall panel that has no keyboard — see Settings. */}
          {settings.onScreenKeyboard && (
            <button className="btn-secondary" onClick={() => setKeyboard((v) => !v)} aria-label="On-screen keyboard">
              ⌨
            </button>
          )}
        </div>

        {keyboard && settings.onScreenKeyboard && (
          <TouchKeyboard
            value={query}
            onChange={setQuery}
            onSubmit={runSearch}
            onClose={() => setKeyboard(false)}
            submitLabel="Search"
          />
        )}

        <div className="recipe-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              className={`recipe-tab ${!searching && active === tab.key ? 'active' : ''}`}
              onClick={() => loadSection(tab.key)}
            >
              {tab.title}
            </button>
          ))}
        </div>

        {loading && <div className="recipe-note">Loading…</div>}
        {!loading && error && <div className="recipe-note">{error}</div>}

        <div className="recipe-grid">
          {cards.map((card) => (
            <button className="recipe-card" key={card.id} onClick={() => openRecipe(card)}>
              {card.image ? (
                <img className="recipe-card-img" src={card.image} alt="" loading="lazy" />
              ) : (
                <div className="recipe-card-img recipe-card-blank" />
              )}
              <span className="recipe-card-title">{card.title}</span>
            </button>
          ))}
        </div>
      </div>

      {open && (
        <div className="recipe-detail" onClick={() => setOpen(null)}>
          <div className="recipe-detail-panel" onClick={(e) => e.stopPropagation()}>
            <div className="recipe-detail-head">
              {open.image && <img className="recipe-detail-img" src={open.image} alt="" />}
              <div className="recipe-detail-meta">
                <h3 className="recipe-detail-title">{open.title}</h3>
                <div className="recipe-detail-sub">
                  {[open.category, open.area, open.glass, open.alcoholic].filter(Boolean).join(' · ')}
                </div>

                <div className="recipe-detail-actions">
                  <button className="btn-accent" onClick={() => chooseForBake()}>
                    Make this {bake?.next ? bakeWhenPhrase(bake.next.date, bake.dayName, now) : 'this week'}
                  </button>
                  <button className="btn-secondary" onClick={() => setWeekPicker((v) => !v)}>
                    Another week
                  </button>
                  {open.ingredients.length > 0 && (
                    <button className="btn-secondary" onClick={addAllToGrocery}>
                      Add to grocery list
                    </button>
                  )}
                  {open.source && settings.browserEnabled && (
                    <button className="btn-secondary" onClick={() => onOpenBrowser(open.source as string)}>
                      Open the page
                    </button>
                  )}
                  <button className="btn-secondary" onClick={() => setOpen(null)}>
                    Back
                  </button>
                </div>

                {weekPicker && bake && (
                  <div className="recipe-weeks">
                    {bake.upcoming.map((week) => (
                      <button key={week.date} className="recipe-week" onClick={() => chooseForBake(week.date)}>
                        <span>{bakeWhen(week.date, week.dayName, now)}</span>
                        <span className="recipe-week-pick">{week.pick ? week.pick.title : 'free'}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {openError && <div className="recipe-note">{openError}</div>}

            <div className="recipe-detail-body">
              <div className="recipe-ingredients">
                <div className="uppercase-label">Ingredients</div>
                {open.ingredients.length === 0 && !openError && <div className="recipe-note">Loading…</div>}
                <ul>
                  {open.ingredients.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>

              <div className="recipe-steps">
                <div className="uppercase-label">Method</div>
                <ol>
                  {open.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="recipe-toast">{toast}</div>}
    </div>
  );
}
