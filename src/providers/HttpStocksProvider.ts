import { StocksProvider } from './StocksProvider';
import { StockQuote } from '../data/models';

const API_BASE = '';

/**
 * Real quotes for the household's ticker list (Settings → Feeds), fetched
 * by the local server from Yahoo Finance with Stooq as a fallback. Prices
 * refresh every five minutes; the change % is against the previous close.
 */
export class HttpStocksProvider implements StocksProvider {
  async getQuotes(): Promise<StockQuote[]> {
    const res = await fetch(`${API_BASE}/api/stocks`, { cache: 'no-store' });
    if (!res.ok) throw new Error('stocks request failed');
    const data = await res.json();
    return data.items ?? [];
  }
}
