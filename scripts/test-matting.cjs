const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const BRAIN_DIR = 'C:/Users/ma9ic/.gemini/antigravity/brain/edca3bbf-1fc9-4d60-b573-437def3f9926';
const imgPortrait = path.join(BRAIN_DIR, 'photoreal_blonde_portrait_1790971058231.jpg');

async function testMatting() {
  const CANVAS_W = 800;
  const CANVAS_H = 1000;
  const resizeOpts = { width: CANVAS_W, height: CANVAS_H, fit: 'cover', position: 'top' };

  const buf = await sharp(imgPortrait).resize(resizeOpts).png().toBuffer();
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Background sample color from top corners
  // Let's sample a few border points: (0,0), (w-1,0), (0, 200), (w-1, 200)
  // Let's do a Breadth-First-Search (BFS) flood fill starting from the perimeter pixels (top edge, left/right edges above shoulders y < 650)
  const isBg = new Uint8Array(w * h);
  const queue = [];

  // Seed with top row, and upper side borders
  for (let x = 0; x < w; x++) {
    queue.push(x, 0);
    isBg[x] = 1;
  }
  for (let y = 1; y < 650; y++) {
    queue.push(0, y);
    isBg[y * w] = 1;
    queue.push(w - 1, y);
    isBg[y * w + (w - 1)] = 1;
  }

  // Color distance threshold: background is pale gray/white.
  // The woman has blonde hair (rich yellow/brown/amber, high chroma or darker luminance)
  // or dark off-shoulder dress (very dark).
  // Let's check distance to pure neutral white/light-gray (R~G~B > 190 and low saturation)
  let head = 0;
  while (head < queue.length) {
    const cx = queue[head++];
    const cy = queue[head++];

    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1]
    ];

    for (const [nx, ny] of neighbors) {
      if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
        const idx = ny * w + nx;
        if (!isBg[idx]) {
          const pi = idx * 4;
          const r = data[pi];
          const g = data[pi + 1];
          const b = data[pi + 2];

          // Check if this pixel is background:
          // Background in this studio shot is very high luminance (min(r,g,b) > 185)
          // and low saturation (difference between max and min channel < 30)
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const satDiff = maxC - minC;

          // Hair and skin have higher saturation or lower brightness
          const isBackgroundPixel = (minC > 180 && satDiff < 32);

          if (isBackgroundPixel) {
            isBg[idx] = 1;
            queue.push(nx, ny);
          }
        }
      }
    }
  }

  console.log('BFS finished, total background pixels identified:', queue.length / 2);

  // Now create smooth alpha mask from isBg:
  // For pixels in isBg: alpha = 0.
  // For boundary pixels (within 2-3 pixels of isBg): feather alpha smoothly!
  const alphaChannel = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    alphaChannel[i] = isBg[i] ? 0 : 255;
  }

  // Smooth the alpha channel with sharp blur for natural feathered edges
  const featheredAlpha = await sharp(Buffer.from(alphaChannel), {
    raw: { width: w, height: h, channels: 1 }
  })
    .blur(1.5)
    .raw()
    .toBuffer();

  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 3] = featheredAlpha[i];
  }

  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .png()
    .toFile('public/avatar2d/test_matting.png');

  console.log('Saved test_matting.png successfully!');
}

testMatting().catch(e => console.error(e));
