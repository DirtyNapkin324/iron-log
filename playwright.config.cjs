const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  testMatch: '*.spec.cjs',
  workers: 2,
  use: { baseURL: 'http://127.0.0.1:4173', timezoneId: 'America/New_York' },
  projects: [
    { name: 'Chromium', use: { browserName: 'chromium' } },
    { name: 'Mobile WebKit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
    ...[320, 375, 430].map(width => ({
      name: 'WebKit ' + width, grep: /six tabs/, use: {
        ...devices['iPhone 13'], browserName: 'webkit', viewport: { width, height: width === 320 ? 568 : 844 }
      }
    }))
  ],
  webServer: {
    command: 'node tests/serve.cjs',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false
  }
});
