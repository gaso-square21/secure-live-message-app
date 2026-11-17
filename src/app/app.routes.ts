import { Routes } from '@angular/router';

/**
 * The route title is the single source for both the browser tab title (set by Angular's
 * built-in title strategy) and the page heading (read in the App component).
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Secure live message',
    loadComponent: () => import('./pages/intro-page').then((m) => m.IntroPage),
  },
  {
    path: 'send',
    title: 'Send live message',
    loadComponent: () => import('./pages/sender-page').then((m) => m.SenderPage),
  },
  {
    path: 'receive/:id',
    title: 'Receive live message',
    loadComponent: () => import('./pages/receiver-page').then((m) => m.ReceiverPage),
  },
  { path: '**', redirectTo: '' },
];
