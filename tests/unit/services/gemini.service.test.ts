import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeminiService } from '../../../src/services/gemini.service';
import type { PlaywrightMCPClient } from '../../../src/types/index';

describe('GeminiService', () => {
  let mockPlaywright: PlaywrightMCPClient;
  let geminiService: GeminiService;

  beforeEach(() => {
    mockPlaywright = {
      navigate: vi.fn().mockResolvedValue(undefined),
      waitForPageLoad: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
      type: vi.fn().mockResolvedValue(undefined),
      pressKey: vi.fn().mockResolvedValue(undefined),
      waitForElement: vi.fn().mockResolvedValue(undefined),
      getTextContent: vi.fn().mockResolvedValue('This is Gemini\'s response')
    };
    geminiService = new GeminiService(mockPlaywright);
  });

  describe('consultGemini', () => {
    it('should navigate to Gemini and return response', async () => {
      const prompt = 'What is 2+2?';
      const response = await geminiService.consultGemini(prompt);

      expect(mockPlaywright.navigate).toHaveBeenCalledWith('https://gemini.google.com/app');
      expect(mockPlaywright.waitForPageLoad).toHaveBeenCalled();
      expect(mockPlaywright.type).toHaveBeenCalledWith(
        expect.stringContaining('textarea'),
        prompt
      );
      expect(mockPlaywright.pressKey).toHaveBeenCalledWith('Enter');
      expect(response).toBe('This is Gemini\'s response');
    });

    it('should throw error when Gemini returns empty response', async () => {
      mockPlaywright.getTextContent = vi.fn().mockResolvedValue('');

      await expect(geminiService.consultGemini('test')).rejects.toThrow(
        'Gemini returned empty response'
      );
    });

    it('should propagate timeout errors', async () => {
      mockPlaywright.waitForElement = vi.fn().mockRejectedValue(
        new Error('Timeout waiting for element')
      );

      await expect(geminiService.consultGemini('test')).rejects.toThrow('Timeout');
    });
  });

  describe('test', () => {
    it('should return true when Gemini responds with OK', async () => {
      mockPlaywright.getTextContent = vi.fn().mockResolvedValue('OK');

      const result = await geminiService.test();

      expect(result).toBe(true);
      expect(mockPlaywright.type).toHaveBeenCalledWith(
        expect.any(String),
        'Respond with just the word OK'
      );
    });

    it('should return false when test fails', async () => {
      mockPlaywright.navigate = vi.fn().mockRejectedValue(new Error('Network error'));

      const result = await geminiService.test();

      expect(result).toBe(false);
    });
  });
});
