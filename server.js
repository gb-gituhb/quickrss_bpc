const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const dns = require('dns');

dns.setDefaultResultOrder('ipv4first');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

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

app.get('/', (req, res) => {
  res.status(200).send('Active');
});

app.get('/fetch', async (req, res) => {
  let targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter.');
  }

  // ===== AGGRESSIVE URL CLEANING =====
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

  if (isProcessing) {
    return res.status(429).send('Server is busy. Please retry.');
  }

  isProcessing = true;
  let browser, page;

  try {
    console.log(`🌐 Fetching: ${cleanUrl}`);

    // === ARCHIVE-FIRST ===
    console.log('📚 Trying archive-first approach...');
    const archiveUrls = [
      `https://web.archive.org/web/2/${cleanUrl}`,
      `https://web.archive.org/web/20260819000000/${cleanUrl}`,
      `https://web.archive.org/web/20260818000000/${cleanUrl}`
    ];

    let archiveContent = null;

    for (const archiveUrl of archiveUrls) {
      try {
        console.log(`📚 Trying: ${archiveUrl}`);
        const response = await fetch(archiveUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
          signal: AbortSignal.timeout(10000)
        });
        if (response.ok) {
          const html = await response.text();
          if (!html.includes('does not exist') && !html.includes('Not Found') && !html.includes('404') && html.length > 5000) {
            archiveContent = html;
            console.log(`✅ Archive found at: ${archiveUrl}`);
            break;
          }
        }
      } catch (archiveError) {
        console.log(`⚠️ Archive failed: ${archiveUrl} - ${archiveError.message}`);
      }
    }

    // ============================================================
    // PATH 1: ARCHIVE FOUND
    // ============================================================
    if (archiveContent) {
      console.log('📝 Cleaning archive content...');
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

      browser = response.browser;
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

      let finalHtml = await page.content();
      
      if (isKOReader) {
        const textContent = await page.evaluate(() => {
          const body = document.body;
          if (!body) return '';
          const walker = document.createTreeWalker(
            body,
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
            if (text.length > 30 && !seen.has(text)) {
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
              if (text.length > 30 && !seen.has(text)) {
                seen.add(text);
                textParts.push(text);
              }
            });
          }
          return textParts.join('\n\n');
        });
        const paragraphs = textContent.split('\n\n').filter(p => p.trim().length > 0);
        const htmlBody = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
        finalHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>body{font-family:Georgia,serif;max-width:700px;margin:0 auto;padding:20px;line-height:1.8;font-size:18px;color:#000;background:#fff}p{margin:0 0 1.2em 0;text-align:justify}</style></head><body>${htmlBody || '<p>No content extracted</p>'}</body></html>`;
        console.log('📝 Sending text-only version for KOReader (from archive)');
      }

      console.log('✅ Archive cleaned, returning response');
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      forceGC();
      isProcessing = false;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(finalHtml);
    }

    // ============================================================
    // PATH 2: ARCHIVE FAILED → FALLBACK TO BPC
    // ============================================================
    console.log('📚 Archive failed, falling back to BPC...');

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

    browser = response.browser;
    page = response.page;

    await wait(3000);

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

    console.log('⏳ Navigating...');
    await page.goto(cleanUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });
    console.log('✅ Page loaded successfully');

    await wait(3000);

    // ============================================================
    // THE FIX: CLICK "CONTINUE READING" TO LOAD FULL CONTENT
    // ============================================================
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
        await wait(4000); // Wait for lazy-loaded content
      } else {
        console.log('ℹ️ No "Continue Reading" button found');
      }
    } catch (e) {
      console.log('⚠️ Error clicking "Continue Reading":', e.message);
    }

    // ============================================================
    // STANDARD CLEANUP
    // ============================================================
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
    
    // ============================================================
    // KOREADER EXTRACTION (with TreeWalker filtering)
    // ============================================================
    if (isKOReader) {
      const textContent = await page.evaluate(() => {
        const body = document.body;
        if (!body) return '';
        const walker = document.createTreeWalker(
          body,
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
          if (text.length > 30 && !seen.has(text)) {
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
            if (text.length > 30 && !seen.has(text)) {
              seen.add(text);
              textParts.push(text);
            }
          });
        }
        return textParts.join('\n\n');
      });
      const paragraphs = textContent.split('\n\n').filter(p => p.trim().length > 0);
      const htmlBody = paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
      htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Article</title>
  <style>
    body { font-family: Georgia, serif; max-width: 700px; margin: 0 auto; padding: 20px; line-height: 1.8; font-size: 18px; color: #000; background: #fff; }
    p { margin: 0 0 1.2em 0; text-align: justify; }
  </style>
</head>
<body>
${htmlBody || '<p>No content extracted</p>'}
</body>
</html>`;
      console.log('📝 Sending text-only version for KOReader (from BPC)');
    } else {
      console.log('📝 Sending full HTML for browser');
    }
    
    console.log('✅ BPC content extracted, returning response');
    
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
    forceGC();
    isProcessing = false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (page) {
      await page.close().catch(() => {});
    }
    forceGC();
    isProcessing = false;
    res.status(500).send(`Error: ${error.message}`);
  }
});

setInterval(forceGC, 30000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ BPC Extension path: ${EXTENSION_PATH}`);
  console.log(`⚠️ Memory limit: 512MB`);
  console.log(`📚 Archive-first mode enabled (web.archive.org only)`);
});
