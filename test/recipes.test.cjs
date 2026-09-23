/**
 * Recipe normalising, caching and failure behaviour.
 *
 * Fixtures, not live calls — this build machine's egress policy blocks
 * themealdb.com and thecocktaildb.com, so the one thing these tests cannot
 * prove is that the real endpoints answer. Everything downstream of the
 * response is exercised for real, against payloads shaped exactly like the
 * documented ones: the twenty-numbered-column ingredient format, the
 * single-blob instructions, and the two different id namespaces.
 */
const path = require('node:path');

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; console.log(`  ok   ${name}`); }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
}

// --- fixtures, in the APIs' real shape -------------------------------------
const MEAL_FIXTURE = {
  idMeal: '52855',
  strMeal: 'Banana Pancakes',
  strCategory: 'Dessert',
  strArea: 'American',
  strInstructions: 'In a bowl, mash the banana.\r\nAdd the eggs and whisk.\r\n3. Fry in a hot pan until golden.\r\n\r\n',
  strMealThumb: 'https://www.themealdb.com/images/media/meals/sywswr.jpg',
  strTags: 'Breakfast,Sweet',
  strYoutube: 'https://www.youtube.com/watch?v=abc',
  strSource: 'https://example.com/pancakes',
  strIngredient1: 'Banana', strMeasure1: '1 large',
  strIngredient2: 'Eggs', strMeasure2: '2',
  strIngredient3: 'Butter', strMeasure3: '',        // no measure — common
  strIngredient4: '  ', strMeasure4: 'ignored',     // blank name — must skip
  strIngredient5: '', strMeasure5: '',
};
for (let i = 6; i <= 20; i += 1) { MEAL_FIXTURE[`strIngredient${i}`] = ''; MEAL_FIXTURE[`strMeasure${i}`] = ''; }

const DRINK_FIXTURE = {
  idDrink: '11602',
  strDrink: 'Virgin Mojito',
  strCategory: 'Other/Unknown',
  strAlcoholic: 'Non alcoholic',
  strGlass: 'Highball glass',
  strInstructions: 'Muddle the mint.\nAdd lime and sugar.\nTop with soda.',
  strDrinkThumb: 'https://www.thecocktaildb.com/images/media/drink/x.jpg',
  strIngredient1: 'Mint', strMeasure1: '6 leaves',
  strIngredient2: 'Lime', strMeasure2: '1/2',
};
for (let i = 3; i <= 20; i += 1) { DRINK_FIXTURE[`strIngredient${i}`] = null; DRINK_FIXTURE[`strMeasure${i}`] = null; }

const ALCOHOLIC_FIXTURE = { ...DRINK_FIXTURE, idDrink: '11007', strDrink: 'Margarita', strAlcoholic: 'Alcoholic' };

// --- stub the network before requiring the module --------------------------
const routes = new Map();
let calls = 0;
let failNext = false;

globalThis.fetch = async (url) => {
  calls += 1;
  if (failNext) { failNext = false; throw new Error('network down'); }
  for (const [pattern, body] of routes) {
    if (String(url).includes(pattern)) {
      return { ok: true, status: 200, json: async () => body };
    }
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

routes.set('themealdb.com/api/json/v1/1/categories.php', {
  categories: [{ strCategory: 'Dessert', strCategoryThumb: 'x.png', strCategoryDescription: 'Sweet things. More text here.' }],
});
routes.set('themealdb.com/api/json/v1/1/filter.php?c=Dessert', { meals: [{ idMeal: '52855', strMeal: 'Banana Pancakes', strMealThumb: 'x.jpg' }] });
routes.set('themealdb.com/api/json/v1/1/lookup.php?i=52855', { meals: [MEAL_FIXTURE] });
routes.set('themealdb.com/api/json/v1/1/search.php', { meals: [MEAL_FIXTURE] });
routes.set('thecocktaildb.com/api/json/v1/1/filter.php?a=Non_Alcoholic', { drinks: [{ idDrink: '11602', strDrink: 'Virgin Mojito', strDrinkThumb: 'x.jpg' }] });
routes.set('thecocktaildb.com/api/json/v1/1/filter.php?a=Alcoholic', { drinks: [{ idDrink: '11007', strDrink: 'Margarita', strDrinkThumb: 'x.jpg' }] });
routes.set('thecocktaildb.com/api/json/v1/1/lookup.php?i=11602', { drinks: [DRINK_FIXTURE] });
routes.set('thecocktaildb.com/api/json/v1/1/lookup.php?i=11007', { drinks: [ALCOHOLIC_FIXTURE] });
routes.set('thecocktaildb.com/api/json/v1/1/search.php', { drinks: [ALCOHOLIC_FIXTURE] });

const r = require(path.join(__dirname, '..', 'app', 'recipes.cjs'));

(async () => {
  console.log('\nThe twenty-column ingredient format is folded into a list');
  {
    const meal = r._normalize.normalizeMeal(MEAL_FIXTURE);
    check('measure and name joined', meal.ingredients[0] === '1 large Banana', meal.ingredients[0]);
    check('an ingredient with no measure still appears', meal.ingredients.includes('Butter'), meal.ingredients.join(' | '));
    check('blank and whitespace-only slots are skipped', meal.ingredients.length === 3, `${meal.ingredients.length}: ${meal.ingredients.join(' | ')}`);
    check('nulls in the unused slots do not throw', r._normalize.normalizeDrink(DRINK_FIXTURE).ingredients.length === 2);
  }

  console.log('\nInstructions become numbered steps');
  {
    const meal = r._normalize.normalizeMeal(MEAL_FIXTURE);
    check('split on newlines', meal.steps.length === 3, `${meal.steps.length}: ${JSON.stringify(meal.steps)}`);
    check('a leading "3." is stripped', meal.steps[2] === 'Fry in a hot pan until golden.', meal.steps[2]);
    check('trailing blank lines dropped', !meal.steps.some((s) => s === ''));
    check('empty instructions give no steps', r._normalize.steps('').length === 0);
    check('missing instructions do not throw', r._normalize.steps(undefined).length === 0);
  }

  console.log('\nDrinks are sorted into mocktails and cocktails');
  {
    check('non-alcoholic reads as a mocktail', r._normalize.normalizeDrink(DRINK_FIXTURE).kind === 'mocktail');
    check('alcoholic reads as a cocktail', r._normalize.normalizeDrink(ALCOHOLIC_FIXTURE).kind === 'cocktail');
    const mock = await r.section('mocktails');
    const cock = await r.section('cocktails');
    check('the mocktail section is non-alcoholic', mock.every((d) => d.kind === 'mocktail'), JSON.stringify(mock[0]));
    check('the cocktail section is alcoholic', cock.every((d) => d.kind === 'cocktail'));
  }

  console.log('\nIds say which API a recipe came from');
  {
    const meal = await r.lookup('meal:52855');
    const drink = await r.lookup('drink:11602');
    check('a meal id resolves to food', meal.kind === 'food' && meal.title === 'Banana Pancakes', meal.title);
    check('a drink id resolves to a drink', drink.title === 'Virgin Mojito', drink.title);
    let threw = false;
    try { await r.lookup('meal:../../etc/passwd'); } catch { threw = true; }
    check('a non-numeric id is refused', threw);
    let threw2 = false;
    try { await r.lookup('wiki:12345'); } catch { threw2 = true; }
    check('an unknown source is refused', threw2);
  }

  console.log('\nCaching');
  {
    calls = 0;
    await r.section('mocktails');
    await r.section('mocktails');
    await r.section('mocktails');
    check('three requests, one fetch', calls === 0, `${calls} fetches (already warm)`);

    const before = calls;
    await r.search('margarita');
    await r.search('margarita');
    check('a repeated search is not refetched', calls - before === 2, `${calls - before} fetches for two searches`);
  }

  console.log('\nWhen the network fails');
  {
    // Warm, then break the network — the cached answer must survive.
    await r.section('cocktails');
    failNext = true;
    const stale = await r.section('cocktails').catch(() => null);
    check('a warm section survives an outage', Array.isArray(stale) && stale.length > 0, JSON.stringify(stale));

    check('a too-short search returns nothing rather than querying', (await r.search('a')).length === 0);
    check('an empty search is safe', (await r.search('')).length === 0);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
