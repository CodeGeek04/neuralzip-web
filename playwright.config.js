import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 360000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', channel: 'chrome',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'] } },
  webServer: { command: 'npm run preview -- --port 4173', url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI },
});
