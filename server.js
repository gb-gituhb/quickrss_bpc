const express = require('express');
const { connect } = require('puppeteer-real-browser');
const cheerio = require('cheerio');
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
      
      try {
        const $ = cheerio.load(archiveContent);
        
        $('.paywall, .subscription-wall, .premium-wall, .metered-content, .gateway, [class*="paywall"], [id*="paywall"]').remove();
        
        const contentSelectors = [
          '.article-content', '.post-content', '.story-content', '.content',
          'article', '.main-content', '.entry-content', '.story-body',
          '.article-body', '#content', '.body-content'
        ];
        
        let contentFound = false;
        for (const selector of contentSelectors) {
          if ($(selector).length > 0) {
            $(selector).css('display', 'block');
            contentFound = true;
            break;
          }
        }
        
        if (!contentFound) {
          $('p').css('display', 'block');
        }
        
        $('img').remove();
        $('.ad, .banner, .popup, .cookie, [class*="banner"], [class*="popup"]').remove();
        
        const cleanHtml = $.html();
        
        console.log('✅ Returned cleaned archive content (no browser)');
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        isProcessing = false;
        return res.send(cleanHtml);
      } catch (cleanError) {
        console.log('⚠️ Cheerio cleaning failed, falling back to browser:', cleanError.message);
      }
    }

    // === FALLBACK TO BPC ===
    console.log('📚 Archive failed, falling back to BPC...');

    // SIMPLIFIED: Let the library handle everything
    const response = await connect({
      headless: true,
      turnstile: true,
      fingerprint: true,
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    browser = response.browser;
    page = response.page;

    console.log('✅ Browser connected');

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
    await page.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000
    });

    await wait(3000);

    await page.evaluate(() => {
      const url = window.location.href;
      
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
      
      const overlaySelectors = [
        '.paywall', '.subscription-wall', '.premium-wall', '.metered-content',
        '.gateway', '.wsj-paywall', '.bloomberg-paywall', '.ft-paywall',
        '[class*="paywall"]', '[id*="paywall"]', '[class*="metered"]',
        '[class*="subscription"]', '[id*="subscription"]'
      ];
      overlaySelectors.forEach(selector => {
        document.querySelectorAll(selector).forEach(el => el.remove());
      });
      
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
      
      document.querySelectorAll('[style*="blur"]').forEach(el => {
        el.style.filter = 'none';
        el.style.backdropFilter = 'none';
        el.style.blur = '0px';
      });
      
      document.body.style.overflow = 'auto';
      document.documentElement.style.overflow = 'auto';
      
      document.querySelectorAll('img').forEach(el => el.remove());
    });

    await wait(3000);

    const htmlContent = await page.content();
    
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
