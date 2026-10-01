import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import fs from 'node:fs/promises';
import path from 'node:path';

// Generated in memory for the installation owner. Never stored in the add-on image.
export async function recoveryPdf({
  key,
  keyId,
  webRoot,
  created = new Date()
}) {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(await fs.readFile(path.join(webRoot, 'LiberationSans-Regular.ttf')), {
    subset: true
  });
  const bold = await doc.embedFont(await fs.readFile(path.join(webRoot, 'LiberationSans-Bold.ttf')), {
    subset: true
  });
  doc.setTitle("Fakturocel - recovery key");
  doc.setAuthor("Fakturocel");
  const page = doc.addPage([595.28, 841.89]),
    green = rgb(.06, .42, .37),
    ink = rgb(.12, .19, .22),
    muted = rgb(.35, .41, .44);
  let y = 788;
  const line = (text, {
    size = 11,
    font = regular,
    color = ink,
    x = 44,
    gap = 17
  } = {}) => {
    page.drawText(text, {
      x,
      y,
      size,
      font,
      color
    });
    y -= gap;
  };
  const paragraph = (text, {
    size = 11,
    color = ink,
    gap = 17
  } = {}) => {
    let row = '';
    for (const word of text.split(' ')) {
      const candidate = row ? row + ' ' + word : word;
      if (regular.widthOfTextAtSize(candidate, size) > 506) {
        line(row, {
          size,
          color,
          gap
        });
        row = word;
      } else row = candidate;
    }
    if (row) line(row, {
      size,
      color,
      gap
    });
    y -= 8;
  };
  line("FAKTUROCEL", {
    size: 12,
    font: bold,
    color: green,
    gap: 35
  });
  line("Recovery key", {
    size: 26,
    font: bold,
    gap: 29
  });
  paragraph("Save this sheet separately from backups. Whoever has the key and the backup can read its contents.", {
    color: muted
  });
  line(`Key ID: ${keyId}`, {
    size: 10,
    color: muted,
    gap: 16
  });
  line(`Created by: ${created.toISOString().slice(0, 10)} (UTC)`, {
    size: 10,
    color: muted,
    gap: 33
  });
  page.drawRectangle({
    x: 38,
    y: y - 31,
    width: 519,
    height: 58,
    color: rgb(.92, .96, .95)
  });
  line(key, {
    size: 9,
    font: regular,
    color: green,
    gap: 50
  });
  paragraph("Copy the entire line including FC3- and dashes. To open Excel, keep capital letters as well. This key applies to files created under the specified ID.", {
    size: 10
  });
  y -= 13;
  line("Restoring the .fakturocel backup", {
    size: 16,
    font: bold,
    gap: 26
  });
  paragraph("1. Install Fakturocel 3.3 or later and open it via Home Assistant. Turn on encryption when installing for the first time. A new installation will create a custom key.");
  paragraph("2. In Settings, select Restore backup and select the saved file .fakturocel. If the file uses a different key, the application prompts for it. Insert the key from this PDF.");
  paragraph("3. Check the number of documents, companies and templates and confirm the renewal. Current data is automatically backed up before being replaced.");
  paragraph("4. The recovered data is saved under the target installation key. In Settings, download its current PDF with the key and create a new backup.");
  y -= 8;
  line("Excel, PIN and older files", {
    size: 16,
    font: bold,
    gap: 26
  });
  paragraph("Encrypted Excel exported by version 3.3+ can be opened by entering the entire key as a password. You can restore templates by importing templates with the same key.", {
    size: 10,
    gap: 15
  });
  paragraph("PIN protects entry to the application and is independent of this key. The owner can turn off the forgotten PIN via \"Forgotten PIN\" using the current key. PIN is not transferred in the .fakturocel backup.", {
    size: 10,
    gap: 15
  });
  paragraph("Older .fakturocel backups with the same encryption key can be restored with this PDF. Excel from version 3.2 requires the original password. After changing the key, keep the previous keys for older files.", {
    size: 10,
    gap: 15
  });
  page.drawLine({
    start: {
      x: 44,
      y: 76
    },
    end: {
      x: 551,
      y: 76
    },
    thickness: 1,
    color: rgb(.8, .86, .85)
  });
  y = 59;
  line("WARNING • This PDF file contains a secret key. The PDF itself is not encrypted.", {
    size: 9,
    font: bold,
    color: muted
  });
  return doc.save();
}
