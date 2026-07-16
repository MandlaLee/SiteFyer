# SiteFyer V1 — Mirror Mode

SiteFyer is a browser-based public website mirroring tool designed for GitHub Pages. It discovers a website beyond the homepage, counts the public file set, downloads the discovered files with resumable browser checkpoints, rewrites local references, and exports one ZIP archive.

## V1 captures

- HTML pages found through internal links and XML sitemaps
- CSS and JavaScript
- images and SVG files
- fonts
- favicons and web manifests
- PDFs and other publicly linked documents
- directly hosted video and audio files
- assets referenced by CSS `url()` and `@import`
- `srcset`, `<picture>`, inline-style and common metadata images
- static JavaScript imports and common asset references

## Whole-site discovery

SiteFyer starts from the supplied URL and performs a breadth-first crawl of in-scope public pages. It also checks `robots.txt`, `/sitemap.xml`, `/sitemap_index.xml`, nested sitemap indexes, CSS imports, JavaScript module imports and page assets. External CDN assets can be included without turning external websites into crawl targets.

No crawler can discover a route that the public website never links, lists in a sitemap, or exposes in downloadable source. V1 also does not execute complex web applications to discover content created only after browser interaction.

## Interruption recovery

Every downloaded response and the live crawl queue are checkpointed in IndexedDB. If the connection drops, SiteFyer waits for the browser to report that the internet is available and then continues. If the tab or browser closes, reopening SiteFyer presents a Resume Mirror card.

The service worker caches the SiteFyer application shell. Checkpoints are specific to the browser and device that started the mirror. Clearing site data removes them.

## Browser and CORS reality

GitHub Pages is static hosting. Browsers prevent a page from reading most unrelated websites unless the target permits CORS or a compatible proxy fetches the public resource. SiteFyer therefore tries:

1. direct CORS access;
2. an optional user-supplied proxy;
3. multiple public fallback routes.

Public fallback proxies can impose file-size, rate or availability limits. For dependable production use or very large sites, a dedicated SiteFyer proxy should be deployed later. SiteFyer sends no cookies or login credentials and blocks local/private-network targets.

## Run through GitHub Pages

The repository includes a Pages deployment workflow. In GitHub, open **Settings → Pages** and choose **GitHub Actions** as the source if it is not already enabled. The expected site address is:

`https://mandlalee.github.io/SiteFyer/`

## Local development

Serve the repository with any static web server. Opening `index.html` directly with `file://` is not recommended because service workers and browser module rules require HTTP or HTTPS.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Output

The ZIP contains:

- the mirrored website folder structure;
- locally rewritten HTML, CSS, supported JavaScript imports and manifest paths;
- `sitefyer-manifest.json`, listing every source URL, local path, status, size and failure;
- `README_OFFLINE.txt`.

## V1 boundaries

SiteFyer mirrors publicly delivered files. It does not log into websites, bypass paywalls, reproduce private backends, download protected streams, or guarantee perfect reconstruction of highly dynamic applications.
