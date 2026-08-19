app.get('/fetch', async (req, res) => {
  // ... URL cleaning code ...

  // ===== DETECT KOREADER =====
  const userAgent = req.headers['user-agent'] || '';
  const isKOReader = userAgent.toLowerCase().includes('koreader');
  console.log(`📱 User-Agent: ${userAgent}`);
  console.log(`📱 isKOReader: ${isKOReader}`);

  // ... rest of code ...

  // After getting htmlContent, check if it's KOReader
  if (isKOReader) {
    // Extract text for KOReader
    const textContent = await page.evaluate(() => {
      const paragraphs = document.querySelectorAll('p, .article-body p, .content p, .story-body p, .article-content p');
      let text = '';
      const seen = new Set();
      
      paragraphs.forEach(p => {
        const content = p.textContent ? p.textContent.trim() : '';
        if (content && content.length > 20 && !seen.has(content)) {
          seen.add(content);
          if (!content.includes('Continue Reading') && 
              !content.includes('Continue reading') &&
              !content.includes('Read more') &&
              !content.includes('Sign up') &&
              !content.includes('Subscribe') &&
              !content.includes('Newsletter')) {
            text += '<p>' + content + '</p>';
          }
        }
      });
      
      if (!text) {
        const articleBody = document.querySelector('.article-body, .article-content, .story-body, .content, article');
        if (articleBody) {
          const allText = articleBody.textContent || '';
          const lines = allText.split('\n').filter(line => line.trim().length > 20);
          lines.forEach(line => {
            if (!line.includes('Continue Reading') && !line.includes('Read more')) {
              text += '<p>' + line.trim() + '</p>';
            }
          });
        }
      }
      
      return text;
    });

    // Send simple HTML for KOReader
    const finalHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Article</title>
  <style>
    body { 
      font-family: Georgia, serif; 
      max-width: 700px; 
      margin: 0 auto; 
      padding: 20px; 
      line-height: 1.8; 
      font-size: 18px;
      color: #000;
      background: #fff;
    }
    p { 
      margin: 0 0 1.2em 0; 
      text-align: justify;
    }
  </style>
</head>
<body>
${textContent}
</body>
</html>`;
    
    console.log('📝 Sending text-only version for KOReader');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    isProcessing = false;
    return res.send(finalHtml);
  }

  // ===== FOR BROWSER: Send full HTML =====
  const htmlContent = await page.content();
  console.log('📝 Sending full HTML for browser');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(htmlContent);
});
