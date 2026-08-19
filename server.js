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

// ===== PROCESS QUEUE =====
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) return;

  isProcessing = true;
  const { req, res, cleanUrl, isKOReader } = requestQueue.shift();

  try {
    console.log(`⏳ Processing queue (${requestQueue.length} remaining)`);

    // ===== EXTRACT CONTENT =====
    const browser = await connect({
      headless: true,
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

    const page = browser.page;

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

    console.log(`⏳ Navigating to: ${cleanUrl}`);
    await page.goto(cleanUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    console.log('✅ Page loaded successfully');

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
        console.log('🔘 Clicked "Continue Reading" button - waiting for content to load...');
        await wait(4000);
      } else {
        console.log('ℹ️ No "Continue Reading" button found');
      }
    } catch (e) {
      console.log('⚠️ Error clicking "Continue Reading":', e.message);
    }

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

    let htmlContent = await page.content();

    // ===== KOREADER: Extract text from article container =====
    if (isKOReader) {
      const textContent = await page.evaluate(() => {
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

        const walker = document.createTreeWalker(
          articleElement,
          NodeFilter.SHOW_TEXT,
          {
            acceptNode: function(node) {
              const parent = node.parentElement;
              if (!parent) return NodeFilter.FILTER_REJECT;
              const tag = parent.tagName.toLowerCase();
              if (tag === 'script' || tag === 'style' || tag === 'noscript' || tag === 'svg') {
                return NodeFilter.FILTER_REJECT;
              }
              return NodeFilter.FILTER_ACCEPT;
            }
          }
        );
        const textParts = [];
        const seen = new Set();
        let node;
        const skipPhrases = ['Continue Reading', 'Continue reading', 'Read more', 'Sign up', 'Subscribe', 'Newsletter', 'Cookie Notice', 'Privacy Policy', 'Terms of Service', 'Advertise', 'Follow us', 'Share this', 'Email', 'Print', 'Download', 'View all', 'Show more', 'Load more', 'By clicking', 'I agree', 'Accept', 'Decline', 'All rights reserved', 'Copyright', 'Get the app'];
        while (node = walker.nextNode()) {
          const text = node.textContent.trim();
          if (text && !seen.has(text)) {
            seen.add(text);
            let shouldSkip = false;
            for (const phrase of skipPhrases) {
              if (text.includes(phrase)) { shouldSkip = true; break; }
            }
            if (!shouldSkip) {
              textParts.push(text);
            }
          }
        }
        if (textParts.length === 0) {
          document.querySelectorAll('p').forEach(p => {
            const text = p.textContent.trim();
            if (text && !seen.has(text)) {
              seen.add(text);
              textParts.push(text);
            }
          });
        }
        return textParts.join('\n\n');
      });

      // Sanitize text
      let sanitizedText = textContent
        .replace(/[^\w\s.,!?;:'"()\-\n]/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/  +/g, ' ')
        .trim();

      console.log(`📝 Sending sanitized text to KOReader (${sanitizedText.length} chars)`);
      console.log(`📝 First 300 chars: ${sanitizedText.substring(0, 300)}...`);

      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      forceGC();

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(sanitizedText);
    } else {
      console.log('📝 Sending full HTML for browser');
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      forceGC();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(htmlContent);
    }
  } catch (error) {
    console.error('❌ Error processing request:', error.message);
    if (res && !res.headersSent) {
      res.status(500).send(`Error: ${error.message}`);
    }
  } finally {
    isProcessing = false;
    processQueue(); // Process next item in queue
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

  // ===== URL CLEANING =====
  let cleanUrl = targetUrl;

  if (Array.isArray(cleanUrl)) {
    console.log(`📦 URL is an array with ${cleanUrl.length} items`);
    cleanUrl = cleanUrl.join('');
    console.log(`🔧 Joined array to: ${cleanUrl}`);
  }

  if (typeof cleanUrl === 'object' && cleanUrl !== null) {
    console.log(`📦 URL is an object, extracting...`);
    if (cleanUrl.url) cleanUrl = cleanUrl.url;
    else if (cleanUrl[0]) cleanUrl = cleanUrl[0];
    else cleanUrl = String(cleanUrl || '');
  }

  if (typeof cleanUrl !== 'string') {
    console.error(`❌ URL is not a string: ${typeof cleanUrl}`);
    cleanUrl = String(cleanUrl || '');
  }

  console.log(`📝 Raw URL: ${cleanUrl}`);

  cleanUrl = cleanUrl.replace(/^\?step=\d+,/, '');
  cleanUrl = cleanUrl.replace(/^[^:]+:\/\/[^,]+,\s*/, '');

  if (cleanUrl.includes('?step=') || cleanUrl.includes('step=')) {
    const match = cleanUrl.match(/https?:\/\/[^\s,]+/);
    if (match) {
      cleanUrl = match[0];
      console.log(`🔧 Extracted URL from malformed string: ${cleanUrl}`);
    }
  }

  try {
    cleanUrl = decodeURIComponent(cleanUrl);
  } catch (e) {
    console.log(`⚠️ URL decode failed: ${e.message}`);
  }

  cleanUrl = cleanUrl.replace(/[,\s]+$/, '');

  try {
    new URL(cleanUrl);
  } catch (e) {
    console.error(`❌ Invalid URL after cleaning: ${cleanUrl}`);
    console.error(`❌ Original was: ${targetUrl}`);
    return res.status(400).send('Invalid URL format.');
  }

  console.log(`✅ Clean URL: ${cleanUrl}`);

  // ===== DETECT KOREADER =====
  const userAgent = req.headers['user-agent'] || '';
  const isKOReader = userAgent.toLowerCase().includes('koreader');
  console.log(`📱 User-Agent: ${userAgent}`);
  console.log(`📱 isKOReader: ${isKOReader}`);

  // ===== ADD TO QUEUE =====
  requestQueue.push({ req, res, cleanUrl, isKOReader });
  console.log(`📥 Added to queue (${requestQueue.length} pending)`);

  // ===== START PROCESSING =====
  processQueue();
});

// ===== START SERVER =====
setInterval(forceGC, 30000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ BPC Extension path: ${EXTENSION_PATH}`);
  console.log(`⚠️ Memory limit: 512MB`);
  console.log(`📚 Archive-first mode enabled (web.archive.org only)`);
});
