/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,ts}'],
  theme: {
    extend: {
      colors: {
        ink: {
          50: '#f7f4ee',
          100: '#ebe5da',
          200: '#d5cbbb',
          300: '#b6a894',
          400: '#8d7d68',
          500: '#6b5b49',
          600: '#4d4136',
          700: '#332b24',
          800: '#211c18',
          900: '#14110e',
        },
        paper: {
          50: '#fdfaf3',
          100: '#f8f1e3',
          200: '#f1e5ce',
          300: '#e7d5b5',
        },
        vermilion: {
          400: '#d05a4b',
          500: '#bd4436',
          600: '#a33328',
          700: '#83271f',
        },
        jade: {
          400: '#5d8d7b',
          500: '#3f6b5c',
          600: '#2f554a',
        },
        gold: {
          300: '#e3c98f',
          400: '#d4b26c',
          500: '#c19a4f',
          600: '#a17c37',
        },
      },
      fontFamily: {
        display: ['"STKaiti"', '"KaiTi"', '"Kaiti SC"', '"Songti SC"', '"SimSun"', 'serif'],
        serif: ['"Noto Serif SC"', '"Songti SC"', '"SimSun"', 'Georgia', 'serif'],
        sans: ['"Microsoft YaHei"', '"PingFang SC"', '"Noto Sans SC"', 'system-ui', 'sans-serif'],
        mono: ['"Cascadia Mono"', '"SFMono-Regular"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 2px rgba(33,28,24,.05), 0 18px 50px -22px rgba(33,28,24,.35)',
        float: '0 24px 60px -24px rgba(33,28,24,.45)',
        insetline: 'inset 0 0 0 1px rgba(193,154,79,.25)',
      },
      animation: {
        'fade-up': 'fadeUp .5s cubic-bezier(.22,1,.36,1) both',
        'fade-in': 'fadeIn .4s ease both',
        'seal-in': 'sealIn .6s cubic-bezier(.22,1,.36,1) both',
        'pulse-soft': 'pulseSoft 2.4s ease-in-out infinite',
        'slide-in': 'slideIn .35s cubic-bezier(.22,1,.36,1) both',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        sealIn: {
          '0%': { opacity: '0', transform: 'scale(1.25) rotate(-8deg)' },
          '100%': { opacity: '1', transform: 'scale(1) rotate(0deg)' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '.55' },
          '50%': { opacity: '1' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
}
