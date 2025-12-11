// Icon Generator Script
// Run this in a browser console or Node.js with canvas support to generate PNG icons

const sizes = [16, 48, 128];

function generateIconData(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#0078d4');
  gradient.addColorStop(1, '#106ebe');

  // Rounded rectangle
  const radius = size * 0.2;
  ctx.beginPath();
  ctx.roundRect(0, 0, size, size, radius);
  ctx.fillStyle = gradient;
  ctx.fill();

  // AI text
  ctx.fillStyle = 'white';
  ctx.font = `bold ${size * 0.5}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('AI', size / 2, size / 2);

  return canvas.toDataURL('image/png');
}

// For browser console:
// sizes.forEach(size => {
//   const dataUrl = generateIconData(size);
//   console.log(`Icon ${size}x${size}:`, dataUrl);
// });
