const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BRAIN_DIR = 'C:/Users/ma9ic/.gemini/antigravity/brain/edca3bbf-1fc9-4d60-b573-437def3f9926';
const imgPortrait = path.join(BRAIN_DIR, 'photoreal_blonde_portrait_1790971058231.jpg');

async function testSilhouette() {
  const CANVAS_W = 800;
  const CANVAS_H = 1000;
  const resizeOpts = { width: CANVAS_W, height: CANVAS_H, fit: 'cover', position: 'top' };

  // Silhouette mask SVG matching the woman's head, hair, and shoulders
  const silhouetteSvg = `
    <svg width="${CANVAS_W}" height="${CANVAS_H}">
      <defs>
        <filter id="featherEdge">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <path d="M 400 55
               C 340 55, 290 85, 260 130
               C 225 185, 200 270, 185 360
               C 170 440, 150 520, 130 610
               C 100 645, 60 690, 20 730
               L 0 750 L 0 1000 L 800 1000 L 800 750 L 780 730
               C 740 690, 700 645, 670 610
               C 650 520, 630 440, 615 360
               C 600 270, 575 185, 540 130
               C 510 85, 460 55, 400 55 Z"
            fill="white"
            filter="url(#featherEdge)" />
    </svg>
  `;

  const maskBuf = await sharp(Buffer.from(silhouetteSvg)).png().toBuffer();

  const portraitPng = await sharp(imgPortrait).resize(resizeOpts).png().toBuffer();

  const masked = await sharp(portraitPng)
    .composite([{ input: maskBuf, blend: 'dest-in' }])
    .png()
    .toBuffer();

  await sharp(masked).toFile('public/avatar2d/test_silhouette.png');
  console.log('Saved test_silhouette.png');
}

testSilhouette().catch(e => console.error(e));
