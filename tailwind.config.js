/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1A1D21",
        panel: "#FFFFFF",
        fondo: "#F2F3F1",
        linea: "#DDDFDA",
        volt: { DEFAULT: "#F5B301", dark: "#D99C00", pale: "#FFF6DC" },
        cobre: "#B4551F",
        electrico: { DEFAULT: "#1D5FD1", pale: "#E8EFFC" },
        ok: "#1F8A4C",
        alerta: "#C9352B",
      },
      fontFamily: {
        display: ["'Barlow Condensed'", "sans-serif"],
        body: ["Barlow", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(26,29,33,.06), 0 4px 14px rgba(26,29,33,.05)",
      },
    },
  },
  plugins: [],
};
