import { computeLayout } from "./map-layout.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      positions: computeLayout(data.nodes, data.layout, data.dimensions),
    });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
