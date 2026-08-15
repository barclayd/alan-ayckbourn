#!/usr/bin/env node
/**
 * Pulls Alan's two official feeds down to static JSON, once, so the site can
 * stay a pile of files on a CDN.
 *
 *   Instagram   instagram.com/ayckbourn_playwright — 404 posts, curated by the
 *               archivist, most of them carousels with a paragraph of caption
 *   YouTube     @AlanAyckbournPlaywright — 53 videos
 *
 * Neither has an official read API we can use. Instagram's Basic Display API
 * was switched off in December 2024 and the Graph API that replaced it wants a
 * token belonging to whoever owns the account, which is not us; YouTube's Data
 * API wants a key and its RSS feed stops at the latest fifteen. So both come
 * from the endpoints the sites' own front-ends call, unauthenticated, once, and
 * the answer is committed. Nothing is fetched at build time and nothing is
 * fetched at page view.
 *
 * Instagram's image URLs are signed and expire within days, so the pictures are
 * copied into R2 the same way the blog's are. YouTube's thumbnails are not —
 * `i.ytimg.com/vi/{id}/hqdefault.jpg` is permanent — so those stay hotlinked.
 *
 * Usage:
 *   node scripts/social.mjs                # both feeds, images to R2
 *   node scripts/social.mjs --no-upload    # skip R2 (offline / iterating)
 *   node scripts/social.mjs --instagram    # one feed only
 *   node scripts/social.mjs --youtube
 *
 * Everything fetched is cached under .cache/social/, so a re-run costs nothing.
 */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const run = promisify(execFile);

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache/social');
const DATA = join(ROOT, 'src/data');

const HANDLE = 'ayckbourn_playwright';
const CHANNEL = 'UCw_wK39Pa4Hnfziu9On5nNg';
const CHANNEL_URL = 'https://www.youtube.com/@AlanAyckbournPlaywright';

/** Public bucket, shared with the blog's images. */
const BUCKET = 'ayckbourn-media';
const R2 = 'https://pub-4c23c36058c0491eaa4d6d55c25b33de.r2.dev';
const UPLOAD_CONCURRENCY = 8;

/* Instagram's web front-end identifies itself with a fixed app id and refuses
   anything that does not look like its own fetch(). The header set is the
   whole of what it checks — without `sec-fetch-site` the feed endpoint answers
   "SecFetch Policy violation" rather than 200. */
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IG_HEADERS = {
  'user-agent': UA,
  'x-ig-app-id': '936619743392459',
  'sec-fetch-site': 'same-origin',
  'sec-fetch-mode': 'cors',
  'sec-fetch-dest': 'empty',
  referer: `https://www.instagram.com/${HANDLE}/`,
};

const upload = !process.argv.includes('--no-upload');
const only = process.argv.find((a) => a === '--instagram' || a === '--youtube');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Fetches once, then never again: the cache is the record of what was pulled. */
async function cached(key, fetcher, { binary = false } = {}) {
  const path = join(CACHE, key);
  try {
    return await readFile(path, binary ? null : 'utf8');
  } catch {
    const body = await fetcher();
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
    return body;
  }
}

const json = async (key, fetcher) => JSON.parse(await cached(key, fetcher));

/* ------------------------------------------------------------- instagram --- */

/**
 * Every post, newest first, twelve at a time.
 *
 * The profile page's own JSON gives the first twelve, but its posts carry no
 * carousel children — a twelve-picture post arrives as one cover image. The
 * `/api/v1/feed/user/` endpoint the app calls gives both the children and the
 * cursor, so that is the one used throughout and the profile call is only for
 * the post count the progress line counts towards.
 *
 * Addressed by handle rather than by account id: the id route answers 401
 * "Please wait a few minutes" to anyone not logged in, and the handle route,
 * which is what the profile grid itself calls, does not.
 */
async function instagramPosts() {
  const profile = await json('profile.json', async () => {
    const res = await fetch(
      `https://www.instagram.com/api/v1/users/web_profile_info/?username=${HANDLE}`,
      { headers: IG_HEADERS },
    );
    if (!res.ok) {
      throw new Error(`profile: ${res.status}`);
    }
    return res.text();
  });

  const total = profile.data.user.edge_owner_to_timeline_media.count;
  const items = [];
  let cursor = '';

  for (let page = 0; ; page++) {
    const body = await json(`feed/${page}.json`, async () => {
      const url = new URL(
        `https://www.instagram.com/api/v1/feed/user/${HANDLE}/username/`,
      );
      url.searchParams.set('count', '12');
      if (cursor) {
        url.searchParams.set('max_id', cursor);
      }

      /* Thirty-four pages is enough to trip a rate limit, and the answer when
         it trips is "please wait a few minutes" — so wait, doubling, rather
         than give up thirty pages in and start again from nothing. */
      for (let attempt = 0; ; attempt++) {
        await sleep(1000 * 2 ** attempt);
        const res = await fetch(url, { headers: IG_HEADERS });
        if (res.ok) {
          return res.text();
        }
        if (attempt === 6) {
          throw new Error(`feed page ${page}: ${res.status}`);
        }
        process.stdout.write(`\n  instagram: ${res.status}, waiting\n`);
      }
    });

    items.push(...(body.items ?? []));
    process.stdout.write(`  instagram: ${items.length}/${total}\r`);
    if (!body.more_available || !body.next_max_id) {
      break;
    }
    cursor = body.next_max_id;
  }

  process.stdout.write('\n');
  return items;
}

/** The largest version Instagram offers of one image. */
const largest = (candidates) =>
  [...candidates].sort((a, b) => b.width - a.width)[0];

/**
 * One post's pictures, whether it is a single image, a video or a carousel.
 *
 * Videos are kept as their poster frame and a link out. The archive has no
 * business re-hosting somebody's video, and a still with the caption under it
 * is what the rest of the page already is.
 */
function picturesOf(item) {
  const children = item.carousel_media ?? [item];
  return children.map((child) => {
    const image = largest(child.image_versions2.candidates);
    return {
      src: image.url,
      width: image.width,
      height: image.height,
      /* Instagram's own generated description, where the account has not
         written one. It is the only alt text these pictures have. */
      alt: child.accessibility_caption ?? '',
      video: Boolean(child.video_versions),
    };
  });
}

/* ------------------------------------------------------------- youtube ----- */

/**
 * Every video on the channel.
 *
 * The videos tab renders the first thirty into a `ytInitialData` blob and hands
 * the rest to its own browse endpoint behind a continuation token, so this
 * reads the blob, then follows the token until it stops coming back.
 */
async function youtubeVideos() {
  const html = await cached('channel.html', async () => {
    const res = await fetch(`${CHANNEL_URL}/videos`, {
      headers: { 'user-agent': UA },
    });
    if (!res.ok) {
      throw new Error(`channel: ${res.status}`);
    }
    return res.text();
  });

  const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const version = html.match(/"clientVersion":"([\d.]+)"/)?.[1];
  const pages = [
    JSON.parse(html.match(/var ytInitialData = (\{.+?\});<\/script>/s)[1]),
  ];
  let token = html.match(/"continuationCommand":\{"token":"([^"]+)"/)?.[1];

  for (let page = 0; token; page++) {
    const next = token;
    const body = await json(`browse/${page}.json`, async () => {
      const res = await fetch(
        `https://www.youtube.com/youtubei/v1/browse?key=${key}`,
        {
          method: 'POST',
          headers: { 'user-agent': UA, 'content-type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: version } },
            continuation: next,
          }),
        },
      );
      if (!res.ok) {
        throw new Error(`browse ${page}: ${res.status}`);
      }
      return res.text();
    });
    pages.push(body);
    token = JSON.stringify(body).match(
      /"continuationCommand":\{"token":"([^"]+)"/,
    )?.[1];
  }

  /* One `lockupViewModel` per video, wherever the shelf it sits in has put it.
     Walking for the shape rather than the path: the videos tab keeps moving its
     grid between `richGridRenderer` and `reloadContinuationItemsCommand`, and
     every one of them holds the same lockups inside. */
  const found = new Map();
  const walk = (node) => {
    if (Array.isArray(node)) {
      return node.forEach(walk);
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const lockup = node.lockupViewModel;
    if (lockup?.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO') {
      found.set(lockup.contentId, lockup);
    }
    for (const value of Object.values(node)) {
      walk(value);
    }
  };
  walk(pages);
  return [...found.values()].map(read);
}

/**
 * The four things a lockup says about a video, dug out of the view models it
 * says them in. Everything else in there is a menu.
 */
function read(lockup) {
  const meta = lockup.metadata.lockupMetadataViewModel;
  const parts =
    meta.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts ??
    [];
  const badge = lockup.contentImage?.thumbnailViewModel?.overlays
    ?.flatMap(
      (overlay) => overlay.thumbnailBottomOverlayViewModel?.badges ?? [],
    )
    .find((b) => b.thumbnailBadgeViewModel?.text);
  return {
    id: lockup.contentId,
    title: meta.title?.content ?? '',
    /* "87 views" and "1 year ago", in that order, and sometimes neither. */
    views: parts[0]?.text?.content ?? '',
    ago: parts[1]?.text?.content ?? '',
    /* "4:37", missing on a premiere that never got one. */
    length: badge?.thumbnailBadgeViewModel?.text ?? '',
  };
}

/**
 * The date and the description, from the video's own page.
 *
 * The grid says "3 years ago", which sorts nothing and dates nothing, and the
 * channel's RSS feed only carries the latest fifteen. The watch page carries
 * both a real timestamp and the description the archivist wrote — which is
 * usually a paragraph saying what the talk was and when it was given, and is
 * the whole reason the page is worth reading rather than just watching.
 */
async function youtubeDetail(id) {
  const html = await cached(`watch/${id}.html`, async () => {
    const res = await fetch(`https://www.youtube.com/watch?v=${id}`, {
      headers: { 'user-agent': UA },
    });
    if (!res.ok) {
      throw new Error(`watch ${id}: ${res.status}`);
    }
    return res.text();
  });
  /* JSON-escaped inside the page's own script, so it comes back out the same
     way rather than by unescaping \n and \" by hand. */
  const raw = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/)?.[1];
  return {
    published: html.match(/"uploadDate":"([^"]+)"/)?.[1] ?? null,
    description: raw ? JSON.parse(`"${raw}"`).trim() : '',
  };
}

/* ------------------------------------------------------------- images ------ */

/**
 * An Instagram picture, resized to what the page actually shows and put in R2.
 *
 * 1400px because the feed sets its images across the reading measure on a
 * 2× screen and nothing on the page is wider; Instagram serves 1080 anyway, so
 * this is a ceiling rather than an upscale. WebP because these are photographs
 * of photographs and nobody is going to print one.
 */
async function store(url) {
  const key = `instagram/${new URL(url).pathname
    .split('/')
    .pop()
    .replace(/\.[^.]+$/, '')}.webp`;
  const file = join(CACHE, 'media', key);
  const meta = await json(`meta/${key}.json`, async () => {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) {
      throw new Error(`${res.status} ${url}`);
    }
    const out = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize({ width: 1400, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, out.data);
    return JSON.stringify({ width: out.info.width, height: out.info.height });
  });
  return { key, url: `${R2}/${key}`, ...meta };
}

async function uploadAll(keys) {
  const done = new Set(
    JSON.parse(await cached('uploaded.json', async () => '[]')),
  );
  const pending = keys.filter((key) => !done.has(key));
  let n = 0;
  const worker = async () => {
    for (let i = n++; i < pending.length; i = n++) {
      await run('bunx', [
        'wrangler',
        'r2',
        'object',
        'put',
        `${BUCKET}/${pending[i]}`,
        '--file',
        join(CACHE, 'media', pending[i]),
        '--remote',
      ]);
      done.add(pending[i]);
      process.stdout.write(`  uploaded ${done.size}/${keys.length}\r`);
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker)).finally(
    () => writeFile(join(CACHE, 'uploaded.json'), JSON.stringify([...done])),
  );
  if (pending.length) {
    process.stdout.write('\n');
  }
  return pending.length;
}

/* ------------------------------------------------------------- main -------- */

async function instagram() {
  const posts = await instagramPosts();

  const out = [];
  for (const item of posts) {
    const pictures = [];
    for (const picture of picturesOf(item)) {
      const stored = await store(picture.src);
      pictures.push({
        src: stored.url,
        width: stored.width,
        height: stored.height,
        alt: picture.alt,
        video: picture.video,
      });
    }
    out.push({
      id: item.code,
      href: `https://www.instagram.com/p/${item.code}/`,
      date: new Date(item.taken_at * 1000).toISOString(),
      caption: item.caption?.text?.trim() ?? '',
      pictures,
    });
    process.stdout.write(`  images: ${out.length}/${posts.length}\r`);
  }
  process.stdout.write('\n');

  if (upload) {
    await uploadAll(
      out.flatMap((post) =>
        post.pictures.map((p) => new URL(p.src).pathname.slice(1)),
      ),
    );
  }

  await writeFile(
    join(DATA, 'instagram.json'),
    `${JSON.stringify({ handle: HANDLE, updated: new Date().toISOString(), posts: out }, null, 2)}\n`,
  );
  console.log(
    `instagram: ${out.length} posts, ${out.reduce((n, p) => n + p.pictures.length, 0)} pictures`,
  );
}

async function youtube() {
  const videos = await youtubeVideos();

  const out = [];
  for (const video of videos) {
    out.push({
      ...video,
      href: `https://www.youtube.com/watch?v=${video.id}`,
      ...(await youtubeDetail(video.id)),
    });
    process.stdout.write(`  youtube: ${out.length}/${videos.length}\r`);
  }
  process.stdout.write('\n');

  /* Newest first, which is the channel's own order until a video is re-dated. */
  out.sort((a, b) => (b.published ?? '').localeCompare(a.published ?? ''));

  await writeFile(
    join(DATA, 'youtube.json'),
    `${JSON.stringify({ channel: CHANNEL, url: CHANNEL_URL, updated: new Date().toISOString(), videos: out }, null, 2)}\n`,
  );
  console.log(
    `youtube: ${out.length} videos, ${out.filter((v) => v.published).length} dated`,
  );
}

if (!only || only === '--instagram') {
  await instagram();
}
if (!only || only === '--youtube') {
  await youtube();
}
