# LiveBoard Frontend

The web app for **LiveBoard**, a collaborative workspace where a team shares Kanban boards, chats and draws on a whiteboard together, and every change shows up for everyone instantly.

Built with **React**, **TypeScript** and **Vite**. It talks to the [LiveBoard backend](https://github.com/adil-java/LiveBorad-backend) over REST and receives live updates through **SignalR**. Sign-in uses **Firebase Authentication**.

## Features

- **Sign in** with Google or email and password, including sign-up, password reset and email verification.
- **Boards:** create boards, rename them, and see every board you're a member of.
- **Kanban cards:** drag cards between columns with mouse, touch or keyboard; add, rename and remove columns.
- **Card editing:** see who else is editing a card. If someone saves first, choose to keep your version or take theirs.
- **Live collaboration:** changes from teammates appear instantly, with avatars showing who's on the board and a Live / Reconnecting indicator.
- **Chat:** a chat per board, with history, a "typing…" indicator and an unread badge.
- **Whiteboard:** draw together with pen, highlighter and eraser in several colours and sizes. Others see lines as they are drawn, with the artist's name. Includes undo (Ctrl/⌘+Z), clear and PNG download.
- **Team management:** invite people as Viewer, Editor or Owner, change roles, remove members, or leave a board.
- **Activity feed:** a history of every change on the board.
- Works in light and dark mode and on phone-sized screens.

## Tech stack

| Area | Technology |
|---|---|
| UI | React 19, TypeScript, plain CSS with light/dark themes |
| Build | Vite 8, Oxlint |
| Routing | React Router |
| Auth | Firebase Authentication (Google, email/password) |
| Real time | `@microsoft/signalr` |
| Drag and drop | `@dnd-kit` |
| Whiteboard | HTML canvas (no extra library) |

## Getting started

**Prerequisites:** Node.js 20.19+ or 22.12+, the [backend](https://github.com/adil-java/LiveBorad-backend) running locally, and a Firebase project with **Google** and/or **Email/Password** enabled under Authentication → Sign-in method.

1. **Install:**
   ```bash
   npm install
   ```
2. **Configure:** copy `.env.example` to `.env` and fill in the values:

   | Variable | Where to find it |
   |---|---|
   | `VITE_API_URL` | Backend URL, e.g. `http://localhost:5024` |
   | `VITE_FIREBASE_API_KEY` | Firebase console → Project settings → General → Your apps |
   | `VITE_FIREBASE_AUTH_DOMAIN` | Same place, e.g. `your-project.firebaseapp.com` |
   | `VITE_FIREBASE_PROJECT_ID` | Same place; must match the backend's `Firebase:ProjectId` |
   | `VITE_FIREBASE_APP_ID` | Same place |

   These Firebase values identify your project and aren't secret, but `.env` is git-ignored so each environment can use its own.

3. **Run:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173`. The backend allows this address by default in Development.

To see the live collaboration, open the same board in two browser windows signed in as different users. Add the second user under **Members** first.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server with hot reload |
| `npm run build` | Type-check and build for production into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Lint with Oxlint |

## Project structure

```
src/
  config.ts            Reads and checks environment variables
  lib/firebase.ts      Firebase setup and friendly sign-in error messages
  api/                 Types matching the backend, fetch client (adds the auth token), endpoint functions
  realtime/hub.ts      One shared SignalR connection with automatic reconnect
  auth/                Sign-in state; syncs the profile with the backend after each sign-in
  components/          Toasts, avatars, modal, side drawer, inline editing
  pages/               Sign-in, boards list, board page
  board/               Everything inside a board: state, cards and drag and drop, card editor,
                       members, activity, chat and whiteboard
```

## How live updates work

- **Saving:** every change is sent to the backend over REST and shown right away from the response.
- **Receiving:** other people's changes arrive as SignalR events and are merged into the board by ID, so duplicates are harmless.
- **No echoes:** each request includes the tab's SignalR connection ID, so the server doesn't send your own change back to you.
- **Reconnecting:** after a dropped connection, the app rejoins the board and reloads it, so nothing missed while offline is lost.

## Deployment

1. Run `npm run build` and serve the `dist/` folder from any static host. Route all paths to `index.html`, since the app uses client-side routing.
2. Set the `VITE_*` variables at build time, with `VITE_API_URL` pointing at the deployed backend.
3. Add the site's domain in Firebase under **Authentication → Settings → Authorized domains**.
4. Add the site's URL to the backend's `Cors:AllowedOrigins`.
