import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Terminal, Loader2 } from 'lucide-react'
import { login, GatewayError } from '../lib/gateway'
import { useSession } from '../hooks/useSession'

export default function LoginPage() {
  const navigate = useNavigate()
  const { saveSession } = useSession()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username || !password) return
    setError('')
    setLoading(true)
    try {
      const token = await login(username, password)
      saveSession({ token, username })
      navigate('/chat')
    } catch (err) {
      setError(
        err instanceof GatewayError && err.status === 401
          ? 'Invalid credentials'
          : 'Could not connect to gateway',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-700 to-amber-600 flex items-center justify-center">
            <Terminal className="w-4.5 h-4.5 text-white" />
          </div>
          <div>
            <span className="text-gray-900 font-bold text-lg">ChatAI Agent</span>
            <span className="text-gray-600 text-xs block">powered by AgentCore</span>
          </div>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-white border border-gray-200 rounded-2xl p-6 space-y-4 shadow-sm"
        >
          <h1 className="text-gray-900 font-semibold text-base mb-1">Sign in</h1>

          <div className="space-y-1">
            <label className="text-xs text-gray-600 uppercase tracking-widest">Username</label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                         text-gray-900 placeholder-gray-500 outline-none
                         focus:border-orange-400 focus:ring-1 focus:ring-orange-200 transition-colors"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs text-gray-600 uppercase tracking-widest">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full bg-gray-50 border border-gray-300 rounded-lg px-3 py-2.5 text-sm
                         text-gray-900 placeholder-gray-500 outline-none
                         focus:border-orange-400 focus:ring-1 focus:ring-orange-200 transition-colors"
            />
          </div>

          {error && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || !username || !password}
            className="w-full py-2.5 rounded-xl font-semibold text-sm text-white
                       bg-gradient-to-r from-orange-700 to-amber-600
                       hover:from-orange-600 hover:to-amber-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       flex items-center justify-center gap-2 transition-all"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
