# Sound Garden

A personal music library with planned real-time 3D waveforms and hand-gesture audio controls.

## Local development

```sh
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your Supabase project URL and browser-safe publishable key. Never use a secret or service-role key in the frontend.

```sh
npm run dev
```

Configure Supabase Auth's site URL and allowed email confirmation redirects for your local and deployed URLs.

## Current behavior

- `/`: landing page with email/password signup and sign-in.
- `/studio`: authenticated studio shell with a track-library empty state.
- Shared header displays the signed-in email and supports signing out.
- Session restoration finishes before protected routes are resolved.
- Uploads, playback, waveform rendering, and hand controls are not implemented yet; their controls are disabled.

## Organization

- `src/hooks/useSession.ts`: session restoration and authentication events.
- `src/components/Header.tsx`: shared navigation and account controls.
- `src/components/Landing.tsx`: landing page and authentication form selection.
- `src/components/AuthForm.tsx`: signup/sign-in requests.
- `src/components/studio/`: studio layout and focused feature components.
- `src/lib/supabase.ts`: shared Supabase client.

## Checks

```sh
npm run lint
npm run build
```

## Deployment and authorization

Configure your static host to rewrite application routes such as `/studio` to `index.html` so direct links and refreshes work. Serve over HTTPS for future camera access.

Client-side route guards do not secure data. Before implementing the music library, configure database row-level security and private storage policies based on the authenticated user's ID.
