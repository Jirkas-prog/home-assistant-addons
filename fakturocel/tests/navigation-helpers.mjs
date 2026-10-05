// Tests follow the same visible navigation paths as a user; no action dispatch or DOM injection.
export function navigationClick(page) {
  const locate = action => page.locator(`[data-action="${action}"]:visible`).first();
  const sectionRoutes = {
    invoice: 'documents', quote: 'documents', checks: 'documents', worklogs: 'documents',
    activities: 'catalog', texts: 'catalog', templates: 'design', fields: 'design', rules: 'design', media: 'design'
  };
  const settingActions = {
    editSettings: 'general', appearance: 'appearance', calculatorSettings: 'calculators',
    securitySettings: 'security', recoveryPdf: 'security', pinSettings: 'security', securityLock: 'security', roles: 'security',
    devices: 'devices', clientPair: 'devices', clientPull: 'devices', clientPush: 'devices', clientUndoSync: 'devices', clientDisconnect: 'devices',
    backup: 'backups', backupFolder: 'backups', downloadBackup: 'backups', retentionSettings: 'backups',
    restore: 'restore', restoreCloud: 'restore', wipe: 'restore', clientClear: 'restore', googleDrive: 'cloud', backupEncryption: 'cloud'
  };
  const main = async action => {
    await page.waitForFunction(() => {
      const width = innerWidth / (Number(document.body.style.zoom) || 1);
      return document.documentElement.dataset.layout === (width <= 700 ? 'mobile' : width <= 1100 ? 'medium' : 'wide');
    });
    if (!(await locate(action).isVisible()) && await page.locator('#navigationToggle').isVisible()) await locate('toggleNavigation').click();
    await locate(action).click();
  };
  return async action => {
    if (action.startsWith('nav:')) {
      const route = action.slice(4), section = sectionRoutes[route];
      if (section && !(await locate(action).isVisible())) await main('section:' + section);
      if (!section) return main(action);
    } else if (!(await locate(action).isVisible()) && settingActions[action.split(':')[0]]) {
      const tab = settingActions[action.split(':')[0]];
      if (!(await locate('settingsTab:general').isVisible())) await main('nav:settings');
      await locate('settingsTab:' + (['cloud', 'restore'].includes(tab) ? 'backups' : tab)).click();
      if (['cloud', 'restore'].includes(tab)) await locate('backupTab:' + tab).click();
      if (action === 'backupEncryption') await locate('googleDrive').click();
    }
    await locate(action).click();
  };
}
