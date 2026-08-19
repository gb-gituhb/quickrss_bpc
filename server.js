const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Force garbage collection
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
        '--disable-jit', // Reduce memory
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

    // Wait for extension
    await wait(2000);

    // Minimal bypass - just the essentials
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

    // Basic stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Minimal request blocking
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url().toLowerCase();
      // Block ONLY paywall scripts to save memory
      if (url.includes('paywall') || url.includes('subscription') || url.includes('cxense')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate with shorter timeout
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded', // Faster than networkidle2
      timeout: 30000
    });

    await wait(2000);

    // Simplified bypass
    await page.evaluate(() => {
      const url = window.location.href;
      
      // Set essential cookies
      if (url.includes('nytimes.com')) {
        document.cookie = "nyt_cc=bypass; path=/; domain=.nytimes.com";
      }
      if (url.includes('wsj.com')) {
        document.cookie = "wsj_cc=bypass; path=/; domain=.wsj.com";
      }
      if (url.includes('bloomberg.com')) {
        document.cookie = "bb_article_access=free; path=/; domain=.bloomberg.com";
      }
      
      // Remove paywall overlays
      document.querySelectorAll('.paywall, .subscription-wall, [class*="paywall"]').forEach(el => el.remove());
      
      // Unhide content
      document.querySelectorAll('.article-content, .story-content, .content, article p').forEach(el => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.maxHeight = 'none';
      });
      
      // Remove blur
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
      });
      
      // Remove images
      document.querySelectorAll('img').forEach(el => el.remove());
    });

    await wait(3000);

    const htmlContent = await page.content();
    
    // Aggressive cleanup
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

// Periodic memory cleanup
setInterval(forceGC, 30000);

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`✅ BPC Extension path: ${EXTENSION_PATH}`);
  console.log(`⚠️ Memory limit: 512MB`);
});
