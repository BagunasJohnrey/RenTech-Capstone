import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Short desktop screens (laptops at 768px tall and below): auth forms
      // tighten their spacing so they fit the viewport without scrolling.
      screens: {
        short: { raw: '(min-width: 1024px) and (max-height: 820px)' },
      },
    },
  },
  plugins: [
    tailwindcssAnimate,
  ],
}