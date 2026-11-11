import {defineConfig,devices} from '@playwright/test';

export default defineConfig({
  testDir:'./tests/e2e',
  fullyParallel:false,
  workers:1,
  reporter:'list',
  use:{
    baseURL:'http://127.0.0.1:4173',
    trace:'retain-on-failure',
    launchOptions:{channel:process.platform==='win32'?'msedge':undefined},
  },
  projects:[
    {name:'desktop',use:{...devices['Desktop Chrome']}},
    {name:'celular',use:{...devices['Pixel 7']}},
  ],
  webServer:{
    command:'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
    url:'http://127.0.0.1:4173',
    reuseExistingServer:false,
    env:{VITE_SUPABASE_URL:'',VITE_SUPABASE_ANON_KEY:''},
  },
});
