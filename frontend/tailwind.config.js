/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff8ff',
          100: '#dff1fe',
          200: '#b8e3fe',
          300: '#84cafa',
          400: '#38aef4',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
      },
      boxShadow: {
        'soft': '0 1px 2px rgba(15, 23, 42, 0.04), 0 12px 40px rgba(15, 23, 42, 0.06)',
        'soft-dark': '0 1px 2px rgba(0, 0, 0, 0.16), 0 16px 48px rgba(0, 0, 0, 0.22)',
      },
    },
  },
  plugins: [],
}
