import { expect, test } from './fixtures';

test('abre el panel bajo el mismo origen de TicketOps', async ({
  panelPage,
  sameOrigin,
}) => {
  const response = await panelPage.goto(sameOrigin.url('/panel/'), {
    waitUntil: 'domcontentloaded',
  });

  expect(response?.ok()).toBe(true);
  expect(new URL(panelPage.url()).origin).toBe(
    new URL(sameOrigin.url('/')).origin,
  );
  expect(new URL(panelPage.url()).pathname).toBe('/panel/');
});
