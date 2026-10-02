const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

app.disableHardwareAcceleration();

const files = [
  'body',
  'eyes_open',
  'eyes_half',
  'eyes_closed',
  'mouth_closed',
  'mouth_smile',
  'mouth_open_small',
  'mouth_open_wide',
  'mouth_o'
];

const WIDTH = 800;
const HEIGHT = 1000;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    transparent: true,
    frame: false,
    webPreferences: {
      offscreen: false
    }
  });

  const dir = path.resolve(__dirname, '../public/avatar2d');

  for (const name of files) {
    const svgPath = path.join(dir, `${name}.svg`);
    const pngPath = path.join(dir, `${name}.png`);

    if (!fs.existsSync(svgPath)) {
      console.warn(`File not found: ${svgPath}`);
      continue;
    }

    const svg = fs.readFileSync(svgPath, 'utf8');
    const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      background: transparent !important;
      width: ${WIDTH}px;
      height: ${HEIGHT}px;
      overflow: hidden;
    }
    svg {
      width: 100%;
      height: 100%;
      display: block;
    }
  </style>
</head>
<body>
  ${svg}
</body>
</html>`;

    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    // Brief delay to ensure all gradients, filters, and fonts have painted
    await new Promise(r => setTimeout(r, 200));

    const image = await win.capturePage();
    fs.writeFileSync(pngPath, image.toPNG());
    const stats = fs.statSync(pngPath);
    console.log(`Rendered ${name}.png (${WIDTH}x${HEIGHT}) - ${stats.size} bytes`);
  }

  console.log('All avatar layers rendered to PNG successfully!');
  app.quit();
});
