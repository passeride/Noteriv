# NOTICE

## Origin of this project

This repository is a fork of **Noteriv** by Jace, <https://github.com/thejacedev/Noteriv>
(`thejacedev/Noteriv`), released under the MIT License, Copyright (c) 2026 Jace.
The `upstream` git remote points to that project. Its commit history, tags and licence
are preserved here unchanged.

The original copyright notice and licence text are kept in [LICENSE](LICENSE), with an
additional copyright line for the contributions made in this fork.

The mobile app in `phone/` was removed from this fork on 2026-10-17 and restored on
2026-10-21 from upstream `main` at commit `013fa8c` (Copyright (c) 2026 Jace, MIT). Changes
made here after that point (application id, shared code, design) are part of this fork.

## What this fork adds

Work done in this repository after the fork point, including the web application
(`web/`), its API server (`web/server/`), the PDF rendering service (`web/pdf-service/`),
the deployment, backup and monitoring setup (`web/infra/`, `docs/ops/`) and the
documentation under `docs/`, is Copyright (c) 2026 Phùng Đức Tường and is provided
under the same MIT License.

## Binaries

This repository does not distribute compiled binaries. The Android APK that older copies
of the upstream README link to was built and published by the upstream author; it is not
built, reviewed or guaranteed by this project, and was removed from this repository's
tree (it remains in git history, as it does upstream).

## Third-party code

- Runtime and build dependencies are installed from the npm registry (and other package
  registries) and remain under their own licences. See each package's `package.json` and
  `package-lock.json`.
- Code or data **copied into** this repository from another project must be listed here
  **at the time it is imported**, with: name, source URL, version or commit, author and
  licence, and the files it ended up in. Only material under a licence compatible with
  MIT is imported. Components are not listed in advance.

### Imported components

Both entries below are chess piece artwork embedded in the Chessboard core plugin,
`packages/plugins/src/chessboard/pieces.ts`. The full licence texts and the exact
modifications are in
[`packages/plugins/src/chessboard/THIRD-PARTY-LICENSES.md`](packages/plugins/src/chessboard/THIRD-PARTY-LICENSES.md).

- **chessnut-pieces** ("classic" set, `PIECE_SVG`)
  - Source: <https://github.com/LexLuengas/chessnut-pieces>
  - Author: Copyright 2015 Alexis Luengas
  - Licence: Apache License 2.0
  - Modified: XML prolog, DOCTYPE, editor comments and `id` attributes removed; the 12
    SVG files inlined as string literals. Path geometry and colours unchanged.
- **lichess `spatial` piece set** (`PIECE_SVG_SPATIAL`)
  - Source: <https://github.com/lichess-org/lila/tree/master/public/piece/spatial>
    (original artwork: <https://github.com/maurimo/chess-art>)
  - Author: Copyright Maurizio Monge
  - Licence: MIT
  - Modified: per-file gradient fills flattened to solid colours (the duplicated gradient
    ids collided when inlined); `id` attributes and the shared `<style>` block removed.
    Path geometry unchanged.
