/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          950: '#08090b',
          900: '#0c0e12',
          850: '#11141a',
          800: '#161a22',
          700: '#1d2230',
          600: '#252b3b',
          500: '#3a4255',
          400: '#5a6377',
          300: '#8a93a8',
          200: '#b8bfd0',
          100: '#e2e6ee',
        },
        accent: {
          green: '#3ddc84',
          blue: '#5aa9ff',
          violet: '#a584ff',
          amber: '#ffb547',
          red: '#ff5d6c',
        },
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.03) inset, 0 0 0 1px rgba(255,255,255,0.04)',
      },
    },
  },
  plugins: [],
};
