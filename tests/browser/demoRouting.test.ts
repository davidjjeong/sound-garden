import { createElement } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../src/App'
const session = vi.hoisted(() => ({ user: null as null | { email: string }, loading: false, error: '' }))
vi.mock('../../src/hooks/useSession', () => ({ useSession: () => session }))
vi.mock('../../src/components/Header', () => ({ Header: ({ user }: { user: { email: string } | null }) => createElement('header', null, user ? user.email : 'Logo only') }))
vi.mock('../../src/components/Landing', () => ({ Landing: () => createElement('h1', null, 'Landing') }))
vi.mock('../../src/components/studio/Studio', () => ({ Studio: () => createElement('h1', null, 'Saved studio') }))
vi.mock('../../src/components/studio/DemoStudio', () => ({ DemoStudio: () => createElement('h1', null, 'Demo studio') }))
afterEach(() => { cleanup(); session.user = null; session.loading = false; session.error = '' })
function visit(path: string) { render(createElement(MemoryRouter, { initialEntries: [path] }, createElement(App))) }
it('opens the public demo while authentication is loading', () => {
  session.loading = true
  visit('/demo')
  expect(screen.getByText('Demo studio')).toBeTruthy()
})
it('opens the public demo despite an authentication error', () => {
  session.error = 'Auth unavailable'
  visit('/demo')
  expect(screen.getByText('Demo studio')).toBeTruthy()
})
it('redirects unauthenticated studio visitors to the landing page', () => {
  visit('/studio')
  expect(screen.getByText('Landing')).toBeTruthy()
})
it('preserves authenticated studio access', () => {
  session.user = { email: 'test@example.com' }
  visit('/studio')
  expect(screen.getByText('Saved studio')).toBeTruthy()
})

it('hides the account identity on the demo even when signed in', () => {
  session.user = { email: 'test@example.com' }
  visit('/demo')
  expect(screen.getByText('Logo only')).toBeTruthy()
  expect(screen.queryByText('test@example.com')).toBeNull()
})
it('keeps the account identity visible on the signed-in studio', () => {
  session.user = { email: 'test@example.com' }
  visit('/studio')
  expect(screen.getByText('test@example.com')).toBeTruthy()
})
