import axios from 'axios';
import { logger } from '../utils/logger.js';

interface SearchResult {
  title: string;
  url: string;
  description: string;
}

export class SearchService {
  constructor(private apiKey: string) {}

  async search(query: string, count = 5): Promise<SearchResult[]> {
    logger.info('Brave search', { query, count });

    const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
      params: { q: query, count },
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': this.apiKey,
      },
    });

    const results: SearchResult[] = (response.data.web?.results || []).map(
      (r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url,
        description: r.description,
      })
    );

    logger.info('Brave search completed', { query, resultCount: results.length });
    return results;
  }
}
