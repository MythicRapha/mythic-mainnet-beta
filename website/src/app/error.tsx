'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-8">
      <div className="max-w-lg text-center space-y-6">
        <h2 className="text-xl font-bold text-white">Something went wrong</h2>
        <p className="text-mythic-text-dim text-sm font-mono">{error.message}</p>
        <button
          onClick={() => reset()}
          className="px-6 py-3 bg-mythic-violet text-white font-semibold hover:bg-mythic-violet-bright transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  )
}
