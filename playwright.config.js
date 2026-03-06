import { defineConfig } from '@playwright/test';

// All projects use Chromium — we installed only that browser.
// Responsive testing is about layout/viewport, not browser engine differences.
const CHROMIUM = { browserName: /** @type {'chromium'} */ ('chromium') };

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    ...CHROMIUM,
  },

  projects: [
    // Portrait phone (iPhone SE)
    {
      name: 'portrait-phone',
      use: {
        ...CHROMIUM,
        viewport: { width: 375, height: 667 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
    // Landscape phone small (iPhone SE rotated — the critical overflow viewport)
    {
      name: 'landscape-phone-sm',
      use: {
        ...CHROMIUM,
        viewport: { width: 667, height: 375 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
    // Landscape phone large (iPhone 14 rotated)
    {
      name: 'landscape-phone-lg',
      use: {
        ...CHROMIUM,
        viewport: { width: 844, height: 390 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      },
    },
    // Portrait tablet
    {
      name: 'portrait-tablet',
      use: {
        ...CHROMIUM,
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    // Landscape tablet
    {
      name: 'landscape-tablet',
      use: {
        ...CHROMIUM,
        viewport: { width: 1024, height: 768 },
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false,
      },
    },
    // Desktop
    {
      name: 'desktop',
      use: {
        ...CHROMIUM,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
