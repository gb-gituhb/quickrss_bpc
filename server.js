const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;

app.get('/', (req, res) => {
  res.status(200).send('Active');
});

app.get('/fetch', async (req, res) => {
  const targetUrl = req.query.url;
  
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter.');
  }

  if (isProcessing) {
    return res.status(429).send('Server is busy processing another request. Please retry in 10 seconds.');
  }

  isProcessing = true;
  let browser, page;

  try {
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
        '--use-mock-keychain'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium'
      }
    });

    browser = response.browser;
    page = response.page;

    // Get extension ID for activation
    const targets = await browser.targets();
    let extensionId = null;
    for (const target of targets) {
      const url = target.url();
      if (url.startsWith('chrome-extension://') && url.includes('manifest.json')) {
        const match = url.match(/chrome-extension:\/\/([^\/]+)/);
        if (match) {
          extensionId = match[1];
          break;
        }
      }
    }
    console.log(`🔌 Extension ID: ${extensionId || 'Not found'}`);

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // REMOVED: webdriver detection
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      window.chrome = { runtime: {} };
    });

    // ADDED: Activate BPC extension
    await page.evaluateOnNewDocument((extId) => {
      // This will run before the page loads
      // BPC extension looks for these to activate
      if (extId) {
        // Tell the extension we're ready
        try {
          chrome.runtime.sendMessage(extId, {
            action: 'activate',
            url: window.location.href
          });
        } catch (e) {
          // Extension might not be ready yet
        }
      }
      
      // Also set a flag for the extension to detect
      window.__BPC_ACTIVE = true;
      window.__BPC_BYPASS = true;
    }, extensionId);

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'media', 'font'].includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // ADDED: Activate BPC after page load too
    await page.evaluate((extId) => {
      // Send activation message to extension
      if (extId) {
        try {
          chrome.runtime.sendMessage(extId, {
            action: 'enableSite',
            url: window.location.href
          });
        } catch (e) {
          // Ignore errors
        }
      }
      
      // Try to find and click BPC button if it exists
      const bpcButtons = document.querySelectorAll('[data-bpc], .bpc-bypass, #bpc-activate');
      bpcButtons.forEach(btn => btn.click());
      
      // Remove paywall elements manually
      const paywallSelectors = [
        '.paywall', '.premium-wall', '.metered-content',
        '.gateway', '.subscription-wall', '.article-limit',
        '#paywall', '#gateway', '#subscription'
      ];
      paywallSelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
      // Show hidden content
      document.querySelectorAll('.article-content, .post-content, .story-content').forEach(el => {
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
        el.style.maxHeight = 'none';
        el.style.overflow = 'visible';
      });
    }, extensionId);

    // Wait for bypass to take effect
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Check if bypass worked
    const bypassStatus = await page.evaluate(() => {
      return {
        hasPaywall: document.querySelector('.paywall, .premium-wall, .metered-content') !== null,
        hasContent: document.querySelector('article, .article-content, .post-content') !== null,
        title: document.title
      };
    });
    console.log('📊 Bypass status:', bypassStatus);

    const content = await page.content();
    await browser.close();
    isProcessing = false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (browser) {
      await browser.close().catch(() => {});
    }
    isProcessing = false;
    res.status(500).send(error.message);
  }
});

app.listen(PORT);
