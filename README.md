# Secure live message

A small web app for sharing live, end-to-end encrypted text. The sender types, and whoever opens
the sender's link watches the text change in real time. The text is encrypted in the sender's
browser and decrypted in the receiver's; the server only relays ciphertext and never sees the key.

## Running it

Requires Node 24.15.0 or newer (Angular 22 refuses older versions; developed on 24.22.2) and, for
the end-to-end tests, Google Chrome.

```bash
nvm use            # any installed Node 24, from .nvmrc (or: nvm install)
npm ci
npm start          # development server on http://localhost:4200
```

Open `http://localhost:4200`, choose **Send a message**, copy the link, and open it in a second
window (or another browser).

Production build:

```bash
npm run build
node dist/secure-live-message/server/server.mjs   # http://localhost:4000 (PORT to change it)
```

Use `localhost`, not a LAN address or another host name: WebCrypto (`crypto.subtle`) and the
Clipboard API exist only in secure contexts (HTTPS or localhost), and the server accepts only
`localhost` and `127.0.0.1` as host names (`security.allowedHosts` in `angular.json`).

## Architecture

```
 Sender browser                     Server (Express)                 Receiver browser
 ──────────────                     ────────────────                 ────────────────
 key = random 256 bits              POST /api/sessions               key ← link fragment
 text ─▶ AES-GCM ─▶ frame ─PUT────▶ keeps only the latest  ──SSE───▶ frame ─▶ verify + decrypt
         (fresh IV)                 frame per session                 ─▶ show text
 link: /receive/<sessionId>#<key>   never sees key or text
```

| Decision         | Choice                                                                                | Why                                                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key distribution | Key in the URL fragment: `/receive/<sessionId>#<key>`                                 | Browsers never send the fragment to the server, so one link carries both the address and the key                                                                          |
| Encryption       | AES-256-GCM via WebCrypto, random 96-bit IV per message                               | Authenticated encryption: any change to the ciphertext, IV or bound data fails decryption, so no separate MAC is needed. Random IVs cannot repeat if sender state is lost |
| Bound data (AAD) | `[version, sessionId, seq]`                                                           | A frame cannot be moved to another session or given another sequence number without failing authentication                                                                |
| Ordering         | Strictly increasing `seq`; the receiver ignores anything not newer than what it shows | The relay cannot roll the text back by replaying an older authentic frame                                                                                                 |
| Transport        | `fetch` PUT to send, Server-Sent Events to receive                                    | One-way push is all the receiver needs; SSE reconnects by itself and works through ordinary HTTP                                                                          |
| Relay state      | In memory, latest frame only, 1 h idle expiry, max 1000 sessions                      | No persistence needed; a late receiver still gets the current text                                                                                                        |
| Sender auth      | Random write token returned only to the session creator                               | Only the sender can publish to a session (one sender per session)                                                                                                         |
| Rendering        | Angular 22, all routes rendered in the browser only                                   | The key is read from the fragment and used only client-side; no server-side code ever handles it                                                                          |

Code layout:

- `src/app/core/` holds the framework-free logic: `crypto.ts` (seal/open), `frame.ts` (wire
  format and validation of untrusted input), `sender-session.ts`, `receiver-session.ts`, and
  `relay-client.ts` (the only code that talks to the network).
- `src/app/pages/` holds the intro, sender and receiver pages; `src/app/ui/` holds small
  presentational components (button, alert, connection badge).
- `src/server/relay.ts` is the ciphertext relay; `src/server.ts` adds security headers and
  serves the app.

### Asynchronous behaviour

- **Sender:** at most one encrypt-and-send is in flight. Edits made meanwhile collapse into one
  pending text, so frames leave in sequence order and the receiver always ends on the newest
  text. Sends are throttled to one per 150 ms (the first edit goes out at once, the last always
  goes out). Failed sends are retried after 1 s with the newest text; a sequence number is never
  reused. A `404` means the relay has forgotten the session, so the sender stops instead of
  retrying forever and offers to start a new session.
- **Receiver:** decryption is asynchronous, so frames are processed one at a time in arrival
  order. Without that, a slow valid frame finishing after a newer bad one would clear the
  integrity alert.

## Security assumptions and considerations

- **Trust in the server's code delivery.** As in any web-based end-to-end encryption, the server
  that serves the JavaScript could serve a version that leaks the key. The design protects the
  content from the relay's storage and transport, not from a malicious deployment.
- **What the relay can and cannot do.** It can drop, delay or withhold frames. It cannot read,
  forge or alter them (the receiver shows an integrity alert and keeps the last verified text,
  dimmed), and it cannot roll a receiver back below what it has already shown. A receiver that
  opens the link fresh starts from zero, so it cannot tell an old authentic frame from the current
  one, and no receiver can tell "the sender stopped typing" from "the server is withholding
  updates".
- **The link is the secret.** Anyone holding the full link can read the message, including
  someone it was forwarded to and link-preview or mail-scanning bots that open links in a browser.
  The key also stays in the address bar and browser history.
- **One receiver per session, newest wins.** Opening the link again moves the previous receiver
  aside, which makes a refresh reliable. Someone who knows only the session id (no key) can take
  the receiver slot, but cannot read anything.
- **Wrong key and tampering look the same** to the receiver; both are reported as an update that
  could not be verified.
- **Metadata is visible.** The relay sees message sizes and timing (no padding). The throttle
  reduces how much of the typing rhythm it sees.
- **No forward secrecy:** one static key per session.
- **Browser hardening.** Decrypted text is shown with `textContent`, never parsed as HTML. The
  key is imported as non-extractable and single-purpose (the sender can only encrypt, the receiver
  only decrypt). Every response carries a Content Security Policy that allows only same-origin
  scripts, connections and fonts (the font is self-hosted for this reason),
  `Referrer-Policy: no-referrer` (the session id must not leak through links), and `nosniff`. API
  responses are `no-store`.

## Tests

```bash
npm test        # unit and integration tests (Vitest, jsdom): 100 tests
npm run e2e     # end-to-end tests (Playwright, local Chrome, production build): 10 tests
npm run lint    # ESLint (angular-eslint)
```

- **Main flow:** two or more consecutive updates through the real sender and receiver sessions
  (`session-flow.spec.ts`), on the receiver page, and end to end in two separate browser contexts
  (`e2e/messaging.e2e.ts`).
- **Security:** every tampering case (ciphertext bit, tag bit, truncation, IV, sequence number,
  frame moved to another session, wrong key), malformed input, forged and replayed frames, the
  network never carrying the key or the plaintext (checked on every request of both browsers),
  markup shown as text, damaged links making no API call, the write token, and the security
  headers.
- **Asynchronous behaviour:** collapsing edits during an in-flight send, strictly increasing
  sequence numbers, retries ending on the newest text, the throttle, arrival-order processing on
  the receiver, stopping on an ended session, and reconnect states.
- **Mutation checks:** the race and security guards were deliberately broken one at a time (the
  sequence check, the receiver queue, single-flight sending, the stop on an ended session,
  rendering with `innerHTML`) to confirm that a test fails for each.

## Known limitations and next steps

- **Single server instance.** Sessions live in memory; a restart ends every session, and
  scaling out would need shared state (for example Redis pub/sub).
- **No rate limiting** on session creation or sending, beyond the session cap and size limits.
- **The sender cannot end a session explicitly**, and the receiver cannot tell a quiet sender
  from a withholding server. An authenticated "end" frame and a periodic authenticated heartbeat
  through the same encrypted channel would fix both.
- **Reloading the sender page starts a new session**, because the key and sequence number live
  only in memory.
- **Receiver takeover** by anyone who knows the session id (see above). First-connection-wins
  would prevent it but break a quick refresh; a receiver token derived from the key would solve
  both.
- **Changing only the link's fragment** in an open receiver tab keeps the old key until the page
  is reloaded.
- **Accessibility and UI** are kept deliberately simple: no dark mode and no
  internationalisation.

## AI usage

- **Models and tools:** Claude Opus 5.5 in Claude Code (CLI), used for design discussion,
  implementation, tests, reviews of the code against the requirements, and manual checks in
  Chrome through Claude in Chrome browser automation. The design was explored first in a
  throwaway prototype, part of which was built with Claude Fable 5.2; this repository was then
  built step by step, one reviewed commit at a time.
- **Skills:** none.
- **Validation:**
  - _Useful contribution:_ the concurrency design (single-flight sender, ordered receiver with a
    sequence check) and the mutation checks used to prove the tests guard it. Breaking each
    guard on purpose showed that the original ordering test still passed without the receiver's
    queue, which led to a new test for the case the queue actually protects: a slow valid frame
    must not clear the alert raised by a newer bad one.
  - _Independently verified and corrected:_ testing by hand, I found that after "Start a new
    session" the receiver showed text that the sender's (re-created, now empty) textarea no
    longer showed. The AI's test had missed it because its mocked network answered instantly,
    so the page never rendered the in-between state. The fix binds the textarea to the text, and
    the test now answers after a delay like a real network and fails without the fix.
