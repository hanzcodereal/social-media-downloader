import express from 'express';
import axios from 'axios';
import cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { wrapper } from 'axios-cookiejar-support';
import CryptoJS from 'crypto-js';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

class TikTokScraper {
  constructor() {
    this.genericUserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36";
  }

  decodeJWT(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (error) {
      return null;
    }
  }

  async getDownloadLinks(URL) {
    try {
      const response = await axios.get("https://musicaldown.com/en", {
        headers: {
          "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "max-age=0",
          referer: "https://musicaldown.com/download",
          "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132"',
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": '"Android"',
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1",
        },
      });

      const $ = cheerio.load(response.data);
      const url_name = $("#link_url").attr("name");
      const token_name = $("#submit-form > div").find("div:nth-child(1) > input[type=hidden]:nth-child(2)").attr("name");
      const token_ = $("#submit-form > div").find("div:nth-child(1) > input[type=hidden]:nth-child(2)").attr("value");
      const verify = $("#submit-form > div").find("div:nth-child(1) > input[type=hidden]:nth-child(3)").attr("value");

      if (!url_name || !token_name || !token_ || !verify) {
        throw new Error("Failed to extract form data");
      }

      const data = {
        [url_name]: URL,
        [token_name]: token_,
        verify: verify,
      };

      const respon = await axios.request({
        url: "https://musicaldown.com/download",
        method: "post",
        data: new URLSearchParams(Object.entries(data)),
        headers: {
          "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "accept-language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
          "cache-control": "max-age=0",
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://musicaldown.com",
          referer: "https://musicaldown.com/en",
          "sec-ch-ua": '"Not A(Brand";v="8", "Chromium";v="132"',
          "sec-ch-ua-mobile": "?1",
          "sec-ch-ua-platform": '"Android"',
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1",
          cookie: response.headers["set-cookie"]?.join("; "),
        },
      });

      const ch = cheerio.load(respon.data);
      let result = {};

      const hdLink = ch('a[data-event="hd_download_click"]').attr("href");
      const mp4Link = ch('a[data-event="mp4_download_click"]').attr("href");
      const watermarkLink = ch('a[data-event="watermark_download_click"]').attr("href");
      const mp3Link = ch('a[data-event="mp3_download_click"]').attr("href");

      const videoLinks = [];
      
      if (hdLink && hdLink.includes('token=')) {
        const token = hdLink.split('token=')[1];
        const decoded = this.decodeJWT(token);
        if (decoded && decoded.url) {
          videoLinks.push(decoded.url);
        }
      }

      if (mp4Link && mp4Link.includes('token=')) {
        const token = mp4Link.split('token=')[1];
        const decoded = this.decodeJWT(token);
        if (decoded && decoded.url) {
          videoLinks.push(decoded.url);
        }
      }

      if (watermarkLink && watermarkLink.includes('token=')) {
        const token = watermarkLink.split('token=')[1];
        const decoded = this.decodeJWT(token);
        if (decoded && decoded.url) {
          videoLinks.push(decoded.url);
        }
      }

      result.video = videoLinks.length > 0 ? videoLinks : [];

      if (mp3Link && mp3Link.includes('token=')) {
        const token = mp3Link.split('token='')[1];
        const decoded = this.decodeJWT(token);
        if (decoded && decoded.url) {
          result.audio = decoded.url;
        }
      }

      const images = [];
      ch(".card-action.center > a").each((i, elem) => {
        const href = ch(elem).attr("href");
        if (href && href.includes('token=')) {
          const token = href.split('token=')[1];
          const decoded = this.decodeJWT(token);
          if (decoded && decoded.cover) {
            images.push(decoded.cover);
          }
        }
      });

      if (images.length > 0) {
        result.photo = images;
      }

      const slideButton = ch("#SlideButton");
      if (slideButton.length > 0) {
        try {
          const scriptContent = ch("#SlideButton").parent().find("script").text();
          const slideDataMatch = scriptContent.match(/data:\s*['"](.*?)['"]/);
          if (slideDataMatch) {
            const slideData = slideDataMatch[1];
            const slideRes = await axios.request({
              url: "https://render.muscdn.app/slider",
              method: "post",
              data: new URLSearchParams({ data: slideData }),
              headers: {
                "user-agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36",
                accept: "application/json",
                "content-type": "application/x-www-form-urlencoded",
                origin: "https://musicaldown.com",
                referer: "https://musicaldown.com/photo/download",
              },
            });
            
            if (slideRes.data.success) {
              result.video = [slideRes.data.url];
            }
          }
        } catch (slideError) {}
      }

      return result;
    } catch (err) {
      throw err;
    }
  }

  async scrape(input) {
    try {
      const jar = new CookieJar();
      const client = wrapper(axios.create({ jar, withCredentials: true }));
      
      const headers = {
        "User-Agent": this.genericUserAgent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "max-age=0",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "sec-ch-ua": '"Chromium";v="124", "Not A(Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"'
      };

      await client.get("https://www.tiktok.com/", { headers });

      const first = await client.get(input, { 
        headers, 
        maxRedirects: 0, 
        validateStatus: (s) => s >= 200 && s < 400 
      });
      
      let redirectUrl = first.headers.location || input;

      if (redirectUrl.includes("/photo/")) {
        redirectUrl = redirectUrl.replace("/photo/", "/video/");
      }

      const { data: html } = await client.get(redirectUrl, { headers, maxRedirects: 10 });

      if (!html.includes("__UNIVERSAL_DATA_FOR_REHYDRATION__")) {
        return { error: "content.data_not_found" };
      }

      const json = html.split('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">')[1].split("</script>")[0];
      const data = JSON.parse(json);

      const videoDetail = data["__DEFAULT_SCOPE__"]["webapp.video-detail"];
      
      if (!videoDetail) {
        return { error: "content.detail_not_found" };
      }

      if (videoDetail.statusMsg) {
        return { error: "content.post.unavailable" };
      }

      const item = videoDetail.itemInfo.itemStruct;
      
      const downloadLinks = await this.getDownloadLinks(input);

      const result = {
        metadata: {
          stats: {
            likeCount: item.stats.diggCount,
            playCount: item.stats.playCount,
            commentCount: item.stats.commentCount,
            shareCount: item.stats.shareCount,
          },
          title: item.imagePost?.title || "",
          description: item.desc,
          hashtags: item.textExtra?.filter(extra => extra.type === 1).map(extra => extra.hashtagName) || [],
          locationCreated: item.locationCreated,
          suggestedWords: item.suggestedWords,
        },
        download: downloadLinks,
      };

      return {
        success: true,
        data: result,
        postId: item.id || "",
      };
    } catch (error) {
      return { error: "fetch.fail", message: error.message };
    }
  }
}

class YouTubeDownloader {
  constructor() {
    this.targetUrl = "https://id.savefrom.net/251le/";
    this.browser = null;
    this.page = null;
  }

  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    this.page = await this.browser.newPage();
  }

  parseResult(html) {
    const $ = cheerio.load(html);
    const results = [];

    $("#sf_result .result-box").each((i, el) => {
      const $el = $(el);
      const link = $el.find(".link-download").attr("href");

      if (link) {
        const dataType = $el.find(".link-download").attr("data-type") || "";
        const buttonText = $el.find(".link-download").text().trim();
        const urlExtension = link.split(".").pop()?.split("?")[0].toLowerCase() || "";
        const htmlClass = $el.attr("class") || "";

        let format =
          dataType ||
          buttonText.match(/\b(MP3|JPEG|MP4|PNG|GIF|WAV|JPG)\b/i)?.[1]?.toLowerCase() ||
          urlExtension ||
          "unknown";

        let type = "unknown";
        if (htmlClass.includes("video") || ["mp4", "avi", "mov", "webm"].includes(format)) {
          type = "video";
        } else if (htmlClass.includes("audio") || ["mp3", "wav", "aac", "ogg"].includes(format)) {
          type = "audio";
        } else if (["jpeg", "jpg", "png", "gif", "webp"].includes(format)) {
          type = "image";
        }

        results.push({
          title: $el.find(".title").text().trim().replace(/^#+\s*/, "") || "untitled",
          platform: $el.attr("data-hid") || "unknown",
          type: type,
          format: format,
          url: link,
          thumb: $el.find(".thumb img").attr("src") || null,
          quality: $el.find(".link-download").attr("data-quality") || null,
        });
      }
    });

    return results;
  }

  async download(url) {
    try {
      if (!this.browser) await this.init();

      await this.page.goto(this.targetUrl, { waitUntil: "domcontentloaded" });
      await this.page.type("#sf_url", url);
      await this.page.click("#sf_submit");

      await this.page.waitForResponse((res) => res.url().includes("savefrom.php"), { timeout: 15000 });
      await this.page.waitForSelector("#sf_result .media-result", { timeout: 30000 });

      const html = await this.page.content();
      const results = this.parseResult(html);

      return {
        success: true,
        data: results,
        count: results.length,
        url: url,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        data: [],
        count: 0,
        url: url,
      };
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async scrape(url) {
    try {
      const result = await this.download(url);
      await this.close();
      
      if (!result.success) {
        return { error: "youtube.fetch.fail", message: result.error };
      }

      const videos = result.data.filter(item => item.type === 'video');
      const audios = result.data.filter(item => item.type === 'audio');
      const images = result.data.filter(item => item.type === 'image');

      const download = {};
      
      if (videos.length > 0) {
        download.video = videos.map(v => v.url);
        if (videos[0].thumb) download.thumb = videos[0].thumb;
      }
      
      if (audios.length > 0) {
        download.audio = audios[0].url;
      }
      
      if (images.length > 0) {
        download.photo = images.map(i => i.url);
      }

      const bestVideo = videos.length > 0 ? videos[0] : null;
      const title = bestVideo?.title || result.data[0]?.title || 'YouTube Video';

      return {
        success: true,
        data: {
          metadata: {
            stats: {},
            title: title,
            description: '',
            quality: bestVideo?.quality || null,
          },
          download: download,
          allFormats: result.data,
        }
      };
    } catch (error) {
      return { error: "youtube.fetch.fail", message: error.message };
    }
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

    let type = 'unknown';
    if (videos.length && images.length) type = 'carousel';
    else if (videos.length) type = 'video';
    else if (images.length) type = 'photo';

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
        } while (taskResult && (taskResult.status === 'pending' || taskResult.status === 'processing'));
        
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

    const scraper = new TikTokScraper();
    const result = await scraper.scrape(url);
    
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

    const downloader = new YouTubeDownloader();
    const result = await downloader.scrape(url);
    
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