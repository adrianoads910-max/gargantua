# gargantua — rules for AI sessions

- **English** in code, comments, docs and commit messages. UI strings are Portuguese (pt-BR).
- **Zero runtime dependencies.** Plain Node (18+) and browser APIs only.
- **Front end:** classic scripts in `public/js/`, loaded in order by `public/index.html` (`main.js` last). They share top-level names, so a name is declared in one file only.
- **Layers** (bottom to top): `#sky` (unbent sky), `#fxb` (bodies behind the hole), `#bh` (the hole; its alpha masks `#fxb`), `#fx` (bodies in front, input). `galaxy.draw` picks the layer by depth against the hole's centre.
- **Measured, never guessed:** every on-screen state comes from the registry or the transcripts.
- **Security:** bind to `127.0.0.1`; keep the Host allowlist, the CSP, and the cookie + header + origin checks on `/api/send` in `src/server.js`; never read `*.key`, `auth.json` or tokens; run `claude` with arguments, never a shell; escape everything rendered into HTML with `esc()`.
- **Run `npm test` before every commit.** After visual changes, refresh `docs/*.png` from `npm run demo`.
