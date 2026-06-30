import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import CryptoJS from 'crypto-js';
import yt from '@vreden/youtube_scraper';
import crypto from 'crypto';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BASE_YOUTUBE = "https://youtubedl.siputzx.my.id";
const APIKEY = null;

function solvePow(challenge, difficulty) {
  let nonce = 0;
  const prefix = "0".repeat(Number(difficulty));

  while (true) {
    const hash = crypto
      .createHash("sha256")
      .update(challenge + nonce.toString())
      .digest("hex");

    if (hash.startsWith(prefix)) {
      return nonce.toString();
    }

    nonce++;

    if (nonce > 10000000) {
      throw new Error("PoW solving timeout");
    }
  }
}

function createClient() {
  const jar = new CookieJar();

  return wrapper(
    axios.create({
      jar,
      withCredentials: true,
      timeout: 60000,
      validateStatus: () => true,
      headers: {
        Accept: "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36",
        Origin: BASE_YOUTUBE,
        Referer: `${BASE_YOUTUBE}/`,
        "X-Request-Id": crypto.randomUUID()
      }
    })
  );
}

function normalizeType(type) {
  return type === "audio" || type === "mp3" ? "audio" : "merge";
}

async function downloadWithExternalAPI(type, url, apikey = null) {
  const client = createClient();
  const downloadType = normalizeType(type);

  if (!apikey) {
    const challengeRes = await client.post(`${BASE_YOUTUBE}/akumaudownload`, {
      url,
      type: downloadType
    });

    if (challengeRes.status !== 200) {
      throw new Error(`Challenge ${downloadType} gagal HTTP ${challengeRes.status}`);
    }

    const { challenge, difficulty } = challengeRes.data || {};

    if (!challenge || !difficulty) {
      throw new Error(`Challenge ${downloadType} tidak ditemukan`);
    }

    const nonce = solvePow(challenge, difficulty);

    const verifyRes = await client.post(`${BASE_YOUTUBE}/cekpunyaku`, {
      url,
      type: downloadType,
      nonce
    });

    if (verifyRes.status !== 200) {
      throw new Error(`Verify ${downloadType} gagal HTTP ${verifyRes.status}`);
    }
  }

  for (let attempts = 0; attempts < 30; attempts++) {
    const downloadRes = await client.get(`${BASE_YOUTUBE}/download`, {
      params: {
        url,
        type: downloadType,
        apikey
      }
    });

    const data = downloadRes.data || {};

    if (data.status === "completed" && data.fileUrl) {
      return `${BASE_YOUTUBE}${data.fileUrl}`;
    }

    if (data.status === "failed") {
      throw new Error(data.error || `Download ${downloadType} failed`);
    }

    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  throw new Error(`Download ${downloadType} timeout`);
}

function getYoutubeId(url) {
  return (
    url.match(/youtu\.be\/([^?&/]+)/)?.[1] ||
    url.match(/[?&]v=([^?&]+)/)?.[1] ||
    url.match(/shorts\/([^?&/]+)/)?.[1] ||
    null
  );
}

function cleanMetadata(metadata = {}, inputUrl = null) {
  const thumbnails = Array.isArray(metadata?.thumbnails)
    ? metadata.thumbnails
    : [];

  const bestThumbnail =
    thumbnails.find(v => v.quality === "maxres")?.url ||
    thumbnails.find(v => v.quality === "standard")?.url ||
    thumbnails.find(v => v.quality === "high")?.url ||
    thumbnails.at(-1)?.url ||
    metadata?.thumbnail ||
    metadata?.image ||
    metadata?.thumb ||
    null;

  const id = metadata?.id || metadata?.videoId || getYoutubeId(inputUrl);

  return {
    title: metadata?.title || null,
    author:
      metadata?.author?.name ||
      metadata?.author ||
      metadata?.channel_title ||
      metadata?.channel ||
      null,
    views:
      metadata?.statistics?.view
        ? Number(metadata.statistics.view)
        : metadata?.views || metadata?.viewCount || null,
    thumbnail: bestThumbnail,
    url:
      metadata?.url ||
      metadata?.videoUrl ||
      (id ? `https://youtube.com/watch?v=${id}` : inputUrl)
  };
}

async function getMetadata(url) {
  try {
    const data = await yt.metadata(url);
    return cleanMetadata(data, url);
  } catch {
    return cleanMetadata({}, url);
  }
}

async function scrapeYouTube(url) {
  try {
    if (!url) {
      throw new Error("URL kosong");
    }

    const youtubeRegex = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|music\.youtube\.com)\/.+$/;

    if (!youtubeRegex.test(url)) {
      throw new Error("URL YouTube tidak valid");
    }

    const [metadata, urlVideo, urlAudio] = await Promise.all([
      getMetadata(url),
      downloadWithExternalAPI("video", url, APIKEY),
      downloadWithExternalAPI("mp3", url, APIKEY)
    ]);

    const download = {};
    const allFormats = [];

    if (urlVideo) {
      download.video = [urlVideo];
      allFormats.push({
        type: 'video',
        format: 'mp4',
        quality: '720p'
      });
    }

    if (urlAudio) {
      download.audio = urlAudio;
      allFormats.push({
        type: 'audio',
        format: 'mp3',
        quality: '128kbps'
      });
    }

    if (metadata?.thumbnail) {
      download.thumb = metadata.thumbnail;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {
            playCount: metadata?.views || 0,
            likeCount: 0
          },
          title: metadata?.title || 'YouTube Video',
          description: metadata?.author || '',
        },
        download: download,
        allFormats: allFormats
      }
    };
  } catch (error) {
    return { error: "youtube.fetch.fail", message: error.message };
  }
}

async function scrapeTikTok(url) {
  try {
    const BASE = "https://musicaldown.com";
    const HOME = `${BASE}/id`;
    const UA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36";

    const jar = new CookieJar();
    const client = wrapper(
      axios.create({
        jar,
        withCredentials: true,
        timeout: 60000,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
          "user-agent": UA,
          "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7"
        }
      })
    );

    function absoluteUrl(url) {
      if (!url) return null;
      if (url.startsWith("http")) return url;
      return new URL(url, BASE).href;
    }

    function cleanText(text = "") {
      return text
        .replace(/arrow_downward/gi, "")
        .replace(/content_paste/gi, "")
        .replace(/close/gi, "")
        .trim()
        .replace(/\s+/g, " ");
    }

    function parseBackgroundImage(style = "") {
      const match = style.match(/url\((.*?)\)/i);
      if (!match) return null;
      return match[1].replace(/^["']|["']$/g, "");
    }

    function stripDownloadTitle(title = "") {
      return cleanText(title)
        .replace(/\s*\|\s*Download Sekarang!?$/i, "")
        .replace(/\s*\|\s*Download Now!?$/i, "")
        .trim();
    }

    async function getFormData(url) {
      const res = await client.get(HOME, {
        headers: {
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          referer: HOME,
          "cache-control": "max-age=0",
          "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": '"Android"',
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "navigate",
          "sec-fetch-user": "?1",
          "sec-fetch-dest": "document",
          "upgrade-insecure-requests": "1"
        }
      });

      if (res.status !== 200) {
        throw new Error(`Gagal buka home HTTP ${res.status}`);
      }

      const html = String(res.data || "");
      const $ = cheerio.load(html);

      const form = $("#submit-form").first();
      const action = absoluteUrl(form.attr("action") || "/id/download");
      const urlField = form.find('input[type="text"][name]').first().attr("name");

      if (!urlField) {
        throw new Error("Field URL tidak ditemukan");
      }

      const body = new URLSearchParams();
      body.set(urlField, url);

      form.find('input[type="hidden"][name]').each((_, el) => {
        const name = $(el).attr("name");
        const value = $(el).attr("value") || "";
        if (name) {
          body.set(name, value);
        }
      });

      return { action, body };
    }

    function parseMetadata($) {
      const rawTitle = cleanText($("title").first().text());
      const bgStyle = $(".video-header").attr("style") || "";

      const author = cleanText($(".video-author").first().text()) ||
        cleanText($(".author").first().text()) ||
        cleanText($("[class*=author]").first().text()) || null;

      const description = cleanText($(".video-desc").first().text()) ||
        cleanText($(".desc").first().text()) ||
        cleanText($("[class*=desc]").first().text()) ||
        cleanText($("meta[property='og:description']").attr("content")) ||
        cleanText($("meta[name='description']").attr("content")) || null;

      const thumbnail = parseBackgroundImage(bgStyle) ||
        $(".img-area img").first().attr("src") ||
        $("meta[property='og:image']").attr("content") ||
        $("meta[name='twitter:image']").attr("content") || null;

      const metadata = {
        title: stripDownloadTitle(rawTitle) || rawTitle || null,
        full_title: rawTitle || null,
        author,
        description,
        thumbnail
      };

      Object.keys(metadata).forEach(key => {
        if (!metadata[key]) delete metadata[key];
      });

      return metadata;
    }

    function getLinkType(text, event, url) {
      const source = `${text} ${event} ${url}`;

      if (event === "mp4_download_click" || /^Download MP4$/i.test(text)) {
        return "video";
      }

      if (event === "hd_download_click" || /\[HD\]/i.test(text)) {
        return "video_hd";
      }

      if (event === "watermark_download_click" || /watermark/i.test(text)) {
        return "video_watermark";
      }

      if (event === "mp3_download_click" || /mp3|audio|sound/i.test(source)) {
        return "audio";
      }

      if (/jpg|jpeg|png|webp|image|photo|slide/i.test(source)) {
        return "photo";
      }

      return null;
    }

    function getOrder(type) {
      const order = {
        video_hd: 1,
        video: 2,
        video_watermark: 3,
        photo: 4,
        audio: 99
      };
      return order[type] || 50;
    }

    function addUnique(result, item) {
      if (!item.url) return;
      const exists = result.some(v => v.url === item.url);
      if (!exists) {
        result.push(item);
      }
    }

    function parseResult(html) {
      const $ = cheerio.load(html);
      const metadata = parseMetadata($);
      const result = [];

      $("a[href]").each((_, el) => {
        const href = $(el).attr("href");
        const label = cleanText($(el).text());
        const event = $(el).attr("data-event") || "";

        if (!href) return;

        const url = absoluteUrl(href);

        if (!url.includes("fastdl.muscdn.app")) return;

        const type = getLinkType(label, event, url);

        if (!type) return;

        addUnique(result, {
          type,
          label: label || type,
          url
        });
      });

      $("img[src]").each((_, el) => {
        const src = $(el).attr("src");
        if (!src) return;

        const url = absoluteUrl(src);

        if (url.includes("fastdl.muscdn.app/a/images") || url.includes("tiktokcdn")) {
          addUnique(result, {
            type: "photo",
            label: "Photo",
            url
          });
        }
      });

      $("[style]").each((_, el) => {
        const bg = parseBackgroundImage($(el).attr("style") || "");
        if (!bg) return;

        const url = absoluteUrl(bg);

        if (url.includes("fastdl.muscdn.app/a/images") || url.includes("tiktokcdn")) {
          addUnique(result, {
            type: "photo",
            label: "Photo",
            url
          });
        }
      });

      result.sort((a, b) => getOrder(a.type) - getOrder(b.type));

      return {
        metadata,
        result,
        hasResult: result.length > 0
      };
    }

    const form = await getFormData(url);

    const res = await client.post(form.action, form.body.toString(), {
      headers: {
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "content-type": "application/x-www-form-urlencoded",
        origin: BASE,
        referer: HOME,
        "cache-control": "max-age=0",
        "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
        "sec-ch-ua-mobile": "?1",
        "sec-ch-ua-platform": '"Android"',
        "sec-fetch-site": "same-origin",
        "sec-fetch-mode": "navigate",
        "sec-fetch-user": "?1",
        "sec-fetch-dest": "document",
        "upgrade-insecure-requests": "1"
      }
    });

    const html = String(res.data || "");

    if (html.includes('id="submit-form"') && !html.includes("fastdl.muscdn.app")) {
      return {
        status: false,
        error: "MusicalDown balik ke halaman home, tidak ada link download di response."
      };
    }

    const parsed = parseResult(html);

    const download = {};
    const allFormats = [];

    parsed.result.forEach(item => {
      if (item.type === 'video' || item.type === 'video_hd' || item.type === 'video_watermark') {
        if (!download.video) download.video = [];
        download.video.push(item.url);
        allFormats.push({
          type: 'video',
          format: 'mp4',
          quality: item.type === 'video_hd' ? 'HD' : item.type === 'video_watermark' ? 'Watermark' : 'SD'
        });
      } else if (item.type === 'audio') {
        download.audio = item.url;
        allFormats.push({
          type: 'audio',
          format: 'mp3',
          quality: '128kbps'
        });
      } else if (item.type === 'photo') {
        if (!download.photo) download.photo = [];
        download.photo.push(item.url);
        allFormats.push({
          type: 'photo',
          format: 'jpeg',
          quality: 'HD'
        });
      }
    });

    if (parsed.metadata?.thumbnail) {
      download.thumb = parsed.metadata.thumbnail;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {
            playCount: 0,
            likeCount: 0
          },
          title: parsed.metadata?.title || 'TikTok Video',
          description: parsed.metadata?.description || '',
        },
        download: download,
        allFormats: allFormats
      }
    };
  } catch (error) {
    return { error: "tiktok.fetch.fail", message: error.message };
  }
}

async function scrapeInstagram(url) {
  try {
    const ts = Math.floor(Date.now() / 1000);
    const tt = CryptoJS.MD5(ts + 'X-Fc-Pp-Ty-eZ').toString();

    const body = new URLSearchParams();
    body.append('id', url);
    body.append('locale', 'en');
    body.append('cf-turnstile-response', '');
    body.append('tt', tt);
    body.append('ts', ts.toString());

    const response = await axios.post('https://reelsvideo.io/', body, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'hx-request': 'true',
        'hx-current-url': 'https://reelsvideo.io/',
        'hx-target': 'target',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Origin': 'https://reelsvideo.io',
        'Referer': 'https://reelsvideo.io/'
      }
    });
    
    const $ = cheerio.load(response.data);

    const username = $('.bg-white span.text-400-16-18').first().text().trim() || null;
    const thumb = $('div[data-bg]').first().attr('data-bg') || null;

    const videos = [];
    $('a.type_videos').each((i, el) => {
      const href = $(el).attr('href');
      if (href) videos.push(href);
    });

    const images = [];
    $('a.type_images').each((i, el) => {
      const href = $(el).attr('href');
      if (href) images.push(href);
    });

    const mp3 = [];
    $('a.type_audio').each((i, el) => {
      const href = $(el).attr('href');
      const id = $(el).attr('data-id');
      if (href && id) {
        mp3.push({ id, url: href });
      }
    });

    const download = {};
    if (videos.length > 0) download.video = videos;
    if (images.length > 0) download.photo = images;
    if (mp3.length > 0) download.audio = mp3[0].url;
    if (thumb) download.thumb = thumb;

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: username || 'Instagram Post',
          description: '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "instagram.fetch.fail", message: error.message };
  }
}

async function scrapeFacebook(url) {
  try {
    const encodedUrl = encodeURIComponent(url);
    const formData = `url=${encodedUrl}&lang=en&type=redirect`;

    const response = await axios.post("https://getvidfb.com/", formData, {
      headers: {
        'authority': 'getvidfb.com',
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
        'cache-control': 'max-age=0',
        'content-type': 'application/x-www-form-urlencoded',
        'origin': 'https://getvidfb.com',
        'referer': 'https://getvidfb.com/',
        'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'same-origin',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36'
      },
      timeout: 30000,
    });

    const $ = cheerio.load(response.data);
    
    const videoContainer = $('#snaptik-video');
    if (!videoContainer.length) {
      throw new Error("Video container not found");
    }

    const thumb = videoContainer.find('.snaptik-left img').attr('src');
    const title = videoContainer.find('.snaptik-middle h3').text().trim();

    const videoLinks = [];
    const audioLinks = [];

    videoContainer.find('.abuttons a').each((_, el) => {
      const link = $(el).attr('href');
      const spanText = $(el).find('.span-icon span').last().text().trim();
      
      if (link && spanText && link.startsWith('http')) {
        if (spanText.includes('Mp3') || spanText.includes('Audio')) {
          audioLinks.push(link);
        } else {
          videoLinks.push(link);
        }
      }
    });

    const download = {};
    if (videoLinks.length > 0) download.video = videoLinks;
    if (audioLinks.length > 0) download.audio = audioLinks[0];
    if (thumb) download.thumb = thumb;

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: title || 'Facebook Video',
          description: '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "facebook.fetch.fail", message: error.message };
  }
}

async function scrapeTwitter(url) {
  try {
    const { data: html } = await axios.get("https://snaptwitter.com/");
    const $tok = cheerio.load(html);
    const tokenValue = $tok('input[name="token"]').attr("value");

    const formData = new URLSearchParams();
    formData.append("url", url);
    formData.append("token", tokenValue || "");

    const response = await axios.post("https://snaptwitter.com/action.php", formData, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" }
    });
    
    const $ = cheerio.load(response.data.data);

    const imgUrl = $(".videotikmate-left img").attr("src");
    const downloadLink = $(".abuttons a").attr("href");
    const videoTitle = $(".videotikmate-middle h1").text().trim();

    const download = {};
    if (downloadLink) {
      download.video = [downloadLink];
    }
    if (imgUrl) {
      download.thumb = imgUrl;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: videoTitle || 'Twitter Video',
          description: '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "twitter.fetch.fail", message: error.message };
  }
}

async function scrapeSpotify(url) {
  try {
    const res = await axios.get('https://spotmate.online/en1', {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
      }
    });

    const $ = cheerio.load(res.data);
    const token = $('meta[name="csrf-token"]').attr('content');
    const cookies = res.headers['set-cookie'] || [];
    const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

    const session = { token, cookieStr };

    const trackRes = await axios.post('https://spotmate.online/getTrackData',
      { spotify_url: url },
      {
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': session.token,
          'cookie': session.cookieStr,
          'origin': 'https://spotmate.online',
          'referer': 'https://spotmate.online/en1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
        }
      }
    );

    const trackInfo = trackRes.data;

    if (!trackInfo || trackInfo.status === 'error') {
      throw new Error('Failed to get track info');
    }

    const convertRes = await axios.post('https://spotmate.online/convert',
      { urls: url },
      {
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': session.token,
          'cookie': session.cookieStr,
          'origin': 'https://spotmate.online',
          'referer': 'https://spotmate.online/en1',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
        }
      }
    );

    const convertInfo = convertRes.data;
    const image = trackInfo.album?.images?.[0]?.url || '';

    let downloadUrl = null;

    if (convertInfo.error === false && convertInfo.url) {
      downloadUrl = convertInfo.url;
    } else {
      const taskid = convertInfo.task_id || convertInfo.taskid;
      if (taskid) {
        let taskResult;
        let attempts = 0;
        do {
          await new Promise(r => setTimeout(r, 3000));
          const taskRes = await axios.get(`https://spotmate.online/tasks/${taskid}`, {
            headers: {
              'x-csrf-token': session.token,
              'cookie': session.cookieStr,
              'origin': 'https://spotmate.online',
              'referer': 'https://spotmate.online/en1',
              'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
            }
          });
          taskResult = taskRes.data;
          attempts++;
        } while (attempts < 10 && taskResult && (taskResult.status === 'pending' || taskResult.status === 'processing'));
        
        if (taskResult && taskResult.url) {
          downloadUrl = taskResult.url;
        }
      }
    }

    const download = {};
    if (downloadUrl) {
      download.audio = downloadUrl;
    }
    if (image) {
      download.thumb = image;
    }

    return {
      success: true,
      data: {
        metadata: {
          stats: {},
          title: trackInfo.name || 'Spotify Track',
          description: trackInfo.artists?.[0]?.name || '',
        },
        download: download
      }
    };
  } catch (error) {
    return { error: "spotify.fetch.fail", message: error.message };
  }
}

app.post('/api/tiktok', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeTikTok(url);
    
    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/youtube', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeYouTube(url);
    
    if (result.error) {
      return res.status(400).json({ success: false, error: result.error });
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/instagram', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeInstagram(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/facebook', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeFacebook(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/twitter', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeTwitter(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/spotify', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required' });
    }

    const result = await scrapeSpotify(url);
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const { url, type } = req.query;
    if (!url) {
      return res.status(400).send('URL konten tidak valid');
    }

    const response = await axios({
      url: url,
      method: 'GET',
      responseType: 'stream',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Referer': 'https://www.tiktok.com/'
      }
    });
    
    const filename = `media_${Date.now()}`;
    let ext = '.mp4';
    if (type === 'mp3') ext = '.mp3';
    if (type === 'photo') ext = '.jpeg';
    
    res.setHeader('Content-Disposition', `attachment; filename="${filename}${ext}"`);
    response.data.pipe(res);
  } catch (error) {
    res.status(500).send('Gagal mengunduh file media');
  }
});

app.get('/api/platforms', (req, res) => {
  res.json({
    platforms: ['tiktok', 'youtube', 'instagram', 'facebook', 'twitter', 'spotify']
  });
});

export default app;
