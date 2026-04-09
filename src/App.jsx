import { useState, useCallback, useRef, useEffect } from 'react'
import { imageToAscii, exportAsPng, exportAsText, CHAR_SETS } from './asciiConverter'
import './App.css'

const DEFAULT_PARAMS = {
  width: 100,
  charSet: 'standard',
  invert: false,
  brightness: 0,
  contrast: 0,
  colorMode: false,
  fontSize: 10,
  bgColor: '#000000',
  fgColor: '#00ff41',
}

export default function App() {
  const [imageSrc, setImageSrc] = useState(null)
  const [imageData, setImageData] = useState(null)
  const [params, setParams] = useState(DEFAULT_PARAMS)
  const [asciiResult, setAsciiResult] = useState(null)
  const [isConverting, setIsConverting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)
  const previewCanvasRef = useRef(null)
  const convertTimeoutRef = useRef(null)

  // Load image into ImageData
  const loadImage = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setImageSrc(url)

    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      setImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [])

  // Convert whenever imageData or params change (debounced)
  useEffect(() => {
    if (!imageData) return

    clearTimeout(convertTimeoutRef.current)
    convertTimeoutRef.current = setTimeout(() => {
      setIsConverting(true)
      // Use setTimeout to let the UI update (show spinner) before blocking work
      setTimeout(() => {
        const result = imageToAscii(imageData, params)
        setAsciiResult(result)
        setIsConverting(false)
      }, 10)
    }, 120)

    return () => clearTimeout(convertTimeoutRef.current)
  }, [imageData, params])

  const handleParam = useCallback((key, value) => {
    setParams(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleFile = useCallback((file) => {
    loadImage(file)
  }, [loadImage])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  const handleExportPng = useCallback(() => {
    if (!asciiResult) return
    const dataUrl = exportAsPng(asciiResult.lines, asciiResult.colorData, params)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = 'ascii-art.png'
    a.click()
  }, [asciiResult, params])

  const handleExportTxt = useCallback(() => {
    if (!asciiResult) return
    const text = exportAsText(asciiResult.lines)
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'ascii-art.txt'
    a.click()
    URL.revokeObjectURL(url)
  }, [asciiResult])

  return (
    <div className="app">
      <header className="header">
        <span className="logo">PICTORA</span>
        <span className="tagline">ASCII Art Converter</span>
      </header>

      <div className="workspace">
        {/* Sidebar controls */}
        <aside className="sidebar">
          <section className="panel">
            <h3>Image</h3>
            <div
              className={`dropzone ${isDragging ? 'dragging' : ''} ${imageSrc ? 'has-image' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              {imageSrc
                ? <img src={imageSrc} alt="source" className="thumb" />
                : <div className="drop-hint">
                    <span className="drop-icon">⊕</span>
                    <span>Drop image or click</span>
                  </div>
              }
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleFile(e.target.files[0])}
            />
          </section>

          <section className="panel">
            <h3>Parameters</h3>

            <label className="control-label">
              Width <span className="value-badge">{params.width} chars</span>
            </label>
            <input
              type="range" min="20" max="300" step="1"
              value={params.width}
              onChange={(e) => handleParam('width', Number(e.target.value))}
              className="slider"
            />

            <label className="control-label">Character Set</label>
            <select
              value={params.charSet}
              onChange={(e) => handleParam('charSet', e.target.value)}
              className="select"
            >
              {Object.keys(CHAR_SETS).map(k => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>

            <label className="control-label">
              Brightness <span className="value-badge">{params.brightness > 0 ? '+' : ''}{params.brightness}</span>
            </label>
            <input
              type="range" min="-100" max="100" step="1"
              value={params.brightness}
              onChange={(e) => handleParam('brightness', Number(e.target.value))}
              className="slider"
            />

            <label className="control-label">
              Contrast <span className="value-badge">{params.contrast > 0 ? '+' : ''}{params.contrast}</span>
            </label>
            <input
              type="range" min="-100" max="100" step="1"
              value={params.contrast}
              onChange={(e) => handleParam('contrast', Number(e.target.value))}
              className="slider"
            />

            <div className="toggle-row">
              <label className="toggle-label">Invert</label>
              <button
                className={`toggle ${params.invert ? 'on' : 'off'}`}
                onClick={() => handleParam('invert', !params.invert)}
              >
                {params.invert ? 'ON' : 'OFF'}
              </button>
            </div>

            <div className="toggle-row">
              <label className="toggle-label">Color Mode</label>
              <button
                className={`toggle ${params.colorMode ? 'on' : 'off'}`}
                onClick={() => handleParam('colorMode', !params.colorMode)}
              >
                {params.colorMode ? 'ON' : 'OFF'}
              </button>
            </div>
          </section>

          <section className="panel">
            <h3>Display</h3>

            <label className="control-label">
              Font Size <span className="value-badge">{params.fontSize}px</span>
            </label>
            <input
              type="range" min="4" max="24" step="1"
              value={params.fontSize}
              onChange={(e) => handleParam('fontSize', Number(e.target.value))}
              className="slider"
            />

            <label className="control-label">Background</label>
            <div className="color-row">
              <input
                type="color" value={params.bgColor}
                onChange={(e) => handleParam('bgColor', e.target.value)}
                className="color-pick"
              />
              <span className="color-hex">{params.bgColor}</span>
            </div>

            <label className="control-label">Foreground</label>
            <div className="color-row">
              <input
                type="color" value={params.fgColor}
                onChange={(e) => handleParam('fgColor', e.target.value)}
                className="color-pick"
              />
              <span className="color-hex">{params.fgColor}</span>
            </div>

            <button
              className="btn-reset"
              onClick={() => setParams(DEFAULT_PARAMS)}
            >
              Reset to defaults
            </button>
          </section>

          <section className="panel">
            <h3>Export</h3>
            <div className="export-buttons">
              <button
                className="btn-export"
                onClick={handleExportPng}
                disabled={!asciiResult}
              >
                Export PNG
              </button>
              <button
                className="btn-export"
                onClick={handleExportTxt}
                disabled={!asciiResult}
              >
                Export TXT
              </button>
            </div>
          </section>
        </aside>

        {/* Main canvas area */}
        <main className="canvas-area">
          {!imageData && (
            <div className="empty-state">
              <div className="empty-art">
                {`    ____  _      _                  \n   |  _ \\(_) ___| |_ ___  _ __ __ _ \n   | |_) | |/ __| __/ _ \\| '__/ _\` |\n   |  __/| | (__| || (_) | | | (_| |\n   |_|   |_|\\___|\\__\\___/|_|  \\__,_|\n`}
              </div>
              <p>Upload an image to begin</p>
            </div>
          )}

          {imageData && (
            <div className="ascii-wrapper">
              {isConverting && (
                <div className="converting-overlay">
                  <span className="spinner">Converting...</span>
                </div>
              )}
              <pre
                className="ascii-output"
                style={{
                  fontSize: `${params.fontSize}px`,
                  lineHeight: `${params.fontSize * 1.2}px`,
                  backgroundColor: params.colorMode ? params.bgColor : params.bgColor,
                  color: params.colorMode ? 'inherit' : params.fgColor,
                }}
              >
                {asciiResult?.lines.map((line, i) => (
                  <div key={i} className="ascii-line">
                    {params.colorMode
                      ? asciiResult.colorData[i]?.map((cell, j) => (
                          <span
                            key={j}
                            style={{ color: `rgb(${cell.r},${cell.g},${cell.b})` }}
                          >
                            {cell.char}
                          </span>
                        ))
                      : line
                    }
                  </div>
                ))}
              </pre>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
