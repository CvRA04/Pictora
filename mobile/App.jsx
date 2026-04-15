import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert, Dimensions, Platform, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View,
} from 'react-native'
import Slider from '@react-native-community/slider'
import { StatusBar } from 'expo-status-bar'
import * as FileSystem from 'expo-file-system'
import * as ImageManipulator from 'expo-image-manipulator'
import * as ImagePicker from 'expo-image-picker'
import * as Sharing from 'expo-sharing'
import { WebView } from 'react-native-webview'
import { processorHtml } from './src/processorHtml'

// ─── constants ───────────────────────────────────────────────────────────────
const ACCENT   = '#00ff41'
const BG       = '#0d0d0d'
const SURFACE  = '#161616'
const SURFACE2 = '#1e1e1e'
const BORDER   = '#2a2a2a'
const DIM      = '#707070'

const CHAR_SETS = ['standard', 'simple', 'blocks', 'binary', 'detailed', 'braille']

const THEME_PRESETS = [
  { bg: '#000000', fg: '#00ff41', label: 'Matrix'    },
  { bg: '#000000', fg: '#ffffff', label: 'Terminal'  },
  { bg: '#ffffff', fg: '#000000', label: 'Light'     },
  { bg: '#0a0a2e', fg: '#00ccff', label: 'Cyan'      },
  { bg: '#1a0a00', fg: '#ff8800', label: 'Amber'     },
  { bg: '#0a0014', fg: '#cc44ff', label: 'Purple'    },
]

const DEFAULT_PARAMS = {
  width: 80, charSet: 'standard', invert: false,
  brightness: 0, contrast: 0,
  fontSize: 7, bgColor: '#000000', fgColor: '#00ff41',
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

// ─── small UI components ─────────────────────────────────────────────────────
function Row({ label, value, children }) {
  return (
    <View style={s.ctrlRow}>
      <View style={s.ctrlHeader}>
        <Text style={s.ctrlLabel}>{label}</Text>
        <Text style={s.ctrlValue}>{value}</Text>
      </View>
      {children}
    </View>
  )
}

function Toggle({ value, onPress }) {
  return (
    <TouchableOpacity style={[s.toggle, value && s.toggleOn]} onPress={onPress}>
      <Text style={[s.toggleTxt, value && s.toggleTxtOn]}>{value ? 'ON' : 'OFF'}</Text>
    </TouchableOpacity>
  )
}

function FilterCard({ label, enabled, onToggle, children }) {
  return (
    <View style={[s.filterCard, enabled && s.filterCardOn]}>
      <TouchableOpacity style={s.filterHeader} onPress={onToggle}>
        <View style={[s.filterDot, enabled && s.filterDotOn]} />
        <Text style={s.filterName}>{label}</Text>
        <Toggle value={enabled} onPress={onToggle} />
      </TouchableOpacity>
      {enabled && children && <View style={s.filterBody}>{children}</View>}
    </View>
  )
}

// ─── main app ────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab]             = useState('ascii')
  const [asciiLines, setLines]    = useState(null)
  const [isProcessing, setProc]   = useState(false)
  const [webReady, setWebReady]   = useState(false)
  const [params, setParams]       = useState(DEFAULT_PARAMS)
  const [filters, setFilters]     = useState(DEFAULT_FILTERS)

  // Hold the compressed base64 + mime between re-renders without causing effects
  const imageRef   = useRef({ b64: null, mime: 'image/jpeg' })
  const webRef     = useRef(null)
  const procTimer  = useRef(null)

  // Kick off (re)processing whenever params / filters change
  const triggerProcess = useCallback((b64, mime, pms, fts) => {
    if (!b64 || !webRef.current) return
    clearTimeout(procTimer.current)
    procTimer.current = setTimeout(() => {
      setProc(true)
      const msg = JSON.stringify({ type: 'process', b64, mime, params: pms, filters: fts })
      webRef.current.injectJavaScript(`handleMsg(${JSON.stringify(msg)}); true;`)
    }, 220)
  }, [])

  useEffect(() => {
    if (!webReady || !imageRef.current.b64) return
    triggerProcess(imageRef.current.b64, imageRef.current.mime, params, filters)
  }, [params, filters, webReady])

  // ── image picker ──────────────────────────────────────────────────────────
  const pickImage = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow photo access in settings.')
      return
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    })
    if (res.canceled) return
    const asset = res.assets[0]

    // Resize to ≤1000px so the base64 stays manageable (~50-150 KB)
    const manipulated = await ImageManipulator.manipulateAsync(
      asset.uri,
      [{ resize: { width: Math.min(asset.width, 1000) } }],
      { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.82 }
    )
    imageRef.current = { b64: manipulated.base64, mime: 'image/jpeg' }
    setLines(null)
    triggerProcess(manipulated.base64, 'image/jpeg', params, filters)
  }, [params, filters, triggerProcess])

  // ── WebView message handler ───────────────────────────────────────────────
  const onMessage = useCallback((e) => {
    try {
      const msg = JSON.parse(e.nativeEvent.data)
      if (msg.type === 'result') {
        setLines(msg.lines)
        setProc(false)
      } else if (msg.type === 'exportPng') {
        savePng(msg.dataUrl)
      } else if (msg.type === 'error') {
        setProc(false)
        Alert.alert('Error', msg.msg)
      }
    } catch (_) {}
  }, [])

  // ── export helpers ────────────────────────────────────────────────────────
  const exportPng = useCallback(() => {
    if (!asciiLines) return
    setProc(true)
    const msg = JSON.stringify({ type: 'export', params })
    webRef.current?.injectJavaScript(`handleMsg(${JSON.stringify(msg)}); true;`)
  }, [asciiLines, params])

  const savePng = useCallback(async (dataUrl) => {
    setProc(false)
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, '')
    const path = FileSystem.cacheDirectory + 'ascii-art.png'
    await FileSystem.writeAsStringAsync(path, b64, { encoding: FileSystem.EncodingType.Base64 })
    await Sharing.shareAsync(path, { mimeType: 'image/png', dialogTitle: 'Save ASCII art' })
  }, [])

  const exportTxt = useCallback(async () => {
    if (!asciiLines) return
    const text = asciiLines.join('\n')
    const path = FileSystem.cacheDirectory + 'ascii-art.txt'
    await FileSystem.writeAsStringAsync(path, text, { encoding: FileSystem.EncodingType.UTF8 })
    await Sharing.shareAsync(path, { mimeType: 'text/plain', dialogTitle: 'Save ASCII art' })
  }, [asciiLines])

  // ── param / filter helpers ────────────────────────────────────────────────
  const setP = useCallback((k, v) => setParams(p => ({ ...p, [k]: v })), [])
  const toggleF = useCallback((name) =>
    setFilters(f => ({ ...f, [name]: { ...f[name], enabled: !f[name].enabled } })), [])
  const setFVal = useCallback((name, key, val) =>
    setFilters(f => ({ ...f, [name]: { ...f[name], [key]: val } })), [])

  const activeFilters = Object.values(filters).filter(f => f.enabled).length

  // ── render ────────────────────────────────────────────────────────────────
  const TABS = ['filters', 'ascii', 'display']
  const monoFont = Platform.OS === 'ios' ? 'Courier' : 'monospace'

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />

      {/* Hidden WebView — runs the pixel algorithms using Canvas */}
      <WebView
        ref={webRef}
        source={{ html: processorHtml }}
        style={s.hidden}
        javaScriptEnabled
        originWhitelist={['*']}
        onLoad={() => setWebReady(true)}
        onMessage={onMessage}
      />

      {/* ── Header ── */}
      <View style={s.header}>
        <Text style={s.logo}>PICTORA</Text>
        <TouchableOpacity style={s.pickBtn} onPress={pickImage}>
          <Text style={s.pickBtnTxt}>{asciiLines ? 'Change Image' : 'Pick Image'}</Text>
        </TouchableOpacity>
      </View>

      {/* ── Control panel ── */}
      {(asciiLines || isProcessing) && (
        <View style={s.controls}>
          {/* Tab bar */}
          <View style={s.tabBar}>
            {TABS.map(t => (
              <TouchableOpacity key={t} style={[s.tabBtn, tab === t && s.tabBtnActive]}
                onPress={() => setTab(t)}>
                <Text style={[s.tabTxt, tab === t && s.tabTxtActive]}>
                  {t === 'filters' && activeFilters > 0 ? `Filters (${activeFilters})` : t}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Tab content */}
          <ScrollView style={s.tabContent} keyboardShouldPersistTaps="handled">

            {/* ── FILTERS ── */}
            {tab === 'filters' && (
              <View style={s.tabBody}>
                <FilterCard label="Blur" enabled={filters.blur.enabled} onToggle={() => toggleF('blur')}>
                  <Row label="Radius" value={filters.blur.radius}>
                    <Slider minimumValue={1} maximumValue={20} step={1} value={filters.blur.radius}
                      onValueChange={v => setFVal('blur','radius',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Sharpen" enabled={filters.sharpen.enabled} onToggle={() => toggleF('sharpen')}>
                  <Row label="Amount" value={filters.sharpen.amount.toFixed(1)}>
                    <Slider minimumValue={0.1} maximumValue={3} step={0.1} value={filters.sharpen.amount}
                      onValueChange={v => setFVal('sharpen','amount',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Pixelate" enabled={filters.pixelate.enabled} onToggle={() => toggleF('pixelate')}>
                  <Row label="Block size" value={filters.pixelate.size}>
                    <Slider minimumValue={2} maximumValue={64} step={1} value={filters.pixelate.size}
                      onValueChange={v => setFVal('pixelate','size',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Posterize" enabled={filters.posterize.enabled} onToggle={() => toggleF('posterize')}>
                  <Row label="Levels" value={filters.posterize.levels}>
                    <Slider minimumValue={2} maximumValue={8} step={1} value={filters.posterize.levels}
                      onValueChange={v => setFVal('posterize','levels',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Threshold" enabled={filters.threshold.enabled} onToggle={() => toggleF('threshold')}>
                  <Row label="Value" value={filters.threshold.value}>
                    <Slider minimumValue={0} maximumValue={255} step={1} value={filters.threshold.value}
                      onValueChange={v => setFVal('threshold','value',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Grayscale"     enabled={filters.grayscale.enabled}     onToggle={() => toggleF('grayscale')} />
                <FilterCard label="Edge Detect"   enabled={filters.edgeDetect.enabled}    onToggle={() => toggleF('edgeDetect')} />
                <FilterCard label="Emboss"        enabled={filters.emboss.enabled}        onToggle={() => toggleF('emboss')} />

                <FilterCard label="Dither — Floyd-Steinberg" enabled={filters.ditherFloyd.enabled} onToggle={() => toggleF('ditherFloyd')}>
                  <Row label="Levels" value={filters.ditherFloyd.levels}>
                    <Slider minimumValue={2} maximumValue={8} step={1} value={filters.ditherFloyd.levels}
                      onValueChange={v => setFVal('ditherFloyd','levels',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Dither — Ordered (Bayer)" enabled={filters.ditherOrdered.enabled} onToggle={() => toggleF('ditherOrdered')}>
                  <Row label="Levels" value={filters.ditherOrdered.levels}>
                    <Slider minimumValue={2} maximumValue={8} step={1} value={filters.ditherOrdered.levels}
                      onValueChange={v => setFVal('ditherOrdered','levels',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Noise" enabled={filters.noise.enabled} onToggle={() => toggleF('noise')}>
                  <Row label="Amount" value={filters.noise.amount}>
                    <Slider minimumValue={1} maximumValue={80} step={1} value={filters.noise.amount}
                      onValueChange={v => setFVal('noise','amount',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                <FilterCard label="Vignette" enabled={filters.vignette.enabled} onToggle={() => toggleF('vignette')}>
                  <Row label="Strength" value={filters.vignette.strength.toFixed(1)}>
                    <Slider minimumValue={0} maximumValue={3} step={0.1} value={filters.vignette.strength}
                      onValueChange={v => setFVal('vignette','strength',v)}
                      minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                  </Row>
                </FilterCard>

                {activeFilters > 0 && (
                  <TouchableOpacity style={s.clearBtn} onPress={() => setFilters(DEFAULT_FILTERS)}>
                    <Text style={s.clearBtnTxt}>Clear all filters</Text>
                  </TouchableOpacity>
                )}
              </View>
            )}

            {/* ── ASCII ── */}
            {tab === 'ascii' && (
              <View style={s.tabBody}>
                <Row label="Width" value={`${params.width} chars`}>
                  <Slider minimumValue={20} maximumValue={200} step={1} value={params.width}
                    onValueChange={v => setP('width', v)}
                    minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                </Row>
                <Row label="Brightness" value={params.brightness > 0 ? `+${params.brightness}` : params.brightness}>
                  <Slider minimumValue={-100} maximumValue={100} step={1} value={params.brightness}
                    onValueChange={v => setP('brightness', v)}
                    minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                </Row>
                <Row label="Contrast" value={params.contrast > 0 ? `+${params.contrast}` : params.contrast}>
                  <Slider minimumValue={-100} maximumValue={100} step={1} value={params.contrast}
                    onValueChange={v => setP('contrast', v)}
                    minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                </Row>

                <Text style={s.sectionLabel}>Character Set</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.chipRow}>
                  {CHAR_SETS.map(cs => (
                    <TouchableOpacity key={cs} style={[s.chip, params.charSet === cs && s.chipActive]}
                      onPress={() => setP('charSet', cs)}>
                      <Text style={[s.chipTxt, params.charSet === cs && s.chipTxtActive]}>{cs}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={s.toggleRow}>
                  <Text style={s.ctrlLabel}>Invert</Text>
                  <Toggle value={params.invert} onPress={() => setP('invert', !params.invert)} />
                </View>
              </View>
            )}

            {/* ── DISPLAY ── */}
            {tab === 'display' && (
              <View style={s.tabBody}>
                <Row label="Font Size" value={`${params.fontSize}px`}>
                  <Slider minimumValue={4} maximumValue={16} step={1} value={params.fontSize}
                    onValueChange={v => setP('fontSize', v)}
                    minimumTrackTintColor={ACCENT} thumbTintColor={ACCENT} maximumTrackTintColor={BORDER} />
                </Row>

                <Text style={s.sectionLabel}>Color Theme</Text>
                <View style={s.themeGrid}>
                  {THEME_PRESETS.map(t => (
                    <TouchableOpacity key={t.label}
                      style={[s.themeSwatch, { backgroundColor: t.bg, borderColor: params.bgColor === t.bg && params.fgColor === t.fg ? ACCENT : BORDER }]}
                      onPress={() => { setP('bgColor', t.bg); setP('fgColor', t.fg) }}>
                      <Text style={[s.themeLabel, { color: t.fg }]}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

          </ScrollView>
        </View>
      )}

      {/* ── ASCII art display ── */}
      <View style={[s.asciiArea, { backgroundColor: params.bgColor }]}>
        {!asciiLines && !isProcessing && (
          <View style={s.emptyState}>
            <Text style={s.emptyTitle}>PICTORA</Text>
            <Text style={s.emptyHint}>Tap "Pick Image" to begin</Text>
          </View>
        )}
        {isProcessing && (
          <View style={s.emptyState}>
            <Text style={[s.emptyTitle, { fontSize: 14 }]}>Converting...</Text>
          </View>
        )}
        {asciiLines && !isProcessing && (
          <ScrollView style={{ flex: 1 }} nestedScrollEnabled>
            <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}>
              <View>
                {asciiLines.map((line, i) => (
                  <Text
                    key={i}
                    numberOfLines={1}
                    ellipsizeMode="clip"
                    style={{
                      fontFamily: monoFont,
                      fontSize: params.fontSize,
                      lineHeight: params.fontSize * 1.2,
                      color: params.fgColor,
                      includeFontPadding: false,
                    }}
                  >
                    {line}
                  </Text>
                ))}
              </View>
            </ScrollView>
          </ScrollView>
        )}
      </View>

      {/* ── Export bar ── */}
      {asciiLines && (
        <View style={s.exportBar}>
          <TouchableOpacity style={s.exportBtn} onPress={exportPng} disabled={isProcessing}>
            <Text style={s.exportBtnTxt}>Export PNG</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.exportBtn} onPress={exportTxt} disabled={isProcessing}>
            <Text style={s.exportBtnTxt}>Export TXT</Text>
          </TouchableOpacity>
        </View>
      )}
    </SafeAreaView>
  )
}

// ─── styles ──────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: BG },
  hidden:  { width: 1, height: 1, position: 'absolute', top: -2, opacity: 0 },

  // Header
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER },
  logo:       { fontSize: 18, fontWeight: '700', letterSpacing: 4, color: ACCENT, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  pickBtn:    { backgroundColor: ACCENT, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4 },
  pickBtnTxt: { color: '#000', fontWeight: '700', fontSize: 12 },

  // Controls panel
  controls:   { maxHeight: 260, backgroundColor: SURFACE, borderBottomWidth: 1, borderBottomColor: BORDER },
  tabBar:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: BORDER },
  tabBtn:     { flex: 1, paddingVertical: 8, alignItems: 'center' },
  tabBtnActive: { borderBottomWidth: 2, borderBottomColor: ACCENT },
  tabTxt:     { fontSize: 11, fontWeight: '600', letterSpacing: 0.5, color: DIM, textTransform: 'uppercase' },
  tabTxtActive: { color: ACCENT },
  tabContent: { flex: 1 },
  tabBody:    { padding: 12, gap: 8 },

  // Controls
  ctrlRow:    { gap: 4 },
  ctrlHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ctrlLabel:  { fontSize: 11, color: DIM },
  ctrlValue:  { fontSize: 10, color: ACCENT, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', backgroundColor: BORDER, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  toggleRow:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },

  // Toggle
  toggle:       { borderWidth: 1, borderColor: BORDER, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3 },
  toggleOn:     { backgroundColor: ACCENT, borderColor: ACCENT },
  toggleTxt:    { fontSize: 10, fontWeight: '700', color: DIM, letterSpacing: 0.5 },
  toggleTxtOn:  { color: '#000' },

  // Chips
  sectionLabel: { fontSize: 11, color: DIM, marginTop: 4 },
  chipRow:      { marginTop: 4 },
  chip:         { borderWidth: 1, borderColor: BORDER, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6 },
  chipActive:   { borderColor: ACCENT, backgroundColor: 'rgba(0,255,65,0.1)' },
  chipTxt:      { fontSize: 11, color: DIM, textTransform: 'capitalize' },
  chipTxtActive: { color: ACCENT },

  // Filter cards
  filterCard:    { borderWidth: 1, borderColor: BORDER, borderRadius: 5, marginBottom: 4, overflow: 'hidden' },
  filterCardOn:  { borderColor: ACCENT },
  filterHeader:  { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, backgroundColor: SURFACE2 },
  filterDot:     { width: 6, height: 6, borderRadius: 3, backgroundColor: BORDER },
  filterDotOn:   { backgroundColor: ACCENT },
  filterName:    { flex: 1, fontSize: 11, color: '#e0e0e0', fontWeight: '500' },
  filterBody:    { padding: 10, backgroundColor: BG, gap: 4 },
  clearBtn:      { borderWidth: 1, borderColor: '#ff4444', borderRadius: 4, padding: 8, alignItems: 'center', marginTop: 4 },
  clearBtnTxt:   { color: '#ff4444', fontSize: 11, fontWeight: '600' },

  // Theme swatches
  themeGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  themeSwatch: { width: '30%', paddingVertical: 10, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  themeLabel:  { fontSize: 11, fontWeight: '700' },

  // ASCII area
  asciiArea:  { flex: 1, overflow: 'hidden' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyTitle: { fontSize: 22, fontWeight: '700', letterSpacing: 4, color: ACCENT, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', opacity: 0.6 },
  emptyHint:  { fontSize: 13, color: DIM },

  // Export bar
  exportBar:    { flexDirection: 'row', gap: 10, padding: 12, backgroundColor: SURFACE, borderTopWidth: 1, borderTopColor: BORDER },
  exportBtn:    { flex: 1, backgroundColor: ACCENT, padding: 10, borderRadius: 5, alignItems: 'center' },
  exportBtnTxt: { color: '#000', fontWeight: '700', fontSize: 13 },
})
