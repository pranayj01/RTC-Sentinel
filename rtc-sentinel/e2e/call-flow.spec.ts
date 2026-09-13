import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

type RegisteredUser = {
  user: { id: string; email: string };
  accessToken: string;
};

const password = 'PlaywrightPass1';

async function registerUser(
  request: APIRequestContext,
  role: string,
  suffix: string,
): Promise<RegisteredUser> {
  const roleSlug = role.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const response = await request.post('/api/auth/register', {
    data: {
      name: `E2E ${role}`,
      email: `e2e-${roleSlug}-${suffix}@example.com`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<RegisteredUser>;
}

async function signIn(page: Page, email: string, path = '/'): Promise<void> {
  await page.goto(path);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
}

test('two signed-in browsers complete a persisted WebRTC call', async ({
  browser,
  request,
  baseURL,
}) => {
  expect(baseURL).toBeTruthy();
  const suffix = `${Date.now()}-${test.info().workerIndex}`;
  const hostUser = await registerUser(request, 'Host', suffix);
  const participantUser = await registerUser(request, 'Participant', suffix);
  const contextOptions = { baseURL, permissions: ['microphone'] };
  const hostContext = await browser.newContext(contextOptions);
  const participantContext = await browser.newContext(contextOptions);
  const host = await hostContext.newPage();
  const participant = await participantContext.newPage();

  try {
    await Promise.all([
      signIn(host, hostUser.user.email),
      signIn(participant, participantUser.user.email),
    ]);

    await host.getByRole('button', { name: 'Create Call' }).click();
    const roomDisplay = host.locator('.room-line strong').first();
    await expect(roomDisplay).toHaveText(/^[A-Z0-9]{6}$/);
    const roomId = (await roomDisplay.textContent())!;
    await expect(host.locator('[data-status="waiting"]')).toHaveText(
      'Waiting for peer',
    );

    await participant.getByLabel('Room ID').fill(roomId);
    await participant.getByRole('button', { name: 'Join Call' }).click();
    await expect(host.locator('[data-status="connected"]')).toHaveText(
      'Connected',
    );
    await expect(participant.locator('[data-status="connected"]')).toHaveText(
      'Connected',
    );

    let callId = '';
    await expect
      .poll(
        async () => {
          const response = await request.get('/api/calls', {
            headers: { authorization: `Bearer ${hostUser.accessToken}` },
          });
          expect(response.status()).toBe(200);
          const body = (await response.json()) as {
            calls: Array<{ id: string; roomId: string; status: string }>;
          };
          const call = body.calls.find((entry) => entry.roomId === roomId);
          callId = call?.id ?? '';
          return call?.status;
        },
        { timeout: 30_000 },
      )
      .toBe('CONNECTED');
    expect(callId).not.toBe('');

    const rttValue = host
      .locator('.metric-grid > div')
      .filter({ hasText: 'Round Trip Time' })
      .locator('strong');
    await expect(rttValue).not.toHaveText('—', { timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const response = await request.get(`/api/calls/${callId}/metrics`, {
            headers: { authorization: `Bearer ${hostUser.accessToken}` },
          });
          expect(response.status()).toBe(200);
          const body = (await response.json()) as { metrics: unknown[] };
          return body.metrics.length;
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await host.getByRole('button', { name: 'End Call' }).click();
    await expect(
      participant.getByText('The other participant left the call.'),
    ).toBeVisible();

    await expect
      .poll(
        async () => {
          const response = await request.get(`/api/calls/${callId}`, {
            headers: {
              authorization: `Bearer ${participantUser.accessToken}`,
            },
          });
          expect(response.status()).toBe(200);
          return (await response.json()).call as {
            roomId: string;
            status: string;
            endedAt: string | null;
            duration: number | null;
          };
        },
        { timeout: 30_000 },
      )
      .toMatchObject({
        roomId,
        status: 'ENDED',
        endedAt: expect.any(String),
        duration: expect.any(Number),
      });
  } finally {
    await Promise.all([hostContext.close(), participantContext.close()]);
  }
});

test('an authenticated host and anonymous guest connect through TURN relay', async ({
  browser,
  request,
  baseURL,
}) => {
  expect(baseURL).toBeTruthy();
  const suffix = `relay-${Date.now()}-${test.info().workerIndex}`;
  const hostUser = await registerUser(request, 'Relay Host', suffix);
  const contextOptions = { baseURL, permissions: ['microphone'] };
  const hostContext = await browser.newContext(contextOptions);
  const guestContext = await browser.newContext(contextOptions);
  const host = await hostContext.newPage();
  const guest = await guestContext.newPage();

  try {
    await Promise.all([
      signIn(host, hostUser.user.email, '/?relay=1'),
      guest.goto('/?relay=1'),
    ]);
    await guest.getByRole('button', { name: 'Join a call as guest' }).click();

    await host.getByRole('button', { name: 'Create Call' }).click();
    const roomDisplay = host.locator('.room-line strong').first();
    await expect(roomDisplay).toHaveText(/^[A-Z0-9]{6}$/);
    const roomId = (await roomDisplay.textContent())!;

    await guest.getByLabel('Room ID').fill(roomId);
    await guest.getByRole('button', { name: 'Join Call' }).click();
    await expect(host.locator('[data-status="connected"]')).toHaveText(
      'Connected',
      { timeout: 30_000 },
    );
    await expect(guest.locator('[data-status="connected"]')).toHaveText(
      'Connected',
      { timeout: 30_000 },
    );

    for (const page of [host, guest]) {
      await expect(
        page
          .locator('.status-grid > div')
          .filter({ hasText: 'Network Path' })
          .locator('strong'),
      ).toHaveText('RELAY', { timeout: 30_000 });
    }

    await host.getByRole('button', { name: 'End Call' }).click();
    await expect(
      guest.getByText('The other participant left the call.'),
    ).toBeVisible();
  } finally {
    await Promise.all([hostContext.close(), guestContext.close()]);
  }
});
