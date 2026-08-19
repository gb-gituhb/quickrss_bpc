const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

// ===== QUEUE SYSTEM =====
const requestQueue = [];
let isProcessing = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const forceGC = () => {
  if (global.gc) {
    try {
      global.gc();
      console.log('🧹 GC triggered');
    } catch (e) {}
  }
};

// ===== ESCAPE HTML =====
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}

// ===== URL CLEANING FUNCTION =====
function cleanArticleUrl(rawUrl) {
  if (!rawUrl) return null;

  let cleanUrl = rawUrl;

  // Handle FiveFilters format: ?step=3&fulltext=1&url=https://example.com
  if (cleanUrl.includes('?step=') && cleanUrl.includes('&url=')) {
    const match = cleanUrl.match(/url=([^&]+)/);
    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  // Handle QuickRSS comma format: ?step=3,https://example.com
  if (cleanUrl.match(/^\?step=\d+,/)) {
    cleanUrl = cleanUrl.replace(/^\?step=\d+,/, '');
  }

  // Handle URL-encoded
  try {
    const decoded = decodeURIComponent(cleanUrl);
    if (decoded !== cleanUrl && decoded.match(/^https?:\/\//)) {
      return decoded;
    }
  } catch (e) {}

  // Extract URL if it contains step= pattern
  if (cleanUrl.includes('?step=') || cleanUrl.includes('step=')) {
    const match = cleanUrl.match(/https?:\/\/[^\s,]+/);
    if (match) {
      return match[0];
    }
  }

  return cleanUrl;
}

// ===== PROCESS QUEUE =====
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { req, res, cleanUrl, isKOReader } = requestQueue.shift();

  let browserInstance = null;
  let page = null;

  try {
    console.log(`⏳ Processing queue (${requestQueue.length} remaining)`);

    // ===== ARCHIVE-FIRST (WAYBACK MACHINE) =====
    const archiveUrls = [
      `https://web.archive.org/web/2/${cleanUrl}`,
      `https://web.archive.org/web/20260819000000/${cleanUrl}`,
      `https://web.archive.org/web/20260818000000/${cleanUrl}`
    ];

    let archiveContent = null;

    for (const archiveUrl of archiveUrls) {
      try {
        const response = await fetch(archiveUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          const html = await response.text();
          if (!html.includes('does not exist') && !html.includes('Not Found') && !html.includes('404') && html.length > 5000) {
            archiveContent = html;
            console.log(`✅ Archive found`);
            break;
          }
        }
      } catch (archiveError) {
        // Silently continue
      }
    }

    // ===== IF ARCHIVE FOUND, USE IT =====
    if (archiveContent) {
      const response = await connect({
        headless: false,
        turnstile: true,
        fingerprint: true,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
          '--single-process', '--no-zygote', '--js-flags="--max-old-space-size=128"',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
          '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-default-apps',
          '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-popup-blocking',
          '--disable-prompt-on-repost', '--disable-renderer-backgrounding', '--disable-sync',
          '--metrics-recording-only', '--no-first-run', '--password-store=basic', '--use-mock-keychain',
          '--disable-web-security', '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--disable-jit', '--disable-accelerated-2d-canvas', '--disable-accelerated-jpeg-decoding',
          '--disable-accelerated-mjpeg-decode', '--disable-accelerated-video-decode'
        ],
        customConfig: {
          chromePath: '/usr/bin/chromium',
          ignoreHTTPSErrors: true,
          defaultViewport: { width: 1024, height: 600 }
        }
      });

      browserInstance = response.browser;
      page = response.page;

      await page.setContent(archiveContent, { waitUntil: 'domcontentloaded' });
      await wait(2000);

      await page.evaluate(() => {
        document.querySelectorAll('.ad, .banner, .popup, .cookie, [class*="banner"], [class*="popup"]').forEach(el => el.remove());
        document.querySelectorAll('img').forEach(el => el.remove());
        const contentSelectors = ['.article-content', '.post-content', '.story-content', '.content', 'article', '.main-content', '.entry-content', '.story-body', '.article-body', '#content', '.body-content', '.ArticleBody'];
        let contentFound = false;
        for (const selector of contentSelectors) {
          const elements = document.querySelectorAll(selector);
          if (elements.length > 0) {
            elements.forEach(el => {
              el.style.display = 'block';
              el.style.visibility = 'visible';
              el.style.maxHeight = 'none';
              el.style.overflow = 'visible';
            });
            contentFound = true;
            break;
          }
        }
        if (!contentFound) {
          document.querySelectorAll('p').forEach(p => {
            p.style.display = 'block';
            p.style.visibility = 'visible';
          });
        }
        document.querySelectorAll('[class*="paywall"], [class*="subscription"]').forEach(el => el.remove());
      });

      let contentToSend = await page.content();

      if (isKOReader) {
        const htmlContent = await page.evaluate(() => {
          const articleSelectors = [
            '.article-body', '.article-content', '.post-content', '.story-content',
            '.content', 'article', '.main-content', '.entry-content', '.story-body',
            '.article-body', '#content', '.body-content', '.ArticleBody',
            '.dcr-article-body', '.dcr-body', '.article-body-commercial-selector',
            '[data-gu-metric="article-body"]', '.js-article-body', '.article__body',
            '.article__content', '.dcr-article', '.content--article-body',
            '.article', '[role="article"]'
          ];
          let articleElement = null;
          for (const selector of articleSelectors) {
            const el = document.querySelector(selector);
            if (el) {
              articleElement = el;
              break;
            }
          }
          if (!articleElement) {
            const paragraphs = document.querySelectorAll('p');
            if (paragraphs.length > 5) {
              const parent = paragraphs[0]?.closest('div, section, article, main');
              if (parent) {
                articleElement = parent;
              }
            }
          }
          if (!articleElement) {
            articleElement = document.body;
          }

          let html = articleElement.innerHTML;
          html = html.replace(/<img[^>]*>/g, '');
          html = html.replace(/<[^>]*class="[^"]*(paywall|subscription)[^"]*"[^>]*>[\s\S]*?<\/[^>]*>/gi, '');
          html = html.replace(/<[^>]*id="[^"]*(paywall|subscription)[^"]*"[^>]*>[\s\S]*?<\/[^>]*>/gi, '');
          html = html.replace(/<script[\s\S]*?<\/script>/g, '');
          html = html.replace(/<style[\s\S]*?<\/style>/g, '');
          html = html.replace(/<p>\s*<\/p>/g, '');
          return html.trim();
        });

        const title = await page.evaluate(() => {
          const titleEl = document.querySelector('h1, .article-title, .headline, .entry-title, .title');
          return titleEl ? titleEl.textContent.trim() : 'Article';
        });

        contentToSend = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 0 auto; padding: 20px; line-height: 1.8; font-size: 18px; color: #000; background: #fff; }
    h1, h2, h3 { margin: 1.2em 0 0.5em 0; }
    p { margin: 0 0 1.2em 0; text-align: justify; }
    a { color: #0066cc; text-decoration: underline; }
    .paywall, .subscription { display: none; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${htmlContent}
</body>
</html>`;

        console.log(`📝 Sent HTML to KOReader (${contentToSend.length} chars) [ARCHIVE]`);
      }

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(contentToSend);

      if (browserInstance) {
        await browserInstance.close().catch(() => {});
      }
      forceGC();
      isProcessing = false;
      processQueue();
      return;
    }

    // ============================================================
    // ARCHIVE FAILED → FALLBACK TO BPC
    // ============================================================
    console.log('📚 Archive failed, using BPC...');

    const response = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
        '--single-process', '--no-zygote', '--js-flags="--max-old-space-size=128"',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
        '--disable-breakpad', '--disable-client-side-phishing-detection', '--disable-default-apps',
        '--disable-hang-monitor', '--disable-ipc-flooding-protection', '--disable-popup-blocking',
        '--disable-prompt-on-repost', '--disable-renderer-backgrounding', '--disable-sync',
        '--metrics-recording-only', '--no-first-run', '--password-store=basic', '--use-mock-keychain',
        '--disable-web-security', '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--disable-jit', '--disable-accelerated-2d-canvas', '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode', '--disable-accelerated-video-decode'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium',
        ignoreHTTPSErrors: true,
        defaultViewport: { width: 1024, height: 600 }
      }
    });

    browserInstance = response.browser;
    page = response.page;

    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    await page.setExtraHTTPHeaders({ 'Referer': 'https://www.google.com/' });
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      const url = req.url().toLowerCase();
      if (resourceType === 'image' || resourceType === 'media' || resourceType === 'font') {
        req.abort();
        return;
      }
      if (url.includes('paywall') || url.includes('subscription') || url.includes('cxense') ||
          url.includes('google-analytics') || url.includes('googletagmanager') ||
          url.includes('facebook') || url.includes('segment') || url.includes('optimizely') ||
          url.includes('abtest') || url.includes('analytics') || url.includes('chartbeat') ||
          url.includes('scorecard') || url.includes('comscore') || url.includes('quantcast') ||
          url.includes('adzerk') || url.includes('doubleclick')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`⏳ Navigating...`);
    await page.goto(cleanUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    console.log('✅ Page loaded');

    await wait(3000);

    // Click "Continue Reading" if exists
    try {
      const clicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, a, div, span, [role="button"]');
        for (const el of buttons) {
          const text = el.textContent || '';
          if (text.trim() === 'Continue Reading' ||
              text.trim() === 'Continue reading' ||
              text.includes('Continue Reading') ||
              text.includes('Continue reading')) {
            el.click();
            return true;
          }
        }
        return false;
      });
      if (clicked) {
        console.log('🔘 Clicked "Continue Reading"');
        await wait(4000);
      }
    } catch (e) {}

    // Cleanup
    await page.evaluate(() => {
      document.querySelectorAll('.paywall, .subscription-wall, .premium-wall, .metered-content, .gateway, [class*="paywall"], [id*="paywall"], [class*="subscription"], [id*="subscription"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="continue"], [class*="read-more"]').forEach(el => el.remove());
      document.querySelectorAll('button').forEach(el => {
        if (el.textContent && el.textContent.includes('Continue')) {
          el.remove();
        }
      });

      const contentSelectors = [
        '.article-content', '.post-content', '.story-content', '.content',
        '.premium-content', 'article p', '.article-body', '.entry-content',
        '.story-body', '.main-content'
      ];
      contentSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
          el.style.height = 'auto';
        });
      });

      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
        el.style.blur = '0px';
      });

      document.querySelectorAll('img').forEach(el => el.remove());
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
    });

    await wait(3000);

    let contentToSend;

    if (isKOReader) {
      const htmlContent = await page.evaluate(() => {
        const articleSelectors = [
          '.article-body', '.article-content', '.post-content', '.story-content',
          '.content', 'article', '.main-content', '.entry-content', '.story-body',
          '.article-body', '#content', '.body-content', '.ArticleBody',
          '.dcr-article-body', '.dcr-body', '.article-body-commercial-selector',
          '[data-gu-metric="article-body"]', '.js-article-body', '.article__body',
          '.article__content', '.dcr-article', '.content--article-body',
          '.article', '[role="article"]'
        ];
        let articleElement = null;
        for (const selector of articleSelectors) {
          const el = document.querySelector(selector);
          if (el) {
            articleElement = el;
            break;
          }
        }
        if (!articleElement) {
          const paragraphs = document.querySelectorAll('p');
          if (paragraphs.length > 5) {
            const parent = paragraphs[0]?.closest('div, section, article, main');
            if (parent) {
              articleElement = parent;
            }
          }
        }
        if (!articleElement) {
          articleElement = document.body;
        }

        let html = articleElement.innerHTML;
        html = html.replace(/<img[^>]*>/g, '');
        html = html.replace(/<[^>]*class="[^"]*(paywall|subscription)[^"]*"[^>]*>[\s\S]*?<\/[^>]*>/gi, '');
        html = html.replace(/<[^>]*id="[^"]*(paywall|subscription)[^"]*"[^>]*>[\s\S]*?<\/[^>]*>/gi, '');
        html = html.replace(/<script[\s\S]*?<\/script>/g, '');
        html = html.replace(/<style[\s\S]*?<\/style>/g, '');
        html = html.replace(/<p>\s*<\/p>/g, '');
        return html.trim();
      });

      const title = await page.evaluate(() => {
        const titleEl = document.querySelector('h1, .article-title, .headline, .entry-title, .title');
        return titleEl ? titleEl.textContent.trim() : 'Article';
      });

      contentToSend = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 0 auto; padding: 20px; line-height: 1.8; font-size: 18px; color: #000; background: #fff; }
    h1, h2, h3 { margin: 1.2em 0 0.5em 0; }
    p { margin: 0 0 1.2em 0; text-align: justify; }
    a { color: #0066cc; text-decoration: underline; }
    .paywall, .subscription { display: none; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${htmlContent}
</body>
</html>`;

      console.log(`📝 Sent HTML to KOReader (${contentToSend.length} chars) [BPC]`);
    } else {
      contentToSend = await page.content();
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(contentToSend);

    if (browserInstance) {
      await browserInstance.close().catch(() => {});
    }
    forceGC();

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (res && !res.headersSent) {
      res.status(500).send(`Error: ${error.message}`);
    }
    if (browserInstance) {
      await browserInstance.close().catch(() => {});
    }
  } finally {
    isProcessing = false;
    processQueue();
  }
}

// ===== ROUTES =====
app.get('/', (req, res) => {
  res.status(200).send('Active');
});

app.get('/fetch', async (req, res) => {
  let targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter.');
  }

  let cleanUrl = targetUrl;

  if (Array.isArray(cleanUrl)) {
    cleanUrl = cleanUrl.join('');
  }

  if (typeof cleanUrl === 'object' && cleanUrl !== null) {
    if (cleanUrl.url) cleanUrl = cleanUrl.url;
    else if (cleanUrl[0]) cleanUrl = cleanUrl[0];
    else cleanUrl = String(cleanUrl || '');
  }

  if (typeof cleanUrl !== 'string') {
    cleanUrl = String(cleanUrl || '');
  }

  // Clean URL using the function
  const cleaned = cleanArticleUrl(cleanUrl);
  if (cleaned) {
    cleanUrl = cleaned;
  }

  cleanUrl = cleanUrl.replace(/[,\s]+$/, '');

  try {
    new URL(cleanUrl);
  } catch (e) {
    console.error(`❌ Invalid URL: ${cleanUrl}`);
    return res.status(400).send('Invalid URL format.');
  }

  const userAgent = req.headers['user-agent'] || '';
  const isKOReader = userAgent.toLowerCase().includes('koreader');

  requestQueue.push({ req, res, cleanUrl, isKOReader });
  console.log(`📥 Queued (${requestQueue.length} pending)`);

  processQueue();
});

// ===== START SERVER =====
setInterval(forceGC, 30000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ BPC Extension path: ${EXTENSION_PATH}`);
  console.log(`📚 Archive-first mode enabled`);
});
