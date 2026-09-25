import JSZip from 'jszip';
import { yearlyRows } from './reports.js';
const escape = v => String(v ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/_x([0-9a-f]{4})_/gi, '_x005F_x$1_').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;'
})[c]);
const col = i => {
  let s = '';
  for (i++; i; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
  return s;
};
export async function exportWorkbook(s, backupText) {
  const zip = new JSZip(),
    sheets = [];
  function add(name, rows) {
    if (rows.length > 1048576) throw Error("The export exceeds the number of Excel rows. Use a full backup.");
    sheets.push({
      name,
      rows: rows.map(r => r.map(v => typeof v === 'string' && v.length > 32700 ? v.slice(0, 32600) + " … [abbreviated; full value is in Application Backup sheet]" : v))
    });
  }
  add("Invoices", [["Number", 'Type', 'Date', "Due date", "Customer", "State", "Currency", 'Discount', "Total", "Note", "Custom field"], ...s.documents.map(d => [d.number, d.type, d.date, d.due, d.customer?.name, d.status, d.currency, d.discount, d.summaryOnly ? d.importedTotal : Math.round(d.items.reduce((v, i) => v + Math.round(i.qty * i.price * 100) / 100, 0) * (1 - d.discount / 100) * 100) / 100, d.notes, JSON.stringify(d.custom || {})])]);
  add("Items", [["Document", "Item", "Amount", 'Unit', "Unit price", "Total", "Custom field"], ...s.documents.flatMap(d => d.items.map(i => [d.number, i.name, +i.qty, i.unit, +i.price, {
    formula: `ROUND(C${sheets.length}*E${sheets.length},2)`,
    value: Math.round(i.qty * i.price * 100) / 100
  }, JSON.stringify(i.custom || {})]))]);
  // Formula references depend on the final row in this worksheet.
  sheets[1].rows.slice(1).forEach((row, i) => row[5].formula = `ROUND(C${i + 2}*E${i + 2},2)`);
  for (const [key, name] of [['texts', 'Texty'], ['companies', "Companies"], ['activities', "Activities"], ['payments', "Payments"], ['worklogs', "Statements"], ['fields', "Custom field"], ['rules', 'Pravidla'], ['templates', "Templates"], ['media', "Media"], ['checks', 'Kontroly'], ['audit', 'Historie']]) {
    const columns = [...new Set((s[key] || []).flatMap(x => Object.keys(x)))];
    add(name, [columns, ...(s[key] || []).map(x => columns.map(k => typeof x[k] === 'object' ? JSON.stringify(x[k]) : x[k]))]);
  }
  add("Annual review", [["Year", "Currency", 'Invoiced', "Payments received", "Number of invoices"], ...yearlyRows(s).map(r => [r.year, r.currency, r.invoiced, r.received, r.count])]);
  add("Settings", [["Detail", 'Value'], ...Object.entries({
    supplier: s.supplier,
    settings: s.settings
  }).map(([k, v]) => [k, JSON.stringify(v)])]);
  add("Application backup", [["Part", "Complete backup including attachments and templates"], ...(backupText.match(/[\s\S]{1,30000}/gu) || []).map((x, i) => [i + 1, x])]);
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  sheets.forEach((s, i) => zip.file(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="50" width="24" customWidth="1"/></cols><sheetData>${s.rows.map((r, j) => `<row r="${j + 1}">${r.map((v, k) => {
    const ref = col(k) + (j + 1);
    return typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : v?.formula ? `<c r="${ref}"><f>${escape(v.formula)}</f><v>${v.value}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(v)}</t></is></c>`;
  }).join('')}</row>`).join('')}</sheetData></worksheet>`));
  zip.file('xl/workbook.xml', `<?xml version="1.0"?><workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${escape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr fullCalcOnLoad="1"/></workbook>`);
  const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="${REL}">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`);
  zip.file('_rels/.rels', `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('[Content_Types].xml', `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`);
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE'
  });
}
