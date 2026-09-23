import { Recipe, RecipeCard, RecipeCategory, RecipeSection } from '../data/models';

/**
 * The recipe browser's half of the wire.
 *
 * Plain functions rather than a hook: the browser screen is a small state
 * machine (a section, a search, an open recipe) and it owns that state itself.
 * Wrapping each call in a hook would have meant three hooks that all needed
 * cancelling in the right order, for no gain.
 *
 * Every response is already cached server-side, so re-opening a section
 * costs a local round trip and nothing more.
 */

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) detail = String(body.error);
    } catch {
      // Not JSON. The status is all we have.
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export interface SectionList {
  sections: RecipeSection[];
  categories: RecipeCategory[];
  error?: string;
}

export function fetchSections(): Promise<SectionList> {
  return get<SectionList>('/api/recipes/sections');
}

export function fetchSection(key: string): Promise<RecipeCard[]> {
  return get<RecipeCard[]>(`/api/recipes/section/${encodeURIComponent(key)}`);
}

export function searchRecipes(query: string): Promise<RecipeCard[]> {
  return get<RecipeCard[]>(`/api/recipes/search?q=${encodeURIComponent(query)}`);
}

export function fetchRecipe(id: string): Promise<Recipe> {
  return get<Recipe>(`/api/recipes/${encodeURIComponent(id)}`);
}
