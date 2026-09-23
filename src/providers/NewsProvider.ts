import { NewsHeadline } from '../data/models';

export interface NewsProvider {
  getHeadlines(): Promise<NewsHeadline[]>;
}

/**
 * Mock world/business/tech headlines so the rail looks alive offline.
 * A real provider would wrap a news API — same interface, swap it in
 * wherever MockNewsProvider is instantiated.
 */
export class MockNewsProvider implements NewsProvider {
  async getHeadlines(): Promise<NewsHeadline[]> {
    const now = new Date().toISOString();
    return [
      { id: 'n1', source: 'Reuters', headline: 'Global markets steady ahead of rate decision', category: 'business', publishedAt: now },
      { id: 'n2', source: 'AP', headline: 'Major climate accord signed by 40 nations', category: 'world', publishedAt: now },
      { id: 'n3', source: 'The Verge', headline: 'New chip architecture promises major efficiency gains', category: 'tech', publishedAt: now },
      { id: 'n4', source: 'BBC', headline: 'Regional transit expansion breaks ground downtown', category: 'local', publishedAt: now },
      { id: 'n5', source: 'Bloomberg', headline: 'Consumer spending holds steady into the new quarter', category: 'business', publishedAt: now },
    ];
  }
}
