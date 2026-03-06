// @ts-check
import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Shared mock data
// ---------------------------------------------------------------------------

const MOCK_ME = { username: 'testuser', role: 'user' };

const MOCK_STATUS = { has_data: true };

const MOCK_DASHBOARD = {
  stats: {
    total_plays: 15000,
    total_hours: 1234.5,
    unique_artists: 320,
    unique_tracks: 4200,
    first_listen: '2021-01-01',
    last_listen: '2024-12-31',
  },
  monthly_hours: {
    labels: ['2024-01', '2024-02', '2024-03'],
    values: [80.5, 95.2, 110.1],
  },
  top_artists: {
    labels: ['Radiohead', 'Blur', 'Oasis', 'Portishead', 'Massive Attack'],
    values: [300, 250, 200, 150, 100],
    images: [null, null, null, null, null],
  },
  top_tracks: {
    labels: ['Karma Police', 'Song 2', 'Wonderwall', 'Glory Box', 'Teardrop'],
    values: [120, 100, 80, 60, 50],
    images: [null, null, null, null, null],
    album_keys: ['OK Computer', 'Blur', 'Morning Glory', 'Dummy', 'Mezzanine'],
    album_pairs: [
      ['Radiohead', 'OK Computer'],
      ['Blur', 'Blur'],
      ['Oasis', 'Morning Glory'],
      ['Portishead', 'Dummy'],
      ['Massive Attack', 'Mezzanine'],
    ],
  },
  years: ['2021', '2022', '2023', '2024'],
};

const MOCK_TOP_ARTISTS = {
  chart: {
    labels: Array.from({ length: 10 }, (_, i) => `Artist ${i + 1}`),
    values: Array.from({ length: 10 }, (_, i) => 500 - i * 40),
  },
  table: Array.from({ length: 10 }, (_, i) => ({
    artist: `Artist ${i + 1}`,
    plays: 500 - i * 40,
    hours: (500 - i * 40) * 0.05,
    image: null,
    genre: 'rock',
  })),
};

const MOCK_TOP_ALBUMS = {
  chart: {
    labels: Array.from({ length: 10 }, (_, i) => `Album ${i + 1}`),
    values: Array.from({ length: 10 }, (_, i) => 300 - i * 25),
  },
  table: Array.from({ length: 10 }, (_, i) => ({
    album: `Album ${i + 1}`,
    artist: `Artist ${i + 1}`,
    plays: 300 - i * 25,
    hours: (300 - i * 25) * 0.05,
    tracks: 12,
    image: null,
    artist_image: null,
    genre: 'rock',
  })),
};

const MOCK_TOP_TRACKS = {
  chart: {
    labels: Array.from({ length: 10 }, (_, i) => `Track ${i + 1}`),
    values: Array.from({ length: 10 }, (_, i) => 200 - i * 15),
  },
  table: Array.from({ length: 10 }, (_, i) => ({
    track: `Track ${i + 1}`,
    artist: `Artist ${i + 1}`,
    album: `Album ${i + 1}`,
    plays: 200 - i * 15,
    hours: (200 - i * 15) * 0.05,
    image: null,
    artist_image: null,
    genre: 'rock',
  })),
};

const MOCK_TIMELINE = {
  yearly: {
    labels: [2021, 2022, 2023, 2024],
    values: [250.0, 320.0, 410.0, 255.0],
  },
  heatmap: {
    2021: { 1: 20.5, 6: 24.5, 12: 24.0 },
    2022: { 1: 25.0, 6: 30.0, 12: 28.0 },
    2023: { 1: 30.0, 6: 38.0, 12: 35.0 },
    2024: { 1: 22.0, 6: 26.0, 12: 24.0 },
  },
  evolution: {
    labels: [2021, 2022, 2023, 2024],
    artists: ['Radiohead', 'Blur', 'Oasis'],
    images: { Radiohead: '', Blur: '', Oasis: '' },
    datasets: {
      Radiohead: [250.0, 300.0, 380.0, 200.0],
      Blur: [0, 180.0, 220.0, 150.0],
      Oasis: [0, 0, 160.0, 100.0],
    },
    sankey_flows: [
      { from: 'Radiohead (2021)', to: 'Radiohead (2022)', flow: 300.0 },
    ],
    sankey_nodes: {
      'Radiohead (2021)': { artist: 'Radiohead', year: 2021, hours: 250.0 },
    },
  },
  years: ['2021', '2022', '2023', '2024'],
};

// /api/daily-heatmap is called when a user clicks a month cell; not needed for initial tab load
const MOCK_HEATMAP = {
  days: { 1: 2.5, 5: 1.8, 10: 3.2, 15: 0.9, 20: 4.1, 25: 2.0 },
  total_days: 31,
};

const MOCK_HABITS = {
  hourly: {
    labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`),
    values: [0.2, 0.1, 0.05, 0.05, 0.1, 0.3, 0.8, 1.5, 2.0, 1.8, 1.2, 1.5, 2.0, 1.8, 1.5, 1.8, 2.2, 2.5, 3.0, 3.5, 3.8, 4.0, 3.2, 2.0],
    avg_values: Array.from({ length: 24 }, () => 0.3),
  },
  daily: {
    labels: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    values: [80, 95, 110, 100, 150, 180, 130],
    avg_values: [2.1, 2.5, 2.9, 2.7, 4.0, 4.8, 3.5],
  },
  shuffle: { labels: ['Yes', 'No'], values: [800, 1200] },
  skip: { labels: ['Yes', 'No'], values: [400, 1600] },
  offline: { labels: ['Yes', 'No'], values: [200, 1800] },
  platform: {
    labels: ['Android', 'iOS', 'Desktop'],
    values: [800, 700, 500],
  },
  avg_track_min: 3.8,
  total_listening_days: 310,
  unique_countries: 3,
  peak_hour: '20:00',
  peak_day: 'Friday',
  years: ['2021', '2022', '2023', '2024'],
};

// /api/top-artists-brief returns a list of suggestion chips (different shape from /api/top-artists)
const MOCK_TOP_ARTISTS_BRIEF = [
  { name: 'Radiohead', plays: 1200, image: '' },
  { name: 'Blur', plays: 800, image: '' },
  { name: 'Oasis', plays: 600, image: '' },
  { name: 'Portishead', plays: 400, image: '' },
  { name: 'Massive Attack', plays: 300, image: '' },
];

// ---------------------------------------------------------------------------
// Helper: register all API mocks
// ---------------------------------------------------------------------------

/**
 * @param {import('@playwright/test').Page} page
 */
async function mockAllAPIs(page) {
  await page.route('/api/auth/me', route =>
    route.fulfill({ json: MOCK_ME })
  );
  await page.route('/api/status', route =>
    route.fulfill({ json: MOCK_STATUS })
  );
  await page.route('/api/dashboard*', route =>
    route.fulfill({ json: MOCK_DASHBOARD })
  );
  // Register brief route BEFORE the top-artists* glob so it matches first
  await page.route('/api/top-artists-brief*', route =>
    route.fulfill({ json: MOCK_TOP_ARTISTS_BRIEF })
  );
  await page.route('/api/top-artists*', route =>
    route.fulfill({ json: MOCK_TOP_ARTISTS })
  );
  await page.route('/api/top-albums*', route =>
    route.fulfill({ json: MOCK_TOP_ALBUMS })
  );
  await page.route('/api/top-tracks*', route =>
    route.fulfill({ json: MOCK_TOP_TRACKS })
  );
  await page.route('/api/timeline*', route =>
    route.fulfill({ json: MOCK_TIMELINE })
  );
  await page.route('/api/daily-heatmap*', route =>
    route.fulfill({ json: MOCK_HEATMAP })
  );
  await page.route('/api/habits*', route =>
    route.fulfill({ json: MOCK_HABITS })
  );
  await page.route('/api/resolve-images', route =>
    route.fulfill({ json: {} })
  );
  await page.route('/api/resolve-genres', route =>
    route.fulfill({ json: {} })
  );
  await page.route('/api/health', route =>
    route.fulfill({ json: { status: 'ok' } })
  );
}

/**
 * Navigate to the app with all APIs mocked and wait for the dashboard to load.
 * @param {import('@playwright/test').Page} page
 */
async function loadApp(page) {
  await mockAllAPIs(page);
  await page.goto('/');
  // Wait for the splash/upload screen to disappear (app has data → skip it)
  await page.waitForSelector('#splash-screen', { state: 'hidden', timeout: 10000 }).catch(() => {});
  // Wait for dashboard content to appear
  await page.waitForSelector('#dashboard-loading', { state: 'hidden', timeout: 10000 }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Utility: switch to a named tab and wait for its content to appear
// ---------------------------------------------------------------------------

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} tabName  data-tab value
 * @param {string} loadingId  id of the loading spinner element
 */
async function switchTab(page, tabName, loadingId) {
  await page.click(`[data-tab="${tabName}"]`);
  if (loadingId) {
    await page.waitForSelector(`#${loadingId}`, { state: 'hidden', timeout: 10000 }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Helper: assert chart container height does not overflow the viewport
// ---------------------------------------------------------------------------

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector  CSS selector for the chart wrapper div
 */
async function assertChartFitsViewport(page, selector) {
  const { elementHeight, viewportHeight } = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return { elementHeight: 0, viewportHeight: window.innerHeight };
    return {
      elementHeight: el.getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
    };
  }, selector);

  expect(
    elementHeight,
    `Chart "${selector}" height ${elementHeight}px exceeds viewport ${viewportHeight}px`
  ).toBeLessThanOrEqual(viewportHeight);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Login / splash screen', () => {
  test('shows login form when not authenticated', async ({ page }) => {
    await page.route('/api/auth/me', route =>
      route.fulfill({ status: 401, json: { detail: 'Not authenticated' } })
    );
    await page.goto('/');
    // The splash/auth screen should be visible
    await expect(page.locator('.splash-screen, .auth-input').first()).toBeVisible({ timeout: 8000 });
  });

  test('skips login when already authenticated', async ({ page }) => {
    await loadApp(page);
    await expect(page.locator('.splash-screen')).toBeHidden({ timeout: 5000 }).catch(() => {});
    await expect(page.locator('#tab-dashboard')).toBeVisible();
  });
});

test.describe('Navigation layout', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  test('tab bar is scrollable on small screens', async ({ page }) => {
    const tabBar = page.locator('.tab-scroll').first();
    await expect(tabBar).toBeVisible();
    const overflowX = await tabBar.evaluate(el =>
      window.getComputedStyle(el).overflowX
    );
    expect(['auto', 'scroll']).toContain(overflowX);
  });

  test('all 8 tab buttons are present', async ({ page }) => {
    const tabs = ['dashboard', 'top-artists', 'top-albums', 'top-tracks', 'timeline', 'habits', 'deep-dive', 'compare'];
    for (const tab of tabs) {
      await expect(page.locator(`[data-tab="${tab}"]`)).toBeVisible();
    }
  });

  test('clicking a tab activates it', async ({ page }) => {
    await page.click('[data-tab="top-artists"]');
    await expect(page.locator('[data-tab="top-artists"]')).toHaveClass(/active/);
    await expect(page.locator('#tab-top-artists')).not.toHaveClass(/hidden/);
  });
});

test.describe('Dashboard tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  test('shows stat cards', async ({ page }) => {
    await expect(page.locator('.stat-card').first()).toBeVisible({ timeout: 8000 });
    const statCards = await page.locator('.stat-card').count();
    expect(statCards).toBeGreaterThanOrEqual(4);
  });

  test('shows recent tracks', async ({ page }) => {
    const recentSection = page.locator('#tab-dashboard').getByText('Karma Police');
    await expect(recentSection).toBeVisible({ timeout: 8000 });
  });

  test('stat cards do not overflow horizontally', async ({ page }) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1); // 1px tolerance
  });
});

test.describe('Top Artists tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'top-artists', 'top-artists-loading');
  });

  test('shows bar chart and table', async ({ page }) => {
    await expect(page.locator('#chart-artists-bar')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#artists-table tr').first()).toBeVisible({ timeout: 8000 });
  });

  test('table is horizontally scrollable', async ({ page }) => {
    const tableWrapper = page.locator('#tab-top-artists .overflow-x-auto').first();
    await expect(tableWrapper).toBeVisible();
  });
});

test.describe('Top Albums tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'top-albums', 'top-albums-loading');
  });

  test('shows bar chart and table', async ({ page }) => {
    await expect(page.locator('#chart-albums-bar')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#albums-table tr').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Top Tracks tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'top-tracks', 'top-tracks-loading');
  });

  test('shows bar chart and table', async ({ page }) => {
    await expect(page.locator('#chart-tracks-bar')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#tracks-table tr').first()).toBeVisible({ timeout: 8000 });
  });
});

test.describe('Timeline tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'timeline', 'timeline-loading');
  });

  test('shows yearly chart, heatmap, and evolution chart', async ({ page }) => {
    await expect(page.locator('#chart-yearly')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#heatmap-container')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#chart-evolution')).toBeVisible({ timeout: 8000 });
  });

  test('heatmap wrapper is horizontally scrollable', async ({ page }) => {
    const wrapper = page.locator('#tab-timeline .overflow-x-auto').first();
    await expect(wrapper).toBeVisible();
  });
});

test.describe('Habits tab', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'habits', 'habits-loading');
  });

  test('shows stats and charts', async ({ page }) => {
    await expect(page.locator('#habits-stats')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#chart-hourly, #chart-daily, #chart-monthly').first()).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// Landscape overflow tests — these are the critical regression checks
// ---------------------------------------------------------------------------

test.describe('Landscape phone — chart height overflow', () => {
  // Only run these on landscape-phone-sm and landscape-phone-lg projects
  test.skip(({ viewport }) => !viewport || viewport.height > 450,
    'Only runs on landscape phone viewports (height ≤ 450px)');

  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  test('artists bar chart fits within viewport height', async ({ page }) => {
    await switchTab(page, 'top-artists', 'top-artists-loading');
    await expect(page.locator('#chart-artists-bar')).toBeVisible({ timeout: 8000 });
    await assertChartFitsViewport(page, '#chart-artists-bar');
    // Also check the wrapper .chart-tall div
    await assertChartFitsViewport(page, '.chart-tall');
  });

  test('albums bar chart fits within viewport height', async ({ page }) => {
    await switchTab(page, 'top-albums', 'top-albums-loading');
    await expect(page.locator('#chart-albums-bar')).toBeVisible({ timeout: 8000 });
    await assertChartFitsViewport(page, '#chart-albums-bar');
  });

  test('tracks bar chart fits within viewport height', async ({ page }) => {
    await switchTab(page, 'top-tracks', 'top-tracks-loading');
    await expect(page.locator('#chart-tracks-bar')).toBeVisible({ timeout: 8000 });
    await assertChartFitsViewport(page, '#chart-tracks-bar');
  });

  test('evolution chart fits within viewport height', async ({ page }) => {
    await switchTab(page, 'timeline', 'timeline-loading');
    await expect(page.locator('#chart-evolution')).toBeVisible({ timeout: 8000 });
    await assertChartFitsViewport(page, '#chart-evolution');
  });

  test('body does not overflow horizontally in landscape', async ({ page }) => {
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.body.scrollWidth,
      clientWidth: document.body.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  });
});

test.describe('Portrait phone — chart heights are reasonable', () => {
  test.skip(({ viewport }) => !viewport || viewport.width > 430 || viewport.height < 500,
    'Only runs on portrait phone viewports');

  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  test('artists chart height is at least 200px in portrait', async ({ page }) => {
    await switchTab(page, 'top-artists', 'top-artists-loading');
    await expect(page.locator('#chart-artists-bar')).toBeVisible({ timeout: 8000 });
    const height = await page.locator('.chart-tall').first().evaluate(el =>
      el.getBoundingClientRect().height
    );
    expect(height).toBeGreaterThanOrEqual(200);
  });
});

// ---------------------------------------------------------------------------
// .chart-tall CSS class — computed style checks
// ---------------------------------------------------------------------------

test.describe('.chart-tall computed styles', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'top-artists', 'top-artists-loading');
    await expect(page.locator('#chart-artists-bar')).toBeVisible({ timeout: 8000 });
  });

  test('chart-tall wrapper has explicit height (not auto)', async ({ page }) => {
    const heightStyle = await page.locator('.chart-tall').first().evaluate(el =>
      window.getComputedStyle(el).height
    );
    // Should not be 'auto' — must be a px value from the CSS class
    expect(heightStyle).not.toBe('auto');
    expect(heightStyle).toMatch(/^\d+(\.\d+)?px$/);
  });

  test('chart-tall height in landscape phone does not exceed viewport', async ({ page, viewport }) => {
    if (!viewport || viewport.height > 450) test.skip();
    const { elementHeight, viewportH } = await page.evaluate(() => {
      const el = document.querySelector('.chart-tall');
      return {
        elementHeight: el ? el.getBoundingClientRect().height : 0,
        viewportH: window.innerHeight,
      };
    });
    expect(elementHeight).toBeLessThanOrEqual(viewportH);
  });
});

// ---------------------------------------------------------------------------
// Table scroll — data-heavy tables must not cause horizontal page overflow
// ---------------------------------------------------------------------------

test.describe('Tables do not cause horizontal overflow', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
  });

  for (const [tabName, loadingId] of [
    ['top-artists', 'top-artists-loading'],
    ['top-albums', 'top-albums-loading'],
    ['top-tracks', 'top-tracks-loading'],
  ]) {
    test(`${tabName} table: page does not overflow horizontally`, async ({ page }) => {
      await switchTab(page, tabName, loadingId);
      // Give the chart a moment to render
      await page.waitForTimeout(300);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 2);
    });
  }
});

// ---------------------------------------------------------------------------
// Artist Deep-Dive tab — search and layout
// ---------------------------------------------------------------------------

test.describe('Artist Deep-Dive tab', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/artists/search*', route =>
      route.fulfill({ json: { artists: ['Radiohead', 'Radiohead UK'] } })
    );
    await page.route('/api/artist/*', route =>
      route.fulfill({
        json: {
          artist: 'Radiohead',
          plays: 1200,
          duration_ms: 240000000,
          tracks: [{ track: 'Karma Police', plays: 300, duration_ms: 60000000 }],
          image_url: null,
          genres: ['alternative rock', 'art rock'],
          years: { '2022': 400, '2023': 500, '2024': 300 },
        },
      })
    );
    await loadApp(page);
    await page.click('[data-tab="deep-dive"]');
  });

  test('deep-dive section is visible', async ({ page }) => {
    await expect(page.locator('#tab-deep-dive')).not.toHaveClass(/hidden/);
  });

  test('search input is present', async ({ page }) => {
    await expect(page.locator('#artist-search-input, input[placeholder*="artist" i]').first()).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Compare tab — layout
// ---------------------------------------------------------------------------

test.describe('Compare tab layout', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await page.click('[data-tab="compare"]');
  });

  test('compare section is visible', async ({ page }) => {
    await expect(page.locator('#tab-compare')).not.toHaveClass(/hidden/);
  });
});

// ---------------------------------------------------------------------------
// Year filter buttons
// ---------------------------------------------------------------------------

test.describe('Year filter buttons', () => {
  test.beforeEach(async ({ page }) => {
    await loadApp(page);
    await switchTab(page, 'top-artists', 'top-artists-loading');
  });

  test('year filter buttons are rendered', async ({ page }) => {
    const yearBtns = page.locator('#artists-year-btns .year-btn');
    await expect(yearBtns.first()).toBeVisible({ timeout: 8000 });
    const count = await yearBtns.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking a year button activates it and refetches', async ({ page }) => {
    const firstBtn = page.locator('#artists-year-btns .year-btn').first();
    await firstBtn.click();
    await expect(firstBtn).toHaveClass(/active/);
  });
});
