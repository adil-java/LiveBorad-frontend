const env = import.meta.env;

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name}. Copy .env.example to .env and fill it in, then restart the dev server.`);
  }
  return value;
}

export const config = {
  /** Empty means same origin: in development the Vite server forwards /api and /hubs to the backend. */
  apiUrl: (env.VITE_API_URL ?? '').trim().replace(/\/+$/, ''),
  firebase: {
    apiKey: required('VITE_FIREBASE_API_KEY', env.VITE_FIREBASE_API_KEY),
    authDomain: required('VITE_FIREBASE_AUTH_DOMAIN', env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: required('VITE_FIREBASE_PROJECT_ID', env.VITE_FIREBASE_PROJECT_ID),
    appId: required('VITE_FIREBASE_APP_ID', env.VITE_FIREBASE_APP_ID),
  },
};
