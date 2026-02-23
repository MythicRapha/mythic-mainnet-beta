import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        mythic: {
          // Backgrounds
          bg: '#000000',
          'bg-1': '#08080C',
          'bg-2': '#0F0F15',
          'bg-3': '#16161F',
          'bg-4': '#1E1E2A',
          // Cards / surfaces
          card: '#08080C',
          // Borders
          border: 'rgba(255, 255, 255, 0.06)',
          'border-md': 'rgba(255, 255, 255, 0.1)',
          'border-strong': 'rgba(255, 255, 255, 0.16)',
          // Text
          text: '#A0A0B0',
          'text-dim': '#686878',
          'text-muted': '#404050',
          'text-secondary': '#E0E0E8',
          // Primary: Electric Violet
          violet: '#7B2FFF',
          'violet-bright': '#9B5FFF',
          'violet-deep': '#5A1FCC',
          // Legacy aliases
          purple: '#7B2FFF',
          cyan: '#00E5FF',
          // Gem colors (sub-brands)
          green: '#39FF14',
          amber: '#FF9500',
          rose: '#FF2D78',
          // Semantic
          success: '#34D399',
          warning: '#FBBF24',
          error: '#F87171',
          info: '#60A5FA',
        },
      },
      fontFamily: {
        display: ['Sora', 'sans-serif'],
        sans: ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        none: '0',
      },
      animation: {
        'gradient': 'gradient 8s ease infinite',
        'pulse-slow': 'pulse 4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 6s ease-in-out infinite',
      },
      keyframes: {
        gradient: {
          '0%, 100%': { backgroundPosition: '0% 50%' },
          '50%': { backgroundPosition: '100% 50%' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
      boxShadow: {
        'violet': '0 0 24px rgba(123,47,255,0.15)',
        'violet-glow': '0 0 48px rgba(123,47,255,0.08)',
        'violet-focus': '0 0 0 3px rgba(123,47,255,0.25)',
      },
    },
  },
  plugins: [],
}
export default config
