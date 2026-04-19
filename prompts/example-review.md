---
name: example-review
purpose: Produce a structured review report from a unified diff
description: |
  Placeholder prompt demonstrating the prompts/ entry convention.
  Takes a diff and an optional focus area; produces a report with summary, concerns, and action items.
input_vars:
  - name: diff
    required: true
    description: unified diff of the change under review
  - name: focus
    required: false
    description: optional emphasis area such as security or performance
---

You are reviewing the following change:

```
{{diff}}
```

Focus area: {{focus}}

Produce a report with three sections: summary, concerns, action items.
