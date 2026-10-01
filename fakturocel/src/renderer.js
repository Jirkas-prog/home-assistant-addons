import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, rectangle, clip, endPath } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode/lib/core/qrcode.js';
import { fieldValue, rawField, condition, total, round, money, fieldLabels } from './model.js';
const PT = 72 / 25.4,
  mm = pt => pt / PT;
export function validateTemplate(t, s) {
  if (!t?.name?.trim() || !Array.isArray(t.nodes) || !t.nodes.length || t.nodes.length > 500) throw Error("A template must have a name and 1 to 500 elements.");
  if (!t.page || !['width', 'height', 'bottom', 'top'].every(k => Number.isFinite(+t.page[k])) || +t.page.top + +t.page.bottom > t.page.height - 20 || t.page.width < 100 || t.page.width > 420 || t.page.height < 100 || t.page.height > 600 || t.page.bottom < 5 || t.page.top < 5) throw Error("Invalid page or margin dimensions.");
  const ids = new Set(t.nodes.map(n => n.id));
  if (ids.size !== t.nodes.length) throw Error("Duplicate template element.");
  for (const n of t.nodes) {
    if (!['text', 'table', 'image', 'rect', 'line', 'qr'].includes(n.kind)) throw Error("Unknown element.");
    for (const k of ['x', 'y', 'w', 'h']) if (!Number.isFinite(+n[k])) throw Error(n.name + ": invalid dimensions.");
    if (n.size !== undefined && (!Number.isFinite(+n.size) || n.size < 5 || n.size > 96)) throw Error(n.name + ": font size must be between 5 and 96 points.");
    if (n.y < 0 || n.y > t.page.height || n.w <= 0 || n.h < 0 || n.h > t.page.height || n.x < 0 || n.x + n.w > t.page.width + .01) throw Error(n.name + ": the element exceeds the width of the page.");
    if (n.anchor === 'after' && (!ids.has(n.after) || n.after === n.id)) throw Error(n.name + ": invalid binding.");
    if (n.kind === 'table' && (!n.columns?.length || n.columns.length > 30 || n.columns.some(c => !c.label || !Number.isFinite(+c.width) || +c.width <= 0 || n.w * +c.width / n.columns.reduce((v, x) => v + +x.width, 0) < 5))) throw Error("The table has invalid columns.");
    for (const r of n.runs || []) {
      if (r.size !== undefined && (!Number.isFinite(+r.size) || r.size < 5 || r.size > 96)) throw Error(n.name + ": invalid font size.");
      if (r.field && !r.field.startsWith('custom.') && !fieldLabels[r.field]) throw Error(n.name + ": unknown data " + r.field);
    }
    for (const r of n.runs || []) if (r.field?.startsWith('custom.') && !s.fields.some(f => f.id === r.field.slice(7))) throw Error(n.name + ": custom field no longer exists.");
    if (n.mediaId && !s.media.some(m => m.id === n.mediaId)) throw Error(n.name + ": media is missing.");
  }
  const visited = new Set(),
    pending = new Set();
  function visit(n) {
    if (pending.has(n.id)) throw Error("The elements follow each other in a circle.");
    if (visited.has(n.id)) return;
    pending.add(n.id);
    if (n.anchor === 'after') visit(t.nodes.find(x => x.id === n.after));
    pending.delete(n.id);
    visited.add(n.id);
  }
  t.nodes.forEach(visit);
  return t;
}
export async function renderDocument(d, s, t, load, options = {}) {
  t = structuredClone(t);
  for (const n of t.nodes) if (n.styleId && t.styles?.[n.styleId]) Object.assign(n, {
    ...t.styles[n.styleId],
    ...n
  });
  validateTemplate(t, s);
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const regular = await pdf.embedFont(await load('LiberationSans-Regular.ttf'), {
      subset: true
    }),
    bold = await pdf.embedFont(await load('LiberationSans-Bold.ttf'), {
      subset: true
    });
  const fonts = {
    regular,
    bold,
    italic: await pdf.embedFont(await load('LiberationSans-Italic.ttf'), {
      subset: true
    }),
    boldItalic: await pdf.embedFont(await load('LiberationSans-BoldItalic.ttf'), {
      subset: true
    })
  };
  for (const m of s.media.filter(m => m.mime?.includes('font') && t.nodes.some(n => n.font === m.id || (n.runs || []).some(r => r.font === m.id)))) fonts[m.id] = await pdf.embedFont(await load(m.hash), {
    subset: true
  });
  const pages = [[]],
    bounds = {},
    bottom = t.page.height - t.page.bottom,
    top = t.page.top,
    errors = [],
    images = {};
  const addPage = () => {
    if (pages.length >= 100) throw Error("The document exceeded 100 pages. Shorten the content or change the template.");
    pages.push([]);
    return pages.length - 1;
  };
  const fontFor = (run, node) => {
    const selected = run.font || node.font;
    if (selected && !['regular', 'bold', 'italic', 'boldItalic'].includes(selected)) return fonts[selected] || regular;
    const b = run.bold ?? (selected === 'bold' || selected === 'boldItalic'),
      i = run.italic ?? (selected === 'italic' || selected === 'boldItalic');
    return fonts[b && i ? 'boldItalic' : b ? 'bold' : i ? 'italic' : 'regular'];
  };
  const runsFor = (n, p = 1, count = 1) => (n.runs || []).map(r => ({
    ...r,
    text: r.field ? fieldValue(r, d, s, p, count) : r.text || ''
  }));
  function lines(runs, node, width) {
    const out = [[]];
    let used = 0;
    const sizeFor = r => +r.size || +node.size || 10;
    for (const r of runs) {
      const font = fontFor(r, node),
        size = sizeFor(r);
      for (const part of String(r.text).split(/(\n|\s+)/)) {
        if (part === '\n') {
          out.push([]);
          used = 0;
          continue;
        }
        if (!part) continue;
        let widthPart = mm(font.widthOfTextAtSize(part, size));
        if (used + widthPart > width && used > 0 && !/^\s+$/.test(part)) {
          out.push([]);
          used = 0;
        }
        if (widthPart > width) {
          for (const ch of part) {
            const cw = mm(font.widthOfTextAtSize(ch, size));
            if (used + cw > width && used > 0) {
              out.push([]);
              used = 0;
            }
            out.at(-1).push({
              ...r,
              text: ch,
              fontName: Object.keys(fonts).find(k => fonts[k] === font),
              size,
              width: cw
            });
            used += cw;
          }
        } else {
          if (!used && /^\s+$/.test(part)) continue;
          out.at(-1).push({
            ...r,
            text: part,
            fontName: Object.keys(fonts).find(k => fonts[k] === font),
            size,
            width: widthPart
          });
          used += widthPart;
        }
      }
    }
    return out;
  }
  const heightFor = (line, n) => mm(Math.max(+n.size || 10, ...line.map(r => r.size))) * (+n.lineHeight || 1.35);
  function drawLineRuns(line, n, p, x, y, width) {
    const full = line.reduce((a, r) => a + r.width, 0);
    let xx = x + (n.align === 'right' ? width - full : n.align === 'center' ? (width - full) / 2 : 0);
    for (const r of line) {
      pages[p].push({
        kind: 'text',
        x: xx,
        y: y + mm(r.size),
        text: r.text,
        width: r.width,
        size: r.size,
        font: r.fontName,
        color: r.color || n.color || '#172f35',
        underline: r.underline,
        italic: r.italic,
        nodeId: n.id
      });
      xx += r.width;
    }
  }
  function visibility(n) {
    return !n.condition || condition(n.condition, d, s);
  }
  function imageOp(n, im, y) {
    let w = n.w,
      h = n.h,
      x = n.x,
      yy = y;
    if (n.fit !== 'stretch') {
      const scale = (n.fit === 'cover' ? Math.max : Math.min)(w / im.pdf.width, h / im.pdf.height);
      w = im.pdf.width * scale;
      h = im.pdf.height * scale;
      if (n.fit === 'cover') {
        x += (n.w - w) / 2;
        yy += (n.h - h) / 2;
      }
    }
    return {
      kind: 'image',
      hash: im.hash,
      x,
      y: yy,
      w,
      h,
      clip: n.fit === 'cover' ? {
        x: n.x,
        y,
        w: n.w,
        h: n.h
      } : null,
      opacity: n.opacity ?? 1,
      nodeId: n.id
    };
  }
  async function imageFor(n) {
    const m = s.media.find(x => x.id === n.mediaId);
    if (!m) throw Error(n.name + ": select an image.");
    if (!images[m.hash]) {
      const bytes = await load(m.hash);
      images[m.hash] = {
        bytes,
        pdf: m.mime === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes)
      };
    }
    return {
      hash: m.hash,
      ...images[m.hash]
    };
  }
  const done = new Set();
  async function place(n) {
    if (done.has(n.id)) return;
    done.add(n.id);
    if (n.anchor === 'after') await place(t.nodes.find(x => x.id === n.after));
    if (!visibility(n)) {
      bounds[n.id] = n.anchor === 'after' ? bounds[n.after] : {
        page: 0,
        y: n.y,
        h: 0,
        x: n.x,
        w: n.w
      };
      return;
    }
    const previous = n.anchor === 'after' ? bounds[n.after] : null;
    let p = previous?.page || 0,
      y = previous ? previous.y + previous.h + n.y : n.y;
    const startP = p,
      startY = y;
    if (n.kind === 'text') {
      for (const r of n.runs || []) if (r.field && r.required && [null, undefined, ''].includes(rawField(r.field, d, s))) throw Error(n.name + ": mandatory information is missing " + r.field);
      const pad = Math.max(0, +n.padding || 0);
      if (pad * 2 >= n.w) throw Error(n.name + ": too large inner margins.");
      y += pad;
      const list = lines(runsFor(n), n, n.w - pad * 2),
        height = list.reduce((a, l) => a + heightFor(l, n), 0);
      if (n.overflow === 'error' && height + pad * 2 > n.h + .1) throw Error(n.name + ": the text does not fit. Enlarge field or enable continuation.");
      if (n.keepTogether && height + pad * 2 <= bottom - top && y + height + pad > bottom) {
        p = addPage();
        y = top + pad;
      }
      for (const l of list) {
        const lh = heightFor(l, n);
        if (y + lh > bottom) {
          if (n.repeat === 'all' || n.repeat === 'last') throw Error(n.name + ": footer does not fit.");
          p = addPage();
          y = top;
        }
        drawLineRuns(l, n, p, n.x + pad, y, n.w - pad * 2);
        y += lh;
      }
      y += pad;
    } else if (n.kind === 'table') {
      const widths = n.columns.map(c => n.w * +c.width / n.columns.reduce((a, c) => a + +c.width, 0)),
        pad = 2,
        lh = mm(n.size || 9) * 1.5;
      const heading = () => {
        const heads = n.columns.map((c, i) => lines([{
          text: c.label,
          bold: true
        }], {
          ...n,
          font: 'bold'
        }, widths[i] - 2 * pad));
        const h = Math.max(...heads.map(l => l.length)) * lh + 4;
        if (y + h > bottom) {
          p = addPage();
          y = top;
        }
        pages[p].push({
          kind: 'rect',
          x: n.x,
          y,
          w: n.w,
          h,
          color: n.headerColor || '#e8f3ef',
          nodeId: n.id
        });
        let x = n.x;
        heads.forEach((ls, i) => {
          ls.forEach((l, j) => drawLineRuns(l, {
            ...n,
            font: 'bold'
          }, p, x + pad, y + 2 + j * lh, widths[i] - 2 * pad));
          x += widths[i];
        });
        y += h;
      };
      heading();
      for (const item of d.items) {
        const cells = n.columns.map((c, i) => {
          let v = c.key === 'total' ? money(round(item.qty * item.price), d.currency) : c.key === 'price' ? money(item.price, d.currency) : c.key.startsWith('custom.') ? item.custom?.[c.key.slice(7)] : item[c.key];
          return lines([{
            text: String(v ?? '')
          }], n, widths[i] - pad * 2);
        });
        const count = Math.max(...cells.map(l => l.length));
        let row = 0;
        while (row < count) {
          if (y + lh + 4 > bottom) {
            p = addPage();
            y = top;
            heading();
          }
          let capacity = Math.floor((bottom - y - 4) / lh);
          if (capacity < 1) throw Error("The table header leaves no room for rows.");
          const take = Math.min(capacity, count - row);
          let x = n.x;
          cells.forEach((ls, i) => {
            for (let j = 0; j < take; j++) if (ls[row + j]) drawLineRuns(ls[row + j], {
              ...n,
              align: ['qty', 'price', 'total'].includes(n.columns[i].key) ? 'right' : 'left'
            }, p, x + pad, y + 2 + j * lh, widths[i] - 2 * pad);
            x += widths[i];
          });
          y += take * lh + 4;
          pages[p].push({
            kind: 'line',
            x: n.x,
            y,
            w: n.w,
            h: .15,
            color: '#dae5e3',
            nodeId: n.id
          });
          row += take;
        }
      }
    } else {
      if (y + n.h > bottom) {
        p = addPage();
        y = top;
      }
      if (n.kind === 'image') {
        const im = await imageFor(n);
        pages[p].push(imageOp(n, im, y));
      } else if (n.kind === 'qr') {
        let value = n.value || '';
        if (n.qrType === 'payment') {
          const iban = String(d.supplier.iban || '').replace(/\s/g, '');
          if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) throw Error("QR payment: add valid IBAN.");
          let rem = 0;
          for (const c of (iban.slice(4) + iban.slice(0, 4)).split('')) for (const digit of /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c) rem = (rem * 10 + +digit) % 97;
          if (rem !== 1) throw Error("QR payment: checksum IBAN does not match.");
          value = `SPD*1.0*ACC:${iban}*AM:${total(d).toFixed(2)}*CC:${d.currency}*X-VS:${d.vs || d.number.replace(/\D/g, '')}`;
        }
        const qr = QRCode.create(value || "Fakturocel", {
            errorCorrectionLevel: 'M'
          }),
          size = qr.modules.size,
          cell = Math.min(n.w, n.h) / (size + 8);
        pages[p].push({
          kind: 'rect',
          x: n.x,
          y,
          w: n.w,
          h: n.h,
          color: '#ffffff',
          nodeId: n.id
        });
        for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (qr.modules.get(r, c)) pages[p].push({
          kind: 'rect',
          x: n.x + (c + 4) * cell,
          y: y + (r + 4) * cell,
          w: cell,
          h: cell,
          color: '#000000',
          nodeId: n.id
        });
      } else pages[p].push({
        ...n,
        y,
        nodeId: n.id
      });
      y += n.h;
    }
    bounds[n.id] = {
      page: p,
      y: p === startP ? startY : top,
      h: y - (p === startP ? startY : top),
      x: n.x,
      w: n.w
    };
  }
  for (const n of t.nodes.filter(n => !['all', 'last', 'continuation'].includes(n.repeat))) await place(n);
  const count = pages.length;
  for (const n of t.nodes.filter(n => ['all', 'last', 'continuation'].includes(n.repeat) && visibility(n))) for (let p = 0; p < count; p++) {
    if (n.repeat === 'last' && p !== count - 1 || n.repeat === 'continuation' && p === 0) continue;
    if (n.kind === 'text') {
      const ls = lines(runsFor(n, p + 1, count), n, n.w),
        h = ls.reduce((v, l) => v + heightFor(l, n), 0);
      if (h > n.h + .2 || n.y + h > t.page.height - 3) throw Error(n.name + ": repeated text does not fit in the reserved field.");
      let y = n.y;
      for (const l of ls) {
        drawLineRuns(l, n, p, n.x, y, n.w);
        y += heightFor(l, n);
      }
    } else if (n.kind === 'image') {
      const im = await imageFor(n);
      pages[p].push(imageOp(n, im, n.y));
    } else if (['rect', 'line'].includes(n.kind)) pages[p].push({
      ...n,
      nodeId: n.id
    });else throw Error("Place the table and QR code in the first-page content.");
  }
  // Compare actual content extents, ignoring decorative rectangles and rules.
  for (let p = 0; p < pages.length; p++) {
    const boxes = new Map();
    for (const o of pages[p]) {
      const n = t.nodes.find(n => n.id === o.nodeId);
      if (!n || n.allowOverlap || ['rect', 'line'].includes(n.kind) || o.kind === 'text' && !o.text.trim()) continue;
      const actual = o.clip || o,
        x = actual.x,
        y = o.kind === 'text' ? o.y - mm(o.size) * .85 : actual.y,
        w = o.kind === 'text' ? o.width : actual.w,
        h = o.kind === 'text' ? mm(o.size) : actual.h;
      if (!w || !h) continue;
      const b = boxes.get(n.id);
      boxes.set(n.id, b ? {
        x: Math.min(b.x, x),
        y: Math.min(b.y, y),
        right: Math.max(b.right, x + w),
        bottom: Math.max(b.bottom, y + h),
        name: n.name
      } : {
        x,
        y,
        right: x + w,
        bottom: y + h,
        name: n.name
      });
    }
    const entries = [...boxes.values()];
    for (let a = 0; a < entries.length; a++) for (let b = a + 1; b < entries.length; b++) {
      const x = entries[a],
        y = entries[b];
      if (Math.min(x.right, y.right) - Math.max(x.x, y.x) > .5 && Math.min(x.bottom, y.bottom) - Math.max(x.y, y.y) > .5) errors.push(`Page ${p + 1}: elements "${x.name}" and "${y.name}" overlap. Move them, link their positions, or enable intentional overlap.`);
    }
  }
  if (errors.length && !options.preview) throw Error(errors.join('\n'));
  const color = hex => {
    const c = /^#[a-f\d]{6}$/i.test(hex || '') ? hex : '#172f35';
    return rgb(parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255);
  };
  for (const ops of pages) {
    const page = pdf.addPage([t.page.width * PT, t.page.height * PT]);
    for (const o of ops) {
      if (o.kind === 'text') {
        page.drawText(o.text, {
          x: o.x * PT,
          y: (t.page.height - o.y) * PT,
          font: fonts[o.font],
          size: o.size,
          color: color(o.color)
        });
        if (o.underline) page.drawLine({
          start: {
            x: o.x * PT,
            y: (t.page.height - o.y - .6) * PT
          },
          end: {
            x: (o.x + mm(fonts[o.font].widthOfTextAtSize(o.text, o.size))) * PT,
            y: (t.page.height - o.y - .6) * PT
          },
          thickness: .5,
          color: color(o.color)
        });
      } else if (o.kind === 'image') {
        if (o.clip) page.pushOperators(pushGraphicsState(), rectangle(o.clip.x * PT, (t.page.height - o.clip.y - o.clip.h) * PT, o.clip.w * PT, o.clip.h * PT), clip(), endPath());
        page.drawImage(images[o.hash].pdf, {
          x: o.x * PT,
          y: (t.page.height - o.y - o.h) * PT,
          width: o.w * PT,
          height: o.h * PT,
          opacity: o.opacity ?? 1
        });
        if (o.clip) page.pushOperators(popGraphicsState());
      } else if (o.kind === 'line') page.drawLine({
        start: {
          x: o.x * PT,
          y: (t.page.height - o.y) * PT
        },
        end: {
          x: (o.x + o.w) * PT,
          y: (t.page.height - o.y) * PT
        },
        thickness: Math.max(.2, o.h * PT),
        color: color(o.color)
      });else if (o.kind === 'rect') page.drawRectangle({
        x: o.x * PT,
        y: (t.page.height - o.y - o.h) * PT,
        width: o.w * PT,
        height: o.h * PT,
        color: color(o.color),
        opacity: o.opacity ?? 1
      });
    }
  }
  pdf.setTitle((d.type === 'quote' ? "Offer " : "Invoice ") + d.number);
  pdf.setCreator("Fakturocel 3");
  return {
    bytes: await pdf.save(),
    pages,
    bounds,
    errors
  };
}
