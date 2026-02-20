export interface PlaywrightMCPClient {
  navigate(url: string): Promise<void>;
  waitForPageLoad(): Promise<void>;
  click(selector: string): Promise<void>;
  type(selector: string, text: string): Promise<void>;
  pressKey(key: string): Promise<void>;
  waitForElement(selector: string, timeoutMs: number): Promise<void>;
  getTextContent(selector: string): Promise<string>;
}
