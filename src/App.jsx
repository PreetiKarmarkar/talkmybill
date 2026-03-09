import { useState, useRef, useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'

const SYSTEM_PROMPT = `You are TalkMyBill, a sharp and caring bill advocate. Your job is not to summarize bills — it is to fight for the person reading them. You speak like a smart, direct friend who just reviewed their bill and is sitting across from them explaining exactly what is going on, whether they are being treated fairly, and what they should do about it.

FORMAT YOUR RESPONSE USING THESE EXACT MARKERS — section title on its own line, content starting on the next line. Use no emojis anywhere in the content itself, only the markers below:

📌 SUMMARY
In 2-3 conversational sentences, explain what this bill is and what the person actually owes. Use their real numbers. Speak directly to them using "you". No jargon. Example: "This is your monthly Verizon bill. You owe $127.43 this month, which is $22 more than a typical Verizon plan in your tier."

⚖️ ARE YOU BEING CHARGED FAIRLY?
This is the most important section. Analyze the charges critically. Is anything unusual, added quietly, or higher than it should be? Are there vague or unjustified fees? For medical bills — are there charges insurance should have covered? For utility bills — excessive riders or surcharges? For phone or wifi — new fees that weren't there before? For subscriptions — price increases or duplicate charges?

Give your verdict as the very first line of this section:
- "No, something looks off here." — if anything is suspicious or unfair
- "Yes, this bill looks fair." — only if everything checks out completely

Then explain your reasoning in 2-3 sentences using their actual numbers.

🔧 WHAT YOU SHOULD DO
If your verdict was "No, something looks off here." — give 2-3 specific concrete actions. Not generic advice. Real steps with real details from their actual bill. Tell them exactly who to contact, what to reference, and what to ask for.

If your verdict was "Yes, this bill looks fair." — write exactly this and nothing more: You are good here — no action needed.

📞 WHAT TO SAY
Only include this entire section if your verdict was "No, something looks off here." If the bill is fair, omit this section completely — do not write it at all.

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

function TemplateAccordion({ templates }) {
  const [openIdx, setOpenIdx] = useState(null)
  const toggle = (idx) => setOpenIdx(openIdx === idx ? null : idx)

  const meta = {
    call: {
      label: 'Call Script',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A6580" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 9.81a19.79 19.79 0 01-3.07-8.63A2 2 0 012 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 14.92z"/>
        </svg>
      ),
    },
    email: {
      label: 'Email Template',
      icon: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#4A6580" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
      ),
    },
  }

  return (
    <div className="accordion-wrap">
      {templates.map((tmpl, idx) => {
        const isOpen = openIdx === idx
        const { label, icon } = meta[tmpl.type] || { label: tmpl.type, icon: null }
        return (
          <div key={idx} className={`accordion-item${isOpen ? ' accordion-item--open' : ''}`}>
            <button className="accordion-trigger" onClick={() => toggle(idx)}>
              <span className="accordion-icon-wrap">{icon}</span>
              <span className="accordion-label">{label}</span>
              <span className="accordion-chevron">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </span>
            </button>
            <div className="accordion-body">
              <div className="accordion-body-inner">
                <p className="template-text">{tmpl.content}</p>
                <div className="accordion-footer">
                  <CopyButton text={tmpl.content} />
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function formatAnalysis(text) {
  const lines = text.split('\n')
  const elements = []
  let listItems = []
  let collectingTemplate = null // 'call' | 'email' | null
  let templateLines = []
  let collectedTemplates = []
  let accordIdx = 0

  const flushList = (key) => {
    if (listItems.length > 0) {
      elements.push(<ul key={`ul-${key}`} className="analysis-list">{listItems}</ul>)
      listItems = []
    }
  }

  const flushTemplate = () => {
    if (collectingTemplate && templateLines.length > 0) {
      const content = templateLines.join('\n').trim()
      collectedTemplates.push({ type: collectingTemplate, content })
    }
    templateLines = []
    collectingTemplate = null
  }

  const renderAccordion = (key) => {
    if (collectedTemplates.length > 0) {
      elements.push(<TemplateAccordion key={`accord-${key}-${accordIdx++}`} templates={[...collectedTemplates]} />)
      collectedTemplates = []
    }
  }

  lines.forEach((line, i) => {
    const trimmed = line.trim()

    // Main section markers
    if (/^(📌|⚖️|🔧|📞)/.test(trimmed)) {
      flushList(i)
      flushTemplate()
      renderAccordion(i)
      const headerText = trimmed.replace(/^(📌|⚖️|🔧|📞)\s*/, '').replace(/:$/, '').trim()
      elements.push(<h3 key={i} className="section-header">{headerText}</h3>)
      return
    }

    // Template sub-section markers
    if (/^(📱|✉️)/.test(trimmed)) {
      flushList(i)
      flushTemplate()
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
  flushTemplate()
  renderAccordion('end')
  return elements
}

function RobotAvatar({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="20" cy="20" r="20" fill="#E8F4F8"/>
      <rect x="11" y="14" width="18" height="14" rx="4" fill="#447F98"/>
      <circle cx="16" cy="20" r="2" fill="white"/>
      <circle cx="24" cy="20" r="2" fill="white"/>
      <rect x="17" y="24" width="6" height="2" rx="1" fill="white"/>
      <rect x="19" y="10" width="2" height="4" rx="1" fill="#447F98"/>
      <circle cx="20" cy="10" r="1.5" fill="#447F98"/>
    </svg>
  )
}

const CHAT_CSS = `
.chat-fab{position:fixed!important;bottom:28px!important;right:28px!important;left:auto!important;top:auto!important;z-index:9999!important;display:flex;flex-direction:column;align-items:flex-end;gap:12px}
.chat-fab-btn{display:flex;align-items:center;gap:10px;background:#fff;color:#447F98;border:1px solid rgba(68,127,152,.18);border-radius:50px;padding:8px 20px 8px 8px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.13),0 1px 4px rgba(0,0,0,.06);transition:box-shadow .2s,transform .2s;white-space:nowrap;font-family:inherit}
.chat-fab-btn:hover{box-shadow:0 6px 30px rgba(0,0,0,.18),0 2px 6px rgba(0,0,0,.08);transform:translateY(-1px)}
.chat-fab-avatar{width:36px;height:36px;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.chat-fab-text{font-size:14px;font-weight:600;color:#447F98}
.chat-window{width:380px;height:520px;background:#fff;border-radius:16px;box-shadow:0 8px 48px rgba(0,0,0,.18),0 2px 8px rgba(0,0,0,.08);display:flex;flex-direction:column;overflow:hidden;animation:chatSlideUp .22s ease both}
@keyframes chatSlideUp{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
.chat-window-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#fff;border-bottom:1px solid #f0f0f0;flex-shrink:0}
.chat-window-header-left{display:flex;align-items:center;gap:10px}
.chat-avatar-wrap{width:40px;height:40px;border-radius:50%;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center}
.chat-window-title{font-size:15px;font-weight:700;color:#1a2b3c;letter-spacing:-.2px}
.chat-window-header-right{display:flex;align-items:center;gap:2px}
.chat-header-icon-btn{background:none;border:none;cursor:pointer;padding:6px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#999;transition:background .15s}
.chat-header-icon-btn:hover{background:#f5f5f5}
.chat-messages{flex:1;overflow-y:auto;padding:16px;background:#F0F4F8;display:flex;flex-direction:column;gap:10px}
.chat-messages::-webkit-scrollbar{width:4px}
.chat-messages::-webkit-scrollbar-track{background:transparent}
.chat-messages::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px}
.chat-row{display:flex;align-items:flex-start;gap:8px}
.chat-row--user{justify-content:flex-end}
.chat-bot-avatar{width:28px;height:28px;flex-shrink:0;margin-top:2px}
.chat-bubble{max-width:78%;padding:10px 14px;font-size:14px;line-height:1.55;word-wrap:break-word}
.chat-bubble--bot{background:#fff;color:#2c3e50;border-radius:4px 16px 16px 16px;box-shadow:0 1px 4px rgba(0,0,0,.07)}
.chat-bubble--user{background:#447F98;color:#fff;border-radius:16px 16px 4px 16px}
.chat-bubble--loading{display:flex;align-items:center;gap:5px;padding:12px 16px}
.chat-dot{width:7px;height:7px;border-radius:50%;background:#94B4C8;animation:chatDotBounce 1.2s ease-in-out infinite}
.chat-dot:nth-child(2){animation-delay:.2s}
.chat-dot:nth-child(3){animation-delay:.4s}
@keyframes chatDotBounce{0%,80%,100%{transform:scale(.7);opacity:.5}40%{transform:scale(1.2);opacity:1}}
.chat-input-row{display:flex;align-items:center;gap:8px;padding:12px 14px;background:#fff;border-top:1px solid #f0f0f0;flex-shrink:0}
.chat-input{flex:1;border:1.5px solid #e5e7eb;border-radius:24px;padding:9px 16px;font-size:14px;font-family:inherit;outline:none;background:#fff;color:#2c3e50;transition:border-color .2s}
.chat-input:focus{border-color:#447F98}
.chat-input::placeholder{color:#b0b8c4}
.chat-send-btn{background:#447F98;color:#fff;border:none;border-radius:24px;padding:9px 20px;font-size:14px;font-weight:700;font-family:inherit;cursor:pointer;flex-shrink:0;transition:background .2s,transform .15s;white-space:nowrap}
.chat-send-btn:hover:not(:disabled){background:#3a6e85;transform:translateY(-1px)}
.chat-send-btn:disabled{opacity:.4;cursor:not-allowed}
@media(max-width:600px){.chat-window{width:calc(100vw - 32px)!important;height:480px!important}.chat-fab{right:16px!important;bottom:16px!important}}
`

function BillChat({ analysis }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([
    { role: 'assistant', content: "Hi there! Have any questions or need clarification about your bill review? I'm here to help." }
  ])
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    }
  }, [messages, isOpen])

  const sendMessage = async () => {
    if (!inputValue.trim() || isLoading) return
    const userMsg = { role: 'user', content: inputValue.trim() }
    const updatedMessages = [...messages, userMsg]
    setMessages(updatedMessages)
    setInputValue('')
    setIsLoading(true)
    try {
      const apiKey = import.meta.env.VITE_OPENAI_API_KEY
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 200,
          messages: [
            {
              role: 'system',
              content: `You are a bill assistant for TalkMyBill. You have analyzed the user's bill. Here is the analysis:\n\n${analysis}\n\nYOUR JOB when someone asks what a charge means:\n1. Explain clearly what that charge actually IS in plain English — what it means, why it exists, who charges it and why. Speak like a knowledgeable friend.\n2. Relate it to their specific bill — is the amount normal or high?\n3. Only mention contacting the provider if there is a specific, genuine reason to do so — for example, if the charge looks wrong, unexplained, or negotiable. Do NOT end every answer with "contact your provider" as a default. If the charge is normal and well understood, just explain it and stop.\n\nEXAMPLE of BAD answer: "The Pole Plant Adjustment is a charge on your bill. You should contact your utility company for more details."\nEXAMPLE of GOOD answer: "The Pole Plant Adjustment is a fee utilities charge to recover the cost of maintaining physical infrastructure like poles and wiring in your area. It's standard across most utility bills and your amount of $4.12 is within the normal range."\n\nTOPICS YOU CAN ANSWER:\n- Any charge, fee, or line item on this specific bill\n- General bill and energy literacy questions like "what is a kWh", "what is a deductible", "what is an EOB", "what is demand charge", "how does net metering work" — these help people understand their bills and are always fair game\n- Whether a charge is normal, high, or worth disputing\n\nTOPICS TO DECLINE:\n- Personal topics, how you feel, your name, other products or services, general knowledge unrelated to bills, math problems, anything clearly outside the domain of bills and charges\n- If off-topic say exactly: "I'm only here to help with questions about your bill. Is there anything specific about your charges you'd like me to explain?"\n\nFORMAT RULES:\n- 3-4 sentences max\n- No bullet points — plain conversational English only\n- Always explain what something means before suggesting any action`
            },
            ...updatedMessages
          ],
        }),
      })
      if (!res.ok) throw new Error('Request failed')
      const data = await res.json()
      const reply = data.choices?.[0]?.message?.content
      if (reply) setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: 'Sorry, something went wrong. Please try again.' }])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  return createPortal(
    <>
    <style>{CHAT_CSS}</style>
    <div className="chat-fab">
      {isOpen ? (
        <div className="chat-window">
          {/* Header */}
          <div className="chat-window-header">
            <div className="chat-window-header-left">
              <div className="chat-avatar-wrap"><RobotAvatar size={40} /></div>
              <span className="chat-window-title">Ask Me Chat</span>
            </div>
            <div className="chat-window-header-right">
              <button className="chat-header-icon-btn" aria-label="More options">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2" strokeLinecap="round">
                  <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                </svg>
              </button>
              <button className="chat-header-icon-btn" onClick={() => setIsOpen(false)} aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#888" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>
          {/* Messages */}
          <div className="chat-messages">
            {messages.map((msg, i) => (
              msg.role === 'user' ? (
                <div key={i} className="chat-row chat-row--user">
                  <div className="chat-bubble chat-bubble--user">{msg.content}</div>
                </div>
              ) : (
                <div key={i} className="chat-row chat-row--bot">
                  <div className="chat-bot-avatar"><RobotAvatar size={28} /></div>
                  <div className="chat-bubble chat-bubble--bot">{msg.content}</div>
                </div>
              )
            ))}
            {isLoading && (
              <div className="chat-row chat-row--bot">
                <div className="chat-bot-avatar"><RobotAvatar size={28} /></div>
                <div className="chat-bubble chat-bubble--bot chat-bubble--loading">
                  <span className="chat-dot" /><span className="chat-dot" /><span className="chat-dot" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
          {/* Input */}
          <div className="chat-input-row">
            <input
              className="chat-input"
              type="text"
              placeholder="Type your message..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button className="chat-send-btn" onClick={sendMessage} disabled={!inputValue.trim() || isLoading}>
              Send
            </button>
          </div>
        </div>
      ) : (
        <button className="chat-fab-btn" onClick={() => setIsOpen(true)}>
          <span className="chat-fab-avatar"><RobotAvatar size={32} /></span>
          <span className="chat-fab-text">Still confused? Ask me</span>
        </button>
      )}
    </div>
    </>,
    document.body
  )
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
    <>
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
              <h2 className="results-title">Bill reviewed. No lawyers needed.</h2>
            </div>

            <div className="analysis-card">{formatAnalysis(analysis)}</div>

            <button className="analyze-again-btn" onClick={reset}>📄 Analyze Another Bill</button>
          </section>
        )}
      </main>

      <footer className="footer">
        <p>Built for everyone &bull; Not financial or legal advice &bull; TalkMyBill</p>
      </footer>
    </div>
    {appState === 'results' && <BillChat analysis={analysis} />}
    </>
  )
}
