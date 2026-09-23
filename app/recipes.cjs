/**
 * Recipes — food, baking, mocktails and cocktails.
 *
 * Two sister APIs from the same people: TheMealDB for food and TheCocktailDB
 * for drinks. Both are free, need no signup, and return a photo with every
 * recipe, which matters on a wall display where a wall of text is useless from
 * six feet away.
 *
 * Fetched here in Node rather than from the browser, for the same reason the
 * weather and news are: one cache shared by the wall screen and every phone in
 * the house, instead of each of them hammering the same endpoint. Recipes also
 * never change, so they cache hard.
 *
 * On the test key: TheCocktailDB asks for a paid production key if you ship
 * something on an app store. This is one household's kitchen display, which is
 * squarely the "development and educational use" the free key is offered for.
 * If this ever became a product, that changes.
 */
const MEAL = 'https://www.themealdb.com/api/json/v1/1';
const DRINK = 'https://www.thecocktaildb.com/api/json/v1/1';

const TTL = 12 * 60 * 60 * 1000; // recipes don't change; a search result can
const SEARCH_TTL = 60 * 60 * 1000; // go stale a little faster

const cache = new Map();

async function cached(key, ttl, loader) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  try {
    const value = await loader();
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch (err) {
    // Stale beats empty. A kitchen screen that loses its recipe list because
    // the Wi-Fi hiccuped for ten seconds is worse than one showing the same
    // recipes it showed a minute ago.
    if (hit) return hit.value;
    throw err;
  }
}

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'baja-blast-kiosk' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

/* ------------------------------------------------------------------ *
 * Normalising
 * ------------------------------------------------------------------ *
 *
 * Both APIs store ingredients as twenty numbered columns — strIngredient1
 * through strIngredient20, with strMeasure1..20 beside them — which is a
 * spreadsheet pretending to be JSON. Folding that into a list here means the
 * front end never has to know.
 */
function ingredients(raw) {
  const out = [];
  for (let i = 1; i <= 20; i += 1) {
    const name = (raw[`strIngredient${i}`] || '').trim();
    if (!name) continue;
    const measure = (raw[`strMeasure${i}`] || '').trim();
    out.push(measure ? `${measure} ${name}` : name);
  }
  return out;
}

/** Split instructions into steps. The APIs give one blob with newlines. */
function steps(text) {
  if (!text) return [];
  return String(text)
    .split(/\r?\n+/)
    .map((s) => s.replace(/^\s*(STEP\s*)?\d+[.)]?\s*/i, '').trim())
    .filter((s) => s.length > 1);
}

function normalizeMeal(raw) {
  return {
    id: `meal:${raw.idMeal}`,
    kind: 'food',
    title: raw.strMeal,
    image: raw.strMealThumb || null,
    category: raw.strCategory || null,
    area: raw.strArea || null,
    tags: (raw.strTags || '').split(',').map((t) => t.trim()).filter(Boolean),
    ingredients: ingredients(raw),
    steps: steps(raw.strInstructions),
    source: raw.strSource || null,
    video: raw.strYoutube || null,
  };
}

function normalizeDrink(raw) {
  return {
    id: `drink:${raw.idDrink}`,
    kind: raw.strAlcoholic === 'Alcoholic' ? 'cocktail' : 'mocktail',
    title: raw.strDrink,
    image: raw.strDrinkThumb || null,
    category: raw.strCategory || null,
    glass: raw.strGlass || null,
    alcoholic: raw.strAlcoholic || null,
    ingredients: ingredients(raw),
    steps: steps(raw.strInstructions),
    source: null,
    video: null,
  };
}

/** A card in a grid: just enough to show a photo and a name. */
function summarize(item) {
  return { id: item.id, kind: item.kind, title: item.title, image: item.image, category: item.category };
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

/**
 * "Baking" isn't a category either API has, so it's assembled: desserts plus
 * the things people actually mean by baking. Without this, asking for baking
 * returns trifles and mousses and no bread.
 */
const BAKING_SEARCHES = ['cake', 'bread', 'cookie', 'pie', 'brownie', 'muffin', 'scone', 'tart'];

async function foodCategories() {
  return cached('meal:categories', TTL, async () => {
    const data = await getJSON(`${MEAL}/categories.php`);
    return (data.categories || []).map((c) => ({
      id: c.strCategory,
      title: c.strCategory,
      image: c.strCategoryThumb || null,
      description: (c.strCategoryDescription || '').split('.')[0],
    }));
  });
}

async function foodByCategory(category) {
  return cached(`meal:cat:${category}`, TTL, async () => {
    const data = await getJSON(`${MEAL}/filter.php?c=${encodeURIComponent(category)}`);
    return (data.meals || []).map((m) => ({
      id: `meal:${m.idMeal}`,
      kind: 'food',
      title: m.strMeal,
      image: m.strMealThumb || null,
      category,
    }));
  });
}

async function baking() {
  return cached('meal:baking', TTL, async () => {
    const seen = new Map();

    const desserts = await getJSON(`${MEAL}/filter.php?c=Dessert`).catch(() => ({ meals: [] }));
    for (const m of desserts.meals || []) {
      seen.set(m.idMeal, { id: `meal:${m.idMeal}`, kind: 'food', title: m.strMeal, image: m.strMealThumb, category: 'Baking' });
    }

    // Sequential, not parallel: eight simultaneous requests to a free API that
    // asks nothing of us is impolite, and this runs twice a day at most.
    for (const term of BAKING_SEARCHES) {
      try {
        const found = await getJSON(`${MEAL}/search.php?s=${encodeURIComponent(term)}`);
        for (const m of found.meals || []) {
          if (!seen.has(m.idMeal)) {
            seen.set(m.idMeal, { id: `meal:${m.idMeal}`, kind: 'food', title: m.strMeal, image: m.strMealThumb, category: 'Baking' });
          }
        }
      } catch {
        // One search failing shouldn't empty the whole section.
      }
    }

    return [...seen.values()];
  });
}

async function drinks(alcoholic) {
  const filter = alcoholic ? 'Alcoholic' : 'Non_Alcoholic';
  return cached(`drink:${filter}`, TTL, async () => {
    const data = await getJSON(`${DRINK}/filter.php?a=${filter}`);
    return (data.drinks || []).map((d) => ({
      id: `drink:${d.idDrink}`,
      kind: alcoholic ? 'cocktail' : 'mocktail',
      title: d.strDrink,
      image: d.strDrinkThumb || null,
      category: alcoholic ? 'Cocktails' : 'Mocktails',
    }));
  });
}

/** Everything a section needs, by name. */
async function section(name) {
  switch (name) {
    case 'baking':
      return baking();
    case 'mocktails':
      return drinks(false);
    case 'cocktails':
      return drinks(true);
    default:
      // A food category name — "Dessert", "Chicken", "Vegetarian"…
      return foodByCategory(name);
  }
}

/** Search both APIs at once and merge. */
async function search(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];

  return cached(`search:${q.toLowerCase()}`, SEARCH_TTL, async () => {
    const [meals, cocktails] = await Promise.all([
      getJSON(`${MEAL}/search.php?s=${encodeURIComponent(q)}`).catch(() => ({ meals: [] })),
      getJSON(`${DRINK}/search.php?s=${encodeURIComponent(q)}`).catch(() => ({ drinks: [] })),
    ]);

    return [
      ...(meals.meals || []).map((m) => summarize(normalizeMeal(m))),
      ...(cocktails.drinks || []).map((d) => summarize(normalizeDrink(d))),
    ];
  });
}

/** One full recipe. The id carries which API it came from. */
async function lookup(id) {
  const [kind, rawId] = String(id).split(':');
  if (!rawId || !/^\d+$/.test(rawId)) throw new Error('bad recipe id');

  return cached(`recipe:${id}`, TTL, async () => {
    if (kind === 'meal') {
      const data = await getJSON(`${MEAL}/lookup.php?i=${rawId}`);
      if (!data.meals || !data.meals[0]) throw new Error('not found');
      return normalizeMeal(data.meals[0]);
    }
    if (kind === 'drink') {
      const data = await getJSON(`${DRINK}/lookup.php?i=${rawId}`);
      if (!data.drinks || !data.drinks[0]) throw new Error('not found');
      return normalizeDrink(data.drinks[0]);
    }
    throw new Error('unknown recipe source');
  });
}

/** Something to look at when nobody has searched for anything. */
async function surprise() {
  const data = await getJSON(`${MEAL}/random.php`);
  return data.meals && data.meals[0] ? normalizeMeal(data.meals[0]) : null;
}

module.exports = { foodCategories, section, search, lookup, surprise, _normalize: { normalizeMeal, normalizeDrink, ingredients, steps } };
