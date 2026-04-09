import { useState, useCallback, useRef, useEffect } from 'react'
import { imageToAscii, exportAsPng, exportAsText, CHAR_SETS } from './asciiConverter'
import { applyFilters } from './imageFilters'
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

const DEFAULT_FILTERS = {
  blur:          { enabled: false, radius: 3 },
  sharpen:       { enabled: false, amount: 1.0 },
  pixelate:      { enabled: false, size: 8 },
  posterize:     { enabled: false, levels: 4 },
  threshold:     { enabled: false, value: 128 },
  grayscale:     { enabled: false },
  edgeDetect:    { enabled: false },
  emboss:        { enabled: false },
  ditherFloyd:   { enabled: false, levels: 2 },
  ditherOrdered: { enabled: false, levels: 4 },
  noise:         { enabled: false, amount: 20 },
  vignette:      { enabled: false, strength: 1.5 },
}

// ── Small helper components ────────────────────────────────────────────────

function Slider({ label, value, min, max, step, onChange, fmt }) {
  return (
    <div className="slider-group">
      <div className="control-label">
        {label}
        <span className="value-badge">{fmt ? fmt(value) : value}</span>
      </div>
      <input
        type="range" className="slider"
        min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  )
}

function FilterCard({ label, enabled, onToggle, children }) {
  return (
    <div className={`filter-card ${enabled ? 'active' : ''}`}>
      <button className="filter-header" onClick={onToggle}>
        <span className={`filter-dot ${enabled ? 'on' : ''}`} />
        <span className="filter-name">{label}</span>
        <span className={`filter-badge ${enabled ? 'on' : ''}`}>{enabled ? 'ON' : 'OFF'}</span>
      </button>
      {enabled && children && (
        <div className="filter-params">{children}</div>
      )}
    </div>
  )
}

// ── Main app ───────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab]               = useState('image')
  const [imageSrc, setImageSrc]     = useState(null)
  const [imageData, setImageData]   = useState(null)
  const [params, setParams]         = useState(DEFAULT_PARAMS)
  const [filters, setFilters]       = useState(DEFAULT_FILTERS)
  const [asciiResult, setAsciiResult] = useState(null)
  const [isConverting, setIsConverting] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef    = useRef(null)
  const convertTimeout  = useRef(null)

  // Load image file → ImageData
  const loadImage = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setImageSrc(url)
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      setImageData(ctx.getImageData(0, 0, canvas.width, canvas.height))
      URL.revokeObjectURL(url)
    }
    img.src = url
  }, [])

  // Re-run pipeline whenever source, params, or filters change
  useEffect(() => {
    if (!imageData) return
    clearTimeout(convertTimeout.current)
    convertTimeout.current = setTimeout(() => {
      setIsConverting(true)
      setTimeout(() => {
        const filtered = applyFilters(imageData, filters)
        const result   = imageToAscii(filtered, params)
        setAsciiResult(result)
        setIsConverting(false)
      }, 10)
    }, 150)
    return () => clearTimeout(convertTimeout.current)
  }, [imageData, params, filters])

  const setParam     = useCallback((k, v) => setParams(p => ({ ...p, [k]: v })), [])
  const toggleFilter = useCallback((name) =>
    setFilters(f => ({ ...f, [name]: { ...f[name], enabled: !f[name].enabled } })), [])
  const setFilterVal = useCallback((name, key, val) =>
    setFilters(f => ({ ...f, [name]: { ...f[name], [key]: val } })), [])

  const handleFile = useCallback((file) => loadImage(file), [loadImage])
  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragging(false)
    handleFile(e.dataTransfer.files[0])
  }, [handleFile])

  const handleExportPng = useCallback(() => {
    if (!asciiResult) return
    const url = exportAsPng(asciiResult.lines, asciiResult.colorData, params)
    Object.assign(document.createElement('a'), { href: url, download: 'ascii-art.png' }).click()
  }, [asciiResult, params])

  const handleExportTxt = useCallback(() => {
    if (!asciiResult) return
    const blob = new Blob([exportAsText(asciiResult.lines)], { type: 'text/plain' })
    const url  = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: 'ascii-art.txt' }).click()
    URL.revokeObjectURL(url)
  }, [asciiResult])

  const TABS = ['image', 'filters', 'ascii', 'display', 'export']

  const activeFiltersCount = Object.values(filters).filter(f => f.enabled).length

  return (
    <div className="app">
      <header className="header">
        <span className="logo">PICTORA</span>
        <span className="tagline">ASCII Art Converter</span>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <nav className="tab-nav">
            {TABS.map(t => (
              <button
                key={t}
                className={`tab-btn ${tab === t ? 'active' : ''}`}
                onClick={() => setTab(t)}
              >
                {t}
                {t === 'filters' && activeFiltersCount > 0 && (
                  <span className="tab-badge">{activeFiltersCount}</span>
                )}
              </button>
            ))}
          </nav>

          <div className="tab-content">

            {/* ── IMAGE ── */}
            {tab === 'image' && (
              <div className="panel">
                <div
                  className={`dropzone ${isDragging ? 'dragging' : ''} ${imageSrc ? 'has-image' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                >
                  {imageSrc
                    ? <img src={imageSrc} alt="source" className="thumb" />
                    : <div className="drop-hint">
                        <span className="drop-icon">⊕</span>
                        <span>Drop image or click to upload</span>
                      </div>
                  }
                </div>
                {imageSrc && (
                  <button className="btn-reset" onClick={() => { setImageSrc(null); setImageData(null); setAsciiResult(null) }}>
                    Remove image
                  </button>
                )}
                <input ref={fileInputRef} type="file" accept="image/*"
                  style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
              </div>
            )}

            {/* ── FILTERS ── */}
            {tab === 'filters' && (
              <div className="filters-list">
                <FilterCard label="Blur" enabled={filters.blur.enabled} onToggle={() => toggleFilter('blur')}>
                  <Slider label="Radius" value={filters.blur.radius} min={1} max={20} step={1}
                    onChange={v => setFilterVal('blur', 'radius', v)} />
                </FilterCard>

                <FilterCard label="Sharpen" enabled={filters.sharpen.enabled} onToggle={() => toggleFilter('sharpen')}>
                  <Slider label="Amount" value={filters.sharpen.amount} min={0.1} max={3} step={0.1}
                    onChange={v => setFilterVal('sharpen', 'amount', v)} fmt={v => v.toFixed(1)} />
                </FilterCard>

                <FilterCard label="Pixelate" enabled={filters.pixelate.enabled} onToggle={() => toggleFilter('pixelate')}>
                  <Slider label="Block size" value={filters.pixelate.size} min={2} max={64} step={1}
                    onChange={v => setFilterVal('pixelate', 'size', v)} />
                </FilterCard>

                <FilterCard label="Posterize" enabled={filters.posterize.enabled} onToggle={() => toggleFilter('posterize')}>
                  <Slider label="Levels" value={filters.posterize.levels} min={2} max={8} step={1}
                    onChange={v => setFilterVal('posterize', 'levels', v)} />
                </FilterCard>

                <FilterCard label="Threshold" enabled={filters.threshold.enabled} onToggle={() => toggleFilter('threshold')}>
                  <Slider label="Value" value={filters.threshold.value} min={0} max={255} step={1}
                    onChange={v => setFilterVal('threshold', 'value', v)} />
                </FilterCard>

                <FilterCard label="Grayscale" enabled={filters.grayscale.enabled} onToggle={() => toggleFilter('grayscale')} />

                <FilterCard label="Edge Detect (Sobel)" enabled={filters.edgeDetect.enabled} onToggle={() => toggleFilter('edgeDetect')} />

                <FilterCard label="Emboss" enabled={filters.emboss.enabled} onToggle={() => toggleFilter('emboss')} />

                <FilterCard label="Dither — Floyd-Steinberg" enabled={filters.ditherFloyd.enabled} onToggle={() => toggleFilter('ditherFloyd')}>
                  <Slider label="Levels" value={filters.ditherFloyd.levels} min={2} max={8} step={1}
                    onChange={v => setFilterVal('ditherFloyd', 'levels', v)} />
                </FilterCard>

                <FilterCard label="Dither — Ordered (Bayer 8×8)" enabled={filters.ditherOrdered.enabled} onToggle={() => toggleFilter('ditherOrdered')}>
                  <Slider label="Levels" value={filters.ditherOrdered.levels} min={2} max={8} step={1}
                    onChange={v => setFilterVal('ditherOrdered', 'levels', v)} />
                </FilterCard>

                <FilterCard label="Noise" enabled={filters.noise.enabled} onToggle={() => toggleFilter('noise')}>
                  <Slider label="Amount" value={filters.noise.amount} min={1} max={80} step={1}
                    onChange={v => setFilterVal('noise', 'amount', v)} />
                </FilterCard>

                <FilterCard label="Vignette" enabled={filters.vignette.enabled} onToggle={() => toggleFilter('vignette')}>
                  <Slider label="Strength" value={filters.vignette.strength} min={0} max={3} step={0.1}
                    onChange={v => setFilterVal('vignette', 'strength', v)} fmt={v => v.toFixed(1)} />
                </FilterCard>

                {activeFiltersCount > 0 && (
                  <button className="btn-reset" onClick={() => setFilters(DEFAULT_FILTERS)}>
                    Clear all filters
                  </button>
                )}
              </div>
            )}

            {/* ── ASCII ── */}
            {tab === 'ascii' && (
              <div className="panel">
                <Slider label="Width" value={params.width} min={20} max={300} step={1}
                  onChange={v => setParam('width', v)} fmt={v => `${v} chars`} />

                <div className="control-label" style={{ marginTop: 4 }}>Character Set</div>
                <select className="select" value={params.charSet}
                  onChange={e => setParam('charSet', e.target.value)}>
                  {Object.keys(CHAR_SETS).map(k => <option key={k} value={k}>{k}</option>)}
                </select>

                <Slider label="Brightness" value={params.brightness} min={-100} max={100} step={1}
                  onChange={v => setParam('brightness', v)}
                  fmt={v => (v > 0 ? `+${v}` : `${v}`)} />

                <Slider label="Contrast" value={params.contrast} min={-100} max={100} step={1}
                  onChange={v => setParam('contrast', v)}
                  fmt={v => (v > 0 ? `+${v}` : `${v}`)} />

                <div className="toggle-row">
                  <span className="toggle-label">Invert</span>
                  <button className={`toggle ${params.invert ? 'on' : 'off'}`}
                    onClick={() => setParam('invert', !params.invert)}>
                    {params.invert ? 'ON' : 'OFF'}
                  </button>
                </div>

                <div className="toggle-row">
                  <span className="toggle-label">Color Mode</span>
                  <button className={`toggle ${params.colorMode ? 'on' : 'off'}`}
                    onClick={() => setParam('colorMode', !params.colorMode)}>
                    {params.colorMode ? 'ON' : 'OFF'}
                  </button>
                </div>

                <button className="btn-reset" style={{ marginTop: 8 }}
                  onClick={() => setParams(DEFAULT_PARAMS)}>
                  Reset to defaults
                </button>
              </div>
            )}

            {/* ── DISPLAY ── */}
            {tab === 'display' && (
              <div className="panel">
                <Slider label="Font Size" value={params.fontSize} min={4} max={24} step={1}
                  onChange={v => setParam('fontSize', v)} fmt={v => `${v}px`} />

                <div className="control-label" style={{ marginTop: 4 }}>Background</div>
                <div className="color-row">
                  <input type="color" className="color-pick" value={params.bgColor}
                    onChange={e => setParam('bgColor', e.target.value)} />
                  <span className="color-hex">{params.bgColor}</span>
                </div>

                <div className="control-label">Foreground</div>
                <div className="color-row">
                  <input type="color" className="color-pick" value={params.fgColor}
                    onChange={e => setParam('fgColor', e.target.value)} />
                  <span className="color-hex">{params.fgColor}</span>
                </div>
              </div>
            )}

            {/* ── EXPORT ── */}
            {tab === 'export' && (
              <div className="panel">
                <p className="export-hint">
                  {asciiResult
                    ? `${asciiResult.lines[0]?.length ?? 0} × ${asciiResult.lines.length} chars`
                    : 'No image loaded yet'}
                </p>
                <div className="export-buttons">
                  <button className="btn-export" onClick={handleExportPng} disabled={!asciiResult}>
                    Export PNG
                  </button>
                  <button className="btn-export" onClick={handleExportTxt} disabled={!asciiResult}>
                    Export TXT
                  </button>
                </div>
              </div>
            )}

          </div>
        </aside>

        {/* ── Canvas area ── */}
        <main className="canvas-area">
          {!imageData && (
            <div className="empty-state">
              <div className="empty-art">{`    ____  _      _                  \n   |  _ \\(_) ___| |_ ___  _ __ __ _ \n   | |_) | |/ __| __/ _ \\| '__/ _\` |\n   |  __/| | (__| || (_) | | | (_| |\n   |_|   |_|\\___|\\__\\___/|_|  \\__,_|\n`}</div>
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
                  backgroundColor: params.bgColor,
                  color: params.colorMode ? 'inherit' : params.fgColor,
                }}
              >
                {asciiResult?.lines.map((line, i) => (
                  <div key={i} className="ascii-line">
                    {params.colorMode
                      ? asciiResult.colorData[i]?.map((cell, j) => (
                          <span key={j} style={{ color: `rgb(${cell.r},${cell.g},${cell.b})` }}>
                            {cell.char}
                          </span>
                        ))
                      : line}
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
