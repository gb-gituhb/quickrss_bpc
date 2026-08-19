const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => {
  res.status(200).send('Active');
});

app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter.');
  }

  if (isProcessing) {
    return res.status(429).send('Server is busy. Please retry.');
  }

  isProcessing = true;
  let browser, page;

  try {
    console.log(`🌐 Fetching: ${targetUrl}`);

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
        '--disable-component-extensions-with-background-pages',
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
        '--disable-features=BlockInsecurePrivateNetworkRequests'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium',
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: 1280,
          height: 720
        }
      }
    });

    browser = response.browser;
    page = response.page;

    // Wait for extension to load
    await wait(3000);

    // Set user agent - Googlebot for better bypass
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

    // Additional stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Referer': 'https://www.google.com/'
    });

    // Block paywall scripts
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url().toLowerCase();
      // Block known paywall and tracking scripts
      if (url.includes('paywall') || 
          url.includes('subscription') || 
          url.includes('cxense') || 
          url.includes('cloudflare') ||
          url.includes('google-analytics') ||
          url.includes('googletagmanager')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await wait(3000);

    // Comprehensive bypass
    console.log('🔧 Applying bypasses...');
    await page.evaluate(() => {
      const url = window.location.href;
      
      // === SITE-SPECIFIC COOKIES ===
      // NY Times
      if (url.includes('nytimes.com')) {
        document.cookie = "nyt_cc=bypass; path=/; domain=.nytimes.com";
        document.cookie = "nyt_metered=0; path=/; domain=.nytimes.com";
      }
      
      // WSJ
      if (url.includes('wsj.com')) {
        document.cookie = "wsj_cc=bypass; path=/; domain=.wsj.com";
        document.cookie = "wsj_article_access=free; path=/; domain=.wsj.com";
      }
      
      // Bloomberg
      if (url.includes('bloomberg.com')) {
        document.cookie = "bb_article_access=free; path=/; domain=.bloomberg.com";
      }
      
      // FT
      if (url.includes('ft.com')) {
        document.cookie = "ft_subscriber=free; path=/; domain=.ft.com";
      }
      
      // === PAYWALL OVERLAY REMOVAL ===
      const overlaySelectors = [
        '.paywall', '.subscription-wall', '.premium-wall', '.metered-content',
        '.gateway', '.wsj-paywall', '.bloomberg-paywall', '.ft-paywall',
        '[class*="paywall"]', '[id*="paywall"]', '[class*="metered"]',
        '.css-1l7c0f9', '.subscription-overlay'
      ];
      
      overlaySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      // === UNHIDE CONTENT ===
      const contentSelectors = [
        '.article-content', '.post-content', '.story-content', '.content',
        '.premium-content', 'article p', '.story-body', '.css-1l7c0f9',
        '.article-body', '.entry-content'
      ];
      
      contentSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
          el.style.opacity = '1';
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
          el.style.height = 'auto';
        });
      });
      
      // === REMOVE BLUR ===
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
        el.style.blur = '0px';
      });
      
      // === REMOVE OVERLAY ELEMENTS ===
      document.querySelectorAll('[style*="overflow:hidden"], [style*="position:fixed"]').forEach(el => {
        if (el.style.zIndex && parseInt(el.style.zIndex) > 100) {
          el.style.display = 'none';
        }
      });
      
      // === RESTORE SCROLLING ===
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      
      // === REMOVE ADS AND POPUPS ===
      document.querySelectorAll('[class*="ad"], [id*="ad"], [class*="banner"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"]').forEach(el => el.remove());
      document.querySelectorAll('[class*="cookie"], [id*="cookie"]').forEach(el => el.remove());
      
      // === REMOVE IMAGES ===
      document.querySelectorAll('img').forEach(el => el.remove());
    });

    await wait(5000);

    // Handle Cloudflare
    const pageContent = await page.content();
    if (pageContent.includes('cf-wrapper') || pageContent.includes('Are you a robot') || pageContent.includes('challenge-form')) {
      console.log('⚠️ Cloudflare detected, waiting...');
      await wait(15000);
      
      await page.evaluate(() => {
        document.querySelectorAll('button, input[type="submit"]').forEach(btn => {
          const text = btn.textContent.toLowerCase();
          if (text.includes('verify') || text.includes('continue')) {
            btn.click();
          }
        });
      });
      
      await wait(5000);
    }

    const htmlContent = await page.content();
    await browser.close();
    isProcessing = false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(htmlContent);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    isProcessing = false;
    res.status(500).send(`Error: ${error.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ BPC Extension path: ${EXTENSION_PATH}`);
});
