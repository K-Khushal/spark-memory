# Social posts: X, TikTok and Instagram (#20)

Checked 12 November 2026. Sources are the platforms' own documents; two of them
say less than the behaviour we rely on, which is marked. Nothing here logs in on
the server, uses uploaded cookies or calls a private API from Spark's servers
(ADR-0010).

## What each platform's oEmbed returns

| Platform  | Endpoint Spark calls                                                  | Auth                                | Fields Spark reads                                                                 |
| --------- | --------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------- |
| X         | `https://publish.x.com/oembed?omit_script=1&dnt=1&url=…`              | none, "not rate limited" (docs)     | `author_name`, `author_url`, `html` (the post's words as a blockquote), `provider_name` |
| TikTok    | `https://www.tiktok.com/oembed?url=…`                                 | none                                | `title`, `author_name`, `thumbnail_url` (the docs' example lists `html` and `thumbnail_url`; the others are seen in practice, not documented) |
| Instagram | `https://graph.facebook.com/v27.0/instagram_oembed?url=…`             | none since May 2026 (Meta's changelog; the June 2026 blog post says the same of all Meta oEmbed) | `html` only is documented (`version`, `provider_name`, `provider_url`, `html`, `width`, `type`). No author, title or thumbnail. |

- **X moved its host.** The docs now name `publish.x.com`; `publish.twitter.com`
  was the one in `gather.ts` before this change. Both `x.com` and `twitter.com`
  post URLs are accepted. Replies, quotes, protected and deleted posts are not
  described; an answer that is not JSON is simply no oEmbed.
- **TikTok says oEmbed "will be deprecated soon"** in favour of an Embed Player,
  with existing integrations migrating. Short links (`vm.`, `vt.tiktok.com`) are
  not mentioned in the docs, so Spark follows the redirect through its own
  guarded fetch and asks oEmbed about the video it led to.
- **Instagram supports** posts (`/p/`), reels (`/reel/`) and profiles; not
  stories, private, inactive or age-restricted accounts, or accounts that
  turned Embeds off. 1,000 requests an hour is documented for the token route;
  Meta says tokenless limits "may differ".
- **Instagram's terms are the blocker, not the technology.** The docs say the
  endpoint's content may be used only "to provide a front-end view" and that
  "consuming, manipulating, extracting, or persisting the metadata and content"
  is "strictly prohibited". Spark keeps what it gathers as the Memory's
  metadata. So Instagram oEmbed is **off by default** (`INSTAGRAM_OEMBED`),
  and Instagram links use the public page's Open Graph tags like any other
  page. Turning it on is the owner's decision after reading Meta's Platform
  Terms; it is never used for AI opt-out and never sends a token or cookie
  (the tokenless route needs none).
- Since oEmbed for Instagram carries no author or caption outside its embed
  markup, even switched on it adds little; the extension is the real source
  (below).

## What a logged-out visitor's page gives a server

Open Graph tags from the page itself (`og:title`, `og:description`, `og:image`)
are what `gather.ts` already reads for every link. Instagram's `og:description`
is `N likes, M comments - handle on Date: "caption".`; X and TikTok pages are
JavaScript shells whose useful words arrive in oEmbed. All of this is
best-effort and can change without notice.

## What the extension reads

The extension's site adapters read only what the logged-in person can see, in
the page, with no request of their own (`apps/extension/lib/sites/`):

- **X**: the `article[data-testid="tweet"]` whose status link matches the URL
  (never a reply), its `tweetText`, `User-Name`, `time` and photo.
- **TikTok**: the page's own `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON
  (`webapp.video-detail.itemInfo.itemStruct`), else `data-e2e="browse-video-desc"`.
- **Instagram**: the `h1` caption, the header's author link and `time`, else
  the quoted caption in `og:description`.

These are undocumented, can break at any redesign, and were written against
saved DOM fixtures (`apps/extension/tests/fixtures/`) that approximate current
markup. **A real logged-in check on each site is an owner release step.** When
markup changes, an adapter returns nothing and the Capture falls back to the
generic reader and a screenshot (Reference only, with metadata).

## Instagram reels: the user-provided copy

Instagram serves reels to the browser through MSE, so the `<video>` has a
`blob:` source and there is no URL to download from the page. The adapter's
copy step, run in the tab with the person's own session, calls the same
`/api/v1/media/<id>/info/` the web app calls (shortcode → numeric id,
`x-ig-app-id` header), reads `video_versions`, and downloads the one nearest
720 px wide from `*.cdninstagram.com` or `*.fbcdn.net` only, without cookies,
up to the 25 MB upload limit. It draws up to eight frames at 540 px. This is a
private web endpoint: **unverified live from this sandbox** (no Instagram
login here), and expected to change. Failure at any step leaves the reel saved
as Reference only.

The copy goes to R2 through the existing presigned PUT flow, is read once for
a transcript (Gemini Flash-Lite on the paid tier, inline, so up to about 15 MB
of video; larger videos still get Visual vectors from their frames) and for
Visual vectors, then is deleted: immediately when Indexing ends (done or Failed),
within an hour by the sweep otherwise, and after 24 hours whatever happened.
A site adapter's Capture is marked (`site`), and its caption outranks what gathering finds of a login wall; every other page keeps the freshest gathered metadata. The transcript is model-written from the user's copy, so AI opt-out removes it.
