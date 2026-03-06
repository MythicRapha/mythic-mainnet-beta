'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useProfileContext } from '@/providers/ProfileProvider'
import { useWalletContext } from '@/providers/WalletProvider'

type Step = 'form' | 'confirm'

export default function ProfileSetupModal() {
  const { needsSetup, createProfile, checkUsername, setNeedsSetup } = useProfileContext()
  const { address, shortAddress } = useWalletContext()

  const [step, setStep] = useState<Step>('form')
  const [username, setUsername] = useState('')
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null)
  const [usernameChecking, setUsernameChecking] = useState(false)
  const [bio, setBio] = useState('')
  const [pfpFile, setPfpFile] = useState<File | null>(null)
  const [pfpPreview, setPfpPreview] = useState<string | null>(null)
  const [pfpUploading, setPfpUploading] = useState(false)
  const [pfpUri, setPfpUri] = useState('')
  const [shieldOn, setShieldOn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const checkTimer = useRef<NodeJS.Timeout | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (needsSetup && address) {
      setStep('form')
      setUsername('')
      setUsernameAvailable(null)
      setBio('')
      setPfpFile(null)
      setPfpPreview(null)
      setPfpUri('')
      setShieldOn(false)
      setError('')
    }
  }, [needsSetup, address])

  // Debounced username availability check
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current)
    setUsernameAvailable(null)

    const cleaned = username.trim().toLowerCase().replace(/\.myth$/, '').replace(/[^a-z0-9_-]/g, '')
    if (cleaned.length < 2) {
      setUsernameChecking(false)
      return
    }

    setUsernameChecking(true)
    checkTimer.current = setTimeout(async () => {
      const available = await checkUsername(cleaned)
      setUsernameAvailable(available)
      setUsernameChecking(false)
    }, 400)

    return () => { if (checkTimer.current) clearTimeout(checkTimer.current) }
  }, [username, checkUsername])

  // Handle file selection
  const handleFile = useCallback((file: File) => {
    const validTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
    if (!validTypes.includes(file.type)) {
      setError('Invalid image type. Use PNG, JPG, GIF, or WebP.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image too large. Max 5MB.')
      return
    }
    setError('')
    setPfpFile(file)
    setPfpPreview(URL.createObjectURL(file))
  }, [])

  // Upload file
  const uploadPfp = useCallback(async (): Promise<string> => {
    if (!pfpFile) return ''
    if (pfpUri) return pfpUri // already uploaded

    setPfpUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', pfpFile)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      const data = await res.json()
      const uri = data.uri || data.url
      setPfpUri(uri)
      return uri
    } catch {
      throw new Error('Failed to upload profile picture')
    } finally {
      setPfpUploading(false)
    }
  }, [pfpFile, pfpUri])

  // Drag handlers
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])
  const onDragLeave = useCallback(() => setDragOver(false), [])
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [handleFile])

  if (!needsSetup || !address) return null

  const cleanUsername = username.trim().toLowerCase().replace(/\.myth$/, '').replace(/[^a-z0-9_-]/g, '')
  const usernameValid = cleanUsername.length >= 2 && cleanUsername.length <= 24
  const canProceed = usernameValid && usernameAvailable === true

  const handleNext = () => {
    if (!canProceed) return
    setStep('confirm')
  }

  const handleBack = () => {
    setStep('form')
    setError('')
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      // Upload PFP if needed
      let uri = pfpUri
      if (pfpFile && !pfpUri) {
        uri = await uploadPfp()
      }

      await createProfile({
        username: cleanUsername,
        display_name: cleanUsername,
        bio: bio.trim(),
        pfp_url: uri,
        privacy_shield: shieldOn,
      })
    } catch (e: any) {
      setError(e.message || 'Failed to save profile')
      setSaving(false)
      return
    }
    setSaving(false)
  }

  const handleSkip = () => {
    setNeedsSetup(false)
  }

  const removePfp = () => {
    setPfpFile(null)
    setPfpPreview(null)
    setPfpUri('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}>
      <div className="relative w-full max-w-md bg-[#08080C] border border-white/[0.06] overflow-hidden">

        {step === 'form' && (
          <>
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 bg-mythic-violet flex items-center justify-center">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <h3 className="font-mono text-sm font-bold text-white tracking-[0.08em] uppercase">Claim Your .myth</h3>
                  <p className="font-mono text-[0.6rem] text-[#404050]">{shortAddress}</p>
                </div>
              </div>
              <p className="font-mono text-[0.7rem] text-[#686878] leading-relaxed">
                Claim a <span className="text-mythic-violet">.myth</span> domain as your on-chain identity. Registered permanently on Mythic L2.
              </p>
            </div>

            {/* Form */}
            <div className="px-6 py-5 space-y-4">
              {/* Username (.myth domain) */}
              <div>
                <label className="block font-mono text-[0.6rem] text-[#404050] uppercase tracking-[0.15em] mb-1.5">
                  Username
                </label>
                <div className="flex items-center bg-[#0F0F15] border border-white/[0.06] focus-within:border-mythic-violet/40 transition-colors">
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder="satoshi"
                    maxLength={24}
                    autoFocus
                    className="flex-1 bg-transparent px-3 py-2.5 font-mono text-[0.75rem] text-white placeholder-[#404050] focus:outline-none"
                  />
                  <span className="pr-3 font-mono text-[0.75rem] text-mythic-violet font-medium">.myth</span>
                </div>
                <div className="h-5 flex items-center mt-1">
                  {usernameChecking && cleanUsername.length >= 2 && (
                    <span className="font-mono text-[0.6rem] text-[#404050] flex items-center gap-1.5">
                      <span className="inline-block w-2.5 h-2.5 border border-[#404050] border-t-transparent rounded-full animate-spin" />
                      Checking...
                    </span>
                  )}
                  {!usernameChecking && usernameAvailable === true && cleanUsername.length >= 2 && (
                    <span className="font-mono text-[0.6rem] text-[#39FF14] flex items-center gap-1.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/></svg>
                      {cleanUsername}.myth is available
                    </span>
                  )}
                  {!usernameChecking && usernameAvailable === false && cleanUsername.length >= 2 && (
                    <span className="font-mono text-[0.6rem] text-red-400 flex items-center gap-1.5">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
                      {cleanUsername}.myth is taken
                    </span>
                  )}
                  {cleanUsername.length > 0 && cleanUsername.length < 2 && (
                    <span className="font-mono text-[0.6rem] text-[#404050]">Min 2 characters</span>
                  )}
                </div>
              </div>

              {/* Profile Picture — Drag & Drop */}
              <div>
                <label className="block font-mono text-[0.6rem] text-[#404050] uppercase tracking-[0.15em] mb-1.5">
                  Profile Picture
                </label>
                {pfpPreview ? (
                  <div className="relative group">
                    <div className="flex items-center gap-4 p-3 bg-[#0F0F15] border border-mythic-violet/20">
                      <img src={pfpPreview} alt="" className="w-14 h-14 object-cover border border-white/10" />
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-[0.7rem] text-white truncate">{pfpFile?.name}</p>
                        <p className="font-mono text-[0.55rem] text-[#404050]">
                          {pfpFile ? `${(pfpFile.size / 1024).toFixed(0)} KB` : ''}
                          {pfpUri && <span className="text-[#39FF14] ml-2">Uploaded to IPFS</span>}
                        </p>
                      </div>
                      <button
                        onClick={removePfp}
                        className="p-1.5 text-[#404050] hover:text-red-400 transition-colors"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`flex flex-col items-center justify-center p-6 border-2 border-dashed cursor-pointer transition-colors ${
                      dragOver
                        ? 'border-mythic-violet bg-mythic-violet/10'
                        : 'border-white/[0.08] bg-[#0F0F15] hover:border-white/[0.15]'
                    }`}
                  >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={dragOver ? '#7B2FFF' : '#404050'} strokeWidth="1.5" className="mb-2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <p className="font-mono text-[0.65rem] text-[#686878]">
                      {dragOver ? 'Drop image here' : 'Drag & drop or click to upload'}
                    </p>
                    <p className="font-mono text-[0.55rem] text-[#303040] mt-1">PNG, JPG, GIF, WebP — Max 5MB</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                      onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }}
                      className="hidden"
                    />
                  </div>
                )}
              </div>

              {/* Bio */}
              <div>
                <label className="block font-mono text-[0.6rem] text-[#404050] uppercase tracking-[0.15em] mb-1.5">
                  Bio <span className="text-[#303040]">(optional)</span>
                </label>
                <textarea
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Building on Mythic..."
                  maxLength={256}
                  rows={2}
                  className="w-full bg-[#0F0F15] border border-white/[0.06] px-3 py-2.5 font-mono text-[0.75rem] text-white placeholder-[#404050] focus:outline-none focus:border-mythic-violet/40 transition-colors resize-none"
                />
              </div>

              {/* Privacy Shield */}
              <div className="border border-white/[0.06] bg-[#0F0F15] p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 flex items-center justify-center transition-colors ${shieldOn ? 'bg-mythic-violet' : 'bg-[#1a1a24]'}`}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <div>
                      <div className="font-mono text-[0.75rem] text-white font-medium">Privacy Shield</div>
                      <div className="font-mono text-[0.6rem] text-[#686878]">
                        {shieldOn ? 'You appear as ' + (shortAddress || '****') : 'Your .myth name & pfp are visible'}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShieldOn(!shieldOn)}
                    className={`w-10 h-5 flex items-center transition-colors ${shieldOn ? 'bg-mythic-violet justify-end' : 'bg-[#1a1a24] border border-white/10 justify-start'}`}
                  >
                    <div className={`w-4 h-4 mx-0.5 transition-colors ${shieldOn ? 'bg-white' : 'bg-[#404050]'}`} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/20">
                  <p className="font-mono text-[0.65rem] text-red-400">{error}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between">
              <button
                onClick={handleSkip}
                className="font-mono text-[0.65rem] text-[#404050] hover:text-[#686878] transition-colors tracking-[0.08em] uppercase"
              >
                Skip for now
              </button>
              <button
                onClick={handleNext}
                disabled={!canProceed}
                className="px-5 py-2 bg-mythic-violet text-white font-mono text-[0.7rem] font-medium tracking-[0.06em] hover:brightness-110 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 'confirm' && (
          <>
            {/* Confirmation Header */}
            <div className="px-6 pt-6 pb-4 border-b border-white/[0.06]">
              <h3 className="font-mono text-sm font-bold text-white tracking-[0.08em] uppercase mb-1">Confirm Your Identity</h3>
              <p className="font-mono text-[0.7rem] text-[#686878] leading-relaxed">
                This will register <span className="text-mythic-violet font-medium">{cleanUsername}.myth</span> on-chain. Domain names are permanent.
              </p>
            </div>

            {/* Preview */}
            <div className="px-6 py-5 space-y-4">
              <div className="border border-mythic-violet/20 bg-mythic-violet/5 p-5">
                <div className="flex items-center gap-4 mb-4">
                  {pfpPreview ? (
                    <img src={pfpPreview} alt="" className="w-14 h-14 object-cover border border-white/10" />
                  ) : (
                    <div className="w-14 h-14 bg-mythic-violet/20 border border-mythic-violet/30 flex items-center justify-center">
                      <span className="font-mono text-xl text-mythic-violet font-bold">{cleanUsername.charAt(0).toUpperCase()}</span>
                    </div>
                  )}
                  <div>
                    <div className="font-mono text-[1rem] text-white font-bold">{cleanUsername}<span className="text-mythic-violet">.myth</span></div>
                    <div className="font-mono text-[0.6rem] text-[#404050]">{shortAddress}</div>
                  </div>
                </div>

                {bio.trim() && (
                  <p className="font-mono text-[0.7rem] text-[#686878] mb-3">{bio.trim()}</p>
                )}

                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] ${shieldOn ? 'bg-mythic-violet/20 text-mythic-violet' : 'bg-[#39FF14]/10 text-[#39FF14]'}`}>
                    {shieldOn ? 'Shield ON' : 'Public'}
                  </span>
                  {pfpFile && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 font-mono text-[0.55rem] uppercase tracking-[0.1em] bg-[#39FF14]/10 text-[#39FF14]">
                      PFP Attached
                    </span>
                  )}
                </div>
              </div>

              {error && (
                <div className="px-3 py-2 bg-red-500/10 border border-red-500/20">
                  <p className="font-mono text-[0.65rem] text-red-400">{error}</p>
                </div>
              )}

              <div className="flex items-start gap-2 px-3 py-2.5 bg-[#0F0F15] border border-white/[0.04]">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#686878" strokeWidth="2" className="flex-shrink-0 mt-0.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="font-mono text-[0.6rem] text-[#686878] leading-relaxed">
                  Your domain is stored on-chain. PFP is stored on IPFS. You can update your bio and pfp anytime, but the domain name is permanent and tied to your wallet.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="px-6 py-4 border-t border-white/[0.06] flex items-center justify-between">
              <button
                onClick={handleBack}
                className="font-mono text-[0.65rem] text-[#404050] hover:text-[#686878] transition-colors tracking-[0.08em] uppercase"
              >
                Back
              </button>
              <button
                onClick={handleSave}
                disabled={saving || pfpUploading}
                className="px-5 py-2 bg-mythic-violet text-white font-mono text-[0.7rem] font-medium tracking-[0.06em] hover:brightness-110 transition-all disabled:opacity-50"
              >
                {pfpUploading ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Uploading...
                  </span>
                ) : saving ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Registering on-chain...
                  </span>
                ) : (
                  <>Claim {cleanUsername}.myth</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
