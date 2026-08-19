const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;

// Helper to find extension ID
async function getExtensionId(browser) {
  const targets = await browser.targets();
  for (const target of targets) {
    const url = target.url();
    if (url.startsWith('chrome-extension://') && url.includes('manifest.json')) {
      const match = url.match(/chrome-extension:\/\/([^\/]+)/);
      if (match) return match[1];
    }
  }
  return null;
}

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
        '--disable-software-rasterizer',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-background-networking',
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
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080'
      ],
      customConfig: {
        chromePath: '/usr/bin/chromium',
        ignoreHTTPSErrors: true,
        defaultViewport: {
          width: 1920,
          height: 1080,
          deviceScaleFactor: 1,
          hasTouch: false,
          isLandscape: true,
          isMobile: false
        }
      }
    });

    browser = response.browser;
    page = response.page;

    // Get extension ID for debugging
    const extensionId = await getExtensionId(browser);
    console.log(`🔌 Extension ID: ${extensionId || 'Not found'}`);

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Comprehensive stealth
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
      // Override navigator properties
      Object.defineProperty(navigator, 'plugins', { 
        get: () => {
          const plugins = [
            { name: 'Chrome PDF Plugin' },
            { name: 'Chrome PDF Viewer' },
            { name: 'Native Client' }
          ];
          plugins.length = 3;
          plugins.item = (i) => plugins[i];
          plugins.namedItem = (name) => plugins.find(p => p.name === name);
          return plugins;
        }
      });
      
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'platform', { get: () => 'Win32' });
      
      // Mock chrome
      window.chrome = { runtime: {} };
      
      // Override permissions
      const originalQuery = window.navigator.permissions?.query;
      if (originalQuery) {
        window.navigator.permissions.query = (parameters) => (
          parameters.name === 'notifications' ?
            Promise.resolve({ state: Notification.permission }) :
            originalQuery(parameters)
        );
      }
    });

    // Block unnecessary resources
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'media', 'font'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    // Navigate
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for potential Cloudflare challenge
    console.log('⏳ Waiting for page to load...');
    await page.waitForTimeout(5000);

    // Check for Cloudflare
    const hasCloudflare = await page.evaluate(() => {
      return document.querySelector('#cf-wrapper, #challenge-form, .cf-browser-verification, [id*="challenge"]') !== null;
    });

    if (hasCloudflare) {
      console.log('⚠️ Cloudflare detected, waiting for bypass...');
      await page.waitForTimeout(10000);
      
      // Try to interact if needed
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button');
        buttons.forEach(btn => {
          const text = btn.textContent.toLowerCase();
          if (text.includes('verify') || text.includes('continue') || text.includes('click')) {
            btn.click();
          }
        });
      });
      
      await page.waitForTimeout(5000);
    }

    const content = await page.content();
    await browser.close().catch(() => {});
    isProcessing = false;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(content);
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
  
  // Verify extension exists
  if (fs.existsSync(EXTENSION_PATH)) {
    const files = fs.readdirSync(EXTENSION_PATH);
    console.log(`📁 Extension loaded: ${files.length} files`);
    if (files.includes('manifest.json')) {
      console.log('✅ Extension manifest found');
    }
  } else {
    console.log('❌ Extension not found at:', EXTENSION_PATH);
  }
});
