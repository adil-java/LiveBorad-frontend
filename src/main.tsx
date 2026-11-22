import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

const root = createRoot(document.getElementById('root')!);

// App is imported dynamically so a configuration error (e.g. a missing .env value) is shown on the page
// instead of leaving it blank.
import('./App')
  .then(({ default: App }) =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((error: unknown) =>
    root.render(
      <main className="page center full-height">
        <div className="empty-state">
          <h2>LiveBoard can't start</h2>
          <p className="muted">{error instanceof Error ? error.message : String(error)}</p>
        </div>
      </main>,
    ),
  );
