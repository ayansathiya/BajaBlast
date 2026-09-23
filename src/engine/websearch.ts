/**
 * Turning what someone typed into somewhere to go.
 *
 * Two callers, one set of rules: the recipe screen's "search the web" button
 * and the in-app browser's address bar. Kept here rather than in either
 * component because "is that a web address or a search?" is a judgement call
 * with edge cases, and two copies of a judgement call drift.
 */

/** Everything Google needs, and nothing that identifies the household. */
export function googleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
}

/**
 * The same search, nudged towards food.
 *
 * "chocolate cake" on its own returns Wikipedia and a picture gallery; with
 * the word recipe it returns recipes, which is the only reason this screen
 * opens a search at all. Skipped when the word is already in there, because
 * "banana bread recipe recipe" measurably changes the results for the worse.
 */
export function googleRecipeSearch(query: string): string {
  const q = query.trim();
  return googleSearchUrl(/\brecipes?\b/i.test(q) ? q : `${q} recipe`);
}

/**
 * An address bar accepts both. The rule: anything with a scheme is a URL,
 * anything shaped like a domain is a URL, everything else is a search.
 *
 * `localhost:8787` and bare IPs count as addresses too — this runs on a
 * machine where the household's own kiosk is exactly that.
 */
export function normalizeUrl(input: string): string {
  const text = input.trim();
  if (!text) return '';

  // A scheme we're willing to load. Not javascript:, not data:, not file: —
  // an address bar inside a kiosk shouldn't be a way to run something or read
  // the disk, and nobody types those by accident.
  if (/^https?:\/\//i.test(text)) return text;

  // Hosts are tested before schemes, because `localhost:8787` looks exactly
  // like a scheme called "localhost" and would otherwise go to Google — which
  // is a silly way to lose the address of your own kiosk.
  //
  // A domain is letters and dots, no spaces, and a last segment that looks
  // like a TLD rather than a sentence: "what.a.mess" is a search, "bbc.co.uk"
  // is a site. The two-or-more-letters test is what separates them.
  if (/^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#].*)?$/i.test(text)) return `https://${text}`;
  if (/^localhost(:\d+)?([/?#].*)?$/i.test(text)) return `http://${text}`;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?([/?#].*)?$/.test(text)) return `http://${text}`;

  return googleSearchUrl(text);
}
