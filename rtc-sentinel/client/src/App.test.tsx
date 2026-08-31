import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('renders the application name', () => {
  render(<App />);
  expect(screen.getByRole('heading', { name: 'RTC Sentinel' })).toBeInTheDocument();
});

