// ASCII character sets ordered from dark to light (high density -> low density)
export const CHAR_SETS = {
  standard: ' .\'`^",:;Il!i><~+_-?][}{1)(|\\//tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  simple: ' .:-=+*#%@',
  blocks: ' ░▒▓█',
  binary: ' @',
  detailed: ' .\'"^`,:;Il!i<>~+_-?][}{1)(|/\\tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
  braille: ' ⠁⠂⠃⠄⠅⠆⠇⠈⠉⠊⠋⠌⠍⠎⠏⠐⠑⠒⠓⠔⠕⠖⠗⠘⠙⠚⠛⠜⠝⠞⠟⠠⠡⠢⠣⠤⠥⠦⠧⠨⠩⠪⠫⠬⠭⠮⠯⠰⠱⠲⠳⠴⠵⠶⠷⠸⠹⠺⠻⠼⠽⠾⠿',
}

/**
 * Apply brightness and contrast to a pixel value (0-255)
 */
function adjustBrightnessContrast(value, brightness, contrast) {
  // brightness: -100 to 100, contrast: -100 to 100
  let v = value

  // Apply brightness
  v = v + brightness * 2.55

  // Apply contrast: scale around midpoint 128
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast))
  v = factor * (v - 128) + 128

  return Math.max(0, Math.min(255, v))
}

/**
 * Convert image data to ASCII art
 * @param {ImageData} imageData - Canvas ImageData
 * @param {object} params - Conversion parameters
 * @returns {{ lines: string[], colorData: Array<Array<{r,g,b,char}>> }}
 */
export function imageToAscii(imageData, params) {
  const {
    width: outputWidth,
    charSet = 'standard',
    invert = false,
    brightness = 0,
    contrast = 0,
    colorMode = false,
  } = params

  const chars = CHAR_SETS[charSet] || CHAR_SETS.standard
  const srcWidth = imageData.width
  const srcHeight = imageData.height

  // ASCII chars are roughly 2x taller than wide, so adjust aspect ratio
  const aspectRatio = srcHeight / srcWidth
  const outputHeight = Math.round(outputWidth * aspectRatio * 0.45)

  const cellW = srcWidth / outputWidth
  const cellH = srcHeight / outputHeight

  const lines = []
  const colorData = []

  for (let row = 0; row < outputHeight; row++) {
    let line = ''
    const rowColors = []

    for (let col = 0; col < outputWidth; col++) {
      // Sample a region of the source image for this cell
      const x0 = Math.floor(col * cellW)
      const y0 = Math.floor(row * cellH)
      const x1 = Math.min(Math.ceil((col + 1) * cellW), srcWidth)
      const y1 = Math.min(Math.ceil((row + 1) * cellH), srcHeight)

      let totalR = 0, totalG = 0, totalB = 0, count = 0

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const idx = (py * srcWidth + px) * 4
          totalR += imageData.data[idx]
          totalG += imageData.data[idx + 1]
          totalB += imageData.data[idx + 2]
          count++
        }
      }

      if (count === 0) count = 1

      let r = totalR / count
      let g = totalG / count
      let b = totalB / count

      // Apply brightness/contrast
      r = adjustBrightnessContrast(r, brightness, contrast)
      g = adjustBrightnessContrast(g, brightness, contrast)
      b = adjustBrightnessContrast(b, brightness, contrast)

      // Luminance (perceived brightness)
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b

      // Map luminance (0-255) to character index
      let t = luminance / 255
      if (invert) t = 1 - t

      const charIndex = Math.floor(t * (chars.length - 1))
      const char = chars[charIndex]

      line += char
      rowColors.push({ r: Math.round(r), g: Math.round(g), b: Math.round(b), char })
    }

    lines.push(line)
    colorData.push(rowColors)
  }

  return { lines, colorData }
}

/**
 * Export ASCII art as PNG using canvas
 */
export function exportAsPng(lines, colorData, params) {
  const {
    fontSize = 10,
    fontFamily = 'monospace',
    bgColor = '#000000',
    fgColor = '#ffffff',
    colorMode = false,
  } = params

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')

  ctx.font = `${fontSize}px ${fontFamily}`
  const charWidth = ctx.measureText('M').width
  const lineHeight = fontSize * 1.2

  canvas.width = Math.ceil(lines[0]?.length * charWidth) || 800
  canvas.height = Math.ceil(lines.length * lineHeight)

  // Background
  ctx.fillStyle = bgColor
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.font = `${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'top'

  for (let row = 0; row < lines.length; row++) {
    const line = lines[row]
    const y = row * lineHeight

    for (let col = 0; col < line.length; col++) {
      const x = col * charWidth
      const char = line[col]

      if (colorMode && colorData?.[row]?.[col]) {
        const { r, g, b } = colorData[row][col]
        ctx.fillStyle = `rgb(${r},${g},${b})`
      } else {
        ctx.fillStyle = fgColor
      }

      ctx.fillText(char, x, y)
    }
  }

  return canvas.toDataURL('image/png')
}

/**
 * Export ASCII art as plain text
 */
export function exportAsText(lines) {
  return lines.join('\n')
}
