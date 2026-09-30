# Card artwork

The 185 card images in `assets/cards/` are included in the repository so remote
builds can package them without depending on the Witcher wiki CDN. The original
image URLs are recorded in `scripts/asset-manifest.json`.

The images are third-party artwork owned by CD PROJEKT RED or other rights
holders. The project's software license does not cover them; see `NOTICE.md`
and `LICENSING.md`.

`npm run build` checks that every card has a valid image and copies the files to
`packages/client/dist/assets/cards/`. A Cloudflare static assets deployment
should include that directory. The Node server also serves the local files
from `assets/cards/`.

To add or refresh card art, update the manifest if needed, run
`npm run fetch-assets`, review the images, and include them in the next change.
`npm run build:code` skips the image check for local code-only work.
