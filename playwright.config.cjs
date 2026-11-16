const {defineConfig} = require('@playwright/test');
module.exports = defineConfig({testDir:'./tests',testMatch:'reparto.spec.cjs',workers:1,
  use:{headless:true,viewport:{width:1440,height:1000}},
  webServer:{command:'node tests/serve.cjs',port:4173,reuseExistingServer:false}});
