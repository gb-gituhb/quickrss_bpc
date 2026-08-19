const express = require('express');
const { connect } = require('puppeteer-real-browser');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const EXTENSION_PATH = path.join(__dirname, 'bpc_extension', 'bypass-paywalls-chrome-clean-master');

let isProcessing = false;

// Helper function for waiting
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Verify extension exists
function verifyExtension() {
  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.error('❌ Extension manifest not found at:', manifestPath);
    return false;
  }
  console.log('✅ Extension found at:', EXTENSION_PATH);
  return true;
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
    await wait(2000);
    
    // Extension detection
    const targets = await browser.targets();
    let extensionId = null;
    let extensionFound = false;
    
    for (const target of targets) {
      const url = target.url();
      if (url.startsWith('chrome-extension://')) {
        const match = url.match(/chrome-extension:\/\/([^\/]+)/);
        if (match) {
          extensionId = match[1];
          extensionFound = true;
          console.log(`🔌 Extension found with ID: ${extensionId}`);
          break;
        }
      }
    }
    
    if (!extensionFound) {
      console.log('⚠️ Extension not found, continuing...');
    }

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      
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
      
      window.chrome = { 
        runtime: { 
          id: 'test',
          sendMessage: () => {}
        } 
      };
      
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
      if (['document', 'script', 'xhr', 'fetch'].includes(resourceType)) {
        req.continue();
      } else {
        req.abort();
      }
    });

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Wait for BPC to work
    console.log('⏳ Waiting for BPC bypass...');
    await wait(3000);

    // Get the FULL HTML content (like BPC extension does)
    console.log('📝 Extracting HTML...');
    const htmlContent = await page.content();

    // Clean up the HTML - remove unnecessary elements
    const cleanHtml = await page.evaluate(() => {
      // Remove scripts
      document.querySelectorAll('script').forEach(el => el.remove());
      
      // Remove styles (keep inline styles for layout)
      document.querySelectorAll('style').forEach(el => el.remove());
      
      // Remove ads
      document.querySelectorAll('[class*="ad"], [id*="ad"], [class*="banner"], [class*="cookie"]').forEach(el => el.remove());
      
      // Remove nav, footer, header if they're not part of article
      const article = document.querySelector('article');
      if (article) {
        // If we have an article, clean within it
        article.querySelectorAll('nav, footer, header, aside').forEach(el => el.remove());
        
        // Remove any empty elements
        article.querySelectorAll('*').forEach(el => {
          if (el.textContent.trim() === '' && el.children.length === 0) {
            el.remove();
          }
        });
      }
      
      return document.documentElement.outerHTML;
    });

    console.log(`✅ Extracted ${cleanHtml.length} characters of HTML`);

    await browser.close();
    isProcessing = false;

    // Return HTML with proper content type
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(cleanHtml);
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
  verifyExtension();
});
