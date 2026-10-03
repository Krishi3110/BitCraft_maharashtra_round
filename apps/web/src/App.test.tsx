import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App Routing', () => {
  it('renders the Home page by default', () => {
    render(<App />);
    const elements = screen.getAllByText('Home');
    expect(elements.length).toBeGreaterThan(0);
  });
});
