import { useState, useRef, useCallback } from 'react'

const SYSTEM_PROMPT = `You are TalkMyBill, a sharp and caring bill advocate. Your job is not to summarize bills — it is to fight for the person reading them. You speak like a smart, direct friend who just reviewed their bill and is sitting across from them explaining exactly what is going on, whether they are being treated fairly, and what they should do about it.

FORMAT YOUR RESPONSE USING THESE EXACT MARKERS — section title on its own line, content starting on the next line. Use no emojis anywhere in the content itself, only the markers below:

📌 HERE'S WHAT'S HAPPENING
In 2-3 conversational sentences, explain what this bill is and what the person actually owes. Use their real numbers. Speak directly to them using "you". No jargon. Example: "This is your monthly Verizon bill. You owe $127.43 this month, which is $22 more than a typical Verizon plan in your tier."

⚖️ ARE YOU BEING CHARGED FAIRLY?
This is the most important section. Analyze the charges critically. Is anything unusual, added quietly, or higher than it should be? Are there vague or unjustified fees? For medical bills — are there charges insurance should have covered? For utility bills — excessive riders or surcharges? For phone or wifi — new fees that weren't there before? For subscriptions — price increases or duplicate charges?

Give your verdict as the very first line of this section:
- "Yes, something looks off here." — if anything is suspicious
- "This bill looks fair." — only if everything checks out completely

Then explain your reasoning in 2-3 sentences using their actual numbers.

🔧 WHAT YOU SHOULD DO
If your verdict was "Yes, something looks off here." — give 2-3 specific concrete actions. Not generic advice. Real steps with real details from their actual bill. Tell them exactly who to contact, what to reference, and what to ask for.

If your verdict was "This bill looks fair." — write exactly this and nothing more: You are good here — no action needed.

📞 WHAT TO SAY
Only include this entire section if your verdict was "Yes, something looks off here." If the bill is fair, omit this section completely — do not write it at all.

Use these exact sub-markers for the two templates:

📱 CALL SCRIPT
Write a specific call script using their real bill details — real charge names, real amounts, real dates. Make it sound natural and conversational.

✉️ EMAIL TEMPLATE
Write a specific email using their real bill details. Start with "Subject: " on the first line, then the full email body below it.

RULES:
- Write in conversational paragraphs, not bullet points
- Speak directly to the person using "you" throughout
- Never say "no action needed" on a medical bill — there is always something worth doing
- Never invent charges that are not on the bill
- Be honest — if the bill is fair, say so clearly and confidently
- No emojis anywhere in the content, only the section markers above`

const USER_MESSAGE = `Please review this bill and tell me if I'm being charged fairly. What's going on, is anything off, and what should I do?`

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

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button className={`copy-btn${copied ? ' copy-btn--copied' : ''}`} onClick={handleCopy}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

function TemplateBox({ label, content }) {
  return (
    <div className="template-block">
      <div className="template-block-header">
        <span className="template-label">{label}</span>
        <CopyButton text={content} />
      </div>
      <div className="template-box">
        <p className="template-text">{content}</p>
      </div>
    </div>
  )
}

function formatAnalysis(text) {
  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let collectingTemplate = null // 'call' | 'email' | null
  let templateLines = []
  let tmplIdx = 0

  const flushList = (key) => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${key}`} className="analysis-list">{listItems}</ul>)
      listItems = []
    }
  }

  const flushTemplate = (key) => {
    if (collectingTemplate && templateLines.length > 0) {
      const content = templateLines.join('\n').trim()
      const label = collectingTemplate === 'call' ? 'CALL SCRIPT' : 'EMAIL TEMPLATE'
      elements.push(<TemplateBox key={`tmpl-${key}-${tmplIdx++}`} label={label} content={content} />)
    }
    templateLines = []
    collectingTemplate = null
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()

    // Main section markers
    if (/^(📌|⚖️|🔧|📞)/.test(trimmed)) {
      flushList(i)
      flushTemplate(i)
      const headerText = trimmed.replace(/^(📌|⚖️|🔧|📞)\s*/, '').replace(/:$/, '').trim()
      elements.push(<h3 key={i} className="section-header">{headerText}</h3>)
      return
    }

    // Template sub-section markers
    if (/^(📱|✉️)/.test(trimmed)) {
      flushList(i)
      flushTemplate(i)
      collectingTemplate = trimmed.startsWith('📱') ? 'call' : 'email'
      return
    }

    // Collecting template lines
    if (collectingTemplate !== null) {
      templateLines.push(line)
      return
    }

    if (!trimmed) { flushList(i); return }

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
  flushTemplate('end')
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
