import assert from 'node:assert/strict';

// The countdown is independent of the DOM; layout is checked in the browser.
globalThis.HTMLElement = class {};
globalThis.customElements = {get(){}, define(){}};
globalThis.window = {};
globalThis.fetch = async () => ({json: async () => ({})});
const {emailCountdown} = await import('../download_www/workflow-fastshare.js');
const data = {email_enabled:true, email_poll:{next_check_at:1060}};
assert.equal(emailCountdown(data, true, 1000).text, '01:00');
assert.equal(emailCountdown(data, true, 1001).text, '00:59');
assert.equal(emailCountdown(data, true, 1059.2).text, '00:01');
assert.equal(emailCountdown(data, true, 1061).label, 'Waiting for the next email check');
data.email_poll = {checking:true};
assert.equal(emailCountdown(data, true, 1061).label, 'Checking email…');
data.email_poll = {next_check_at:1121};
assert.equal(emailCountdown(data, true, 1061).text, '01:00');
assert.equal(emailCountdown(data, false).text, '—');
assert.equal(emailCountdown({...data, email_enabled:false}, true).text, 'Off');
assert.equal(emailCountdown({email_enabled:true}, true).text, '…');
console.log('Email countdown: timing, reset, checking, disabled and offline passed.');
