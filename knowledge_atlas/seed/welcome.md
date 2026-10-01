---
schema: 2
status: draft
color: "#a7e87b"
tags: []
related: []
resources: []
id: welcome
title: Writing your first record
type: knowledge
parent: study
summary: One Markdown file is one map node.
---

# Your first record

Use **New record** or copy a template into the library folder. The filename must be `<id>.md`. A YAML header describes the record and the text below contains your notes.

Changes appear automatically in search, statistics and the map.

```javascript
const response = await fetch("./api/nodes");
const { nodes } = await response.json();
console.table(nodes.map(({ id, title }) => ({ id, title })));
```
