const {defineConfig}=require('@playwright/test');
module.exports=defineConfig({
  testDir:'tests/browser',workers:1,
  use:{baseURL:'http://127.0.0.1:18741',browserName:'chromium',locale:'en-GB'},
  webServer:{command:'node tests/browser/server.cjs',url:'http://127.0.0.1:18741/preview/',reuseExistingServer:false},
});
