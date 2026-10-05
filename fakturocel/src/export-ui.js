import { api, base } from './api.js';
import { withProgress } from './ui.js';

export async function generateDownload(format) {
  return withProgress(format === 'excel' ? 'Generating unencrypted Excel' : 'Creating application backup', async ({ signal, update }) => {
    let id, size, complete = false;
    const timeout = AbortSignal.timeout(360000), requestSignal = AbortSignal.any([signal, timeout]);
    try {
      // Keep the start response so cancellation can always address the server worker.
      ({ id } = await api('export/start', { format }));
      while (true) {
        requestSignal.throwIfAborted();
        const status = await api('export/status?id=' + encodeURIComponent(id), undefined, { signal: requestSignal });
        if (status.error) throw Object.assign(Error(status.error), { status: status.status });
        update(status.percent, status.stage);
        if (status.ready) { size = status.size; break; }
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timer); requestSignal.removeEventListener('abort', finish); resolve(); };
          const timer = setTimeout(finish, 200);
          requestSignal.addEventListener('abort', finish, { once: true });
          if (requestSignal.aborted) finish();
        });
      }
      const res = await fetch(new URL('api/export/result?id=' + encodeURIComponent(id), base), { cache: 'no-store', signal: requestSignal });
      if (!res.ok) {
        if (res.status === 423) window.dispatchEvent(new Event('Fakturocel-locked'));
        const error = await res.json();
        throw Object.assign(Error(error.error || 'The backup could not be exported.'), { status: res.status });
      }
      if (!Number.isSafeInteger(size) || size < 1 || size > 300 * 1024 * 1024) throw Error('The downloaded file size is invalid.');
      const bytes = new Uint8Array(size), reader = res.body.getReader();
      let received = 0;
      while (true) {
        requestSignal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) break;
        if (received + value.length > size) throw Error('The downloaded file size is invalid.');
        bytes.set(value, received);
        received += value.length;
        update(90 + 9 * received / size, 'Downloading generated file…');
      }
      if (received !== size) throw Error('The download was interrupted. No file was saved. Please try again.');
      requestSignal.throwIfAborted();
      update(100, 'File generated. Ready to save.');
      complete = true;
      return { bytes, mime: res.headers.get('Content-Type') };
    } finally {
      if (id && !complete) {
        // Use a separate signal: the user's aborted request must not abort cancellation.
        try { await api('export/cancel', { id }, { signal: AbortSignal.timeout(15000) }); }
        catch (error) {
          if (![410, 423].includes(error.status)) throw Object.assign(Error('Cancellation could not be confirmed by the server. The temporary export expires automatically within six minutes.'), { cancellationUnconfirmed: true });
        }
      }
    }
  });
}
