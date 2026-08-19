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

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Basic stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await wait(3000);

    // SITE-SPECIFIC BYPASSES
    console.log('🔧 Applying site-specific bypasses...');
    await page.evaluate(() => {
      const url = window.location.href;
      
      // NY Times bypass
      if (url.includes('nytimes.com')) {
        document.cookie = "nyt_cc=bypass; path=/; domain=.nytimes.com";
        document.querySelectorAll('[class*="paywall"], [class*="gate"], [class*="metered"]').forEach(el => el.remove());
        document.querySelectorAll('.article-content, .story-body, .css-1l7c0f9').forEach(el => {
          el.style.display = 'block';
          el.style.maxHeight = 'none';
          el.style.overflow = 'visible';
        });
      }
      
      // The Hindu bypass
      if (url.includes('thehindu.com')) {
        document.querySelectorAll('.paywall, .subscription, .premium-content').forEach(el => el.remove());
        document.querySelectorAll('.article-content, .story-content').forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
        });
      }
      
      // Mint bypass
      if (url.includes('livemint.com')) {
        document.querySelectorAll('.paywall, .subscription-wrap, .premium-story').forEach(el => el.remove());
        document.querySelectorAll('.article-content, .story-content').forEach(el => {
          el.style.display = 'block';
          el.style.maxHeight = 'none';
        });
      }
      
      // FT bypass
      if (url.includes('ft.com')) {
        document.querySelectorAll('.paywall, .subscription, .gateway').forEach(el => el.remove());
        document.querySelectorAll('.article-content, .content, .story').forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
        });
      }
      
      // Bloomberg bypass
      if (url.includes('bloomberg.com')) {
        document.cookie = "bb_article_access=free; path=/; domain=.bloomberg.com";
        document.querySelectorAll('.paywall, .subscription, .gateway').forEach(el => el.remove());
        document.querySelectorAll('.article-content, .story-content').forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
        });
      }
      
      // WSJ bypass
      if (url.includes('wsj.com')) {
        document.cookie = "wsj_cc=bypass; path=/; domain=.wsj.com";
        document.querySelectorAll('.wsj-paywall, .subscription, .gateway').forEach(el => el.remove());
        document.querySelectorAll('.article-content, .story-content').forEach(el => {
          el.style.display = 'block';
          el.style.visibility = 'visible';
        });
      }
      
      // Generic fixes (for all sites)
      document.querySelectorAll('.paywall, .subscription, .gateway, [class*="paywall"], [id*="paywall"], [class*="metered"]').forEach(el => el.remove());
      document.querySelectorAll('.article-content, .post-content, .story-content, .content, .premium-content, article p').forEach(el => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
      });
      
      // Remove blur
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
      });
    });

    await wait(5000);

    // Handle Cloudflare
    const pageContent = await page.content();
    if (pageContent.includes('cf-wrapper') || pageContent.includes('Are you a robot')) {
      console.log('⚠️ Cloudflare detected, waiting...');
      await wait(15000);
      
      await page.evaluate(() => {
        document.querySelectorAll('button').forEach(btn => {
          if (btn.textContent.toLowerCase().includes('verify')) btn.click();
        });
      });
      
      await wait(5000);
    }

    // Clean up: remove ads, images, popups
    await page.evaluate(() => {
      document.querySelectorAll('[class*="ad"], [id*="ad"], img, [class*="popup"], [class*="modal"], [class*="cookie"]').forEach(el => el.remove());
    });

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
