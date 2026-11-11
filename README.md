# Sound Garden

A personal music library with private audio uploads, playback, and a live audio visualizer. Hand gestures control volume and play/pause.

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
- `/studio`: authenticated personal track library with uploads, search, deletion, and playback.
- Shared header displays the signed-in email and supports signing out.
- Session restoration finishes before protected routes are resolved.
- Uploads use reservation, signed transfer, and verification, with deduplication and expired-upload cleanup.
- Playback supports seeking, volume, mute/restore, and 96 live dark-green visualizer bars.
- Optional camera hand tracking supports pinch-and-drag volume and a 600 ms open-palm hold to play/pause.

## Organization

- `src/hooks/useSession.ts`: session restoration and authentication events.
- `src/components/Header.tsx`: shared navigation and account controls.
- `src/components/Landing.tsx`: landing page and authentication form selection.
- `src/components/AuthForm.tsx`: signup/sign-in requests.
- `src/components/studio/`: studio layout and focused feature components.
- `src/lib/supabase.ts`: shared Supabase client.

## Checks

```sh
npm test
npm run lint
npm run build
# Optional: npm run test:edge (requires the local Deno runtime)
```

## Deployment and authorization

Configure your static host to rewrite application routes such as `/studio` to `index.html` so direct links and refreshes work. Serve over HTTPS for future camera access.

Client-side route guards do not secure data. Apply the repository's Supabase migrations, configure private storage and owner-based row-level security, and deploy the Edge Functions before using hosted uploads/deletion. See [test coverage](tests/README.md), [playback workflow](docs/playback_workflow.md), and [cleanup workflow](docs/cleanup_workflow.md) for details.

## Gesture implementation guide

Read the [gesture code walkthrough](docs/gestures/README.md) for the full camera-to-player workflow, pinch-volume math, open-palm hold logic, lifecycle handling, and tests. Formatted for phone reading.
