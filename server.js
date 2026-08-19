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
    console.log('⏳ Waiting for extension to load...');
    await wait(3000);
    
    // Extension detection
    let extensionId = null;
    let extensionFound = false;
    let attempts = 0;
    const maxAttempts = 3;
    
    while (!extensionFound && attempts < maxAttempts) {
      attempts++;
      const targets = await browser.targets();
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
      if (!extensionFound && attempts < maxAttempts) {
        await wait(2000);
      }
    }

    if (!extensionFound) {
      console.log('⚠️ Extension not loaded, continuing...');
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

    // CRITICAL FIX: ALLOW EVERYTHING EXCEPT IMAGES AND VIDEOS
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      // Block ONLY heavy resources
      if (['image', 'media', 'video', 'eventsource', 'websocket'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue(); // Allow everything else: CSS, Fonts, JS, XHR
      }
    });

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    // Wait for BPC to work
    console.log('⏳ Waiting for BPC bypass...');
    await wait(3000);

    // Check for Cloudflare
    const pageContent = await page.content();
    const hasCloudflare = pageContent.includes('cf-wrapper') || 
                         pageContent.includes('challenge-form') ||
                         pageContent.includes('Are you a robot');

    if (hasCloudflare) {
      console.log('⚠️ Cloudflare detected! Waiting for bypass...');
      await wait(15000);
      
      await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, input[type="submit"]');
        buttons.forEach(btn => {
          const text = btn.textContent.toLowerCase();
          if (text.includes('verify') || text.includes('continue')) {
            btn.click();
          }
        });
      });
      
      await wait(5000);
    } else {
      console.log('✅ No Cloudflare detected');
    }

    // ONLY REMOVE ADS AND POPUPS - KEEP EVERYTHING ELSE
    await page.evaluate(() => {
      // Remove ads
      document.querySelectorAll('[class*="ad"], [id*="ad"], [class*="banner"]').forEach(el => el.remove());
      
      // Remove popups
      document.querySelectorAll('[class*="popup"], [class*="modal"], [class*="overlay"]').forEach(el => el.remove());
      
      // Remove newsletter signups (but keep the text content)
      document.querySelectorAll('[class*="newsletter"], [class*="signup"]').forEach(el => el.remove());
      
      // Remove cookie notices
      document.querySelectorAll('[class*="cookie"], [id*="cookie"]').forEach(el => el.remove());
    });

    // Get the FULL HTML with ALL styles preserved
    console.log('📝 Extracting full HTML with styles...');
    const htmlContent = await page.content();

    console.log(`✅ Extracted ${htmlContent.length} characters`);

    await browser.close();
    isProcessing = false;

    // Return styled HTML
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
  verifyExtension();
});
