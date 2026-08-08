const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log(`PAGE LOG [${msg.type()}]:`, msg.text());
  });

  page.on('pageerror', error => {
    console.log(`PAGE ERROR:`, error.message);
  });

  page.on('response', response => {
    if (response.status() >= 400) {
      console.log(`HTTP ${response.status()} from ${response.url()}`);
    }
  });

  await page.goto('http://localhost:5173', { waitUntil: 'networkidle0' });
  
  // also grab the HTML to see what is rendering
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log('HTML RENDERS AS:', html.substring(0, 500));
  
  await browser.close();
})();
