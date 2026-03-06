import { useState, useRef, useCallback } from 'react'

const SYSTEM_PROMPT = `You are TalkMyBill, a knowledgeable friend who helps people understand any bill they receive — electricity, medical, phone, wifi, insurance, credit card, subscriptions, and more.

RESPONSE RULES:
- Write in short conversational paragraphs. No bullet points, no lists whatsoever.
- No emojis anywhere in your response except the three section header markers below.
- Skip information the user can already see: invoice numbers, dates, addresses, account numbers. Never repeat those back.
- Lead with the most important thing: is this bill normal or not?
- Keep the total response under 150 words. Be concise.

FORMAT YOUR RESPONSE EXACTLY LIKE THIS — section title on its own line, content on the next line:

🧾 WHAT YOUR BILL SAYS
In 2–3 sentences, explain what the charge actually is and whether the amount is standard. Sound like a friend who knows this stuff, not a receipt scanner.

⚠️ FLAGS
Only mention something if it is genuinely unusual, overpriced, or worth questioning. If everything looks normal, write exactly: Nothing unusual here. Do not flag normal things like standard tax rates or expected subscription amounts.

💡 TIPS
Give one specific actionable tip only if there is something worth doing. If the bill is fine, write exactly: No action needed.`

const USER_MESSAGE = `Please analyze this bill and explain it to me in plain English. What am I being charged for? Is anything unusual? What should I do?`

// Load PDF.js from CDN and convert first page → base64 PNG
async function pdfToBase64Image(file) {
  if (!window.pdfjsLib) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      s.onload = resolve
      s.onerror = () => reject(new Error('Failed to load PDF renderer'))
      document.head.appendChild(s)
    })
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
  }

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: 2.5 })

  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise

  return canvas.toDataURL('image/png').split(',')[1]
}

function formatAnalysis(text) {
  const lines = text.split('\n')
  const elements = []
  let listItems = []

  const flushList = (key) => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${key}`} className="analysis-list">{listItems}</ul>
      )
      listItems = []
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()
    if (!trimmed) { flushList(i); return }

    if (/^(🧾|⚠️|💡)/.test(trimmed)) {
      flushList(i)
      const headerText = trimmed.replace(/^(🧾|⚠️|💡)\s*/, '').replace(/:$/, '').trim()
      let icon = null
      if (trimmed.startsWith('🧾')) {
        icon = (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A6580" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="2" width="14" height="20" rx="2"/>
            <line x1="9" y1="7" x2="15" y2="7"/>
            <line x1="9" y1="11" x2="15" y2="11"/>
            <circle cx="9" cy="15" r="1" fill="#4A6580"/>
          </svg>
        )
      } else if (trimmed.startsWith('⚠️')) {
        icon = (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A6580" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        )
      } else if (trimmed.startsWith('💡')) {
        icon = (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A6580" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="9" y1="18" x2="15" y2="18"/>
            <line x1="10" y1="22" x2="14" y2="22"/>
            <path d="M12 2a7 7 0 017 7c0 2.38-1.19 4.47-3 5.74V17H8v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 017-7z"/>
          </svg>
        )
      }
      elements.push(
        <div key={i} className="section-header-wrap">
          <div className="section-icon-circle">{icon}</div>
          <h3 className="section-header">{headerText}</h3>
        </div>
      )
      return
    }
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) {
      flushList(i)
      elements.push(<p key={i} className="analysis-label">{trimmed.replace(/\*\*/g, '')}</p>)
      return
    }
    if (/^[•\-\*]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      const clean = trimmed.replace(/^[•\-\*]\s+/, '').replace(/^\d+\.\s+/, '').replace(/\*\*/g, '')
      listItems.push(<li key={i}>{clean}</li>)
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
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heic', 'application/pdf']
    if (!validTypes.includes(f.type)) {
      setError('Please upload a PDF or image (JPG, PNG, WEBP, GIF).')
      return
    }
    if (f.size > 20 * 1024 * 1024) {
      setError('File too large — please keep it under 20 MB.')
      return
    }
    setError('')
    setFile(f)
    setAppState('selected')
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setIsDragging(false); acceptFile(e.dataTransfer.files[0])
  }, [acceptFile])

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true) }, [])
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false) }, [])

  const toBase64 = (f) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(f)
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
  })

  const analyzeFile = async () => {
    setAppState('loading')
    setError('')

    try {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY
      if (!apiKey) throw new Error('Missing VITE_OPENAI_API_KEY — check your .env file.')

      // Convert PDF → PNG image, or read image directly
      let base64, mimeType
      if (file.type === 'application/pdf') {
        base64 = await pdfToBase64Image(file)
        mimeType = 'image/png'
      } else {
        base64 = await toBase64(file)
        mimeType = file.type
      }

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 2048,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64}`,
                    detail: 'high',
                  },
                },
                { type: 'text', text: USER_MESSAGE },
              ],
            },
          ],
        }),
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        throw new Error(errData?.error?.message || `Request failed (${response.status})`)
      }

      const data = await response.json()
      const text = data.choices?.[0]?.message?.content
      if (!text) throw new Error('No response received. Please try again.')

      setAnalysis(text)
      setAppState('results')
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong — please try again.')
      setAppState('selected')
    }
  }

  const reset = () => { setFile(null); setAnalysis(''); setError(''); setAppState('landing') }

  return (
    <div className="app">
      {/* Floating colour orbs — CSS-only depth effect */}
      <div className="orb orb-1" aria-hidden="true" />
      <div className="orb orb-2" aria-hidden="true" />
      <div className="orb orb-3" aria-hidden="true" />
      <div className="orb orb-4" aria-hidden="true" />

      <header className="header">
        <div className="header-inner">
          <span className="logo">🧾 TalkMyBill</span>
          <span className="free-badge">FREE • No signup needed</span>
        </div>
      </header>

      <main className="main">

        {appState === 'landing' && (
          <section className="card landing-card">
            <div className="hero-emoji">🧾</div>
            <h1 className="hero-title">What is this bill even<br />charging me for? 🤔</h1>
            <p className="hero-sub">
              Drop any bill: medical, electric, phone, wifi, insurance. We'll explain every charge in plain English.
            </p>

            <div
              className={`drop-zone${isDragging ? ' drop-zone--active' : ''}`}
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => fileInputRef.current.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current.click()}
              aria-label="Upload your bill"
            >
              <span className="drop-icon">📂</span>
              <p className="drop-main">Drag &amp; drop your bill here</p>
              <p className="drop-hint">or <u>click to browse</u></p>
              <p className="drop-formats">PDF · JPG · PNG · WEBP — up to 20 MB</p>
            </div>

            <input ref={fileInputRef} type="file" accept="image/*,.pdf"
              onChange={(e) => acceptFile(e.target.files[0])}
              className="sr-only" aria-hidden="true" />

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
            <div className="progress-dots">
              <span className="dot" /><span className="dot" /><span className="dot" />
            </div>
          </section>
        )}

        {appState === 'results' && (
          <section className="results-wrap">
            <div className="results-header">
              <h2 className="results-title">Here's what's going on 👇</h2>
              <p className="results-sub">Plain English, no jargon, no fluff.</p>
            </div>

            <div className="analysis-card">{formatAnalysis(analysis)}</div>

            <button className="analyze-again-btn" onClick={reset}>📄 Analyze Another Bill</button>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>Built for everyone 🗽 &bull; Not financial or legal advice &bull; TalkMyBill</p>
      </footer>
    </div>
  )
}
