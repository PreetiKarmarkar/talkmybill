import { useState, useRef, useCallback } from 'react'
import { GoogleGenerativeAI } from '@google/generative-ai'

const SYSTEM_PROMPT = `You are TalkMyBill, a friendly AI that helps New Yorkers understand their Con Edison electricity bills. Explain each charge in plain casual English, flag anything unusual compared to typical NYC Con Ed rates (average $0.21-0.25 per kWh), and give actionable tips. Format response in 3 sections: 🧾 WHAT YOUR BILL SAYS, ⚠️ FLAGS, 💡 TIPS. Be warm like a friend helping them. Call out anything above average rates or vague charges. Include Con Ed dispute line 1-800-752-6633 and NY PSC 1-800-342-3377 when relevant.`

const USER_MESSAGE = `Please analyze this Con Edison bill and explain it to me in plain English. What am I being charged for? Is anything unusual? What should I do?`

function formatAnalysis(text) {
  const lines = text.split('\n')
  const elements = []
  let listItems = []

  const flushList = (key) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${key}`} className="analysis-list">
          {listItems}
        </ul>
      )
      listItems = []
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) { flushList(i); return }
    if (/^(🧾|⚠️|💡)/.test(trimmed)) {
      flushList(i)
      elements.push(<h3 key={i} className="section-header">{trimmed}</h3>)
      return
    }
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      flushList(i)
      elements.push(<p key={i} className="analysis-label">{trimmed.replace(/\*\*/g, '')}</p>)
      return
    }
    if (/^[•\-\*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      listItems.push(<li key={i}>{trimmed.replace(/^[•\-\*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/\*\*/g, '')}</li>)
      return
    }
    flushList(i)
    elements.push(<p key={i} className="analysis-p">{trimmed.replace(/\*\*([^*]+)\*\*/g, '$1')}</p>)
  })
  flushList('end')
  return elements
}

export default function App() {
  const [appState, setAppState] = useState('landing')
  const [file, setFile] = useState(null)
  const [analysis, setAnalysis] = useState('')
  const [error, setError] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef(null)

  const acceptFile = useCallback((f) => {
    if (!f) return
    const validTypes = ['image/jpeg','image/png','image/gif','image/webp','image/heic','application/pdf']
    if (!validTypes.includes(f.type)) { setError('Please upload a PDF or image (JPG, PNG, WEBP, GIF).'); return }
    if (f.size > 20 * 1024 * 1024) { setError('File too large — please keep it under 20 MB.'); return }
    setError(''); setFile(f); setAppState('selected')
  }, [])

  const handleDrop = useCallback((e) => { e.preventDefault(); setIsDragging(false); acceptFile(e.dataTransfer.files[0]) }, [acceptFile])
  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false) }, [])

  const toBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(f)
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
  })

  const analyzeFile = async () => {
    setAppState('loading'); setError('')
    try {
      const apiKey = import.meta.env.VITE_GEMINI_API_KEY
      if (!apiKey) throw new Error('Missing VITE_GEMINI_API_KEY — check your .env file.')
      const genAI = new GoogleGenerativeAI(apiKey)
      const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash', systemInstruction: SYSTEM_PROMPT })
      const base64 = await toBase64(file)
      const result = await model.generateContent([{ inlineData: { data: base64, mimeType: file.type } }, USER_MESSAGE])
      setAnalysis(result.response.text())
      setAppState('results')
    } catch (err) {
      console.error(err); setError(err.message || 'Something went wrong — please try again.'); setAppState('selected')
    }
  }

  const reset = () => { setFile(null); setAnalysis(''); setError(''); setAppState('landing') }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <span className="logo">⚡ TalkMyBill</span>
          <span className="free-badge">FREE • No signup needed</span>
        </div>
      </header>
      <main className="main">
        {appState === 'landing' && (
          <section className="card landing-card">
            <div className="hero-emoji">🧾</div>
            <h1 className="hero-title">What is Con Ed even<br />charging me for? 🤔</h1>
            <p className="hero-sub">Drop your bill below — we'll translate every line into plain English, flag sketchy charges, and tell you exactly what to do about it.</p>
            <div className={`drop-zone${isDragging ? ' drop-zone--active' : ''}`} onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={() => fileInputRef.current.click()} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current.click()} aria-label="Upload your Con Ed bill">
              <span className="drop-icon">📂</span>
              <p className="drop-main">Drag &amp; drop your bill here</p>
              <p className="drop-hint">or <u>click to browse</u></p>
              <p className="drop-formats">PDF · JPG · PNG · WEBP — up to 20 MB</p>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,.pdf" onChange={(e) => acceptFile(e.target.files[0])} className="sr-only" aria-hidden="true" />
            {error && <div className="error-box">⚠️ {error}</div>}
            <div className="features">
              <div className="feature-chip">🔍 Explains every charge</div>
              <div className="feature-chip">⚠️ Flags unusual rates</div>
              <div className="feature-chip">💡 Gives you action tips</div>
            </div>
          </section>
        )}
        {appState === 'selected' && (
          <section className="card selected-card">
            <h2 className="selected-title">Got your bill! 📬</h2>
            <p className="selected-sub">Ready to decode it for you.</p>
            <div className="file-preview">
              <span className="file-emoji">{file?.type === 'application/pdf' ? '📄' : '🖼️'}</span>
              <div className="file-meta">
                <p className="file-name">{file?.name}</p>
                <p className="file-size">{file ? (file.size / 1024).toFixed(1) + ' KB' : ''}</p>
              </div>
              <button className="remove-btn" onClick={reset} aria-label="Remove file">✕</button>
            </div>
            {error && <div className="error-box">⚠️ {error}</div>}
            <button className="cta-btn" onClick={analyzeFile}>Explain My Bill! ⚡</button>
            <button className="ghost-btn" onClick={reset}>Upload a different file</button>
          </section>
        )}
        {appState === 'loading' && (
          <section className="card loading-card">
            <div className="bolt-wrap"><span className="bolt" aria-hidden="true">⚡</span></div>
            <h2 className="loading-title">Reading your bill…</h2>
            <p className="loading-sub">Our AI is scanning every line 🔍</p>
            <div className="progress-dots"><span className="dot" /><span className="dot" /><span className="dot" /></div>
          </section>
        )}
        {appState === 'results' && (
          <section className="results-wrap">
            <div className="results-header">
              <h2 className="results-title">Here's what's going on 👇</h2>
              <p className="results-sub">Plain English, no jargon, no fluff.</p>
            </div>
            <div className="analysis-card">{formatAnalysis(analysis)}</div>
            <div className="action-row">
              <a href="tel:18007526633" className="action-btn action-btn--primary">📞 Call Con Ed</a>
              <a href="https://www.coned.com" target="_blank" rel="noopener noreferrer" className="action-btn action-btn--outline">🌐 Con Ed Website</a>
            </div>
            <div className="action-row action-row--single">
              <a href="tel:18003423377" className="action-btn action-btn--ghost">📋 NY PSC Hotline — 1-800-342-3377</a>
            </div>
            <button className="analyze-again-btn" onClick={reset}>📄 Analyze Another Bill</button>
          </section>
        )}
      </main>
      <footer className="footer">
        <p>Built for New Yorkers 🗽 &bull; Not financial or legal advice &bull; TalkMyBill</p>
      </footer>
    </div>
  )
}
