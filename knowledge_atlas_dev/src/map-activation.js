// Defer selection so opening a document never first opens/resizes the side panel.
export function createMapActivation({
  select,
  open,
  delay = 500,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let pending = null;
  function cancel() {
    if (pending) clearTimer(pending.timer);
    pending = null;
  }
  return {
    cancel,
    click(node, event) {
      if (!node) {
        cancel();
        return;
      }
      if (
        pending?.node.id === node.id &&
        Math.hypot(event.clientX - pending.x, event.clientY - pending.y) <= 8
      ) {
        cancel();
        open(node);
        return;
      }
      cancel();
      pending = {
        node,
        x: event.clientX,
        y: event.clientY,
        timer: setTimer(() => {
          pending = null;
          select(node);
        }, delay),
      };
    },
  };
}
