const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');

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

    // === INCREASED: Wait for extension to load ===
    console.log('⏳ Waiting for extension to load...');
    await wait(5000); // Increased from 2000ms

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

    // Set Google Referer
    await page.setExtraHTTPHeaders({
      'Referer': 'https://www.google.com/'
    });

    // Basic stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    // Block tracking and paywall scripts
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const url = req.url().toLowerCase();
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
          url.includes('quantcast')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // === CHANGED: Use networkidle2 for full page load ===
    console.log('⏳ Navigating (waiting for full load)...');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2', // Changed from domcontentloaded
      timeout: 60000 // Increased from 30000
    });

    // === INCREASED: Wait for BPC to work ===
    console.log('⏳ Waiting for BPC to bypass paywall...');
    await wait(8000); // Increased from 2000ms

    // Check if paywall is still present
    const hasPaywall = await page.evaluate(() => {
      return document.querySelector('.paywall, .subscription-wall, [class*="paywall"], [class*="metered"]') !== null;
    });

    if (hasPaywall) {
      console.log('⚠️ Paywall still present, waiting longer...');
      await wait(10000); // Extra time if paywall still there
    }

    // Apply bypasses
    console.log('🔧 Applying bypasses...');
    await page.evaluate(() => {
      const url = window.location.href;
      
      // Set essential cookies
      if (url.includes('nytimes.com')) {
        document.cookie = "nyt_cc=bypass; path=/; domain=.nytimes.com";
        document.cookie = "nyt_metered=0; path=/; domain=.nytimes.com";
      }
      if (url.includes('wsj.com')) {
        document.cookie = "wsj_cc=bypass; path=/; domain=.wsj.com";
        document.cookie = "wsj_article_access=free; path=/; domain=.wsj.com";
      }
      if (url.includes('bloomberg.com')) {
        document.cookie = "bb_article_access=free; path=/; domain=.bloomberg.com";
      }
      if (url.includes('ft.com')) {
        document.cookie = "ft_subscriber=free; path=/; domain=.ft.com";
      }
      
      // Remove ALL paywall elements
      const overlaySelectors = [
        '.paywall', '.subscription-wall', '.premium-wall', '.metered-content',
        '.gateway', '.wsj-paywall', '.bloomberg-paywall', '.ft-paywall',
        '[class*="paywall"]', '[id*="paywall"]', '[class*="metered"]',
        '[class*="subscription"]', '[id*="subscription"]'
      ];
      overlaySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      // Unhide ALL content
      const contentSelectors = [
        '.article-content', '.post-content', '.story-content', '.content',
        '.premium-content', 'article p', '.article-body', '.entry-content',
        '.story-body', '.main-content'
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
      
      // Remove blur
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
        el.style.blur = '0px';
      });
      
      // Restore scrolling
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      
      // Remove images
      document.querySelectorAll('img').forEach(el => el.remove());
    });

    // === INCREASED: Wait for bypass to take effect ===
    console.log('⏳ Waiting for bypass to take effect...');
    await wait(5000); // Increased from 3000ms

    // Check again if paywall was removed
    const paywallRemoved = await page.evaluate(() => {
      return document.querySelector('.paywall, .subscription-wall, [class*="paywall"]') === null;
    });

    if (paywallRemoved) {
      console.log('✅ Paywall bypassed successfully!');
    } else {
      console.log('⚠️ Paywall may still be present');
      
      // Try archive fallback
      console.log('🔄 Trying archive fallback...');
      const archiveUrl = `https://archive.is/latest/${targetUrl}`;
      try {
        await page.goto(archiveUrl, {
          waitUntil: 'networkidle2',
          timeout: 15000
        });
        await wait(3000);
        
        await page.evaluate(() => {
          document.querySelectorAll('[class*="ad"], img, [class*="popup"]').forEach(el => el.remove());
        });
        console.log('✅ Archive fallback successful');
      } catch (archiveError) {
        console.log('⚠️ Archive fallback failed');
      }
    }

    const htmlContent = await page.content();
    
    // Cleanup
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
});
