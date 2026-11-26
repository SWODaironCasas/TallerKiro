import {
  test as base,
  expect,
  type Page,
  type Route,
} from '@playwright/test';

export type SameOrigin = {
  url: (path: string) => string;
  route: (
    path: string,
    handler: (route: Route) => Promise<void>,
  ) => Promise<void>;
};

type BrowserFixtures = {
  sameOrigin: SameOrigin;
  panelPage: Page;
};

export const test = base.extend<BrowserFixtures>({
  sameOrigin: async ({ page, baseURL }, use) => {
    if (!baseURL) {
      throw new Error('El fixture del panel necesita una baseURL same-origin.');
    }

    const origin = new URL(baseURL).origin;

    const toSameOriginUrl = (path: string): string => {
      const target = new URL(path, origin);
      if (target.origin !== origin) {
        throw new Error('El fixture sólo admite URLs del mismo origen.');
      }
      return target.toString();
    };

    const sameOrigin: SameOrigin = {
      url: toSameOriginUrl,
      async route(path, handler) {
        await page.route(toSameOriginUrl(path), handler);
      },
    };

    await use(sameOrigin);
  },

  panelPage: async ({ page }, use) => {
    await use(page);
  },
});

export { expect };
