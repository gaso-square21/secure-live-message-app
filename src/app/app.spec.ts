import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { App } from './app';
import { routes } from './app.routes';

describe('App', () => {
  const render = async (url: string) => {
    TestBed.configureTestingModule({ imports: [App], providers: [provideRouter(routes)] });
    const fixture = TestBed.createComponent(App);
    await TestBed.inject(Router).navigateByUrl(url);
    await fixture.whenStable();
    return {
      heading: (fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent,
      tabTitle: document.title,
    };
  };

  it('uses the default heading and tab title on the intro page', async () => {
    expect(await render('/')).toEqual({
      heading: 'Secure live message',
      tabTitle: 'Secure live message',
    });
  });

  it('uses the send heading and tab title on the sender page', async () => {
    expect(await render('/send')).toEqual({
      heading: 'Send live message',
      tabTitle: 'Send live message',
    });
  });

  it('uses the receive heading and tab title on the receiver page', async () => {
    expect(await render('/receive/some-session')).toEqual({
      heading: 'Receive live message',
      tabTitle: 'Receive live message',
    });
  });

  it('falls back to the intro page for unknown paths', async () => {
    expect((await render('/nowhere')).heading).toBe('Secure live message');
  });
});
