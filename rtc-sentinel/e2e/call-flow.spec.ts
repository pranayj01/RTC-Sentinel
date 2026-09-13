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
  const response = await request.post('/api/auth/register', {
    data: {
      name: `E2E ${role}`,
      email: `e2e-${role.toLowerCase()}-${suffix}@example.com`,
      password,
    },
  });
  expect(response.status()).toBe(201);
  return response.json() as Promise<RegisteredUser>;
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
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

    const createdResponse = await request.post('/api/calls', {
      headers: { authorization: `Bearer ${hostUser.accessToken}` },
      data: { roomId, receiverId: participantUser.user.id },
    });
    expect(createdResponse.status()).toBe(201);
    const { call } = (await createdResponse.json()) as {
      call: { id: string; status: string };
    };
    expect(call.status).toBe('INITIATED');

    await participant.getByLabel('Room ID').fill(roomId);
    await participant.getByRole('button', { name: 'Join Call' }).click();
    await expect(host.locator('[data-status="connected"]')).toHaveText(
      'Connected',
    );
    await expect(participant.locator('[data-status="connected"]')).toHaveText(
      'Connected',
    );

    for (const status of ['RINGING', 'CONNECTED']) {
      const response = await request.patch(`/api/calls/${call.id}/status`, {
        headers: { authorization: `Bearer ${hostUser.accessToken}` },
        data: { status },
      });
      expect(response.status()).toBe(200);
    }

    const rttValue = host
      .locator('.metric-grid > div')
      .filter({ hasText: 'Round Trip Time' })
      .locator('strong');
    await expect(rttValue).not.toHaveText('—', { timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const response = await request.get(`/api/calls/${call.id}/metrics`, {
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

    const endedResponse = await request.post(`/api/calls/${call.id}/end`, {
      headers: { authorization: `Bearer ${hostUser.accessToken}` },
    });
    expect(endedResponse.status()).toBe(200);
    const ended = (await endedResponse.json()) as {
      call: {
        roomId: string;
        status: string;
        endedAt: string;
        duration: number;
      };
    };
    expect(ended.call).toMatchObject({ roomId, status: 'ENDED' });
    expect(ended.call.endedAt).toEqual(expect.any(String));
    expect(ended.call.duration).toEqual(expect.any(Number));

    const persistedResponse = await request.get(`/api/calls/${call.id}`, {
      headers: { authorization: `Bearer ${participantUser.accessToken}` },
    });
    expect(persistedResponse.status()).toBe(200);
    expect((await persistedResponse.json()).call.status).toBe('ENDED');
  } finally {
    await Promise.all([hostContext.close(), participantContext.close()]);
  }
});
