import { StockQuote } from '../data/models';

export interface StocksProvider {
  getQuotes(): Promise<StockQuote[]>;
}

/**
 * Mock trending quotes. Swap in a real market-data API behind this same
 * interface — nothing else in the app needs to change.
 */
export class MockStocksProvider implements StocksProvider {
  private base: StockQuote[] = [
    { symbol: 'AAPL', name: 'Apple', price: 231.42, changePct: 0.8 },
    { symbol: 'NVDA', name: 'NVIDIA', price: 178.05, changePct: 2.3 },
    { symbol: 'MSFT', name: 'Microsoft', price: 428.6, changePct: -0.4 },
    { symbol: 'TSLA', name: 'Tesla', price: 251.9, changePct: -1.6 },
    { symbol: 'AMZN', name: 'Amazon', price: 198.3, changePct: 0.5 },
  ];

  async getQuotes(): Promise<StockQuote[]> {
    // Tiny jitter so the demo doesn't look frozen on repeated polls.
    return this.base.map((q) => ({
      ...q,
      changePct: q.changePct + (Math.random() - 0.5) * 0.2,
    }));
  }
}
