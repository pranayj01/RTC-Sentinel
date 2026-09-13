import { act, renderHook, waitFor } from '@testing-library/react';
import { getCurrentUser, login, logout, refresh } from './authApi';
import { useAuth } from './useAuth';

jest.mock('./authApi', () => ({
  ApiError: class ApiError extends Error {},
  getCurrentUser: jest.fn(),
  login: jest.fn(),
  logout: jest.fn(),
  refresh: jest.fn(),
  register: jest.fn(),
}));

const mockRefresh = refresh as jest.MockedFunction<typeof refresh>;
const mockGetCurrentUser = getCurrentUser as jest.MockedFunction<
  typeof getCurrentUser
>;
const mockLogin = login as jest.MockedFunction<typeof login>;
const mockLogout = logout as jest.MockedFunction<typeof logout>;

const user = {
  id: 'user-1',
  name: 'Secure User',
  email: 'secure@example.com',
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
};

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockRefresh.mockRejectedValue(new Error('No cookie'));
  mockLogout.mockResolvedValue(undefined);
});

test('restores a session through the refresh cookie without storing JWTs', async () => {
  localStorage.setItem(
    'rtc-sentinel.auth',
    JSON.stringify({ accessToken: 'legacy-token', refreshToken: 'legacy' }),
  );
  mockRefresh.mockResolvedValue({ accessToken: 'new-access-token' });
  mockGetCurrentUser.mockResolvedValue(user);

  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.loading).toBe(false));

  expect(result.current.user).toEqual(user);
  expect(result.current.accessToken).toBe('new-access-token');
  expect(localStorage.getItem('rtc-sentinel.auth')).toBeNull();
});

test('keeps a new login in memory and clears its cookie on logout', async () => {
  mockLogin.mockResolvedValue({ user, accessToken: 'access-token' });
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.loading).toBe(false));

  await act(() =>
    result.current.login({
      email: 'secure@example.com',
      password: 'StrongPass1',
    }),
  );
  expect(result.current.user).toEqual(user);
  expect(localStorage.length).toBe(0);

  act(() => result.current.logout());
  expect(result.current.user).toBeNull();
  expect(mockLogout).toHaveBeenCalled();
});
