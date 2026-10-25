/**
 * Monthly inspection-exercise reminders.
 * Run installTriggers() once from the editor. On the 1st of each month every
 * tenant's owners and managers get a list of entities with no exercise for the
 * month just ended; on the 20th, a list of exercises still not signed off.
 */

// Run once from the editor after the first deploy: grants the script its
// permissions, creates the Registry spreadsheet, makes the deploying account a
// platform admin and installs the reminder trigger.
function setup() {
  var reg = registry_();
  var me = Session.getEffectiveUser().getEmail();
  var p = PropertiesService.getScriptProperties();
  var admins = String(p.getProperty('SUPER_ADMINS') || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(String);
  if (me && admins.indexOf(me.toLowerCase()) < 0) admins.push(me.toLowerCase());
  p.setProperty('SUPER_ADMINS', admins.join(','));
  installTriggers();
  Logger.log('Registry: ' + reg.getUrl() + '\nPlatform admins: ' + admins.join(', ') + '\nReminder trigger installed.');
}

// Run from the Apps Script editor (only the script's owner can open it): opens a
// company and writes its key to the log. On the website choose "Join your company
// with its key" and enter it; the first person to join becomes that company's owner.
// Name it with the OWNER_COMPANY_NAME script property (default "Platform owner").
function createOwnerCompany() {
  var me = ''; try { me = Session.getEffectiveUser().getEmail(); } catch (e) {}
  var t = platformCreate_({ user: { id: 'editor', email: me || 'editor' } }, { name: prop_('OWNER_COMPANY_NAME') || 'Platform owner', contact: me });
  Logger.log('Company: ' + t.name);
  Logger.log('Key: ' + t.joinKey);
  Logger.log('On the website choose "Join your company with its key" and enter the key.');
  return t.joinKey;
}

function installTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'monthlyReminder') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('monthlyReminder').timeBased().everyDays(1).atHour(7).create();
}

function monthlyReminder() {
  var day = new Date().getDate();
  if (day !== 1 && day !== 20) return;
  var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  var period = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
  regRows_(REGISTRY_SHEETS.TENANTS).forEach(function (t) {
    if (t.status === 'suspended') return;
    try {
      var ss = SpreadsheetApp.openById(t.spreadsheetId);
      var ents = readTable_(ss, 'entities').filter(function (e) { return e.active !== false; });
      var ex = readTable_(ss, 'exercises');
      var lines = [];
      ents.forEach(function (e) {
        var mine = ex.filter(function (x) { return x.entityId === e.id && (x.period === period || x.period === quarterOf_(period)); })[0];
        if (!mine && day === 1) lines.push('• ' + e.name + ': no inspection exercise for ' + period + ' yet.');
        else if (mine && mine.status !== 'closed' && day === 20) lines.push('• ' + e.name + ': ' + period + ' exercise is "' + mine.status + '", readiness ' + ((mine.summary || {}).score || 0) + '%.');
      });
      if (!lines.length) return;
      var to = usersOfTenant_(t.id).filter(function (u) { return u.active !== false && (u.role === 'owner' || u.role === 'manager'); }).map(function (u) { return u.email; });
      if (!to.length) return;
      MailApp.sendEmail({
        to: to.join(','),
        subject: 'Inspection readiness — ' + period + ' (' + t.name + ')',
        body: 'Monthly VAT & WHT inspection exercise status for ' + t.name + ':\n\n' + lines.join('\n') +
          '\n\nVAT returns are due by the last day of the following month; WHT by the 10th.\n'
      });
    } catch (err) { regAudit_('reminder_failed', t.id, '', String(err && err.message || err)); }
  });
}

function quarterOf_(p) { return p.slice(0, 4) + '-Q' + Math.ceil(+p.slice(5, 7) / 3); }
