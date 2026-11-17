import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Everything renders in the browser. The pages depend on the URL fragment and WebCrypto, and
 * keeping them off the server guarantees no server-side code ever handles key material.
 */
export const serverRoutes: ServerRoute[] = [
  {
    path: '**',
    renderMode: RenderMode.Client,
  },
];
