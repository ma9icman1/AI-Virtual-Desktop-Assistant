const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BRAIN_DIR = 'C:/Users/ma9ic/.gemini/antigravity/brain/edca3bbf-1fc9-4d60-b573-437def3f9926';
const OUT_DIR = path.resolve(__dirname, '../public/avatar2d');

const imgPortrait = path.join(BRAIN_DIR, 'photoreal_blonde_portrait_1790971058231.jpg');
const imgSmile    = path.join(BRAIN_DIR, 'photoreal_blonde_smile_1790971080594.jpg');
const imgOpen     = path.join(BRAIN_DIR, 'photoreal_blonde_open_1790971103489.jpg');
const imgBlink    = path.join(BRAIN_DIR, 'photoreal_blonde_blink_1790971123633.jpg');
const imgO        = path.join(BRAIN_DIR, 'photoreal_blonde_o_1790971142228.jpg');

const CANVAS_W = 800;
const CANVAS_H = 1000;

async function run() {
  console.log('Building clean photorealistic avatar layers with smooth alpha silhouette...');

  const resizeOpts = { width: CANVAS_W, height: CANVAS_H, fit: 'cover', position: 'top' };

  // 1. Clean Body Silhouette Mask (Feathered edge, zero noise, zero pixelation)
  const silhouetteSvg = `
    <svg width="${CANVAS_W}" height="${CANVAS_H}">
      <defs>
        <filter id="featherEdge">
          <feGaussianBlur stdDeviation="3.5" />
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
  const silhouetteMaskBuf = await sharp(Buffer.from(silhouetteSvg)).png().toBuffer();

  const portraitPng = await sharp(imgPortrait).resize(resizeOpts).png().toBuffer();

  // Apply silhouette to body.png
  await sharp(portraitPng)
    .composite([{ input: silhouetteMaskBuf, blend: 'dest-in' }])
    .png()
    .toFile(path.join(OUT_DIR, 'body.png'));
  console.log('Saved clean body.png');

  // Eye Mask SVG
  const eyeMaskSvg = `
    <svg width="${CANVAS_W}" height="${CANVAS_H}">
      <defs>
        <filter id="eyeBlur">
          <feGaussianBlur stdDeviation="8" />
        </filter>
      </defs>
      <g filter="url(#eyeBlur)">
        <ellipse cx="336" cy="324" rx="72" ry="42" fill="white" />
        <ellipse cx="464" cy="324" rx="72" ry="42" fill="white" />
      </g>
    </svg>
  `;
  const eyeMaskBuf = await sharp(Buffer.from(eyeMaskSvg)).png().toBuffer();

  // Helper for feature layers
  async function isolateFeature(imgFile, maskBuf) {
    const resizedPng = await sharp(imgFile).resize(resizeOpts).png().toBuffer();
    return sharp(resizedPng)
      .composite([{ input: maskBuf, blend: 'dest-in' }])
      .png()
      .toBuffer();
  }

  // 2. Eyes Open
  const eyesOpen = await isolateFeature(imgPortrait, eyeMaskBuf);
  await sharp(eyesOpen).toFile(path.join(OUT_DIR, 'eyes_open.png'));
  console.log('Saved eyes_open.png');

  // 3. Eyes Closed
  const eyesClosed = await isolateFeature(imgBlink, eyeMaskBuf);
  await sharp(eyesClosed).toFile(path.join(OUT_DIR, 'eyes_closed.png'));
  console.log('Saved eyes_closed.png');

  // 4. Eyes Half
  const eyesHalf = await sharp(eyesOpen)
    .composite([{ input: eyesClosed, blend: 'over', opacity: 0.5 }])
    .png()
    .toBuffer();
  await sharp(eyesHalf).toFile(path.join(OUT_DIR, 'eyes_half.png'));
  console.log('Saved eyes_half.png');

  // Mouth Mask SVG
  const mouthMaskSvg = `
    <svg width="${CANVAS_W}" height="${CANVAS_H}">
      <defs>
        <filter id="mouthBlur">
          <feGaussianBlur stdDeviation="10" />
        </filter>
      </defs>
      <g filter="url(#mouthBlur)">
        <ellipse cx="400" cy="455" rx="85" ry="48" fill="white" />
      </g>
    </svg>
  `;
  const mouthMaskBuf = await sharp(Buffer.from(mouthMaskSvg)).png().toBuffer();

  // 5. Mouth Closed
  const mouthClosed = await isolateFeature(imgPortrait, mouthMaskBuf);
  await sharp(mouthClosed).toFile(path.join(OUT_DIR, 'mouth_closed.png'));
  console.log('Saved mouth_closed.png');

  // 6. Mouth Smile
  const mouthSmile = await isolateFeature(imgSmile, mouthMaskBuf);
  await sharp(mouthSmile).toFile(path.join(OUT_DIR, 'mouth_smile.png'));
  console.log('Saved mouth_smile.png');

  // 7. Mouth Open Wide
  const mouthWide = await isolateFeature(imgOpen, mouthMaskBuf);
  await sharp(mouthWide).toFile(path.join(OUT_DIR, 'mouth_open_wide.png'));
  console.log('Saved mouth_open_wide.png');

  // 8. Mouth Open Small
  const mouthSmall = await sharp(mouthClosed)
    .composite([{ input: mouthWide, blend: 'over', opacity: 0.5 }])
    .png()
    .toBuffer();
  await sharp(mouthSmall).toFile(path.join(OUT_DIR, 'mouth_open_small.png'));
  console.log('Saved mouth_open_small.png');

  // 9. Mouth O
  const mouthO = await isolateFeature(imgO, mouthMaskBuf);
  await sharp(mouthO).toFile(path.join(OUT_DIR, 'mouth_o.png'));
  console.log('Saved mouth_o.png');

  // Cleanup test files
  try {
    fs.unlinkSync(path.join(OUT_DIR, 'test_matting.png'));
    fs.unlinkSync(path.join(OUT_DIR, 'test_silhouette.png'));
  } catch(e) {}

  console.log('All 9 photorealistic PNG layers successfully built with clean alpha transparency!');
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
