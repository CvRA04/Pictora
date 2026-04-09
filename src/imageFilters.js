function clamp(v) {
  return Math.max(0, Math.min(255, Math.round(v)))
}

// Generic convolution — kernel is a 2D array, offset shifts the result
function convolve(imageData, kernel, offset = 0) {
  const { width, height, data } = imageData
  const kSize = kernel.length
  const kHalf = Math.floor(kSize / 2)
  const output = new Uint8ClampedArray(data)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0
      for (let ky = 0; ky < kSize; ky++) {
        for (let kx = 0; kx < kSize; kx++) {
          const px = Math.min(Math.max(x + kx - kHalf, 0), width - 1)
          const py = Math.min(Math.max(y + ky - kHalf, 0), height - 1)
          const i = (py * width + px) * 4
          const w = kernel[ky][kx]
          r += data[i] * w
          g += data[i + 1] * w
          b += data[i + 2] * w
        }
      }
      const i = (y * width + x) * 4
      output[i]     = clamp(r + offset)
      output[i + 1] = clamp(g + offset)
      output[i + 2] = clamp(b + offset)
    }
  }
  return new ImageData(output, width, height)
}

// O(w*h) separable box blur using prefix sums — fast at any radius
export function applyBlur(imageData, { radius }) {
  const r = Math.max(1, Math.floor(radius))
  const { width, height, data } = imageData
  const temp = new Float32Array(width * height * 4)
  const output = new Uint8ClampedArray(data)

  const hps = new Float64Array(width + 1)
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) {
      hps.fill(0)
      for (let x = 0; x < width; x++) hps[x + 1] = hps[x] + data[(y * width + x) * 4 + c]
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r), x1 = Math.min(width - 1, x + r)
        temp[(y * width + x) * 4 + c] = (hps[x1 + 1] - hps[x0]) / (x1 - x0 + 1)
      }
    }
  }

  const vps = new Float64Array(height + 1)
  for (let x = 0; x < width; x++) {
    for (let c = 0; c < 3; c++) {
      vps.fill(0)
      for (let y = 0; y < height; y++) vps[y + 1] = vps[y] + temp[(y * width + x) * 4 + c]
      for (let y = 0; y < height; y++) {
        const y0 = Math.max(0, y - r), y1 = Math.min(height - 1, y + r)
        output[(y * width + x) * 4 + c] = clamp((vps[y1 + 1] - vps[y0]) / (y1 - y0 + 1))
      }
    }
  }
  return new ImageData(output, width, height)
}

// Unsharp mask kernel
export function applySharpen(imageData, { amount: a }) {
  return convolve(imageData, [
    [0,    -a,        0],
    [-a,   1 + 4 * a, -a],
    [0,    -a,        0],
  ])
}

// Block-average pixelation
export function applyPixelate(imageData, { size }) {
  const s = Math.max(2, Math.floor(size))
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)

  for (let y = 0; y < height; y += s) {
    for (let x = 0; x < width; x += s) {
      let rS = 0, gS = 0, bS = 0, count = 0
      for (let dy = 0; dy < s && y + dy < height; dy++) {
        for (let dx = 0; dx < s && x + dx < width; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4
          rS += data[i]; gS += data[i + 1]; bS += data[i + 2]; count++
        }
      }
      const rv = clamp(rS / count), gv = clamp(gS / count), bv = clamp(bS / count)
      for (let dy = 0; dy < s && y + dy < height; dy++) {
        for (let dx = 0; dx < s && x + dx < width; dx++) {
          const i = ((y + dy) * width + (x + dx)) * 4
          output[i] = rv; output[i + 1] = gv; output[i + 2] = bv
        }
      }
    }
  }
  return new ImageData(output, width, height)
}

// Reduce each channel to N evenly-spaced levels
export function applyPosterize(imageData, { levels }) {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)
  const step = 255 / (Math.max(2, levels) - 1)
  for (let i = 0; i < width * height * 4; i += 4) {
    output[i]     = clamp(Math.round(data[i]     / step) * step)
    output[i + 1] = clamp(Math.round(data[i + 1] / step) * step)
    output[i + 2] = clamp(Math.round(data[i + 2] / step) * step)
  }
  return new ImageData(output, width, height)
}

// Binary luminance threshold
export function applyThreshold(imageData, { value }) {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)
  for (let i = 0; i < width * height * 4; i += 4) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    const v = lum >= value ? 255 : 0
    output[i] = output[i + 1] = output[i + 2] = v
  }
  return new ImageData(output, width, height)
}

// Rec. 709 grayscale
export function applyGrayscale(imageData) {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)
  for (let i = 0; i < width * height * 4; i += 4) {
    const v = clamp(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    output[i] = output[i + 1] = output[i + 2] = v
  }
  return new ImageData(output, width, height)
}

// Sobel edge detection
export function applyEdgeDetect(imageData) {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)
  const Gx = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]]
  const Gy = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]]

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let rx = 0, gx = 0, bx = 0, ry = 0, gy2 = 0, by = 0
      for (let ky = 0; ky < 3; ky++) {
        for (let kx = 0; kx < 3; kx++) {
          const i = ((y + ky - 1) * width + (x + kx - 1)) * 4
          rx += data[i] * Gx[ky][kx];       ry  += data[i]     * Gy[ky][kx]
          gx += data[i + 1] * Gx[ky][kx];   gy2 += data[i + 1] * Gy[ky][kx]
          bx += data[i + 2] * Gx[ky][kx];   by  += data[i + 2] * Gy[ky][kx]
        }
      }
      const i = (y * width + x) * 4
      output[i]     = clamp(Math.hypot(rx,  ry))
      output[i + 1] = clamp(Math.hypot(gx,  gy2))
      output[i + 2] = clamp(Math.hypot(bx,  by))
    }
  }
  return new ImageData(output, width, height)
}

// Emboss via directional kernel + 128 gray offset
export function applyEmboss(imageData) {
  return convolve(imageData, [
    [-2, -1,  0],
    [-1,  1,  1],
    [ 0,  1,  2],
  ], 128)
}

// Floyd-Steinberg error-diffusion dithering on luminance
export function applyDitherFloyd(imageData, { levels }) {
  const { width, height } = imageData
  const L = Math.max(2, Math.floor(levels))
  const step = 255 / (L - 1)
  const src = imageData.data
  const gray = new Float32Array(width * height)

  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * src[i * 4] + 0.587 * src[i * 4 + 1] + 0.114 * src[i * 4 + 2]
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x
      const old = gray[idx]
      const nv = Math.round(old / step) * step
      const err = old - nv
      gray[idx] = nv

      if (x + 1 < width)                  gray[idx + 1]         += err * 7 / 16
      if (y + 1 < height) {
        if (x > 0)                         gray[idx + width - 1] += err * 3 / 16
                                           gray[idx + width]     += err * 5 / 16
        if (x + 1 < width)                gray[idx + width + 1] += err * 1 / 16
      }
    }
  }

  const output = new Uint8ClampedArray(src)
  for (let i = 0; i < width * height; i++) {
    const v = clamp(gray[i])
    output[i * 4] = v; output[i * 4 + 1] = v; output[i * 4 + 2] = v
  }
  return new ImageData(output, width, height)
}

// Ordered (Bayer 8×8) dithering on luminance
export function applyDitherOrdered(imageData, { levels }) {
  const { width, height, data } = imageData
  const L = Math.max(2, Math.floor(levels))
  const step = 255 / (L - 1)
  const bayer = [
    [ 0, 32,  8, 40,  2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44,  4, 36, 14, 46,  6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [ 3, 35, 11, 43,  1, 33,  9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47,  7, 39, 13, 45,  5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ]
  const output = new Uint8ClampedArray(data)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const threshold = (bayer[y % 8][x % 8] / 64 - 0.5) * step
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      const v = clamp(Math.round((lum + threshold) / step) * step)
      output[i] = v; output[i + 1] = v; output[i + 2] = v
    }
  }
  return new ImageData(output, width, height)
}

// Deterministic noise (sin-hash so pattern is stable across re-renders)
export function applyNoise(imageData, { amount }) {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)

  for (let i = 0; i < width * height * 4; i += 4) {
    const h = ((Math.sin((i / 4) * 127.1 + 311.7) * 43758.5453) % 1)
    const n = (h - 0.5) * amount * 2
    output[i]     = clamp(data[i]     + n)
    output[i + 1] = clamp(data[i + 1] + n)
    output[i + 2] = clamp(data[i + 2] + n)
  }
  return new ImageData(output, width, height)
}

// Radial darkness falloff from center
export function applyVignette(imageData, { strength }) {
  const { width, height, data } = imageData
  const output = new Uint8ClampedArray(data)
  const cx = width / 2, cy = height / 2
  const maxDist = Math.sqrt(cx * cx + cy * cy)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist
      const factor = Math.max(0, 1 - dist * dist * strength)
      const i = (y * width + x) * 4
      output[i]     = clamp(data[i]     * factor)
      output[i + 1] = clamp(data[i + 1] * factor)
      output[i + 2] = clamp(data[i + 2] * factor)
    }
  }
  return new ImageData(output, width, height)
}

// Run the full filter pipeline in order
export function applyFilters(imageData, filters) {
  let img = imageData
  if (filters.blur.enabled)          img = applyBlur(img,          filters.blur)
  if (filters.sharpen.enabled)       img = applySharpen(img,       filters.sharpen)
  if (filters.pixelate.enabled)      img = applyPixelate(img,      filters.pixelate)
  if (filters.posterize.enabled)     img = applyPosterize(img,     filters.posterize)
  if (filters.threshold.enabled)     img = applyThreshold(img,     filters.threshold)
  if (filters.grayscale.enabled)     img = applyGrayscale(img)
  if (filters.edgeDetect.enabled)    img = applyEdgeDetect(img)
  if (filters.emboss.enabled)        img = applyEmboss(img)
  if (filters.ditherFloyd.enabled)   img = applyDitherFloyd(img,   filters.ditherFloyd)
  if (filters.ditherOrdered.enabled) img = applyDitherOrdered(img, filters.ditherOrdered)
  if (filters.noise.enabled)         img = applyNoise(img,         filters.noise)
  if (filters.vignette.enabled)      img = applyVignette(img,      filters.vignette)
  return img
}
