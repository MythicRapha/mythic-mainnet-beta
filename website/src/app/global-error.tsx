'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-black text-white flex items-center justify-center p-8">
        <div className="max-w-lg text-center space-y-6">
          <h1 className="text-2xl font-bold">Something went wrong</h1>
          <p className="text-gray-400 text-sm font-mono">{error.message}</p>
          <button
            onClick={() => {
              // Clear caches and reload
              if ('caches' in window) {
                caches.keys().then(names => names.forEach(n => caches.delete(n)))
              }
              reset()
            }}
            className="px-6 py-3 bg-[#7B2FFF] text-white font-semibold hover:bg-[#9B5FFF] transition-colors"
          >
            Try Again
          </button>
          <div>
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault()
                window.location.href = '/?_t=' + Date.now()
              }}
              className="text-sm text-[#7B2FFF] hover:underline"
            >
              Hard reload homepage
            </a>
          </div>
        </div>
      </body>
    </html>
  )
}
