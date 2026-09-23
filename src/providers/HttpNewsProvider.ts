import { NewsProvider } from './NewsProvider';
import { NewsHeadline } from '../data/models';

const API_BASE = '';

/**
 * Real headlines, pulled from public RSS feeds by the local server
 * (BBC World, NPR, CNBC Markets, Ars Technica — all free, no account).
 * Interleaved upstream so the rail never shows one outlet in a row.
 */
export class HttpNewsProvider implements NewsProvider {
  async getHeadlines(): Promise<NewsHeadline[]> {
    const res = await fetch(`${API_BASE}/api/news`, { cache: 'no-store' });
    if (!res.ok) throw new Error('news request failed');
    const data = await res.json();
    return data.items ?? [];
  }
}
