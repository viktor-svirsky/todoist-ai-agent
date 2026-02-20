import type { PlaywrightMCPClient } from '../types/index.js';
import { logger } from '../utils/logger.js';

export class GeminiService {
  private readonly GEMINI_URL = 'https://gemini.google.com/app';
  private readonly TIMEOUT_MS = 60000;
  private readonly INPUT_SELECTOR = 'textarea[placeholder*="Enter a prompt"], textarea[aria-label*="prompt"]';
  private readonly RESPONSE_SELECTOR = '[data-test-id="model-response"], .model-response-text, [role="article"]:last-child';

  constructor(private playwright: PlaywrightMCPClient) {}

  async consultGemini(prompt: string): Promise<string> {
    logger.debug('Consulting Gemini', { promptLength: prompt.length });

    // Navigate to Gemini
    await this.playwright.navigate(this.GEMINI_URL);
    await this.playwright.waitForPageLoad();

    // Try to start fresh chat (optional, don't fail if button missing)
    try {
      await this.playwright.click('[aria-label="New chat"]');
    } catch {
      logger.debug('New chat button not found, using existing chat');
    }

    // Type prompt
    await this.playwright.waitForElement(this.INPUT_SELECTOR, 5000);
    await this.playwright.type(this.INPUT_SELECTOR, prompt);

    // Submit
    await this.playwright.pressKey('Enter');

    // Wait for and extract response
    await this.playwright.waitForElement(this.RESPONSE_SELECTOR, this.TIMEOUT_MS);
    const responseText = await this.playwright.getTextContent(this.RESPONSE_SELECTOR);

    if (!responseText || responseText.trim().length === 0) {
      throw new Error('Gemini returned empty response');
    }

    logger.debug('Gemini response received', { responseLength: responseText.length });
    return responseText.trim();
  }

  async test(): Promise<boolean> {
    try {
      const response = await this.consultGemini('Respond with just the word OK');
      return response.toLowerCase().includes('ok');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error('Gemini test failed', { error: message });
      return false;
    }
  }
}
