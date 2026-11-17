import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { IntroPage } from './intro-page';

describe('IntroPage', () => {
  it('offers a "Send a message" box that links to the sender page', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(IntroPage);
    await fixture.whenStable();
    const box = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="send-box"]')!;

    expect(box.querySelector('h2')?.textContent).toBe('Send a message');
    const link = box.querySelector('a')!;
    expect(link.textContent?.trim()).toBe('Send a message');
    expect(link.getAttribute('href')).toBe('/send');
  });

  it('makes no network request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(IntroPage);
    await fixture.whenStable();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
