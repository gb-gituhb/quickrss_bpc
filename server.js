const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const path = require('path');
const dns = require('dns');

// DNS fix for Render
dns.setDefaultResultOrder('ipv4first');

// Add stealth plugin
puppeteer.use(StealthPlugin());

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

    // === ARCHIVE-FIRST STRATEGY ===
    console.log('📚 Trying archive-first approach...');
    
    const archiveUrls = [
      `https://web.archive.org/web/2/${targetUrl}`,
      `https://web.archive.org/web/20260819000000/${targetUrl}`,
      `https://web.archive.org/web/20260818000000/${targetUrl}`
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
      
      browser = await puppeteer.launch({
        headless: 'new',
        executablePath: '/usr/bin/chromium',
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--single-process',
          '--no-zygote',
          '--js-flags="--max-old-space-size=128"'
        ]
      });

      page = await browser.newPage();
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
          '.article-body', '#content', '.body-content', '.ArticleBody',
          '.article-body', '.story-body', '.post-body'
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
      
      await page.close().catch(() => {});
      await browser.close().catch(() => {});
      forceGC();
      
      isProcessing = false;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(cleanHtml);
    }

    // === FALLBACK TO BPC WITH PUPPETEER+STEALTH ===
    console.log('📚 Archive failed, falling back to BPC with Puppeteer+Stealth...');

    // Launch with stealth and BPC extension
    browser = await puppeteer.launch({
      headless: false,
      executablePath: '/usr/bin/chromium',
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
      defaultViewport: {
        width: 1024,
        height: 600
      }
    });

    page = await browser.newPage();

    // Set user agent
    await page.setUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');

    // Set Google Referer
    await page.setExtraHTTPHeaders({
      'Referer': 'https://www.google.com/'
    });

    // Block tracking and paywall scripts
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

    // Navigate
    console.log('⏳ Navigating...');
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await wait(3000);

    // === CHECK IF BPC IS LOADED ===
    console.log('🔍 Checking BPC status...');
    const bpcDebug = await page.evaluate(() => {
      const hasBpc = typeof window.bpc !== 'undefined';
      const bpcFunctions = hasBpc ? Object.keys(window.bpc) : [];
      const hasChrome = typeof window.chrome !== 'undefined';
      const hasChromeRuntime = hasChrome && typeof window.chrome.runtime !== 'undefined';
      
      return {
        hasBpc,
        bpcFunctions,
        hasChrome,
        hasChromeRuntime
      };
    });

    console.log('📊 BPC Debug:', JSON.stringify(bpcDebug, null, 2));

    // If BPC not loaded, try to find extension and activate
    if (!bpcDebug.hasBpc) {
      console.log('⚠️ BPC not detected, trying to find extension...');
      
      // Find extension ID
      const targets = await browser.targets();
      let extensionId = null;
      for (const target of targets) {
        const url = target.url();
        if (url.startsWith('chrome-extension://')) {
          const match = url.match(/chrome-extension:\/\/([^\/]+)/);
          if (match) {
            extensionId = match[1];
            console.log(`🔌 Found extension: ${extensionId}`);
            break;
          }
        }
      }
      
      if (extensionId) {
        // Try to activate via extension
        await page.evaluate((extId) => {
          // Try chrome.runtime
          if (typeof chrome !== 'undefined' && chrome.runtime) {
            try {
              chrome.runtime.sendMessage(extId, { action: 'activate' });
            } catch(e) {}
          }
          
          // Dispatch events
          document.dispatchEvent(new Event('bpc-activate'));
          document.dispatchEvent(new CustomEvent('bpc-activate', { 
            detail: { action: 'bypass', force: true } 
          }));
          
          // Click BPC buttons
          document.querySelectorAll('[data-bpc], .bpc-bypass, .bpc-activate').forEach(el => el.click());
        }, extensionId);
        
        await wait(3000);
      }
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
      if (url.includes('economist.com')) {
        document.cookie = "ec_subscriber=free; path=/; domain=.economist.com";
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

    // Wait for bypass to take effect
    await wait(3000);

    // Check if paywall was removed
    const paywallRemoved = await page.evaluate(() => {
      return document.querySelector('.paywall, .subscription-wall, [class*="paywall"]') === null;
    });

    if (paywallRemoved) {
      console.log('✅ Paywall bypassed successfully!');
    } else {
      console.log('⚠️ Paywall may still be present');
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
  console.log(`📚 Archive-first mode enabled (web.archive.org only)`);
});
