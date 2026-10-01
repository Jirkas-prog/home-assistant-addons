import { norm } from './model.js';
import { button, select, field, esc } from './ui.js';
import { locale } from './i18n.js';
const views = new Map();
// Shared list controls deliberately keep the underlying record/action DOM intact.
export function enhanceLists(route) {
  if (!['checks', 'companies', 'activities', 'worklogs', 'texts', 'fields', 'templates', 'rules', 'media'].includes(route)) return;
  const card = document.querySelector('#content .card');
  if (!card) return;
  if (route === 'media') {
    const grid = card.querySelector('.media-grid');
    const articles = [...grid.children].filter(x => x.tagName === 'ARTICLE');
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    wrap.innerHTML = "<table><thead><tr><th>Preview</th><th>Name</th><th>Type / use</th><th></th></tr></thead><tbody></tbody></table>";
    for (const a of articles) {
      const row = document.createElement('tr');
      for (const e of [a.querySelector('img,.font-preview'), a.querySelector('strong'), a.querySelector('small'), a.querySelector('button')]) {
        const td = document.createElement('td');
        if (e) td.append(e);
        row.append(td);
      }
      wrap.querySelector('tbody').append(row);
    }
    grid.replaceWith(wrap);
    wrap.classList.add('media-list');
  }
  const table = card.querySelector('table');
  if (!table) return;
  const rows = [...table.tBodies[0].rows].filter(r => !r.querySelector('.empty')),
    heads = [...table.tHead.rows[0].cells],
    view = views.get(route) || {
      search: '',
      column: '',
      value: '',
      sort: -1,
      dir: 1
    };
  views.set(route, view);
  let toolbar = card.querySelector('.toolbar');
  if (!toolbar) {
    toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    card.prepend(toolbar);
  }
  let search = card.querySelector('#search');
  if (!search) {
    search = document.createElement('input');
    search.id = 'search';
    search.placeholder = "Search in overview…";
  }
  toolbar.prepend(search);
  search.value = view.search;
  search.setAttribute('aria-label', "Search in overview");
  const title = card.querySelector('.section-head');
  if (title) {
    for (const b of [...title.querySelectorAll('button')]) toolbar.append(b);
    title.remove();
  }
  const extra = [...toolbar.querySelectorAll('label')];
  const filters = document.createElement('div');
  filters.className = 'filters';
  for (const el of extra) filters.append(el);
  const filterBox = document.createElement('div');
  filterBox.className = 'list-column-filter';
  filterBox.innerHTML = select('Column', 'listColumn', [['', "All columns"], ...heads.flatMap((h, i) => h.textContent.trim() ? [[String(i), h.textContent.trim()]] : [])], view.column) + field('Contains', 'listValue', view.value);
  filters.append(filterBox);
  toolbar.after(filters);
  const summary = document.createElement('div');
  summary.className = 'list-summary';
  summary.innerHTML = '<span></span>' + button('unused', "Cancel filters", 'text-button');
  table.parentElement.before(summary);
  const apply = () => {
    let count = 0;
    for (const row of rows) {
      const text = norm(row.textContent),
        target = view.column === '' ? text : norm(row.cells[+view.column]?.textContent || '');
      row.hidden = !!(view.search && !text.includes(norm(view.search)) || view.value && !target.includes(norm(view.value)));
      if (!row.hidden) count++;
    }
    summary.querySelector('span').textContent = count + ' of ' + rows.length + " records";
    if (view.sort >= 0) {
      const val = r => r.cells[view.sort]?.textContent.trim() || '',
        numeric = t => /^-?[\d\s]+(?:[,.]\d+)?(?:\s*(?:K\u010d|CZK|EUR|€))?$/.test(t) ? Number(t.replace(/\s/g, '').replace(/K\u010d|CZK|EUR|€/g, '').replace(',', '.')) : null;
      rows.sort((a, b) => {
        const av = val(a),
          bv = val(b),
          an = numeric(av),
          bn = numeric(bv);
        const date = t => {
            const m = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(t);
            return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : null;
          },
          ad = date(av),
          bd = date(bv);
        return (ad !== null && bd !== null ? ad - bd : an !== null && bn !== null ? an - bn : av.localeCompare(bv, locale(), {
          numeric: true
        })) * view.dir;
      }).forEach(r => table.tBodies[0].append(r));
    }
    heads.forEach((h, i) => {
      const b = h.querySelector('button');
      if (b) {
        b.textContent = b.dataset.label + (view.sort === i ? view.dir === 1 ? ' ↑' : ' ↓' : ' ↕');
        h.setAttribute('aria-sort', view.sort === i ? view.dir === 1 ? 'ascending' : 'descending' : 'none');
      }
    });
  };
  heads.forEach((h, i) => {
    const label = h.textContent.trim();
    if (!label) return;
    h.innerHTML = '<button type="button" class="sort-heading" data-label="' + esc(label) + '"></button>';
    h.firstChild.onclick = () => {
      view.dir = view.sort === i ? -view.dir : 1;
      view.sort = i;
      apply();
    };
  });
  search.oninput = () => {
    view.search = search.value;
    apply();
  };
  filterBox.querySelector('select').onchange = e => {
    view.column = e.target.value;
    apply();
  };
  filterBox.querySelector('input').oninput = e => {
    view.value = e.target.value;
    apply();
  };
  summary.querySelector('button').onclick = e => {
    e.stopPropagation();
    view.search = view.value = view.column = '';
    search.value = '';
    filterBox.querySelector('input').value = '';
    filterBox.querySelector('select').value = '';
    for (const s of extra.flatMap(e => [...e.querySelectorAll('select')])) {
      s.selectedIndex = 0;
      s.dispatchEvent(new Event('change'));
    }
    apply();
  };
  apply();
}
