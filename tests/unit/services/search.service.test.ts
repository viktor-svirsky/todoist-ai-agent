import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchService } from '../../../src/services/search.service';
import axios from 'axios';

vi.mock('axios');

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(() => {
    service = new SearchService('test-brave-key');
    vi.clearAllMocks();
  });

  it('should call Brave Search API with correct params', async () => {
    vi.mocked(axios.get).mockResolvedValue({
      data: {
        web: {
          results: [
            { title: 'Result 1', url: 'https://example.com', description: 'Description 1' },
          ],
        },
      },
    });

    const results = await service.search('test query', 3);

    expect(axios.get).toHaveBeenCalledWith(
      'https://api.search.brave.com/res/v1/web/search',
      expect.objectContaining({
        params: { q: 'test query', count: 3 },
        headers: expect.objectContaining({
          'X-Subscription-Token': 'test-brave-key',
        }),
      })
    );
    expect(results).toEqual([
      { title: 'Result 1', url: 'https://example.com', description: 'Description 1' },
    ]);
  });

  it('should return empty array when no results', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { web: { results: [] } } });

    const results = await service.search('nothing');

    expect(results).toEqual([]);
  });

  it('should handle missing web field', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: {} });

    const results = await service.search('broken');

    expect(results).toEqual([]);
  });
});
