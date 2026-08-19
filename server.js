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

  // Handle arrays from malformed query params (QuickRSS sometimes sends arrays)
  if (Array.isArray(cleanUrl)) {
    console.log(`📦 URL is an array with ${cleanUrl.length} items`);
    cleanUrl = cleanUrl.join('');
    console.log(`🔧 Joined array to: ${cleanUrl}`);
  }

  // Handle objects
  if (typeof cleanUrl === 'object' && cleanUrl !== null) {
    console.log(`📦 URL is an object, extracting...`);
    if (cleanUrl.url) cleanUrl = cleanUrl.url;
    else if (cleanUrl[0]) cleanUrl = cleanUrl[0];
    else cleanUrl = String(cleanUrl || '');
  }

  // SAFETY: Ensure it's a string
  if (typeof cleanUrl !== 'string') {
    console.error(`❌ URL is not a string: ${typeof cleanUrl}`);
    cleanUrl = String(cleanUrl || '');
  }

  // Log the raw URL for debugging
  console.log(`📝 Raw URL: ${cleanUrl}`);

  // Remove ?step=X, prefix (works with any number)
  cleanUrl = cleanUrl.replace(/^\?step=\d+,/, '');

  // Remove any other malformed prefixes
  cleanUrl = cleanUrl.replace(/^[^:]+:\/\/[^,]+,\s*/, '');

  // If URL still contains ?step= or step=, try to extract the actual URL
  if (cleanUrl.includes('?step=') || cleanUrl.includes('step=')) {
    const match = cleanUrl.match(/https?:\/\/[^\s,]+/);
    if (match) {
      cleanUrl = match[0];
      console.log(`🔧 Extracted URL from malformed string: ${cleanUrl}`);
    }
  }

  // Handle URL-encoded characters
  try {
    cleanUrl = decodeURIComponent(cleanUrl);
  } catch (e) {
    console.log(`⚠️ URL decode failed, using original: ${e.message}`);
  }

  // Remove any trailing commas or spaces
  cleanUrl = cleanUrl.replace(/[,\s]+$/, '');

  // Validate URL
  try {
    new URL(cleanUrl);
  } catch (e) {
    console.error(`❌ Invalid URL after cleaning: ${cleanUrl}`);
    console.error(`❌ Original was: ${targetUrl}`);
    return res.status(400).send('Invalid URL format.');
  }

  console.log(`✅ Clean URL: ${cleanUrl}`);

  if (isProcessing) {
    return res.status(429).send('Server is busy. Please retry.');
  }

  isProcessing = true;
  let browser, page;

  try {
    console.log(`🌐 Fetching: ${cleanUrl}`);

    // === ARCHIVE-FIRST STRATEGY ===
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
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'
          },
          signal: AbortSignal.timeout(10000)
        });
        
        if (response.ok) {
          const html = await response.text();
          
          if (!html.includes('does not exist') && 
              !html.includes('Not Found') && 
              !html.includes('404') &&
              html.length > 5000) {
            archiveContent = html;
            console.log(`✅ Archive found at: ${archiveUrl}`);
            break;
          }
        }
      } catch (archiveError) {
        console.log(`⚠️ Archive failed: ${archiveUrl} - ${archiveError.message}`);
      }
    }

    // If archive worked, clean and return it
    if (archiveContent) {
      console.log('📝 Cleaning archive content...');
      
      const response = await connect({
        headless: false,
        turnstile: true,
        fingerprint: true,
        args: [
          `--disable-extensions-except=${EXTENSION_PATH}`,
          `--load-extension=${EXTENSION_PATH}`,
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote',
          '--js-flags="--max-old-space-size=128"',
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-breakpad',
          '--disable-client-side-phishing-detection',
          '--disable-default-apps',
          '--disable-hang-monitor',
          '--disable-ipc-flooding-protection',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-renderer-backgrounding',
          '--disable-sync',
          '--metrics-recording-only',
          '--no-first-run',
          '--password-store=basic',
          '--use-mock-keychain',
          '--disable-web-security',
          '--disable-features=BlockInsecurePrivateNetworkRequests',
          '--disable-jit',
          '--disable-accelerated-2d-canvas',
          '--disable-accelerated-jpeg-decoding',
          '--disable-accelerated-mjpeg-decode',
          '--disable-accelerated-video-decode'
        ],
        customConfig: {
          chromePath: '/usr/bin/chromium',
          ignoreHTTPSErrors: true,
          defaultViewport: {
            width: 1024,
            height: 600
          }
        }
      });

      browser = response.browser;
      page = response.page;

      await page.setContent(archiveContent, {
        waitUntil: 'domcontentloaded'
      });

      await wait(2000);

      await page.evaluate(() => {
        document.querySelectorAll('.ad, .banner, .popup, .cookie, [class*="banner"], [class*="popup"]').forEach(el => el.remove());
        document.querySelectorAll('img').forEach(el => el.remove());
        
        const contentSelectors = [
          '.article-content', '.post-content', '.story-content', '.content',
          'article', '.main-content', '.entry-content', '.story-body',
          '.article-body', '#content', '.body-content', '.ArticleBody'
        ];
        
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
          const paragraphs = document.querySelectorAll('p');
          if (paragraphs.length > 3) {
            paragraphs.forEach(p => {
              p.style.display = 'block';
              p.style.visibility = 'visible';
            });
          }
        }
        
        document.querySelectorAll('[class*="paywall"], [class*="subscription"]').forEach(el => el.remove());
      });

      const cleanHtml = await page.content();
      console.log('✅ Archive cleaned, returning response');
      
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      forceGC();
      
      isProcessing = false;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(cleanHtml);
    }

    // === FALLBACK TO BPC ===
    console.log('📚 Archive failed, falling back to BPC...');

    const response = await connect({
      headless: false,
      turnstile: true,
      fingerprint: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--single-process',
        '--no-zygote',
        '--js-flags="--max-old-space-size=128"',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--metrics-recording-only',
        '--no-first-run',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-web-security',
        '--disable-features=BlockInsecurePrivateNetworkRequests',
        '--disable-jit',
        '--disable-accelerated-2d-canvas',
        '--disable-accelerated-jpeg-decoding',
        '--disable-accelerated-mjpeg-decode',
        '--disable-accelerated-video-decode'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium',
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: 1024,
          height: 600
        }
      }
    });

    browser = response.browser;
    page = response.page;

    await wait(3000);

    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

    await page.setExtraHTTPHeaders({
      'Referer': 'https://www.google.com/'
    });

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
      
      if (url.includes('paywall') || 
          url.includes('subscription') || 
          url.includes('cxense') ||
          url.includes('google-analytics') ||
          url.includes('googletagmanager') ||
          url.includes('facebook') ||
          url.includes('segment') ||
          url.includes('optimizely') ||
          url.includes('abtest') ||
          url.includes('analytics') ||
          url.includes('chartbeat') ||
          url.includes('scorecard') ||
          url.includes('comscore') ||
          url.includes('quantcast') ||
          url.includes('adzerk') ||
          url.includes('doubleclick')) {
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

    // ===== IMPROVED CLEANUP FOR BOTH BROWSER & KOREADER =====
    await page.evaluate(() => {
      // ===== 1. REMOVE "CONTINUE READING" BUTTONS =====
      const allElements = document.querySelectorAll('*');
      allElements.forEach(el => {
        const text = el.textContent || '';
        if (text.trim() === 'Continue Reading' || 
            text.trim() === 'Continue reading' ||
            text.trim() === 'Read more' ||
            text.includes('Continue Reading') ||
            text.includes('Read more')) {
          el.remove();
        }
      });
      
      document.querySelectorAll('[class*="continue"], [class*="read-more"], [class*="show-more"]').forEach(el => el.remove());
      document.querySelectorAll('[id*="continue"], [id*="read-more"]').forEach(el => el.remove());
      
      // ===== 2. REMOVE PAYWALL OVERLAYS =====
      document.querySelectorAll('.paywall, .subscription-wall, .premium-wall, .metered-content, [class*="paywall"], [id*="paywall"], [class*="subscription"]').forEach(el => el.remove());
      
      // ===== 3. REMOVE ALL TRUNCATION =====
      document.querySelectorAll('*').forEach(el => {
        if (el.style.maxHeight && el.style.maxHeight !== 'none') {
          el.style.maxHeight = 'none';
        }
        if (el.style.overflow === 'hidden') {
          el.style.overflow = 'visible';
        }
        if (el.style.clip) {
          el.style.clip = 'none';
        }
        if (el.style.height && el.style.height !== 'auto') {
          el.style.height = 'auto';
        }
        if (el.style.maxHeight && el.style.maxHeight !== 'none') {
          el.style.maxHeight = 'none';
        }
      });

      // Remove inline style attributes that hide content
      document.querySelectorAll('[style*="max-height"], [style*="overflow:hidden"], [style*="clip"]').forEach(el => {
        el.removeAttribute('style');
      });

      // ===== 4. SHOW ALL CONTENT =====
      const contentSelectors = [
        '.article-body', '.article-content', '.post-content', '.story-content', 
        '.content', 'article', '.main-content', '.entry-content', '.story-body',
        '.article-body', '#content', '.body-content', '.ArticleBody'
      ];
      
      for (const selector of contentSelectors) {
        document.querySelectorAll(selector).forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
          el.style.opacity = '1';
          el.style.filter = 'none';
          el.style.height = 'auto';
        });
      }

      // ===== 5. SHOW ALL PARAGRAPHS =====
      document.querySelectorAll('p').forEach(p => {
        p.style.display = 'block';
        p.style.visibility = 'visible';
        p.style.maxHeight = 'none';
        p.style.overflow = 'visible';
        p.style.height = 'auto';
        p.style.margin = '0 0 1em 0';
        p.style.lineHeight = '1.6';
      });

      // ===== 6. REMOVE BLUR =====
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
        el.style.blur = '0px';
      });

      // ===== 7. REMOVE IMAGES =====
      document.querySelectorAll('img').forEach(el => el.remove());

      // ===== 8. ALLOW SCROLLING =====
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      document.body.style.maxHeight = 'none';
      document.documentElement.style.maxHeight = 'none';
      
      // ===== 9. REMOVE TRUNCATION INDICATORS =====
      document.querySelectorAll('.truncated, .cutoff, [class*="truncate"]').forEach(el => el.remove());
    });

    await wait(3000);

    const htmlContent = await page.content();
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
