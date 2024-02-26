import { defineConfig } from 'vitest/config'

export default defineConfig({
  test:{
    reporters: "verbose",
    threads: false,
    include: ["./test/**/*.test.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
  },
})